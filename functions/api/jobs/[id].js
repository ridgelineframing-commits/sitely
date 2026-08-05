// GET    /api/jobs/:id   -> full job (admin) / sanitized (pm, customer)
// PUT    /api/jobs/:id   -> admin: any fields; pm: schedule/permitReady/pendingNotes only
// DELETE /api/jobs/:id   -> admin only
import { json, forbidden, sessionOf, jobForPm, jobForCustomer, jobVersion, bumpJobVersion } from '../_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function getIndex(env) {
  const raw = await env.RIDGELINE_KV.get('jobs:index');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
async function putIndex(env, index) {
  await env.RIDGELINE_KV.put('jobs:index', JSON.stringify(index));
}
function sanitizeTodos(arr) {
  return arr.filter(td => td && typeof td.text === 'string').slice(0, 300).map(td => ({
    id: String(td.id || crypto.randomUUID()).slice(0, 40),
    text: String(td.text).slice(0, 500),
    done: !!td.done
  }));
}
function sanitizeTaskContractors(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [taskId, contractorId] of Object.entries(value).slice(0, 1000)) {
    const task = String(taskId || '').slice(0, 80), contractor = String(contractorId || '').slice(0, 40);
    if (task && contractor) out[task] = contractor;
  }
  return out;
}
function sanitizeBidRequests(arr, existing) {
  const previous = new Map((Array.isArray(existing) ? existing : []).map(r => [String(r && r.id), r]));
  const cleanIds = (v, max) => Array.from(new Set((Array.isArray(v) ? v : []).map(x => String(x || '').slice(0, 80)).filter(Boolean))).slice(0, max);
  return arr.filter(r => r && typeof r === 'object').slice(0, 100).map(r => {
    const id = String(r.id || crypto.randomUUID()).slice(0, 40), old = previous.get(id) || {};
    return {
      id, token: String(old.token || r.token || crypto.randomUUID()).slice(0, 80),
      title: String(r.title || '').slice(0, 160), scope: String(r.scope || '').slice(0, 5000),
      dueDate: String(r.dueDate || '').slice(0, 10), returnEmail: String(r.returnEmail || '').slice(0, 200),
      planIds: cleanIds(r.planIds, 100), contractorIds: cleanIds(r.contractorIds, 100),
      invitedAt: Number(r.invitedAt) || null,
      bids: (Array.isArray(r.bids) ? r.bids : []).filter(b => b && typeof b === 'object').slice(0, 100).map(b => ({
        contractorId: String(b.contractorId || '').slice(0, 40), amount: Math.round((Number(b.amount) || 0) * 100) / 100,
        receivedAt: String(b.receivedAt || '').slice(0, 10), notes: String(b.notes || '').slice(0, 2000)
      })).filter(b => b.contractorId),
      selectedContractorId: String(r.selectedContractorId || '').slice(0, 40),
      createdAt: Number(old.createdAt) || Number(r.createdAt) || Date.now()
    };
  });
}

// Change orders. A signature can only be added by the signing endpoint, so we carry the
// existing signature fields across from the stored copy and ignore whatever the client sent.
// Same for 'approved' — a CO becomes approved by being signed, or by the owner explicitly
// approving it on a CO that carries no signature (paper/verbal, recorded as such).
const CO_STATUS = ['draft', 'sent', 'approved', 'declined'];
function sanitizeChangeOrders(arr, existing) {
  const prev = new Map((Array.isArray(existing) ? existing : []).map(co => [String(co && co.id), co]));
  return arr.filter(co => co && typeof co === 'object').slice(0, 300).map((co, i) => {
    const id = String(co.id || crypto.randomUUID()).slice(0, 40);
    const old = prev.get(id) || {};
    const status = CO_STATUS.indexOf(co.status) >= 0 ? co.status : 'draft';
    return {
      id,
      no: Number(co.no) || i + 1,
      title: String(co.title || '').slice(0, 200),
      desc: String(co.desc || '').slice(0, 4000),
      amount: Math.round((Number(co.amount) || 0) * 100) / 100,
      days: Math.round(Number(co.days) || 0),
      status,
      createdAt: Number(old.createdAt) || Number(co.createdAt) || Date.now(),
      sentAt: old.sentAt || (status !== 'draft' && !old.sentAt ? Date.now() : null),
      // signature state is server-owned
      signedAt: old.signedAt || null,
      signedBy: old.signedBy || null,
      signatureId: old.signatureId || null
    };
  });
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const session = sessionOf(context);
  const raw = await env.RIDGELINE_KV.get('job:' + params.id);
  if (!raw) return json({ error: 'not found' }, 404);

  const job = JSON.parse(raw);
  job.version = jobVersion(job);
  if (session.role === 'admin') return json(job);
  if (session.role === 'pm') return json(jobForPm(job));
  if (session.role === 'customer') {
    if (!(session.jobIds || []).includes(job.id)) return forbidden();
    return json(jobForCustomer(job));
  }
  return forbidden();
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const session = sessionOf(context);
  if (session.role !== 'admin' && session.role !== 'pm') return forbidden();

  const raw = await env.RIDGELINE_KV.get('job:' + params.id);
  if (!raw) return json({ error: 'not found' }, 404);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }

  const job = JSON.parse(raw);
  const currentVersion = jobVersion(job);
  const baseVersion = Number(body && body.baseVersion);
  if (!Number.isFinite(baseVersion)) {
    return json({ error: 'baseVersion required; reload the job before saving', currentVersion }, 428);
  }
  if (baseVersion !== currentVersion) {
    return json({ error: 'job changed on another device', currentVersion, updatedAt: job.updatedAt }, 409);
  }

  if (session.role === 'admin') {
    if (body && typeof body.edits === 'object' && body.edits !== null) job.edits = body.edits;
    if (body && typeof body.estimate === 'object' && body.estimate !== null) job.estimate = body.estimate;
    if (body && Array.isArray(body.schedule)) job.schedule = body.schedule;
    if (body && typeof body.permitReady === 'string') job.permitReady = body.permitReady;
    if (body && Array.isArray(body.draws)) job.draws = body.draws;
    if (body && typeof body.customer === 'object' && body.customer !== null) job.customer = body.customer;
    if (body && ['active', 'prospect', 'warranty', 'archive'].indexOf(body.status) >= 0) job.status = body.status;
    if (body && typeof body.portal === 'object' && body.portal !== null) {
      job.portal = { showSchedule: body.portal.showSchedule !== false, showDraws: body.portal.showDraws !== false, showAllowances: body.portal.showAllowances !== false };
    }
    if (body && typeof body.warrantyStart === 'string') job.warrantyStart = body.warrantyStart.slice(0, 10);
    if (body && Array.isArray(body.pendingNotes)) job.pendingNotes = body.pendingNotes;
    if (body && typeof body.name === 'string' && body.name.trim()) job.name = body.name.trim().slice(0, 120);
    if (body && Array.isArray(body.todos)) job.todos = sanitizeTodos(body.todos);
    if (body && body.taskContractors && typeof body.taskContractors === 'object') job.taskContractors = sanitizeTaskContractors(body.taskContractors);
    if (body && Array.isArray(body.bidRequests)) job.bidRequests = sanitizeBidRequests(body.bidRequests, job.bidRequests);
    // Native estimating engine: takeoff inputs + rough-quote state (quotes keyed in, manual lines)
    if (body && typeof body.takeoff === 'object' && body.takeoff !== null) job.takeoff = body.takeoff;
    if (body && typeof body.roughQuote === 'object' && body.roughQuote !== null) job.roughQuote = body.roughQuote;
    // Change orders. Signature fields are deliberately NOT writable here — only the
    // signing endpoint may mark one signed, so an admin PUT can't forge a signature.
    if (body && Array.isArray(body.changeOrders)) job.changeOrders = sanitizeChangeOrders(body.changeOrders, job.changeOrders);
  } else if (session.role === 'pm') {
    // field crew: schedule + notes + to-dos only — pricing, draws, customer data and worksheets stay untouched
    if (body && Array.isArray(body.schedule)) job.schedule = body.schedule;
    if (body && Array.isArray(body.todos)) job.todos = sanitizeTodos(body.todos);
    if (body && body.taskContractors && typeof body.taskContractors === 'object') job.taskContractors = sanitizeTaskContractors(body.taskContractors);
    if (body && typeof body.permitReady === 'string') job.permitReady = body.permitReady;
    if (body && Array.isArray(body.pendingNotes)) {
      const clean = body.pendingNotes.filter(n => n && typeof n.text === 'string').slice(0, 200).map(n => ({
        id: String(n.id || crypto.randomUUID()),
        by: String(n.by || session.name || 'PM').slice(0, 60),
        target: ['estimate', 'draws', 'schedule', 'general'].indexOf(n.target) >= 0 ? n.target : 'general',
        text: String(n.text).slice(0, 2000),
        ts: Number(n.ts) || Date.now(),
        status: ['pending', 'approved', 'rejected'].indexOf(n.status) >= 0 ? n.status : 'pending'
      }));
      // PMs can't silently flip their notes to approved
      const prev = {};
      for (const n of (job.pendingNotes || [])) prev[n.id] = n.status;
      for (const n of clean) if (n.status === 'approved' && prev[n.id] !== 'approved') n.status = 'pending';
      job.pendingNotes = clean;
    }
  }

  bumpJobVersion(job);

  const meta = { id: job.id, name: job.name, status: job.status || 'active', version: job.version, updatedAt: job.updatedAt, editCount: Object.keys(job.edits || {}).length };

  const index = await getIndex(env);
  const i = index.findIndex(j => j.id === job.id);
  if (i >= 0) index[i] = meta; else index.push(meta);

  await env.RIDGELINE_KV.put('job:' + job.id, JSON.stringify(job));
  await putIndex(env, index);

  return json(meta);
}

export async function onRequestDelete(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const { env, params } = context;
  const index = await getIndex(env);
  // Remove the job's uploaded plan files from R2 so they don't linger (still fetchable) after
  // the job is gone. Best-effort — orphaned bytes are better than a delete that won't complete.
  if (env.PLANS) {
    try {
      let cursor;
      do {
        const listed = await env.PLANS.list({ prefix: 'plans/' + params.id + '/', cursor });
        if (listed.objects && listed.objects.length) await env.PLANS.delete(listed.objects.map(o => o.key));
        cursor = listed.truncated ? listed.cursor : null;
      } while (cursor);
    } catch (e) { /* leave orphans rather than blocking the job delete */ }
  }
  await env.RIDGELINE_KV.delete('job:' + params.id);
  await putIndex(env, index.filter(j => j.id !== params.id));
  return json({ ok: true });
}
