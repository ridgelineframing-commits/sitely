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

// ---- files: upload_file / list_files ----
function fileCtx(name, args, kv, plans) {
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
  return {
    env: { RIDGELINE_KV: kv, PLANS: plans },
    params: { path: ['tok'] },
    request: new Request('https://x/mcp/tok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rpc) }),
  };
}
function fakeR2() {
  const store = {};
  return { _store: store, put: async (k, v, opts) => { store[k] = { bytes: v, opts }; return {}; } };
}

test('upload_file stores bytes in R2 and records the file on the job', async () => {
  const kv = seedJob({ id: 'j1', name: 'Davi', status: 'active' });
  const plans = fakeR2();
  const b64 = Buffer.from('%PDF-1.4 hello').toString('base64');
  const txt = await textOf(await mcp(fileCtx('upload_file', { job: 'Davi', filename: 'site-plan.pdf', content_base64: b64 }, kv, plans)));
  assert.match(txt, /Uploaded "site-plan\.pdf"/);
  const saved = JSON.parse(kv._store['job:j1']);
  assert.equal(saved.plans.length, 1);
  assert.equal(saved.plans[0].name, 'site-plan.pdf');
  assert.equal(saved.plans[0].type, 'application/pdf');      // guessed from extension
  assert.equal(saved.plans[0].size, Buffer.from('%PDF-1.4 hello').length);
  const key = Object.keys(plans._store)[0];
  assert.match(key, /^plans\/j1\//);                          // stored under the job's folder
  assert.equal(plans._store[key].opts.httpMetadata.contentType, 'application/pdf');
});

test('upload_file accepts a data: URL and rejects invalid base64', async () => {
  const kv = seedJob({ id: 'j1', name: 'Davi', status: 'active' });
  const plans = fakeR2();
  const dataUrl = 'data:image/png;base64,' + Buffer.from('PNGDATA').toString('base64');
  const ok = await textOf(await mcp(fileCtx('upload_file', { job: 'j1', filename: 'photo.png', content_base64: dataUrl }, kv, plans)));
  assert.match(ok, /Uploaded "photo\.png"/);
  const bad = await textOf(await mcp(fileCtx('upload_file', { job: 'j1', filename: 'x.pdf', content_base64: '!!!not base64!!!' }, kv, plans)));
  assert.match(bad, /not valid base64/);
});

test('list_files shows what was uploaded', async () => {
  const kv = seedJob({ id: 'j1', name: 'Davi', status: 'active', plans: [{ id: 'f1', name: 'a.pdf', size: 2048, type: 'application/pdf' }] });
  const txt = await textOf(await mcp(fileCtx('list_files', { job: 'j1' }, kv, fakeR2())));
  assert.match(txt, /a\.pdf/);
  assert.match(txt, /id f1/);
});

// ---- whiteboard: add_board_note / get_board / delete_board_note ----
test('add_board_note puts a plain note on the shared board', async () => {
  const kv = makeKV({ mcptoken: 'tok' });
  const txt = await textOf(await mcp(ctx('tok', 'add_board_note', { text: 'Call the lumber yard about the trusses' }, kv)));
  assert.match(txt, /Added to the Whiteboard/);
  const board = JSON.parse(kv._store['board']);
  assert.equal(board.notes.length, 1);
  assert.equal(board.notes[0].text, 'Call the lumber yard about the trusses');
  assert.equal(board.notes[0].by, 'Claude');
  assert.equal(board.notes[0].items, null);
});

test('add_board_note builds a checklist from the checklist array', async () => {
  const kv = makeKV({ mcptoken: 'tok' });
  await textOf(await mcp(ctx('tok', 'add_board_note', { checklist: ['Order rebar', 'Schedule inspection', '  '] }, kv)));
  const note = JSON.parse(kv._store['board']).notes[0];
  assert.equal(note.items.length, 2);                 // blank item dropped
  assert.equal(note.items[0].text, 'Order rebar');
  assert.equal(note.items[0].done, false);
});

test('add_board_note with empty text and no checklist is rejected', async () => {
  const kv = makeKV({ mcptoken: 'tok' });
  const txt = await textOf(await mcp(ctx('tok', 'add_board_note', { text: '   ' }, kv)));
  assert.match(txt, /some text or a checklist/);
  assert.equal(kv._store['board'], undefined);
});

test('add_board_note assigned to a job with a due date pins a Whiteboard schedule task', async () => {
  const kv = seedJob({ id: 'j1', name: 'Davi', status: 'active' });
  const txt = await textOf(await mcp(ctx('tok', 'add_board_note', { text: 'Pour footings', job: 'Davi', due_date: '2026-08-01' }, kv)));
  assert.match(txt, /pinned on the schedule/);
  const note = JSON.parse(kv._store['board']).notes[0];
  assert.equal(note.jobId, 'j1');
  assert.equal(note.dueDate, '2026-08-01');
  const sched = JSON.parse(kv._store['job:j1']).schedule;
  assert.equal(sched.length, 1);
  assert.equal(sched[0].group, 'Whiteboard');
  assert.equal(sched[0].fixed, '2026-08-01');
  assert.equal(sched[0].boardNoteId, note.id);
  assert.equal(sched[0].id, note.schedTaskId);       // note links to its task
});

test('add_board_note to a job without a due date assigns but does not touch the schedule', async () => {
  const kv = seedJob({ id: 'j1', name: 'Davi', status: 'active' });
  await textOf(await mcp(ctx('tok', 'add_board_note', { text: 'Site walk', job: 'j1' }, kv)));
  assert.equal(JSON.parse(kv._store['board']).notes[0].jobId, 'j1');
  assert.equal(JSON.parse(kv._store['job:j1']).schedule, undefined);
});

test('add_board_note to an unknown job does not add the note', async () => {
  const kv = makeKV({ mcptoken: 'tok', 'jobs:index': JSON.stringify([]) });
  const txt = await textOf(await mcp(ctx('tok', 'add_board_note', { text: 'x', job: 'Nope' }, kv)));
  assert.match(txt, /no job found/i);
  assert.equal(kv._store['board'], undefined);
});

test('get_board lists notes with job and due-date context; delete_board_note removes one', async () => {
  const kv = seedJob({ id: 'j1', name: 'Davi', status: 'active' });
  await textOf(await mcp(ctx('tok', 'add_board_note', { text: 'Pour footings', job: 'j1', due_date: '2026-08-01' }, kv)));
  const list = await textOf(await mcp(ctx('tok', 'get_board', {}, kv)));
  assert.match(list, /Pour footings/);
  assert.match(list, /→ Davi/);
  assert.match(list, /due 2026-08-01/);
  const id = JSON.parse(kv._store['board']).notes[0].id;
  const del = await textOf(await mcp(ctx('tok', 'delete_board_note', { note_id: id }, kv)));
  assert.match(del, /Removed/);
  assert.equal(JSON.parse(kv._store['board']).notes.length, 0);
});
