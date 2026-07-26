import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers.mjs';

const win = loadScript('public/quote-engine.js');
const QE = win.QuoteEngine;

test('default takeoff produces a sane material estimate — every package priced', () => {
  const m = QE.computeMaterials(QE.defaultTakeoff(), null, null);
  assert.ok(m.total > 5000, 'total should be real money, got ' + m.total);
  for (const pkg of ['floor', 'wall', 'roof', 'siding']) assert.ok(m.packages[pkg] > 0, pkg + ' package should be > 0');
  assert.equal(m.packages.deck, 0);                          // no deck on the default takeoff
  assert.ok(m.lines.every(l => l.qty > 0 && l.unitPrice >= 0));
});

test('slab foundation drops joists/subfloor/pony wall; crawl has them', () => {
  const crawl = QE.computeMaterials(Object.assign(QE.defaultTakeoff(), { foundationType: 'crawl' }), null, null);
  const slab = QE.computeMaterials(Object.assign(QE.defaultTakeoff(), { foundationType: 'slab' }), null, null);
  const has = (m, part) => m.lines.some(l => l.pkg === 'floor' && l.desc.toLowerCase().includes(part));
  assert.ok(has(crawl, 'i-joist') && has(crawl, 'subfloor'));
  assert.ok(!has(slab, 'i-joist') && !has(slab, 'subfloor'));
  assert.ok(has(slab, 'mudsill'), 'slab still needs the mudsill');
  assert.ok(slab.packages.floor < crawl.packages.floor);
});

test('a second story adds its own joists, subfloor and wall framing', () => {
  const one = QE.computeMaterials(QE.defaultTakeoff(), null, null);
  const t2 = QE.defaultTakeoff();
  t2.floors.push({ sf: 900, perimeter: 130, wallHeight: 8, joistSpacing: 16 });
  const two = QE.computeMaterials(t2, null, null);
  assert.ok(two.packages.floor > one.packages.floor);
  assert.ok(two.packages.wall > one.packages.wall);
  const joists = m => m.lines.filter(l => l.skuId === 'ijoist95').reduce((s, l) => s + l.qty, 0);
  assert.ok(joists(two) > joists(one));
});

test('subfloor thickness follows joist spacing (16→¾, 24→⅞, 32→1⅛)', () => {
  const at = sp => {
    const t = QE.defaultTakeoff(); t.floors[0].joistSpacing = sp;
    return QE.computeMaterials(t, null, null).lines.find(l => l.desc.includes('subfloor')).skuId;
  };
  assert.equal(at(16), 'sub34');
  assert.equal(at(24), 'sub78');
  assert.equal(at(32), 'sub118');
});

test('headers are no longer $0 — windows/doors and garage doors both price', () => {
  const m = QE.computeMaterials(QE.defaultTakeoff(), null, null);
  const hdr = m.lines.find(l => l.skuId === 'hdr410');
  const glulam = m.lines.find(l => l.skuId === 'glulam');
  assert.ok(hdr && hdr.total > 0, 'window/door headers priced');
  assert.ok(glulam && glulam.total > 0, 'garage header priced');
});

test('deck package only builds when deck SF > 0', () => {
  const none = QE.computeMaterials(QE.defaultTakeoff(), null, null);
  const withDeck = QE.computeMaterials(Object.assign(QE.defaultTakeoff(), { deckSF: 200, deckHeightFt: 6 }), null, null);
  assert.equal(none.packages.deck, 0);
  assert.ok(withDeck.packages.deck > 0);
  assert.ok(withDeck.lines.some(l => l.skuId === 'pt66'), 'tall deck uses 6×6 posts');
});

test('vendor sheet lists every SKU once at qty 1, grouped', () => {
  const sheet = QE.vendorSheet(null);
  const all = sheet.flatMap(g => g.items);
  assert.equal(all.length, QE.defaultPriceBook().length);
  assert.ok(all.every(i => i.qty === 1));
  // every SKU the default material run uses is on the sheet
  const ids = new Set(all.map(i => i.id));
  const used = QE.computeMaterials(Object.assign(QE.defaultTakeoff(), { deckSF: 200 }), null, null).lines;
  for (const l of used) assert.ok(ids.has(l.skuId), l.skuId + ' missing from vendor sheet');
});

test('quote: material packages source from the material estimate when present, backup rates when not', () => {
  const t = QE.defaultTakeoff();
  const m = QE.computeMaterials(t, null, null);
  const withMat = QE.computeQuote(t, null, { materials: m.packages });
  const noMat = QE.computeQuote(t, null, {});
  const line = (qq, key) => qq.categories.flatMap(c => c.lines).find(l => l.key === key);
  assert.equal(line(withMat, 'matFloor').source, 'material');
  assert.equal(line(withMat, 'matFloor').amount, m.packages.floor);
  assert.equal(line(noMat, 'matFloor').source, 'backup');
  assert.equal(line(noMat, 'matFloor').amount, Math.round(1800 * 3.60 * 100) / 100);
});

test('quote: sub-quote pattern — keyed quote wins over the backup calc', () => {
  const t = QE.defaultTakeoff();
  const qq = QE.computeQuote(t, null, { quotes: { hvac: 19500, trusses: 8800 } });
  const line = key => qq.categories.flatMap(c => c.lines).find(l => l.key === key);
  assert.equal(line('hvac').amount, 19500);
  assert.equal(line('hvac').source, 'quote');
  assert.equal(line('trusses').amount, 8800);
  assert.equal(line('plumbing').source, 'backup');            // no quote keyed → backup
  assert.equal(line('plumbing').amount, Math.round(1800 * 9.75 * 100) / 100);
});

test('quote: septic & well toggles gate their lines', () => {
  const on = QE.computeQuote(Object.assign(QE.defaultTakeoff(), { septic: true, well: true }), null, {});
  const off = QE.computeQuote(Object.assign(QE.defaultTakeoff(), { septic: false, well: false }), null, {});
  const keys = qq => qq.categories.flatMap(c => c.lines).map(l => l.key);
  assert.ok(keys(on).includes('septicInstall') && keys(on).includes('well'));
  assert.ok(!keys(off).includes('septicInstall') && !keys(off).includes('well'));
});

test('quote: foundation concrete includes footings and rounds to 5-yard loads', () => {
  // perim 190 × 4′ × 8″ walls = 506.7 cf; footings 190 × 16″×8″ = 168.9 cf → 25.02 CY → 30 CY load
  const qq = QE.computeQuote(QE.defaultTakeoff(), null, {});
  const f = qq.categories.flatMap(c => c.lines).find(l => l.key === 'foundation');
  assert.match(f.desc, /30 CY/);
  assert.equal(f.amount, 30 * 440);
});

test('quote: porta-potty uses schedule months; permit uses valuation when known', () => {
  const t = QE.defaultTakeoff();
  const qq = QE.computeQuote(t, null, { months: 8, valuation: 500000 });
  const line = key => qq.categories.flatMap(c => c.lines).find(l => l.key === key);
  assert.equal(line('portaPotty').amount, 8 * 270);
  assert.equal(line('permit').amount, 500000 * 0.02);
  const noVal = QE.computeQuote(t, null, {});
  const p2 = noVal.categories.flatMap(c => c.lines).find(l => l.key === 'permit');
  assert.equal(p2.amount, 8000);                              // falls back to the allowance
});

test('quote: manual override beats every other source and is not ROUGH', () => {
  const qq = QE.computeQuote(QE.defaultTakeoff(), null, { manual: { matFloor: 4321 } });
  const f = qq.categories.flatMap(c => c.lines).find(l => l.key === 'matFloor');
  assert.equal(f.amount, 4321);
  assert.equal(f.source, 'manual');
  assert.equal(f.rough, false);
});

test('quote: flooring three-way split — tile + carpet, LVT takes the remainder', () => {
  const t = Object.assign(QE.defaultTakeoff(), { tileSF: 400, carpetSF: 300 });
  const qq = QE.computeQuote(t, null, {});
  const line = key => qq.categories.flatMap(c => c.lines).find(l => l.key === key);
  assert.match(line('lvt').desc, /1100 SF/);                  // 1800 − 400 − 300
  assert.equal(line('carpet').amount, 300 * (1.25 + 3));
});

test('quote: rates are editable — changing one moves only its line', () => {
  const base = QE.computeQuote(QE.defaultTakeoff(), null, {});
  const bumped = QE.computeQuote(QE.defaultTakeoff(), { framingLaborLivingPerSF: 14 }, {});
  const line = (qq, key) => qq.categories.flatMap(c => c.lines).find(l => l.key === key);
  assert.equal(line(bumped, 'framingLabor').amount, 1800 * 14);
  assert.equal(line(bumped, 'sidingLabor').amount, line(base, 'sidingLabor').amount);
});

test('quote: total is the sum of category subtotals', () => {
  const qq = QE.computeQuote(QE.defaultTakeoff(), null, {});
  const sum = Math.round(qq.categories.reduce((s, c) => s + c.subtotal, 0) * 100) / 100;
  assert.equal(qq.total, sum);
  assert.ok(qq.total > 100000, 'a 1800-SF build should quote six figures, got ' + qq.total);
});
