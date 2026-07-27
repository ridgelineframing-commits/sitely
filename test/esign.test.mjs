import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKV } from './helpers.mjs';
import { createRequest, getByToken, signRequest, publicView, adminView, listForJob, sha256Hex } from '../functions/api/_sign.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const reqOf = headers => ({ headers: { get: k => headers[k] || null } });

function env(seed) { return { RIDGELINE_KV: makeKV(seed) }; }

test('a signature request mints an unguessable token and is findable by it', async () => {
  const e = env();
  const req = await createRequest(e, {
    jobId: 'j1', jobName: 'Vorse', kind: 'change_order', refId: 'co1',
    title: 'Change order 1 — Add porch', summary: 'Framed and roofed', amount: 12500,
    signerName: 'Linda Johnson', signerEmail: 'L@example.com', createdBy: 'Zac',
  });
  assert.ok(req.token.length >= 40, 'token is long enough to be unguessable');
  assert.equal(req.status, 'sent');
  assert.equal(req.signerEmail, 'l@example.com', 'email normalized');
  const found = await getByToken(e, req.token);
  assert.equal(found.id, req.id);
  assert.equal((await getByToken(e, 'not-a-real-token')), null, 'a wrong token finds nothing');
  const list = await listForJob(e, 'j1');
  assert.deepEqual(list.map(r => r.id), [req.id], 'indexed against its job');
});

test('signing captures intent, consent, attribution and the document hash', async () => {
  const e = env();
  const req = await createRequest(e, { jobId: 'j1', kind: 'change_order', title: 'CO 1', amount: 100 });
  const docHash = await sha256Hex('the exact text shown to the signer');
  const res = await signRequest(e, req, {
    typedName: 'Linda Johnson', signatureImage: PNG, consent: true, docHash,
    request: reqOf({ 'CF-Connecting-IP': '203.0.113.7', 'User-Agent': 'Safari/iPhone' }),
  });
  assert.ok(res.ok);
  const saved = await getByToken(e, req.token);
  assert.equal(saved.status, 'signed');
  assert.equal(saved.typedName, 'Linda Johnson');
  assert.equal(saved.consent, true);
  assert.equal(saved.docHash, docHash, 'we store what was actually shown');
  assert.equal(saved.userAgent, 'Safari/iPhone');
  assert.ok(saved.ipHash && saved.ipHash.length === 64, 'IP is hashed, not stored');
  assert.ok(!JSON.stringify(saved).includes('203.0.113.7'), 'the raw IP never lands in the record');
  assert.ok(saved.audit.some(a => a.event === 'created') && saved.audit.some(a => a.event === 'signed'),
    'the audit trail carries both events');
});

test('signing refuses without a name, without consent, or without a drawn signature', async () => {
  const e = env();
  const mk = () => createRequest(e, { jobId: 'j1', kind: 'contract', title: 'Contract' });
  const request = reqOf({});
  let r = await mk();
  assert.match((await signRequest(e, r, { typedName: 'L', signatureImage: PNG, consent: true, request })).error, /full name/);
  r = await mk();
  assert.match((await signRequest(e, r, { typedName: 'Linda Johnson', signatureImage: PNG, consent: false, request })).error, /check the box/);
  r = await mk();
  assert.match((await signRequest(e, r, { typedName: 'Linda Johnson', signatureImage: '', consent: true, request })).error, /Draw your signature/);
  r = await mk();
  assert.match((await signRequest(e, r, { typedName: 'Linda Johnson', signatureImage: 'javascript:alert(1)', consent: true, request })).error, /Draw your signature/,
    'only real image data is accepted');
});

test('a document cannot be signed twice', async () => {
  const e = env();
  const req = await createRequest(e, { jobId: 'j1', kind: 'draw', title: 'Draw 3' });
  const request = reqOf({});
  assert.ok((await signRequest(e, req, { typedName: 'Linda Johnson', signatureImage: PNG, consent: true, request })).ok);
  const second = await signRequest(e, await getByToken(e, req.token), { typedName: 'Someone Else', signatureImage: PNG, consent: true, request });
  assert.match(second.error, /already signed/);
});

test('the signer page never receives the audit trail, the token, or other people’s data', async () => {
  const e = env();
  const req = await createRequest(e, { jobId: 'j1', kind: 'change_order', title: 'CO 1', summary: 'scope', amount: 500, signerName: 'Linda' });
  const pub = publicView(req);
  assert.ok(!('token' in pub), 'the token is not echoed back');
  assert.ok(!('audit' in pub), 'no audit trail');
  assert.ok(!('ipHash' in pub), 'no ip hash');
  assert.ok(!('signerEmail' in pub), 'no email');
  assert.equal(pub.title, 'CO 1');
  assert.equal(pub.amount, 500);
});

test('the office view carries the record but not the signature bitmap', async () => {
  const e = env();
  const req = await createRequest(e, { jobId: 'j1', kind: 'contract', title: 'Contract' });
  await signRequest(e, req, { typedName: 'Linda Johnson', signatureImage: PNG, consent: true, request: reqOf({}) });
  const view = adminView(await getByToken(e, req.token));
  assert.equal(view.hasSignature, true);
  assert.ok(!('signatureImage' in view), 'the image itself stays out of list payloads');
  assert.ok(Array.isArray(view.audit), 'the office can see the audit trail');
});

test('amounts are rounded to cents and long text is bounded', async () => {
  const e = env();
  const req = await createRequest(e, {
    jobId: 'j1', kind: 'change_order', title: 'x'.repeat(500),
    summary: 'y'.repeat(20000), amount: 1234.567,
  });
  assert.equal(req.amount, 1234.57);
  assert.equal(req.title.length, 200);
  assert.equal(req.summary.length, 8000);
});
