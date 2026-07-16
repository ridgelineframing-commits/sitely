import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as mw } from '../functions/api/_middleware.js';
import { fileResponseHeaders } from '../functions/api/_lib.js';
import { makeKV } from './helpers.mjs';

// ---- #1 safe file download headers (stored-XSS defense) ----
const hdr = type => fileResponseHeaders({ httpMetadata: { contentType: type } }, 'x.dat');

test('inert types (pdf/images) are served inline with their type', () => {
  assert.match(hdr('application/pdf').get('Content-Disposition'), /^inline/);
  assert.equal(hdr('application/pdf').get('Content-Type'), 'application/pdf');
  assert.match(hdr('image/png').get('Content-Disposition'), /^inline/);
});

test('html/svg/js are forced to download as octet-stream', () => {
  for (const t of ['text/html', 'image/svg+xml', 'application/javascript', 'text/xml']) {
    assert.match(hdr(t).get('Content-Disposition'), /^attachment/, t);
    assert.equal(hdr(t).get('Content-Type'), 'application/octet-stream', t);
  }
});

test('nosniff is always set and the filename cannot inject headers', () => {
  assert.equal(hdr('application/pdf').get('X-Content-Type-Options'), 'nosniff');
  const cd = fileResponseHeaders({ httpMetadata: {} }, 'a"\r\nb').get('Content-Disposition');
  assert.doesNotMatch(cd, /[\r\n]/);
  assert.match(cd, /filename="a___b"/);
});

// ---- #5 middleware fails closed ----
function mwCtx(sessionVal, token = 'T') {
  return {
    env: { RIDGELINE_KV: makeKV({ ['session:' + token]: sessionVal }) },
    request: new Request('https://x/api/jobs', { headers: { Authorization: 'Bearer ' + token } }),
    data: {}, waitUntil: () => {}, next: async () => new Response('OK', { status: 200 }),
  };
}

test('a corrupt session is rejected (401), never defaulted to admin', async () => {
  assert.equal((await mw(mwCtx('{not json'))).status, 401);
});
test('a tokenless request is 401', async () => {
  const ctx = mwCtx('1'); ctx.request = new Request('https://x/api/jobs');
  assert.equal((await mw(ctx)).status, 401);
});
test('the legacy "1" admin sentinel still works', async () => {
  const ctx = mwCtx('1');
  assert.equal((await mw(ctx)).status, 200);
  assert.equal(ctx.data.session.role, 'admin');
});
test('a valid session passes through', async () => {
  const ctx = mwCtx(JSON.stringify({ role: 'pm', name: 'P' }));
  assert.equal((await mw(ctx)).status, 200);
  assert.equal(ctx.data.session.role, 'pm');
});
