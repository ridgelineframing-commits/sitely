import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as mw } from '../functions/api/_middleware.js';
import { onRequestPut as boardPut, onRequestGet as boardGet } from '../functions/api/board.js';
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

// ---- Whiteboard: checklist items round-trip (the Field "add item to a to-do list" feature) ----
function boardCtx(sessionVal, body) {
  const kv = makeKV(sessionVal === undefined ? {} : { board: sessionVal });
  return {
    kv,
    env: { RIDGELINE_KV: kv },
    data: { session: { role: 'pm', name: 'Zac' } },
    request: new Request('https://x/api/board', { method: 'PUT', body: JSON.stringify(body) }),
  };
}

test('board PUT keeps a note\'s checklist items {id,text,done}, so a field-added item survives', async () => {
  const ctx = boardCtx(undefined, { notes: [
    { id: 'n1', text: 'Punch list', jobId: 'davi', by: 'Zac', ts: 1,
      items: [{ id: 'i1', text: 'Caulk tub', done: true }, { id: 'i2', text: 'Touch-up paint', done: false }] },
  ] });
  const res = await boardPut(ctx);
  assert.equal(res.status, 200);
  const saved = JSON.parse(ctx.kv._store.board).notes[0];
  assert.equal(saved.items.length, 2);
  assert.deepEqual(saved.items.map(i => i.text), ['Caulk tub', 'Touch-up paint']);
  assert.equal(saved.items[0].done, true);
  assert.equal(saved.jobId, 'davi');
});

test('board PUT caps a checklist at 100 items and drops itemless entries', async () => {
  const many = Array.from({ length: 130 }, (_, k) => ({ id: 'x' + k, text: 't' + k, done: false }));
  const ctx = boardCtx(undefined, { notes: [{ id: 'n1', items: many.concat([{ done: true }]) }] });
  await boardPut(ctx);
  const saved = JSON.parse(ctx.kv._store.board).notes[0];
  assert.equal(saved.items.length, 100);           // hard cap
  assert.ok(saved.items.every(i => typeof i.text === 'string'));
});

test('customers can neither read nor write the whiteboard', async () => {
  const get = await boardGet({ env: { RIDGELINE_KV: makeKV() }, data: { session: { role: 'customer' } } });
  assert.equal(get.status, 403);
  const put = await boardPut({ env: { RIDGELINE_KV: makeKV() }, data: { session: { role: 'customer' } },
    request: new Request('https://x/api/board', { method: 'PUT', body: '{"notes":[]}' }) });
  assert.equal(put.status, 403);
});
