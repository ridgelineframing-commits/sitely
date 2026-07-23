import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, stubReact } from './helpers.mjs';
import * as SE from '../functions/api/_schedule.js';

// functions/api/_schedule.js duplicates the browser engine + templates from public/keystone.js so
// the MCP can build schedules server-side. These tests fail the moment the two drift apart.
const win = loadScript('public/keystone.js', { React: stubReact, crypto: { randomUUID: () => 'x'.repeat(8) } });
const K = win.Keystone;
// keystone runs in a VM realm (its objects have a different prototype), so compare by value via JSON.
const j = v => JSON.stringify(v);

test('built-in templates are byte-identical between keystone and the functions engine', () => {
  assert.equal(j(SE.longBuildTemplate(150)), j(K.longBuildTemplate(150)));
  assert.equal(j(SE.longBuildTemplate(180)), j(K.longBuildTemplate(180)));
  assert.equal(j(SE.commercialTITemplate()), j(K.commercialTITemplate()));
});

test('computeSchedule produces identical dates on both sides', () => {
  for (const defs of [K.longBuildTemplate(150), K.commercialTITemplate()]) {
    const a = K.computeSchedule(defs, '2026-01-05').map(r => [r.id, r.start, r.finish, r.days, r.pred, r.lag]);
    const b = SE.computeSchedule(defs, '2026-01-05').map(r => [r.id, r.start, r.finish, r.days, r.pred, r.lag]);
    assert.equal(j(b), j(a));
  }
});

test('templateDefsFor resolves built-in ids and names without a catalog', () => {
  assert.equal(SE.templateDefsFor(null, 'build_150').length, 81);
  assert.equal(SE.templateDefsFor(null, 'build_180').length, 81);
  assert.equal(SE.templateDefsFor(null, 'commercial_ti').length, 31);
  assert.equal(SE.templateDefsFor(null, 'Commercial TI').length, 31);
  assert.equal(SE.templateDefsFor(null, 'nope'), null);
});

test('templateDefsFor finds a saved template in the catalog by id or name', () => {
  const catalog = { scheduleTemplate: [], schedTemplates: [{ id: 'shop1', name: 'Shop build', tasks: [{ id: 'x', group: 'G', name: 'T', pred: null, days: 1 }] }] };
  assert.equal(SE.templateDefsFor(catalog, 'shop1').length, 1);
  assert.equal(SE.templateDefsFor(catalog, 'shop build').length, 1);
});
