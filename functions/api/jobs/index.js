// GET  /api/jobs          -> [{ id, name, status, updatedAt, editCount }]  (customers: only their jobs)
// POST /api/jobs {name, edits?, status?} -> meta   (admin only)
import { json, forbidden, sessionOf } from '../_lib.js';

async function getIndex(env) {
  const raw = await env.RIDGELINE_KV.get('jobs:index');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

const metaOf = job => ({
  id: job.id, name: job.name, status: job.status || 'active',
  updatedAt: job.updatedAt || 0, editCount: Object.keys(job.edits || {}).length
});

// KV has no transactions, so two writers rewriting jobs:index at once can drop an entry —
// leaving a job that still exists at job:<id> but is invisible in every listing. Jobs are
// stored per-key, so we can self-heal: scan the job: keyspace and re-add anything the index
// is missing. (Job *content* remains last-write-wins by design — see DEPLOY.md.)
async function reconciledIndex(env) {
  const index = await getIndex(env);
  const known = new Set(index.map(j => j.id));
  let cursor, added = false;
  do {
    const page = await env.RIDGELINE_KV.list({ prefix: 'job:', cursor });
    for (const k of page.keys) {
      const id = k.name.slice(4); // strip "job:"
      if (known.has(id)) continue;
      const raw = await env.RIDGELINE_KV.get(k.name);
      if (!raw) continue;
      try { index.push(metaOf(JSON.parse(raw))); known.add(id); added = true; } catch (e) {}
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  if (added) await env.RIDGELINE_KV.put('jobs:index', JSON.stringify(index)); // best-effort repair
  return index;
}

export async function onRequestGet(context) {
  const session = sessionOf(context);
  let index = await reconciledIndex(context.env);
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
  const meta = metaOf(job);
  index.push(meta);

  // Write the job first: if the index write is lost to a concurrent writer, the job still
  // exists at job:<id> and reconciledIndex() will re-add it on the next listing.
  await env.RIDGELINE_KV.put('job:' + id, JSON.stringify(job));
  await env.RIDGELINE_KV.put('jobs:index', JSON.stringify(index));

  return json(meta, 201);
}
