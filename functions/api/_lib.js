// Shared helpers for auth + role-aware sanitization.

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: JSON_HEADERS });
}

export function forbidden() { return json({ error: 'forbidden' }, 403); }

// ---- users store (KV key 'users' = [{id,name,email?,role,salt,hash,jobIds?}]) ----
export async function getUsers(env) {
  const raw = await env.RIDGELINE_KV.get('users');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function putUsers(env, users) {
  await env.RIDGELINE_KV.put('users', JSON.stringify(users));
}

export async function hashPassword(salt, password) {
  const data = new TextEncoder().encode(salt + ':' + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- session helpers ----
export function sessionOf(context) {
  // The middleware always sets a validated session for gated routes. If it is somehow
  // missing, default to an unprivileged role — never fall open to admin.
  return (context.data && context.data.session) || { role: 'none' };
}

// ---- safe file download headers (prevent stored-XSS from uploaded plan/board files) ----
// Only a small allowlist of inert types is served inline; everything else (html, svg, js…)
// is forced to download as an opaque octet-stream so it can never execute on our origin.
const SAFE_INLINE_TYPES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'
]);
export function fileResponseHeaders(obj, name) {
  const headers = new Headers();
  const stored = ((obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const inline = SAFE_INLINE_TYPES.has(stored);
  const fname = String(name || 'file').replace(/[\r\n"\\]/g, '_').slice(0, 200);
  headers.set('Content-Type', inline ? stored : 'application/octet-stream');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', (inline ? 'inline' : 'attachment') + '; filename="' + fname + '"');
  headers.set('Cache-Control', 'private, max-age=3600');
  return headers;
}

// ---- money math (mirror of keystone.js lineCalc/estTotals) ----
export function estContractTotal(est) {
  if (!est || !Array.isArray(est.items)) return 0;
  const s = est.settings || {};
  let tot = 0;
  for (const it of est.items) {
    if (it.excluded) continue;
    for (const l of (it.costLines || [])) {
      const cost = (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
      const mk = l.markupPct != null ? Number(l.markupPct) : (Number(s.defaultMarkupPct) || 0);
      const price = cost * (1 + mk);
      tot += price + (l.taxable ? price * (Number(s.salesTaxPct) || 0) : 0);
    }
  }
  return tot;
}

export function scheduleProgress(schedule) {
  const rows = Array.isArray(schedule) ? schedule : [];
  if (!rows.length) return { pct: 0, phase: null };
  const done = rows.filter(r => r.status === 'Complete').length;
  const inProg = rows.filter(r => r.status === 'In Progress').length;
  const pct = Math.round(100 * (done + 0.5 * inProg) / rows.length);
  const cur = rows.find(r => r.status === 'In Progress') || rows.find(r => r.status !== 'Complete');
  return { pct, phase: cur ? String(cur.task).replace(/^\d{4}\s*/, '') : (done ? 'Complete' : null) };
}

// ---- role views of a job document ----
export function jobForPm(job) {
  const cust = job.customer || {};
  return {
    id: job.id, name: job.name, status: job.status || 'active',
    permitReady: job.permitReady || null,
    schedule: job.schedule || [],
    pendingNotes: job.pendingNotes || [],
    todos: job.todos || [],
    plans: (job.plans || []).map(p => ({ id: p.id, name: p.name, size: p.size, type: p.type, uploadedAt: p.uploadedAt })),
    customer: { name: cust.name || '', phone: cust.phone || '', address: cust.address || '', email: cust.email || '' },
    edits: {},           // worksheets carry pricing — PMs get a clean workbook
    updatedAt: job.updatedAt
  };
}

function itemContractTotal(item, settings) {
  const s = settings || {};
  let tot = 0;
  for (const l of (item.costLines || [])) {
    const cost = (Number(l.qty) || 0) * (Number(l.unitCost) || 0);
    const mk = l.markupPct != null ? Number(l.markupPct) : (Number(s.defaultMarkupPct) || 0);
    const price = cost * (1 + mk);
    tot += price + (l.taxable ? price * (Number(s.salesTaxPct) || 0) : 0);
  }
  return tot;
}

export function jobForCustomer(job) {
  const portal = job.portal || {};
  const showSchedule = portal.showSchedule !== false;
  const showDraws = portal.showDraws !== false;
  const showAllowances = portal.showAllowances !== false;
  const prog = scheduleProgress(job.schedule);
  const contract = estContractTotal(job.estimate);
  let draws = null;
  if (showDraws && Array.isArray(job.draws)) {
    draws = job.draws.map(d => ({
      no: d.no, name: d.name, status: d.status,
      amt: Math.round(contract * (Number(d.pct) || 0)) / 100
    }));
  }
  let allowances = null;
  if (showAllowances && job.estimate && Array.isArray(job.estimate.items)) {
    allowances = job.estimate.items
      .filter(i => i.allowance && !i.excluded)
      .map(i => ({
        name: i.name, code: i.code || '',
        budget: i.allowanceBudget ? { qty: i.allowanceBudget.qty, unit: i.allowanceBudget.unit, price: i.allowanceBudget.price } : null,
        total: Math.round(itemContractTotal(i, job.estimate.settings) * 100) / 100
      }));
    if (!allowances.length) allowances = null;
  }
  return {
    id: job.id, name: job.name, status: job.status || 'active',
    progressPct: prog.pct, phase: prog.phase,
    schedule: showSchedule ? (job.schedule || []).map(r => ({ id: r.id, task: r.task, group: r.group || null, start: r.start, finish: r.finish, status: r.status, pct: r.pct })) : null,
    draws,
    contractTotal: showDraws ? Math.round(contract * 100) / 100 : null,
    allowances,
    edits: {},
    updatedAt: job.updatedAt
  };
}
