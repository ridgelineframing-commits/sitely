// Shared helpers for auth + role-aware sanitization.

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: JSON_HEADERS });
}

export function forbidden() { return json({ error: 'forbidden' }, 403); }

export function jobVersion(job) {
  return Math.max(1, Number(job && job.version) || 1);
}

export function bumpJobVersion(job) {
  job.version = jobVersion(job) + 1;
  job.updatedAt = Date.now();
  return job.version;
}

// ---- users store (KV key 'users' = [{id,name,email?,role,salt,hash,jobIds?}]) ----
export async function getUsers(env) {
  const raw = await env.RIDGELINE_KV.get('users');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}
export async function putUsers(env, users) {
  await env.RIDGELINE_KV.put('users', JSON.stringify(users));
}

// Legacy password hash. Kept only so existing accounts can be upgraded in
// place the first time they successfully sign in.
export async function hashPassword(salt, password) {
  const data = new TextEncoder().encode(salt + ':' + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const PASSWORD_HASH_VERSION = 2;
export const PASSWORD_HASH_ITERATIONS = 210000;

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  const clean = String(value || '');
  if (!clean || clean.length % 2) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqual(a, b) {
  const aa = fromHex(a), bb = fromHex(b);
  if (aa.length !== bb.length || !aa.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export async function passwordHash(salt, password, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password || '')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(String(salt || '')),
    iterations: Number(iterations) || PASSWORD_HASH_ITERATIONS
  }, key, 256);
  return hex(bits);
}

export async function verifyPassword(user, password) {
  if (!user || !user.salt || !user.hash) return false;
  if (Number(user.hashVersion) === PASSWORD_HASH_VERSION) {
    const got = await passwordHash(user.salt, password, user.hashIterations);
    return constantTimeEqual(got, user.hash);
  }
  return constantTimeEqual(await hashPassword(user.salt, password), user.hash);
}

export async function upgradePasswordHash(user, password) {
  if (!user || Number(user.hashVersion) === PASSWORD_HASH_VERSION) return false;
  user.salt = newSalt();
  user.hashIterations = PASSWORD_HASH_ITERATIONS;
  user.hash = await passwordHash(user.salt, password, user.hashIterations);
  user.hashVersion = PASSWORD_HASH_VERSION;
  return true;
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

// Approved change orders ride on top of the base estimate — that sum is the number the
// customer is actually on the hook for, and the number draws are billed against.
export function changeOrderTotal(changeOrders) {
  if (!Array.isArray(changeOrders)) return 0;
  let t = 0;
  for (const co of changeOrders) if (co && co.status === 'approved') t += Number(co.amount) || 0;
  return t;
}

// Base estimate + approved change orders.
export function jobContractTotal(job) {
  if (!job) return 0;
  return estContractTotal(job.estimate) + changeOrderTotal(job.changeOrders);
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
    id: job.id, name: job.name, status: job.status || 'active', version: jobVersion(job),
    permitReady: job.permitReady || null,
    schedule: job.schedule || [],
    taskContractors: job.taskContractors || {},
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
  const base = estContractTotal(job.estimate);
  // draws bill against the base contract plus anything the customer already approved
  const contract = base + changeOrderTotal(job.changeOrders);
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
    id: job.id, name: job.name, status: job.status || 'active', version: jobVersion(job),
    progressPct: prog.pct, phase: prog.phase,
    schedule: showSchedule ? (job.schedule || []).map(r => ({ id: r.id, task: r.task, group: r.group || null, start: r.start, finish: r.finish, status: r.status, pct: r.pct })) : null,
    draws,
    contractTotal: showDraws ? Math.round(contract * 100) / 100 : null,
    baseContract: showDraws ? Math.round(base * 100) / 100 : null,
    // Change orders the customer has been sent — they need to see (and sign) these.
    changeOrders: (job.changeOrders || [])
      .filter(co => co && co.status !== 'draft')
      .map(co => ({
        id: co.id, no: co.no, title: co.title || '', desc: co.desc || '',
        amount: Math.round((Number(co.amount) || 0) * 100) / 100,
        days: Number(co.days) || 0, status: co.status,
        sentAt: co.sentAt || null, signedAt: co.signedAt || null,
        signedBy: co.signedBy || null
      })),
    allowances,
    edits: {},
    updatedAt: job.updatedAt
  };
}
