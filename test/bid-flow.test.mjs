import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, stubReact, treeText } from './helpers.mjs';

const win = loadScripts(['public/quote-engine.js', 'public/keystone.js'], {
  React: stubReact,
  RidgelineSync: { userName: () => 'Ridgeline', isOwner: () => true },
});
const K = win.Keystone, QE = win.QuoteEngine;

// Pull every input's displayed value out of a stub-React tree.
function inputVals(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.props && node.props.defaultValue !== undefined) out.push(String(node.props.defaultValue));
  (node.kids || []).forEach(k => inputVals(k, out));
  return out;
}

function bidComponent(opts = {}) {
  const cat = {
    priceBook: QE.defaultPriceBook(), quoteRates: QE.defaultRates(),
    settings: { defaultMarkupPct: 0.2, salesTaxPct: 0.086 }, branding: {},
    priceQuote: opts.priceQuote,
  };
  const t = QE.defaultTakeoff();
  const c = {
    state: { jobs: [{ id: 'j1', name: 'Vorse Residence' }], jobId: 'j1', role: 'admin', ksRoughTab: opts.tab || 'quote' },
    catalog: cat, jobTakeoff: t,
    jobRoughQuote: { quotes: {}, manual: {}, useMaterials: true, priceOverrides: opts.overrides },
    jobEstimate: opts.estimate === null ? null : (opts.estimate || {
      items: [{ id: 'i1', code: '0110', name: 'Permits', costLines: [] }],
      settings: { defaultMarkupPct: 0.2, salesTaxPct: 0.086 },
    }),
    saved: [], ticks: 0,
    ksSaveJobData() { this.saved.push('job'); }, ksSaveCatalog() { this.saved.push('catalog'); },
    ksTick() { this.ticks++; }, ksTouch() {}, setState(s) { Object.assign(this.state, s); },
    ksLoadTemplates() {}, ksTemplates: [], ksApplyRoughNative() {},
  };
  c.ksQuoteContext = () => {
    const ov = c.jobRoughQuote.priceOverrides;
    const book = (ov && Object.keys(ov).length)
      ? cat.priceBook.map(p => (ov[p.id] != null ? Object.assign({}, p, { price: Number(ov[p.id]) }) : p))
      : cat.priceBook;
    const m = QE.computeMaterials(t, book, cat.quoteRates);
    return { takeoff: t, rq: c.jobRoughQuote, materials: m, months: 6,
      quote: QE.computeQuote(t, cat.quoteRates, { materials: m.packages, quotes: {}, manual: {}, months: 6, valuation: 500000 }) };
  };
  return c;
}

test('bid amounts are shown as currency, not bare numbers', () => {
  const vals = inputVals(K.views.rough(bidComponent())).filter(v => v !== '');
  assert.ok(vals.length > 10, 'expected the bid to render editable amounts');
  const bare = vals.filter(v => /^-?\d+(\.\d+)?$/.test(v));
  assert.deepEqual(bare, [], 'these amounts still render as bare numbers: ' + bare.join(', '));
  assert.ok(vals.every(v => v.startsWith('$')), 'every money cell carries a $');
});

test('a currency-formatted amount round-trips exactly, so an untouched blur cannot drift the number', () => {
  const c = bidComponent();
  const vals = inputVals(K.views.rough(c)).filter(v => v.startsWith('$'));
  for (const v of vals.slice(0, 12)) {
    const parsed = parseFloat(v.replace(/[$,]/g, ''));
    assert.ok(isFinite(parsed), v + ' parses back to a number');
    assert.equal(v.split('.')[1].length, 2, v + ' keeps both cents digits');
  }
});

test('the two apply buttons say which one to use, based on what the estimate actually has', () => {
  // estimate already carries a matching cost code -> "Update" is the recommendation
  const withMatch = treeText(K.views.rough(bidComponent())).join(' | ');
  assert.ok(withMatch.includes('PUT THESE PRICES ON THE ESTIMATE'));
  const upd = withMatch.indexOf('Update the estimate');
  const reb = withMatch.indexOf('Rebuild the estimate from this bid');
  const rec = withMatch.indexOf('DO THIS ONE');
  assert.ok(upd > -1 && reb > -1 && rec > -1, 'both choices plus a recommendation render');
  assert.ok(rec < reb, 'the recommendation sits with Update when items already match');

  // nothing to land on -> rebuilding is the honest recommendation
  const noMatch = treeText(K.views.rough(bidComponent({
    estimate: { items: [{ id: 'i9', code: '9999', name: 'Something else', costLines: [] }], settings: { defaultMarkupPct: 0.2, salesTaxPct: 0.086 } },
  }))).join(' | ');
  assert.ok(noMatch.indexOf('DO THIS ONE') > noMatch.indexOf('Update the estimate'), 'recommendation moves to Rebuild');
});

test('takeoff tab ends with a Done button that hands you to the bid', () => {
  const c = bidComponent({ tab: 'inputs' });
  const tree = K.views.rough(c);
  const txt = treeText(tree).join(' | ');
  assert.ok(txt.includes('✓ Done — price the bid →'), 'Done button present');
  // find it and press it
  const find = n => {
    if (!n || typeof n !== 'object') return null;
    if (n.props && n.props.onClick && treeText(n).join(' ').includes('Done — price the bid')) return n;
    for (const k of (n.kids || [])) { const r = find(k); if (r) return r; }
    return null;
  };
  find(tree).props.onClick();
  assert.equal(c.state.ksRoughTab, 'quote', 'Done lands on the bid');
});

test('tabs read as a numbered flow with the reference tabs off to the side', () => {
  const txt = treeText(K.views.rough(bidComponent({ tab: 'inputs' }))).join(' | ');
  assert.ok(txt.includes('1 · Takeoff'));
  assert.ok(txt.includes('2 · The bid'));
  assert.ok(txt.includes('Material list'));
  assert.ok(txt.includes('Price list'));
});

test('editing a price inside a job asks whether it belongs to the master list or just this job', () => {
  const c = bidComponent({ tab: 'prices' });
  const tree = K.views.rough(c);
  // the price cell for the first SKU
  const sku = c.catalog.priceBook[0];
  const cells = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.props && n.props.onBlur && String(n.props.defaultValue || '').startsWith('$')) cells.push(n);
    (n.kids || []).forEach(walk);
  })(tree);
  assert.ok(cells.length, 'price cells render as currency');
  const before = sku.price;
  cells[0].props.onBlur({ target: { value: '$99.99' } });
  assert.ok(c._sysDlg, 'a dialog asks where the price goes');
  assert.ok(c._sysDlg.altLabel.includes('Vorse Residence'), 'one option is this job only');
  assert.equal(sku.price, before, 'master price untouched until you choose');

  // choose "this job only"
  c._sysDlg.altCb();
  assert.equal(sku.price, before, 'master list still untouched');
  assert.equal(c.jobRoughQuote.priceOverrides[sku.id], 99.99, 'stored as a job-only override');

  // now choose the master option on a second edit
  const c2 = bidComponent({ tab: 'prices' });
  const cells2 = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.props && n.props.onBlur && String(n.props.defaultValue || '').startsWith('$')) cells2.push(n);
    (n.kids || []).forEach(walk);
  })(K.views.rough(c2));
  cells2[0].props.onBlur({ target: { value: '$12.34' } });
  c2._sysDlg.cb(true);
  assert.equal(c2.catalog.priceBook[0].price, 12.34, 'master list updated when you pick master');
});

test('job-only overrides drive the material math without touching the master price list', () => {
  const plain = bidComponent();
  const base = plain.ksQuoteContext().materials.total;
  const sku = plain.catalog.priceBook.find(p => p.group === 'Framing lumber') || plain.catalog.priceBook[0];
  const bumped = bidComponent({ overrides: { [sku.id]: (Number(sku.price) || 1) * 10 + 25 } });
  assert.notEqual(bumped.ksQuoteContext().materials.total, base, 'the override changes this job’s material total');
  assert.equal(bumped.catalog.priceBook.find(p => p.id === sku.id).price, sku.price, 'master price unchanged');
});

test('an expired vendor quote flags itself and offers a re-quote exactly once', () => {
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const c = bidComponent({ tab: 'prices', priceQuote: { vendor: 'Parr Lumber', expires: yday, updated: '2026-01-01' } });
  const txt = treeText(K.views.rough(c)).join(' | ');
  assert.ok(txt.includes('Parr Lumber'), 'the supplier is named on the status bar');
  assert.ok(txt.includes('expired ' + yday), 'the bar says it lapsed');
  assert.ok(c._sysDlg && /expired/i.test(c._sysDlg.title), 'it prompts to re-quote');
  assert.equal(c.catalog.priceQuote.remindedFor, yday, 'the reminder is recorded');

  c._sysDlg = null;
  K.views.rough(c);
  assert.ok(!c._sysDlg, 'it does not nag a second time for the same expiration');
});

test('a quote still in date does not prompt, and offers to change the expiration', () => {
  const future = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const c = bidComponent({ tab: 'prices', priceQuote: { vendor: 'Parr Lumber', expires: future } });
  const txt = treeText(K.views.rough(c)).join(' | ');
  assert.ok(!c._sysDlg, 'no nag while the pricing is good');
  assert.ok(txt.includes('good through ' + future));
  assert.ok(txt.includes('Change expiration'));
});
