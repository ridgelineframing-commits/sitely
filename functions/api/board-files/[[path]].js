// Whiteboard note attachments for notes not yet assigned to a job.
// Files live in the PLANS R2 bucket under 'plans/_board/<id>'; when the note gets
// assigned to a job the file is MOVED into that job's plans (so it shows on the
// job's Plans tab) while the note keeps a link.
//   POST   /api/board-files            -> upload (raw body; X-Filename + Content-Type headers)
//   GET    /api/board-files/:id        -> file bytes
//   DELETE /api/board-files/:id        -> remove
//   POST   /api/board-files/:id/move   -> {jobId} moves file into that job's plans list
// admin + pm; never customers.
import { json, forbidden, sessionOf } from '../_lib.js';

function seg(context) {
  const p = context.params.path;
  return Array.isArray(p) ? p : (p ? [p] : []);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (sessionOf(context).role === 'customer') return forbidden();
  if (!env.PLANS) return json({ error: 'Plan storage is not set up yet (R2 bucket "ridgeline-plans" missing).' }, 503);
  const parts = seg(context);

  // POST /api/board-files/:id/move
  if (parts.length === 2 && parts[1] === 'move') {
    const fileId = parts[0];
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
    const jobId = String((body && body.jobId) || '');
    if (!jobId) return json({ error: 'jobId required' }, 400);
    const raw = await env.RIDGELINE_KV.get('job:' + jobId);
    if (!raw) return json({ error: 'job not found' }, 404);
    const obj = await env.PLANS.get('plans/_board/' + fileId);
    if (!obj) return json({ error: 'file not found' }, 404);
    const name = (obj.customMetadata && obj.customMetadata.name) || 'whiteboard file';
    const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream';
    const buf = await obj.arrayBuffer();
    await env.PLANS.put('plans/' + jobId + '/' + fileId, buf, { httpMetadata: { contentType: type } });
    try { await env.PLANS.delete('plans/_board/' + fileId); } catch (e) {}
    const job = JSON.parse(raw);
    const meta = { id: fileId, name, size: buf.byteLength, type, uploadedAt: Date.now() };
    job.plans = Array.isArray(job.plans) ? job.plans : [];
    if (!job.plans.find(p => p.id === fileId)) job.plans.push(meta);
    job.updatedAt = Date.now();
    await env.RIDGELINE_KV.put('job:' + job.id, JSON.stringify(job));
    return json(meta);
  }

  // POST /api/board-files  (upload)
  if (parts.length !== 0) return json({ error: 'not found' }, 404);
  let name = 'file';
  try { name = decodeURIComponent(request.headers.get('X-Filename') || 'file'); } catch (e) { name = request.headers.get('X-Filename') || 'file'; }
  name = String(name).slice(0, 200);
  const type = request.headers.get('Content-Type') || 'application/octet-stream';
  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return json({ error: 'empty file' }, 400);
  if (buf.byteLength > 100 * 1024 * 1024) return json({ error: 'file too large (100MB max)' }, 413);
  const fileId = crypto.randomUUID();
  await env.PLANS.put('plans/_board/' + fileId, buf, { httpMetadata: { contentType: type }, customMetadata: { name } });
  return json({ id: fileId, name, size: buf.byteLength, type });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (sessionOf(context).role === 'customer') return forbidden();
  if (!env.PLANS) return json({ error: 'plan storage not set up' }, 503);
  const parts = seg(context);
  if (parts.length !== 1) return json({ error: 'not found' }, 404);
  const obj = await env.PLANS.get('plans/_board/' + parts[0]);
  if (!obj) return json({ error: 'not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
}

export async function onRequestDelete(context) {
  const { env } = context;
  if (sessionOf(context).role === 'customer') return forbidden();
  if (!env.PLANS) return json({ error: 'plan storage not set up' }, 503);
  const parts = seg(context);
  if (parts.length !== 1) return json({ error: 'not found' }, 404);
  try { await env.PLANS.delete('plans/_board/' + parts[0]); } catch (e) {}
  return json({ ok: true });
}
