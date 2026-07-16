// GET  /api/jobs/:id/plans   -> [{id,name,size,type,uploadedAt}]  (admin/pm)
// POST /api/jobs/:id/plans   -> upload a plan file (admin). Raw body = file bytes.
//   Headers: X-Filename (encodeURIComponent'd), Content-Type.
import { json, forbidden, sessionOf } from '../../../_lib.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  if (sessionOf(context).role === 'customer') return forbidden();
  const raw = await env.RIDGELINE_KV.get('job:' + params.id);
  if (!raw) return json({ error: 'not found' }, 404);
  return json(JSON.parse(raw).plans || []);
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (sessionOf(context).role === 'customer') return forbidden(); // admin + pm can upload (field photos)
  if (!env.PLANS) return json({ error: 'Plan storage is not set up yet (R2 bucket "ridgeline-plans" missing).' }, 503);
  const raw = await env.RIDGELINE_KV.get('job:' + params.id);
  if (!raw) return json({ error: 'not found' }, 404);
  const job = JSON.parse(raw);
  if (Array.isArray(job.plans) && job.plans.length >= 500) return json({ error: 'too many files on this job (500 max)' }, 409);

  let name = 'plan';
  try { name = decodeURIComponent(request.headers.get('X-Filename') || 'plan'); } catch (e) { name = request.headers.get('X-Filename') || 'plan'; }
  name = String(name).slice(0, 200);
  const type = (request.headers.get('Content-Type') || 'application/octet-stream').slice(0, 100);

  // Enforce the size limit BEFORE reading, and stream the body straight to R2 — never buffer
  // the whole file in Worker memory (a 100MB arrayBuffer risks OOM against the ~128MB ceiling).
  const len = Number(request.headers.get('Content-Length') || 0);
  if (!len) return json({ error: 'missing Content-Length' }, 411);
  if (len > 100 * 1024 * 1024) return json({ error: 'file too large (100MB max)' }, 413);

  const fileId = crypto.randomUUID();
  await env.PLANS.put('plans/' + params.id + '/' + fileId, request.body, { httpMetadata: { contentType: type }, customMetadata: { name } });

  const meta = { id: fileId, name, size: len, type, uploadedAt: Date.now() };
  job.plans = Array.isArray(job.plans) ? job.plans : [];
  job.plans.push(meta);
  job.updatedAt = Date.now();
  await env.RIDGELINE_KV.put('job:' + job.id, JSON.stringify(job));
  return json(meta);
}
