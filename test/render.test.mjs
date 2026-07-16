import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, stubReact, treeText } from './helpers.mjs';

const K = loadScript('public/keystone.js', { React: stubReact, RidgelineSync: { userName: () => 'Pat' } }).Keystone;

const est = {
  settings: { defaultMarkupPct: 0.2, salesTaxPct: 0.08 },
  categories: [{ id: 'c1', code: '0300', name: 'Rough Structure', order: 0 }],
  items: [{ id: 'item_42', code: '0310', name: 'Framing', categoryId: 'c1', allowance: false, excluded: false, specText: 'SPF #2',
    costLines: [{ id: 'l1', desc: 'Lumber', qty: 10, unit: 'EA', unitCost: 100, markupPct: null, taxable: true }] }],
};
const notes = [{ id: 'n1', by: 'Pat', ts: 1700000000000, text: 'Check the beam size', status: 'pending', itemId: 'item_42', itemName: 'Framing' }];
const base = { jobEstimate: est, jobPendingNotes: notes, ksJobCache: {}, catalog: null, setState() {}, ksTick() {}, ksSaveJobData() {}, ksApi() {} };

test('PM estimate view is read-only, shows pricing, and offers per-line field notes', () => {
  const t = treeText(K.views.pmEstimate({ ...base, state: { role: 'pm', jobId: 'j1', ksOpen: 'item_42' } })).join(' | ');
  assert.match(t, /Framing/);
  assert.match(t, /CONTRACT TOTAL/);
  assert.match(t, /FIELD NOTES ON THIS LINE/);
  assert.match(t, /Field note on this line/);
  assert.match(t, /1 NOTE/);
});

test('admin estimate flags the line carrying a PM note', () => {
  const t = treeText(K.views.estimate({ ...base, state: { role: 'admin', jobId: 'j1', ksOpen: 'item_42' } })).join(' | ');
  assert.match(t, /PM NOTE/);
  assert.match(t, /PM FIELD NOTES/);
  assert.match(t, /Check the beam size/);
  assert.match(t, /CONTRACT TOTAL/);
});
