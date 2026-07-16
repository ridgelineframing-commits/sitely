// GET    /api/jobs/:id   -> full job (admin) / sanitized (pm, customer)
// PUT    /api/jobs/:id   -> admin: any fields; pm: schedule/permitReady/pendingNotes only
// DELETE /api/jobs/:id   -> admin only
import { json, forbidden, sessionOf, jobForPm, jobForCustomer } from '../_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function getIndex(env) {
  const raw = await env.RIDGELINE_KV.get('jobs:index');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
async function putIndex(env, index) {
  await env.RIDGELINE_KV.put('jobs:index', JSON.stringify(index));
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const session = sessionOf(context);
  const raw = await env.RIDGELINE_KV.get('job:' + params.id);
  if (!raw) return json({ error: 'not found' }, 404);

  if (session.role === 'admin') return new Response(raw, { headers: JSON_HEADERS });

  const job = JSON.parse(raw);
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
  if (session.role === 'customer') return forbidden();

  const raw = await env.RIDGELINE_KV.get('job:' + params.id);
  if (!raw) return json({ error: 'not found' }, 404);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }

  const job = JSON.parse(raw);

  if (session.role === 'admin') {
    if (body && typeof body.edits === 'object' && body.edits !== null) job.edits = body.edits;
    if (body && typeof body.estimate === 'object' && body.estimate !== null) job.estimate = body.estimate;
    if (body && Array.isArray(body.schedule)) job.schedule = body.schedule;
    if (body && typeof body.permitReady === 'string') job.permitReady = body.permitReady;
    if (body && Array.isArray(body.draws)) job.draws = body.draws;
    if (body && typeof body.customer === 'object' && body.customer !== null) job.customer = body.customer;
    if (body && ['active', 'prospect', 'warranty', 'archive'].indexOf(body.status) >= 0) job.status = body.status;
    if (body && typeof body.portal === 'object' && body.portal !== null) {
      job.portal = { showSchedule: body.portal.showSchedule !== false, showDraws: body.portal.showDraws !== false };
    }
    if (body && typeof body.warrantyStart === 'string') job.warrantyStart = body.warrantyStart.slice(0, 10);
    if (body && Array.isArray(body.pendingNotes)) job.pendingNotes = body.pendingNotes;
    if (body && typeof body.name === 'string' && body.name.trim()) job.name = body.name.trim().slice(0, 120);
  } else if (session.role === 'pm') {
    // field crew: schedule + notes only — pricing, draws, customer data and worksheets stay untouched
    if (body && Array.isArray(body.schedule)) job.schedule = body.schedule;
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

  job.updatedAt = Date.now();

  const meta = { id: job.id, name: job.name, status: job.status || 'active', updatedAt: job.updatedAt, editCount: Object.keys(job.edits || {}).length };

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
  await env.RIDGELINE_KV.delete('job:' + params.id);
  await putIndex(env, index.filter(j => j.id !== params.id));
  return json({ ok: true });
}
