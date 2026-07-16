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
