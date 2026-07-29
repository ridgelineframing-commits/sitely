// Office side of e-signing (admin only).
//   GET  /api/signatures?jobId=<id>   -> every signature request on that job
//   POST /api/signatures {jobId, kind, refId, title, summary, amount, signerName, signerEmail}
//        -> creates the request and returns it WITH its signing link
import { json, forbidden, sessionOf, bumpJobVersion } from '../_lib.js';
import { listForJob, createRequest, adminView, getRequest, putRequest, logEvent } from '../_sign.js';

export async function onRequestGet(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const url = new URL(context.request.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId required' }, 400);
  const reqs = await listForJob(context.env, jobId);
  return json(reqs.map(r => Object.assign(adminView(r), { link: '/sign/' + r.token })));
}

export async function onRequestPost(context) {
  const session = sessionOf(context);
  if (session.role !== 'admin') return forbidden();
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
  if (!body || !body.jobId) return json({ error: 'jobId required' }, 400);

  const raw = await context.env.RIDGELINE_KV.get('job:' + body.jobId);
  if (!raw) return json({ error: 'job not found' }, 404);
  const job = JSON.parse(raw);

  const req = await createRequest(context.env, {
    jobId: body.jobId,
    jobName: job.name || '',
    kind: body.kind,
    refId: body.refId,
    title: body.title,
    summary: body.summary,
    amount: body.amount,
    signerName: body.signerName || (job.customer && job.customer.name) || '',
    signerEmail: body.signerEmail || (job.customer && job.customer.email) || '',
    createdBy: session.name || 'office'
  });

  // Sending a change order for signature moves it out of draft on the job record too.
  if (req.kind === 'change_order' && req.refId) {
    const co = (job.changeOrders || []).find(x => x && x.id === req.refId);
    if (co && co.status === 'draft') {
      co.status = 'sent';
      co.sentAt = Date.now();
      bumpJobVersion(job);
      await context.env.RIDGELINE_KV.put('job:' + body.jobId, JSON.stringify(job));
    }
  }
  return json(Object.assign(adminView(req), { link: '/sign/' + req.token }), 201);
}

export async function onRequestDelete(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  const req = await getRequest(context.env, id);
  if (!req) return json({ error: 'not found' }, 404);
  // A signed record is never deleted — voiding is the reversal, and it stays in the history.
  req.status = req.status === 'signed' ? 'signed' : 'voided';
  if (req.status === 'voided') logEvent(req, 'voided', '');
  await putRequest(context.env, req);
  return json({ ok: true, status: req.status });
}
