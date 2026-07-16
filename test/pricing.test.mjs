import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, stubReact } from './helpers.mjs';
import { estContractTotal } from '../functions/api/_lib.js';

const K = loadScript('public/keystone.js', { React: stubReact }).Keystone;

const est = () => ({
  settings: { defaultMarkupPct: 0.2, salesTaxPct: 0.08 },
  categories: [{ id: 'c1', code: '0100', name: 'General', order: 0 }],
  items: [
    { id: 'i1', code: '0110', name: 'Labor', categoryId: 'c1', excluded: false, allowance: false,
      costLines: [{ id: 'l1', desc: 'Framing', qty: 10, unit: 'HR', unitCost: 50, markupPct: null, taxable: false }] },
    { id: 'i2', code: '0120', name: 'Material', categoryId: 'c1', excluded: false, allowance: false,
      costLines: [{ id: 'l2', desc: 'Lumber', qty: 100, unit: 'BF', unitCost: 5, markupPct: 0.3, taxable: true }] },
  ],
});

test('lineCalc applies markup then tax; per-line override wins over default', () => {
  const S = { defaultMarkupPct: 0.2, salesTaxPct: 0.08 };
  const labor = K.lineCalc({ qty: 10, unitCost: 50, markupPct: null, taxable: false }, S);
  assert.equal(labor.price, 600);          // 500 * (1 + 0.2 default)
  assert.equal(labor.tax, 0);              // not taxable
  const mat = K.lineCalc({ qty: 100, unitCost: 5, markupPct: 0.3, taxable: true }, S);
  assert.equal(mat.price, 650);            // 500 * 1.3 override
  assert.ok(Math.abs(mat.tax - 52) < 1e-9); // 650 * 0.08
});

test('lineCalc guards a malformed settings object (no NaN)', () => {
  const r = K.lineCalc({ qty: 2, unitCost: 100, markupPct: null, taxable: true }, {});
  assert.ok(Number.isFinite(r.total), 'total is finite even with empty settings');
  assert.equal(r.total, 200); // markup 0, tax 0
});

test('client estTotals and server estContractTotal agree', () => {
  const e = est();
  const client = K.estTotals(e).total;
  const server = estContractTotal(e);
  assert.ok(Math.abs(client - server) < 1e-6, `client ${client} vs server ${server}`);
});

test('excluded items drop out of the contract total on both sides', () => {
  const e = est();
  e.items[1].excluded = true;
  assert.ok(Math.abs(K.estTotals(e).total - estContractTotal(e)) < 1e-6);
  assert.equal(K.estTotals(e).total, 600); // only labor remains
});
