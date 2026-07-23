import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, stubReact } from './helpers.mjs';

const win = loadScript('public/keystone.js', { React: stubReact, crypto: { randomUUID: () => 'x'.repeat(8) } });
const K = win.Keystone;

// working-day span (inclusive) of a computed schedule
function spanWorkdays(rows) {
  let min = Infinity, max = -Infinity;
  for (const r of rows) {
    const s = +new Date(r.start + 'T00:00:00Z'), f = +new Date(r.finish + 'T00:00:00Z');
    if (s < min) min = s; if (f > max) max = f;
  }
  let wd = 0;
  for (let t = min; t <= max; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) wd++; }
  return wd;
}

test('150 & 180 templates land on their working-day targets', () => {
  assert.equal(spanWorkdays(K.computeSchedule(K.longBuildTemplate(150), '2026-01-05')), 150);
  assert.equal(spanWorkdays(K.computeSchedule(K.longBuildTemplate(180), '2026-01-05')), 180);
});

test('the four new trades are their own categories in both templates', () => {
  for (const v of [150, 180]) {
    const groups = K.templateGroups(K.longBuildTemplate(v));
    for (const g of ['Septic', 'Well drilling/install', 'Exterior stone', 'Interior stone']) {
      assert.ok(groups.includes(g), v + '-day template missing category ' + g);
    }
  }
});

test('filtering out categories drops their tasks and rewires predecessors (no dangling)', () => {
  const tasks = K.longBuildTemplate(180);
  const sel = {}; K.templateGroups(tasks).forEach(g => sel[g] = true);
  sel['Septic'] = false; sel['Well drilling/install'] = false;
  const filtered = K.applyGroupSelection(tasks, sel);
  assert.ok(filtered.length < tasks.length);
  assert.ok(!filtered.some(t => t.group === 'Septic' || t.group === 'Well drilling/install'));
  const ids = new Set(filtered.map(t => t.id));
  assert.equal(filtered.filter(t => t.pred && !ids.has(t.pred)).length, 0);
  // the surviving schedule still computes to a full span
  assert.ok(spanWorkdays(K.computeSchedule(filtered, '2026-01-05')) > 100);
});

test('editing a finish date pulls the start back by the task duration (round-trips)', () => {
  // Model the FINISH edit: fixed = finish - (days-1) workdays, then recompute -> finish matches.
  const defs = K.longBuildTemplate(150).map(d => ({ ...d }));
  const target = defs.find(d => d.id === 'b24'); // "Frame walls"
  const wantFinish = '2026-05-01';
  const days = target.days;
  target.fixed = isoOf(K.subWorkDays(new Date(wantFinish + 'T00:00:00Z'), days - 1));
  const rows = K.computeSchedule(defs, '2026-01-05');
  const row = rows.find(r => r.id === 'b24');
  assert.equal(row.finish, wantFinish);            // finish is exactly what we typed
  // and the start moved back by (days-1) working days from that finish
  assert.equal(row.start, isoOf(K.subWorkDays(new Date(wantFinish + 'T00:00:00Z'), days - 1)));
});

test('pinning a task ripples to its dependents', () => {
  const defs = K.longBuildTemplate(150).map(d => ({ ...d }));
  const base = K.computeSchedule(defs, '2026-01-05');
  const dep = base.find(r => r.pred === 'b24');    // a task that follows Frame walls
  assert.ok(dep, 'expected a dependent of b24');
  // push Frame walls far out
  defs.find(d => d.id === 'b24').fixed = '2026-09-01';
  const after = K.computeSchedule(defs, '2026-01-05');
  const depAfter = after.find(r => r.id === dep.id);
  assert.ok(+new Date(depAfter.start) > +new Date(dep.start), 'dependent should slide later');
});

test('ensureLongTemplates seeds both once and respects deletion', () => {
  const cat = { schedTemplates: [], scheduleTemplate: K.defaultTemplate() };
  assert.equal(K.ensureLongTemplates(cat), true);                 // seeded
  assert.ok(cat.schedTemplates.find(t => t.id === 'build_150'));
  assert.ok(cat.schedTemplates.find(t => t.id === 'build_180'));
  assert.equal(K.ensureLongTemplates(cat), false);               // idempotent
  // user deletes one; the seed marker keeps it from silently returning
  cat.schedTemplates = cat.schedTemplates.filter(t => t.id !== 'build_150');
  assert.equal(K.ensureLongTemplates(cat), false);
  assert.ok(!cat.schedTemplates.find(t => t.id === 'build_150'));
});

function isoOf(d) { return d.toISOString().slice(0, 10); }
