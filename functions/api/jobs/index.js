// GET  /api/jobs          -> [{ id, name, status, updatedAt, editCount }]  (customers: only their jobs)
// POST /api/jobs {name, edits?, status?} -> meta   (admin only)
import { json, forbidden, sessionOf } from '../_lib.js';

async function getIndex(env) {
  const raw = await env.RIDGELINE_KV.get('jobs:index');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

export async function onRequestGet(context) {
  const session = sessionOf(context);
  let index = await getIndex(context.env);
  index.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (session.role === 'customer') {
    const allowed = new Set(session.jobIds || []);
    index = index.filter(j => allowed.has(j.id)).map(j => ({ id: j.id, name: j.name, status: j.status || 'active', updatedAt: j.updatedAt }));
  }
  return json(index);
}

export async function onRequestPost(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
  const name = String((body && body.name) || '').trim().slice(0, 120) || 'Untitled Job';
  const edits = (body && typeof body.edits === 'object' && body.edits) || {};

  const STATUSES = ['active', 'prospect', 'warranty', 'archive'];
  const status = STATUSES.indexOf(body && body.status) >= 0 ? body.status : 'active';

  const id = crypto.randomUUID();
  const now = Date.now();
  const job = { id, name, edits, status, updatedAt: now };

  const index = await getIndex(env);
  const meta = { id, name, status, updatedAt: now, editCount: Object.keys(edits).length };
  index.push(meta);

  await env.RIDGELINE_KV.put('job:' + id, JSON.stringify(job));
  await env.RIDGELINE_KV.put('jobs:index', JSON.stringify(index));

  return json(meta, 201);
}
