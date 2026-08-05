import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, makeKV } from './helpers.mjs';
import { onRequestGet } from '../functions/api/bid/[[path]].js';
import { onRequestPut as putJob } from '../functions/api/jobs/[id].js';
import { onRequest as authMiddleware } from '../functions/api/_middleware.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repo } from './helpers.mjs';

const P = loadScript('public/procurement.js').SitelyProcurement;

test('contractor CSV import accepts common columns and skips duplicates', () => {
  const csv = 'Company,Contact,Email,Phone,Trade,Notes\r\n"Ace, Inc.",Ann,ann@example.com,555-0100,Electrical,"Good, local"\r\nAce,Ann,ann@example.com,,,duplicate';
  const out = P.importContractors(csv, [], () => 'ctr-1');
  assert.equal(out.added, 1);
  assert.equal(out.skipped, 1);
  assert.equal(out.contractors[0].company, 'Ace, Inc.');
  assert.equal(out.contractors[0].trade, 'Electrical');
});

test('email draft asks for an emailed estimate and includes the packet link', () => {
  const req = { id: 'r1', token: 'secret', title: 'Electrical', scope: 'Price the attached plans.', dueDate: '2026-08-20', returnEmail: 'bids@example.com' };
  const uri = P.mailto(req, { email: 'ann@example.com', contact: 'Ann' }, 'Vorse Residence', 'https://sitely.example', 'j1');
  const decoded = decodeURIComponent(uri);
  assert.match(decoded, /^mailto:ann@example\.com/);
  assert.match(decoded, /Please email your estimate to bids@example\.com/);
  assert.match(decoded, /https:\/\/sitely\.example\/bid\/j1\/r1\/secret/);
});

function env() {
  const job = { id: 'j1', name: 'Vorse Residence', plans: [
    { id: 'p1', name: 'Electrical.pdf', size: 12, type: 'application/pdf' },
    { id: 'p2', name: 'Private.pdf', size: 10, type: 'application/pdf' }
  ], bidRequests: [{ id: 'r1', token: 'secret', title: 'Electrical', scope: 'Scope', dueDate: '2026-08-20', returnEmail: 'bids@example.com', planIds: ['p1'] }] };
  return {
    RIDGELINE_KV: makeKV({ 'job:j1': JSON.stringify(job) }),
    PLANS: { get: async key => key.endsWith('/p1') ? { body: 'PDF', httpMetadata: { contentType: 'application/pdf' }, customMetadata: { name: 'Electrical.pdf' } } : null }
  };
}

test('public bid packet requires the exact token and lists only selected files', async () => {
  const good = await onRequestGet({ env: env(), params: { path: ['j1', 'r1', 'secret'] } });
  assert.equal(good.status, 200);
  const body = await good.json();
  assert.deepEqual(body.plans.map(p => p.id), ['p1']);
  const bad = await onRequestGet({ env: env(), params: { path: ['j1', 'r1', 'wrong'] } });
  assert.equal(bad.status, 404);
});

test('public bid packet cannot fetch a job file that was not selected', async () => {
  const denied = await onRequestGet({ env: env(), params: { path: ['j1', 'r1', 'secret', 'files', 'p2'] } });
  assert.equal(denied.status, 404);
  const allowed = await onRequestGet({ env: env(), params: { path: ['j1', 'r1', 'secret', 'files', 'p1'] } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('bid API is token-gated by the endpoint instead of session middleware', async () => {
  let next = false;
  await authMiddleware({ request: new Request('https://sitely.example/api/bid/j1/r1/secret'), env: {}, data: {}, next: async () => { next = true; return new Response('ok'); } });
  assert.equal(next, true);
});

test('stored invitation token cannot be rotated by a later job save', async () => {
  const stored = { id: 'j1', name: 'Job', version: 1, bidRequests: [{ id: 'r1', token: 'server-secret', title: 'Old', planIds: [], contractorIds: [], bids: [] }] };
  const kv = makeKV({ 'job:j1': JSON.stringify(stored), 'jobs:index': '[]' });
  const response = await putJob({
    request: new Request('https://sitely.example/api/jobs/j1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: 1, bidRequests: [{ id: 'r1', token: 'attacker-choice', title: 'New', planIds: [], contractorIds: [], bids: [] }] }) }),
    env: { RIDGELINE_KV: kv }, params: { id: 'j1' }, data: { session: { role: 'admin' } }
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(kv._store['job:j1']).bidRequests[0].token, 'server-secret');
});

test('public bid page inline script compiles', () => {
  const html = readFileSync(resolve(repo, 'public/bid/index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
});
