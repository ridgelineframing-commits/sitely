import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/_middleware.js';
import { onRequestGet as jobsGet } from '../functions/api/jobs/index.js';
import { onRequestPut as jobPut } from '../functions/api/jobs/[id].js';
import { jobForPm } from '../functions/api/_lib.js';

// ---- middleware: live session re-validation ----
function mwCtx(sessions, users, token) {
  const store = { ...sessions, users: JSON.stringify(users) };
  const ctx = {
    env: { RIDGELINE_KV: { get: async k => (k in store ? store[k] : null), put: async () => {} } },
    request: new Request('https://x/api/jobs', { headers: { Authorization: 'Bearer ' + token } }),
    data: {}, waitUntil: () => {}, next: async () => new Response('OK', { status: 200 }),
  };
  return ctx;
}
const users = [
  { id: 'pm1', role: 'pm', name: 'Pat', tokenVersion: 0 },
  { id: 'cu1', role: 'customer', name: 'Cass', email: 'c@x.com', jobIds: ['jobA'], tokenVersion: 2 },
];

test('valid pm session passes; role/jobIds refreshed from users store', async () => {
  const c = mwCtx({ 'session:T': JSON.stringify({ role: 'pm', name: 'old', userId: 'pm1', tv: 0 }) }, users, 'T');
  const r = await onRequest(c);
  assert.equal(r.status, 200);
  assert.equal(c.data.session.role, 'pm');
  assert.deepEqual(c.data.session.jobIds, []); // pm scope is empty, not the token's snapshot
});

test('deleted user is revoked (401)', async () => {
  const c = mwCtx({ 'session:T': JSON.stringify({ role: 'pm', userId: 'gone', tv: 0 }) }, users, 'T');
  assert.equal((await onRequest(c)).status, 401);
});

test('stale token version (password changed) is revoked (401)', async () => {
  const c = mwCtx({ 'session:T': JSON.stringify({ role: 'customer', userId: 'cu1', tv: 1 }) }, users, 'T');
  assert.equal((await onRequest(c)).status, 401);
});

test('customer job scope reflects the live user record', async () => {
  const c = mwCtx({ 'session:T': JSON.stringify({ role: 'customer', userId: 'cu1', jobIds: ['STALE'], tv: 2 }) }, users, 'T');
  assert.equal((await onRequest(c)).status, 200);
  assert.deepEqual(c.data.session.jobIds, ['jobA']);
});

test('legacy "1" admin sentinel still works and skips the users lookup', async () => {
  let usersRead = 0;
  const store = { 'session:T': '1', users: JSON.stringify(users) };
  const c = {
    env: { RIDGELINE_KV: { get: async k => { if (k === 'users') usersRead++; return store[k] ?? null; }, put: async () => {} } },
    request: new Request('https://x/api/jobs', { headers: { Authorization: 'Bearer T' } }),
    data: {}, waitUntil: () => {}, next: async () => new Response('OK', { status: 200 }),
  };
  assert.equal((await onRequest(c)).status, 200);
  assert.equal(c.data.session.role, 'admin');
  assert.equal(usersRead, 0);
});

test('corrupt session fails closed (401), never admin', async () => {
  const c = mwCtx({ 'session:T': '{not json' }, users, 'T');
  assert.equal((await onRequest(c)).status, 401);
});

// ---- jobs index self-heals dropped entries ----
test('GET /api/jobs re-adds jobs missing from the index', async () => {
  const store = {
    'jobs:index': JSON.stringify([{ id: 'a', name: 'Alpha', status: 'active', updatedAt: 3, editCount: 0 }]),
    'job:a': JSON.stringify({ id: 'a', name: 'Alpha', status: 'active', updatedAt: 3, edits: {} }),
    'job:b': JSON.stringify({ id: 'b', name: 'Bravo', status: 'active', updatedAt: 2, edits: {} }),
    'job:c': JSON.stringify({ id: 'c', name: 'Charlie', status: 'active', updatedAt: 1, edits: {} }),
  };
  const kv = {
    get: async k => store[k] ?? null,
    put: async (k, v) => { store[k] = v; },
    list: async ({ prefix = '', cursor } = {}) => {
      const all = Object.keys(store).filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? +cursor : 0, page = all.slice(start, start + 2), end = start + page.length;
      return { keys: page.map(name => ({ name })), list_complete: end >= all.length, cursor: String(end) };
    },
  };
  const resp = await jobsGet({ env: { RIDGELINE_KV: kv }, data: { session: { role: 'admin' } } });
  const ids = (await resp.json()).map(j => j.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.deepEqual(JSON.parse(store['jobs:index']).map(j => j.id).sort(), ['a', 'b', 'c']);
});

// ---- PM view + PM PUT invariants ----
test('jobForPm exposes the estimate but never draws or worksheets', () => {
  const v = jobForPm({ id: 'j', name: 'J', estimate: { items: [] }, draws: [{ no: 1 }], edits: { 'A!1': 1 }, customer: {} });
  assert.ok(v.estimate);
  assert.equal(v.draws, undefined);
  assert.equal(Object.keys(v.edits).length, 0);
});

function pmPutCtx(body, job) {
  const store = { 'job:j1': JSON.stringify(job), 'jobs:index': JSON.stringify([{ id: 'j1' }]) };
  return {
    env: { RIDGELINE_KV: { get: async k => store[k] ?? null, put: async (k, v) => { store[k] = v; } } },
    params: { id: 'j1' }, data: { session: { role: 'pm', name: 'Pat', userId: 'pm1' } },
    request: new Request('https://x/api/jobs/j1', { method: 'PUT', body: JSON.stringify(body) }),
    _job: () => JSON.parse(store['job:j1']),
  };
}

test('PM PUT keeps note itemId, forces pending, and cannot edit the estimate', async () => {
  const ctx = pmPutCtx(
    { estimate: { items: [{ id: 'HACK' }] },
      pendingNotes: [{ id: 'n1', target: 'estimate', itemId: 'item_42', itemName: 'Framing', text: 'check beam', status: 'approved' }] },
    { id: 'j1', name: 'J', estimate: { items: [{ id: 'item_42' }] }, pendingNotes: [] },
  );
  await jobPut(ctx);
  const j = ctx._job();
  assert.equal(j.estimate.items[0].id, 'item_42'); // money untouched
  assert.equal(j.pendingNotes[0].itemId, 'item_42');
  assert.equal(j.pendingNotes[0].status, 'pending'); // cannot self-approve
});
