// Public signing endpoints. The token in the URL is the credential (see the exemption in
// functions/api/_middleware.js), so a customer can sign from a link without a Sitely login.
//
//   GET  /api/sign/<token>          -> what am I being asked to sign
//   POST /api/sign/<token>          -> { typedName, signatureImage, consent, docHash }
//   POST /api/sign/<token>/decline  -> { reason }
import { json, bumpJobVersion } from '../_lib.js';
import { getByToken, putRequest, logEvent, signRequest, publicView, nowIso, hashIp } from '../_sign.js';

function parts(context) {
  const p = context.params.path;
  return Array.isArray(p) ? p : (p ? [p] : []);
}

export async function onRequestGet(context) {
  const [token] = parts(context);
  const req = await getByToken(context.env, token);
  if (!req) return json({ error: 'This signing link is not valid.' }, 404);
  if (req.status === 'sent') {
    req.status = 'viewed';
    req.viewedAt = nowIso();
    logEvent(req, 'viewed', await hashIp(context.request));
    await putRequest(context.env, req);
  }
  return json(publicView(req));
}

export async function onRequestPost(context) {
  const [token, action] = parts(context);
  const req = await getByToken(context.env, token);
  if (!req) return json({ error: 'This signing link is not valid.' }, 404);

  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }

  if (action === 'decline') {
    if (req.status === 'signed') return json({ error: 'This document is already signed.' }, 400);
    req.status = 'declined';
    req.declinedAt = nowIso();
    req.declineReason = String((body && body.reason) || '').slice(0, 1000);
    req.ipHash = await hashIp(context.request);
    logEvent(req, 'declined', req.declineReason);
    await putRequest(context.env, req);
    return json({ ok: true });
  }

  if (action) return json({ error: 'not found' }, 404);

  const res = await signRequest(context.env, req, {
    typedName: body && body.typedName,
    signatureImage: body && body.signatureImage,
    consent: !!(body && body.consent),
    docHash: body && body.docHash,
    request: context.request
  });
  if (res.error) return json({ error: res.error }, 400);

  // A signed change order flips to approved on the job itself — that's what moves the
  // contract total, and it can only happen here, never from a client PUT.
  if (req.kind === 'change_order' && req.refId) {
    const raw = await context.env.RIDGELINE_KV.get('job:' + req.jobId);
    if (raw) {
      const job = JSON.parse(raw);
      const co = (job.changeOrders || []).find(x => x && x.id === req.refId);
      if (co) {
        co.status = 'approved';
        co.signedAt = Date.now();
        co.signedBy = res.req.typedName;
        co.signatureId = res.req.id;
        bumpJobVersion(job);
        await context.env.RIDGELINE_KV.put('job:' + req.jobId, JSON.stringify(job));
      }
    }
  }
  return json({ ok: true, signedAt: res.req.signedAt });
}
