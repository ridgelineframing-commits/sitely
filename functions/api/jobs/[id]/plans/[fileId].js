// GET    /api/jobs/:id/plans/:fileId   -> the file bytes (admin/pm). Client fetches authed -> blob.
// DELETE /api/jobs/:id/plans/:fileId   -> remove file + metadata (admin).
import { json, forbidden, sessionOf, fileResponseHeaders } from '../../../_lib.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  if (sessionOf(context).role === 'customer') return forbidden();
  if (!env.PLANS) return json({ error: 'plan storage not set up' }, 503);
  const obj = await env.PLANS.get('plans/' + params.id + '/' + params.fileId);
  if (!obj) return json({ error: 'not found' }, 404);
  // Force a safe content-type / attachment so an uploaded HTML/SVG can't run on our origin.
  const name = (obj.customMetadata && obj.customMetadata.name) || params.fileId;
  return new Response(obj.body, { headers: fileResponseHeaders(obj, name) });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  if (sessionOf(context).role !== 'admin') return forbidden();
  const raw = await env.RIDGELINE_KV.get('job:' + params.id);
  if (!raw) return json({ error: 'not found' }, 404);
  const job = JSON.parse(raw);
  // Delete the object first; if R2 errors, let it throw (500) rather than dropping the
  // metadata and orphaning the bytes. (R2 delete of a missing key is a no-op, not an error.)
  if (env.PLANS) await env.PLANS.delete('plans/' + params.id + '/' + params.fileId);
  job.plans = (job.plans || []).filter(p => p.id !== params.fileId);
  job.updatedAt = Date.now();
  await env.RIDGELINE_KV.put('job:' + job.id, JSON.stringify(job));
  return json({ ok: true });
}
