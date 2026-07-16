import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as mcp } from '../functions/mcp/[[path]].js';
import { makeKV } from './helpers.mjs';

function ctx(token, name, args, kv) {
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  return {
    env: { RIDGELINE_KV: kv },
    params: { path: [token] },
    request: new Request('https://x/mcp/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpc) }),
  };
}
const textOf = async r => { const j = await r.json(); return j.result ? j.result.content[0].text : null; };
const seedJob = job => makeKV({ mcptoken: 'tok', ['job:' + job.id]: JSON.stringify(job), 'jobs:index': JSON.stringify([{ id: job.id, name: job.name, status: job.status }]) });

test('a wrong connector token is rejected (401)', async () => {
  const kv = makeKV({ mcptoken: 'a'.repeat(64) });
  assert.equal((await mcp(ctx('b'.repeat(64), 'list_jobs', {}, kv))).status, 401);
});

test('delete_job archives (data kept), never destroys', async () => {
  const kv = seedJob({ id: 'j1', name: 'Test', status: 'active' });
  const txt = await textOf(await mcp(ctx('tok', 'delete_job', { job: 'j1', confirm: true }, kv)));
  assert.match(txt, /Archived/);
  assert.equal(JSON.parse(kv._store['job:j1']).status, 'archive'); // still present
});

test('free-text fields are length-capped', async () => {
  const kv = seedJob({ id: 'j1', name: 'Test', status: 'active' });
  await textOf(await mcp(ctx('tok', 'set_customer', { job: 'j1', name: 'Z'.repeat(500) }, kv)));
  assert.equal(JSON.parse(kv._store['job:j1']).customer.name.length, 120);
});

test('set_markup does NOT wipe per-line markup overrides', async () => {
  const job = { id: 'j1', name: 'Test', status: 'active', estimate: {
    settings: { defaultMarkupPct: 0.15, salesTaxPct: 0.08 },
    categories: [], items: [{ id: 'i1', costLines: [{ id: 'l1', qty: 1, unitCost: 100, markupPct: 0.3, taxable: false }] }],
  } };
  const kv = seedJob(job);
  await textOf(await mcp(ctx('tok', 'set_markup', { job: 'j1', markup_pct: 20 }, kv)));
  const saved = JSON.parse(kv._store['job:j1']).estimate;
  assert.equal(saved.settings.defaultMarkupPct, 0.2);          // default changed
  assert.equal(saved.items[0].costLines[0].markupPct, 0.3);    // override preserved
});

test('set_tax does NOT force every line taxable', async () => {
  const job = { id: 'j1', name: 'Test', status: 'active', estimate: {
    settings: { defaultMarkupPct: 0.15, salesTaxPct: 0.08 },
    categories: [], items: [{ id: 'i1', costLines: [{ id: 'l1', qty: 1, unitCost: 100, markupPct: null, taxable: false }] }],
  } };
  const kv = seedJob(job);
  await textOf(await mcp(ctx('tok', 'set_tax', { job: 'j1', tax_pct: 9 }, kv)));
  const saved = JSON.parse(kv._store['job:j1']).estimate;
  assert.equal(saved.settings.salesTaxPct, 0.09);              // rate changed
  assert.equal(saved.items[0].costLines[0].taxable, false);    // still not taxable
});
