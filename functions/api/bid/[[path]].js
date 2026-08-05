import { json, fileResponseHeaders } from '../_lib.js';

function invitation(job, requestId, token) {
  return (job.bidRequests || []).find(r => r && r.id === requestId && r.token === token) || null;
}

export async function onRequestGet(context) {
  const rawParts = Array.isArray(context.params.path) ? context.params.path : String(context.params.path || '').split('/');
  const parts = rawParts.filter(Boolean).map(decodeURIComponent);
  const [jobId, requestId, token, filesWord, fileId] = parts;
  if (!jobId || !requestId || !token || (parts.length !== 3 && !(parts.length === 5 && filesWord === 'files'))) return json({ error: 'not found' }, 404);
  const raw = await context.env.RIDGELINE_KV.get('job:' + jobId);
  if (!raw) return json({ error: 'not found' }, 404);
  const job = JSON.parse(raw), req = invitation(job, requestId, token);
  if (!req) return json({ error: 'not found' }, 404);
  const selected = new Set(req.planIds || []);
  const plans = (job.plans || []).filter(p => selected.has(p.id)).map(p => ({ id: p.id, name: p.name, size: p.size, type: p.type }));
  if (!fileId) return json({
    job: { name: String(job.name || '').slice(0, 160) },
    request: { id: req.id, title: req.title, scope: req.scope, dueDate: req.dueDate, returnEmail: req.returnEmail },
    plans
  });
  if (!selected.has(fileId) || !plans.find(p => p.id === fileId) || !context.env.PLANS) return json({ error: 'not found' }, 404);
  const obj = await context.env.PLANS.get('plans/' + jobId + '/' + fileId);
  if (!obj) return json({ error: 'not found' }, 404);
  const meta = plans.find(p => p.id === fileId);
  return new Response(obj.body, { headers: fileResponseHeaders(obj, meta.name) });
}
