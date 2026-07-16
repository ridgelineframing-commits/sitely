// GET    /api/jobs/:id/plans/:fileId   -> the file bytes (admin/pm). Client fetches authed -> blob.
// DELETE /api/jobs/:id/plans/:fileId   -> remove file + metadata (admin).
import { json, forbidden, sessionOf } from '../../../_lib.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  if (sessionOf(context).role === 'customer') return forbidden();
  if (!env.PLANS) return json({ error: 'plan storage not set up' }, 503);
  const obj = await env.PLANS.get('plans/' + params.id + '/' + params.fileId);
  if (!obj) return json({ error: 'not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  if (sessionOf(context).role !== 'admin') return forbidden();
  const raw = await env.RIDGELINE_KV.get('job:' + params.id);
  if (!raw) return json({ error: 'not found' }, 404);
  const job = JSON.parse(raw);
  if (env.PLANS) { try { await env.PLANS.delete('plans/' + params.id + '/' + params.fileId); } catch (e) {} }
  job.plans = (job.plans || []).filter(p => p.id !== params.fileId);
  job.updatedAt = Date.now();
  await env.RIDGELINE_KV.put('job:' + job.id, JSON.stringify(job));
  return json({ ok: true });
}
