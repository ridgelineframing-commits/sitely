import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScript, stubReact, treeText } from './helpers.mjs';

const K = loadScript('public/keystone.js', {
  React: stubReact,
  RidgelineSync: { userName: () => 'Ridgeline', isOwner: () => true, token: () => 't' },
  location: { origin: 'https://x' },
  document: { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} }, querySelector: () => null },
}).Keystone;
const QE = (await import('../public/quote-engine.js')).default || (await import('../public/quote-engine.js'));

test('every bid line the engine produces has a plain-English note explaining its basis', () => {
  const t = QE.defaultTakeoff();
  t.septic = true; t.well = true; t.fireplace = true; t.carpetSF = 200; t.deckSF = 300;
  const q = QE.computeQuote(t, QE.defaultRates(), { valuation: 500000, months: 7 });
  const missing = [];
  for (const cat of q.categories) for (const l of cat.lines) if (!K.RQ_LINE_NOTE[l.key]) missing.push(l.key);
  assert.deepEqual(missing, [], 'bid lines with no explanatory note: ' + missing.join(', '));
});

test('the retired "rough quote" and legacy-spreadsheet wording is gone from the UI copy', () => {
  const sources = ['public/keystone.js', 'public/index.html', 'public/quote-engine.js']
    .map(f => readFileSync(f, 'utf8')).join('\n');
  for (const phrase of ['rough quote', 'Rough Quote', 'price book & rates', 'just like the Excel', 'workbook days']) {
    assert.ok(!sources.toLowerCase().includes(phrase.toLowerCase()), 'still says "' + phrase + '"');
  }
});

function schedComponent(view, sideOpen) {
  return {
    state: { jobs: [{ id: 'j1', name: 'Davi Residence' }], jobId: 'j1', role: 'admin', ksSchedView: view, ksField: false, ksSchedSide: sideOpen },
    jobSchedule: [{ id: 't1', task: '10 Siding delivery', group: 'Siding', days: 1, start: '2026-08-03', finish: '2026-08-03', status: 'Not Started' }],
    jobCustomer: { address: '1 A St, Ridgefield, WA' }, jobPermitReady: '2026-04-23',
    ksBoardCache: { notes: [{ id: 'n1', text: 'Davi – Punch List', items: [{ id: 'i1', text: 'x', done: true }, { id: 'i2', text: 'y', done: false }], jobId: 'j1', ts: 1 }] },
    ksLoadBoard() {}, ksSaveBoard() {}, ksSaveJobData() {}, ksTick() {}, go() {}, setState() {}, ksRecompute() {}, computeScheduleRows: () => [],
  };
}

test('to-dos & notes ride in a sidebar on every schedule view style, and collapse to a button', () => {
  for (const view of ['list', 'timeline', 'calendar', 'agenda']) {
    const text = treeText(K.views.schedule(schedComponent(view, true))).join(' ');
    assert.ok(text.includes('TO-DOS & NOTES'), view + ': sidebar present');
    assert.ok(text.includes('Davi – Punch List'), view + ': the job’s note is listed');
    assert.ok(text.includes('1/2'), view + ': checklist progress shown');
    assert.ok(text.includes('PERMIT-READY'), view + ': set-up row present');
  }
  const collapsed = treeText(K.views.schedule(schedComponent('list', false))).join(' ');
  assert.ok(collapsed.includes('☰ To-dos & notes (1)'), 'collapsed state offers a reopen button with the count');
  assert.ok(!collapsed.includes('TO-DOS & NOTES'), 'sidebar itself is gone when collapsed');
});

test('Settings shows the owner as super admin and lets the owner add administrators', () => {
  const c = {
    state: { jobs: [], jobId: null, role: 'admin', tick: 0 },
    catalog: { branding: {}, settings: { defaultMarkupPct: 0.2, salesTaxPct: 0.086 }, priceBook: [], schedTemplates: [] },
    _usersCache: [{ id: 'u1', name: 'Sam', role: 'pm' }, { id: 'u2', name: 'Dana', role: 'admin' }],
    _feedToken: 'ft', ksApi: () => Promise.resolve([]), ksTick() {}, ksSaveCatalog() {}, ksExportXlsx() {}, setState() {},
  };
  const text = treeText(K.views.settings(c)).join(' ');
  assert.ok(text.includes('OWNER · SUPER ADMIN'), 'owner row labeled');
  assert.ok(text.includes('ADMINISTRATOR'), 'admin login tagged');
  assert.ok(text.includes('PROJECT MANAGER'), 'pm login still tagged');
  assert.ok(text.includes('Administrator — full access'), 'owner can pick the administrator role');
});
