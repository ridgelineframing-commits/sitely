import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers.mjs';

const S = loadScript('public/sync.js').RidgelineSync;

test('structured payloads are recognized (so field notes/todos persist correctly)', () => {
  assert.equal(S._isPayload({ pendingNotes: [{}] }), true);
  assert.equal(S._isPayload({ todos: [] }), true);
  assert.equal(S._isPayload({ schedule: [] }), true);
  assert.equal(S._isPayload({ estimate: {} }), true);
});

test('a bare workbook edits map is NOT treated as structured (stays wrapped)', () => {
  assert.equal(S._isPayload({ 'Estimate!A1': 5 }), false);
  assert.equal(S._isPayload({ 'Schedule!B2': 'x' }), false);
});

test('_payloadOf passes a structured payload through unchanged', () => {
  // Compare by value (objects come from a VM realm, so deepStrictEqual's prototype check fails).
  assert.equal(JSON.stringify(S._payloadOf({ edits: { pendingNotes: [{ id: 1 }] } })), JSON.stringify({ pendingNotes: [{ id: 1 }] }));
  assert.equal(JSON.stringify(S._payloadOf({ edits: { 'A!1': 5 } })), JSON.stringify({ edits: { 'A!1': 5 } }));
});

test('direct job PUTs receive the current base version and advance the local version', async () => {
  let sent;
  const localStorage = {
    getItem: key => key === 'ridgeline_token' ? 'token' : null,
    setItem() {},
    removeItem() {},
    get length() { return 0; },
    key() { return null; }
  };
  const sync = loadScript('public/sync.js', {
    localStorage,
    fetch: async (url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: 'j1', version: 8 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }).RidgelineSync;
  sync._versions.j1 = 7;
  await sync.api('/jobs/j1', { method: 'PUT', body: JSON.stringify({ name: 'Renamed' }) });
  assert.equal(sent.baseVersion, 7);
  assert.equal(sync._versions.j1, 8);
});
