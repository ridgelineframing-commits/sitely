import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScript, stubReact, repo } from './helpers.mjs';

// The packet builder lives in index.html's controller class. Lift just that method out and
// run it against a mock component so the customer-facing output stays pinned by tests.
function packetSections(self, inc) {
  const html = readFileSync(resolve(repo, 'public/index.html'), 'utf8');
  const start = html.indexOf('ksPacketSections(inc) {');
  assert.ok(start > -1, 'ksPacketSections not found in index.html');
  let depth = 0, end = -1;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const body = html.slice(html.indexOf('{', start) + 1, end - 1);
  const K = loadScript('public/keystone.js', { React: stubReact }).Keystone;
  const fn = new Function('inc', 'window', body);
  return fn.call(self, inc, { Keystone: K });
}

const est = {
  settings: { defaultMarkupPct: 0.2, salesTaxPct: 0.086 },
  categories: [
    { id: 'c3', code: '0300', name: 'Rough Structure' },
    { id: 'c4', code: '0400', name: 'Windows & Doors, Exterior' },
  ],
  items: [
    { id: 'i1', categoryId: 'c3', code: '0310', name: 'Framing Materials', allowance: true, allowanceBudget: { qty: 1, unit: 'LS', price: 19277.028 }, costLines: [{ id: 'l1', qty: 1, unit: 'LS', unitCost: 15000, markupPct: 0.2, taxable: true }] },
    { id: 'i2', categoryId: 'c3', code: '0320', name: 'Framing Labor', costLines: [{ id: 'l2', qty: 1, unit: 'LS', unitCost: 11000, markupPct: 0.2, taxable: false }] },
    { id: 'i3', categoryId: 'c4', code: '0410', name: 'Front Door', costLines: [{ id: 'l3', qty: 1, unit: 'EA', unitCost: 4000, markupPct: 0.2, taxable: true }] },
    { id: 'i4', categoryId: 'c4', code: '0499', name: 'Dropped scope', excluded: true, costLines: [] },
  ],
  exclusions: ['Landscaping beyond rough grade'],
};

function mockSelf(schedule) {
  return {
    jobEstimate: est,
    jobSchedule: schedule || null,
    ksJobCache: {},
    state: { jobId: 'j1' },
  };
}

const textOf = section => section.rows.map(r => r.cells.map(c => String(c.content)).join(' ¦ ')).join('\n');

test('estimate money never prints a third decimal to the customer', () => {
  const secs = packetSections(mockSelf(), { allowances: true, exclusions: true, schedule: false });
  const all = secs.map(textOf).join('\n');
  const bad = all.match(/\$[\d,]+\.\d{3,}/g);
  assert.equal(bad, null, 'packet shows over-precise amounts: ' + (bad || []).join(', '));
  assert.ok(/\$[\d,]+\.\d{2}\b/.test(all), 'amounts still print with cents');
});

test('each category header carries its own subtotal, with no separate subtotal row', () => {
  const est$ = packetSections(mockSelf(), { allowances: false, exclusions: false, schedule: false })
    .find(s => s.title === 'ESTIMATE');
  const lines = textOf(est$).split('\n');
  const header = lines.find(l => l.includes('0300  Rough Structure'));
  assert.ok(header, 'category header row present');
  assert.ok(/\$[\d,]+\.\d{2}/.test(header), 'the subtotal rides on the header row: ' + header);
  assert.ok(!lines.some(l => l.includes('Subtotal —')), 'the old standalone subtotal rows are gone');
  assert.ok(lines.some(l => l.includes('CONTRACT TOTAL')), 'grand total still prints');
});

test('excluded items stay out of the estimate and its subtotals', () => {
  const est$ = packetSections(mockSelf(), { allowances: false, exclusions: true, schedule: false })
    .find(s => s.title === 'ESTIMATE');
  assert.ok(!textOf(est$).includes('Dropped scope'), 'excluded item is not billed');
  const excl = packetSections(mockSelf(), { allowances: false, exclusions: true, schedule: false })
    .find(s => s.title === 'EXCLUSIONS');
  assert.ok(textOf(excl).includes('Dropped scope'), 'it shows under exclusions instead');
});

test('the packet schedule prints the real job schedule, grouped by phase with dates', () => {
  const schedule = [
    { id: 't1', task: '10 Excavation', group: 'Sitework', start: '2026-08-03', finish: '2026-08-05', status: 'Complete' },
    { id: 't2', task: '20 Footings', group: 'Foundation', start: '2026-08-06', finish: '2026-08-07', status: 'Not Started' },
    { id: 't3', task: '30 Stem walls', group: 'Foundation', start: '2026-08-10', finish: '2026-08-12', status: 'Not Started' },
  ];
  const sec = packetSections(mockSelf(schedule), { allowances: false, exclusions: false, schedule: true })
    .find(s => s.title === 'SCHEDULE');
  const txt = textOf(sec);
  assert.ok(txt.includes('Excavation') && txt.includes('Footings') && txt.includes('Stem walls'), 'real tasks print');
  assert.ok(txt.includes('Sitework') && txt.includes('Foundation'), 'phases head their groups');
  assert.ok(txt.includes('Aug 3, 2026'), 'dates print in plain English');
  assert.ok(txt.includes('Aug 6, 2026 – Aug 12, 2026'), 'each phase shows its own span');
  assert.ok(/working plan/.test(txt), 'the customer is told dates move');
  // and nothing from the retired spreadsheet
  assert.ok(!/Ridgeline_|xlsx|worksheet/i.test(txt), 'no legacy spreadsheet content');
});

test('a job with no schedule says so instead of printing an empty table', () => {
  const sec = packetSections(mockSelf([]), { allowances: false, exclusions: false, schedule: true })
    .find(s => s.title === 'SCHEDULE');
  assert.ok(textOf(sec).includes('No schedule has been set'), 'honest empty state');
});
