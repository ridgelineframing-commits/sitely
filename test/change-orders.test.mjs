import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts, stubReact, treeText, makeKV } from './helpers.mjs';
import { changeOrderTotal, jobContractTotal, jobForCustomer } from '../functions/api/_lib.js';

const win = loadScripts(['public/quote-engine.js', 'public/keystone.js'], {
  React: stubReact, RidgelineSync: { userName: () => 'Ridgeline' },
});
const K = win.Keystone;

const estimate = () => ({
  settings: { defaultMarkupPct: 0.2, salesTaxPct: 0 },
  categories: [{ id: 'c1', code: '0300', name: 'Rough Structure' }],
  items: [{ id: 'i1', categoryId: 'c1', code: '0310', name: 'Framing', costLines: [{ id: 'l1', qty: 1, unit: 'LS', unitCost: 100000, markupPct: 0.2, taxable: false }] }],
});

const cos = () => ([
  { id: 'co1', no: 1, title: 'Add covered porch', desc: 'Framed and roofed', amount: 12500, days: 5, status: 'approved', createdAt: 1, signedAt: 2, signedBy: 'Linda Johnson' },
  { id: 'co2', no: 2, title: 'Upgrade windows', desc: '', amount: 4200, days: 0, status: 'sent', createdAt: 1 },
  { id: 'co3', no: 3, title: 'Draft idea', desc: '', amount: 900, days: 0, status: 'draft', createdAt: 1 },
]);

function comp() {
  const est = estimate();
  return {
    state: { jobs: [{ id: 'j1', name: 'Vorse' }], jobId: 'j1', role: 'admin' },
    jobEstimate: est, jobChangeOrders: cos(), jobDraws: null,
    catalog: { items: [], categories: [], priceBook: [], settings: est.settings },
    ksSaveJobData() {}, ksTick() {}, ksTouch() {}, setState() {}, go() {}, ksSaveCatalog() {},
    ksApi: () => Promise.resolve([]),
  };
}

test('only approved change orders count toward the contract', () => {
  assert.equal(changeOrderTotal(cos()), 12500, 'sent and draft COs are excluded');
  assert.equal(K.approvedCOTotal(comp()), 12500);
  assert.equal(K.contractWithCOs(comp()), 132500, 'base $120,000 + one approved $12,500');
  assert.equal(jobContractTotal({ estimate: estimate(), changeOrders: cos() }), 132500, 'server agrees with the client');
});

test('the change-order screen shows original, approved changes and the contract today', () => {
  const txt = treeText(K.views.changes(comp())).join(' | ');
  assert.ok(txt.includes('ORIGINAL CONTRACT') && txt.includes('$120,000'));
  assert.ok(txt.includes('APPROVED CHANGES') && txt.includes('$12,500'));
  assert.ok(txt.includes('CONTRACT TODAY') && txt.includes('$132,500'));
  assert.ok(txt.includes('Add covered porch'), 'each CO is listed');
  assert.ok(txt.includes('SIGNED'), 'a signed CO is marked');
  assert.ok(txt.includes('awaiting signature'), 'the sent CO is called out as pending');
});

test('a signed change order cannot be edited away', () => {
  const c = comp();
  const tree = K.views.changes(c);
  // the status chip on CO 1 (signed) refuses to cycle and explains why
  const chips = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.props && n.props.onClick && treeText(n).join('').startsWith('APPROVED')) chips.push(n);
    (n.kids || []).forEach(walk);
  })(tree);
  assert.ok(chips.length, 'found the signed CO status chip');
  chips[0].props.onClick();
  assert.ok(c._sysDlg && /Already signed/.test(c._sysDlg.title), 'it explains the record is frozen');
  assert.equal(c.jobChangeOrders.find(x => x.id === 'co1').status, 'approved', 'status unchanged');
});

test('change orders land at the bottom of the estimate and move the contract total', () => {
  const txt = treeText(K.views.estimate(comp())).join(' | ');
  const coHead = txt.indexOf('CHANGE ORDERS');
  const scope = txt.indexOf('Framing');
  assert.ok(coHead > scope, 'the change-order block comes after the original scope');
  assert.ok(txt.includes('CO 1'), 'approved CO listed');
  assert.ok(txt.includes('AWAITING SIGNATURE'), 'unsigned CO shown but flagged');
  assert.ok(txt.includes('CONTRACT TODAY') && txt.includes('$132,500'), 'total includes approved changes only');
});

test('the draw sheet bills against the contract including approved changes', () => {
  const c = comp();
  const txt = treeText(K.views.draws(c)).join(' | ');
  assert.ok(txt.includes('Original contract') && txt.includes('$120,000'));
  assert.ok(txt.includes('CO 1 — Add covered porch'), 'the CO is tracked on the draw sheet');
  assert.ok(txt.includes('Contract today') && txt.includes('$132,500'));
  // first draw is 10% -> of 132,500, not 120,000
  assert.ok(txt.includes('$13,250'), 'draw amounts use the adjusted contract');
});

test('the customer portal sees sent and approved change orders, never drafts', () => {
  const doc = jobForCustomer({ id: 'j1', name: 'Vorse', estimate: estimate(), changeOrders: cos(), draws: [{ no: 1, name: 'Mobilization', pct: 10, status: 'UPCOMING' }] });
  const ids = doc.changeOrders.map(co => co.id);
  assert.deepEqual(ids, ['co1', 'co2'], 'drafts stay internal');
  assert.equal(doc.baseContract, 120000);
  assert.equal(doc.contractTotal, 132500, 'portal contract includes approved changes');
  assert.equal(doc.draws[0].amt, 13250, 'portal draw math matches');
  assert.ok(!('desc' in doc.changeOrders[0]) === false, 'the customer gets the description they need to sign');
});

test('the job nav renders as a vertical sidebar with the tools split off', () => {
  const chips = [
    { label: 'Estimate', click() {}, bg: 'var(--tx,#26211A)', col: 'var(--bg,#F6F3ED)', ml: '0' },
    { label: 'Change orders', click() {}, bg: 'transparent', col: 'var(--mu,#7A6F60)', ml: '0' },
    { label: '⚡ Bid Builder', click() {}, bg: 'var(--ac,#A64B24)', col: '#FFFFFF', ml: 'auto' },
  ];
  const nav = K.jobNav({}, chips);
  assert.ok(nav, 'nav renders when there are chips');
  assert.equal(nav.type, 'nav');
  const txt = treeText(nav).join(' | ');
  assert.ok(txt.includes('Estimate') && txt.includes('Change orders') && txt.includes('⚡ Bid Builder'));
  assert.equal(K.jobNav({}, []), null, 'no chips, no sidebar');
});

test('expanded cards have a Done button that commits the open field and closes them', () => {
  const c = comp();
  c.state.ksOpen = { i1: true };
  let saves = 0;
  c.ksSaveJobData = () => { saves++; };
  c.setState = s => Object.assign(c.state, s);
  let blurred = false;
  win.document = { activeElement: { blur() { blurred = true; } } };

  const findBtn = (n, label) => {
    if (!n || typeof n !== 'object') return null;
    if (n.props && n.props.onClick && treeText(n).join('') === label) return n;
    for (const k of (n.kids || [])) { const r = findBtn(k, label); if (r) return r; }
    return null;
  };

  // estimate item card
  const done = findBtn(K.views.estimate(c), '✓ Done');
  assert.ok(done, 'the estimate item card offers Done');
  done.props.onClick();
  assert.ok(blurred, 'whatever you were typing in is committed first');
  assert.ok(saves > 0, 'it saves');
  assert.ok(!c.state.ksOpen.i1, 'and the card closes');

  // change-order card
  c._coOpen = 'co1';
  const coDone = findBtn(K.views.changes(c), '✓ Done');
  assert.ok(coDone, 'the change-order card offers Done too');
  coDone.props.onClick();
  assert.equal(c._coOpen, null, 'it closes');
});
