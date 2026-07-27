// Native e-signature core. Ported from the Signet worker (ridgelineframing-commits/signet),
// which is the same Cloudflare shape — its token/hash helpers and its recipient+audit model
// are what make a self-hosted signature defensible, so they came over nearly as-is.
//
// What differs from Signet: Signet keeps envelopes in D1 and mails invites through Resend.
// Sitely has no D1 binding and already has a customer portal, so a signature request is a
// KV document the portal (or a tokenized link) reads. One less moving part, same record.
//
// KV layout:
//   sig:<id>          the signature request + its audit trail (append-only)
//   sigtok:<token>    -> id   (the unguessable link the signer clicks)
//   sigjob:<jobId>    -> [id, id, …]  (what's outstanding on a job)

const KEY = id => 'sig:' + id;
const TOKEN_KEY = t => 'sigtok:' + t;
const JOB_KEY = jobId => 'sigjob:' + jobId;

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// We never store a raw IP — a salted hash is enough to show two signings came from the
// same place without keeping the address itself.
export async function hashIp(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return sha256Hex(ip + ':sitely-sign');
}

export function nowIso() { return new Date().toISOString(); }

export async function getRequest(env, id) {
  const raw = await env.RIDGELINE_KV.get(KEY(id));
  return raw ? JSON.parse(raw) : null;
}

export async function getByToken(env, token) {
  if (!token) return null;
  const id = await env.RIDGELINE_KV.get(TOKEN_KEY(token));
  return id ? getRequest(env, id) : null;
}

export async function putRequest(env, req) {
  await env.RIDGELINE_KV.put(KEY(req.id), JSON.stringify(req));
}

export async function listForJob(env, jobId) {
  const raw = await env.RIDGELINE_KV.get(JOB_KEY(jobId));
  const ids = raw ? JSON.parse(raw) : [];
  const out = [];
  for (const id of ids) { const r = await getRequest(env, id); if (r) out.push(r); }
  return out;
}

// Audit events are only ever appended — that history is the point.
export function logEvent(req, event, detail) {
  req.audit = Array.isArray(req.audit) ? req.audit : [];
  req.audit.push({ at: nowIso(), event, detail: detail || '' });
  return req;
}

const DOC_KINDS = ['contract', 'change_order', 'draw'];

/**
 * Create a signature request for one document on one job.
 * `docHash` is the SHA-256 of the exact bytes being signed — that hash is what proves later
 * that the stored copy is the copy the customer agreed to.
 */
export async function createRequest(env, {
  jobId, jobName, kind, refId, title, summary, amount, signerName, signerEmail, createdBy
}) {
  const req = {
    id: crypto.randomUUID(),
    token: newToken(),
    jobId: String(jobId),
    jobName: String(jobName || ''),
    kind: DOC_KINDS.indexOf(kind) >= 0 ? kind : 'contract',
    refId: refId ? String(refId) : null,      // e.g. the change order's id
    title: String(title || '').slice(0, 200),
    summary: String(summary || '').slice(0, 8000),
    amount: amount == null ? null : Math.round(Number(amount) * 100) / 100,
    signerName: String(signerName || '').slice(0, 120),
    signerEmail: String(signerEmail || '').slice(0, 200).toLowerCase(),
    status: 'sent',                           // sent | viewed | signed | declined | voided
    createdBy: String(createdBy || '').slice(0, 120),
    createdAt: nowIso(),
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    declineReason: null,
    consent: false,
    typedName: null,
    signatureImage: null,                     // data: URL of the drawn signature
    docHash: null,
    ipHash: null,
    userAgent: null,
    audit: []
  };
  logEvent(req, 'created', req.title);
  await putRequest(env, req);
  await env.RIDGELINE_KV.put(TOKEN_KEY(req.token), req.id);
  const raw = await env.RIDGELINE_KV.get(JOB_KEY(req.jobId));
  const ids = raw ? JSON.parse(raw) : [];
  ids.push(req.id);
  await env.RIDGELINE_KV.put(JOB_KEY(req.jobId), JSON.stringify(ids));
  return req;
}

/**
 * Record a signature. Everything that makes this hold up is captured here in one shot:
 * intent (they typed their name), consent (they ticked the box), attribution (name + email
 * + IP hash + user agent), and the hash of exactly what they were shown.
 */
export async function signRequest(env, req, { typedName, signatureImage, consent, docHash, request }) {
  if (req.status === 'signed') return { error: 'This document is already signed.' };
  if (req.status === 'voided' || req.status === 'declined') return { error: 'This document is no longer available to sign.' };
  const name = String(typedName || '').trim();
  if (name.length < 2) return { error: 'Type your full name to sign.' };
  if (!consent) return { error: 'Please check the box agreeing to sign electronically.' };
  const img = String(signatureImage || '');
  if (!/^data:image\/(png|jpeg);base64,/.test(img)) return { error: 'Draw your signature before submitting.' };
  if (img.length > 400000) return { error: 'That signature image is too large.' };

  req.status = 'signed';
  req.signedAt = nowIso();
  req.typedName = name.slice(0, 120);
  req.signatureImage = img;
  req.consent = true;
  req.docHash = docHash ? String(docHash).slice(0, 64) : null;
  req.ipHash = await hashIp(request);
  req.userAgent = String(request.headers.get('User-Agent') || '').slice(0, 300);
  logEvent(req, 'signed', name + (req.docHash ? ' · doc ' + req.docHash.slice(0, 12) : ''));
  await putRequest(env, req);
  return { ok: true, req };
}

// What the signer's page is allowed to see — never the audit trail or the token itself.
export function publicView(req) {
  return {
    id: req.id,
    jobName: req.jobName,
    kind: req.kind,
    title: req.title,
    summary: req.summary,
    amount: req.amount,
    signerName: req.signerName,
    status: req.status,
    signedAt: req.signedAt,
    typedName: req.typedName,
    createdAt: req.createdAt
  };
}

// What the office sees in the app: the full record minus the stored signature bitmap.
export function adminView(req) {
  const { signatureImage, ...rest } = req;
  return Object.assign(rest, { hasSignature: !!signatureImage });
}
