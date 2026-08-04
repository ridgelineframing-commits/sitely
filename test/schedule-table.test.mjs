// The schedule's List view is the table people actually work in — the TASK column has to be
// readable. It stopped being readable once the controls around it grew, so these tests pin
// both the column budget and the field app's date semantics (a date in the field = DUE date).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScript, stubReact, repo } from './helpers.mjs';

const K = loadScript('public/keystone.js', {
  React: stubReact,
  RidgelineSync: { userName: () => 'Zac' },
}).Keystone;

function comp() {
  return { state: {}, ksTick() {}, ksTouch() {}, setState() {} };
}

function rows() {
  return [
    { id: 't1', group: 'Sitework', task: '10 Excavation and rough grade', days: 3, pred: null, lag: 0, off: 0, start: '2026-08-03', finish: '2026-08-05', status: 'In Progress', pct: 0.5 },
    { id: 't2', group: 'Sitework', task: '20 Footings', days: 2, pred: 't1', lag: 1, off: 0, start: '2026-08-07', finish: '2026-08-10', status: 'Not Started', pct: 0 },
  ];
}

function find(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const k of (node.kids || [])) find(k, pred, out);
  return out;
}

function gridsIn(tree) {
  return find(tree, n => n.props && n.props.style && n.props.style.gridTemplateColumns)
    .map(n => n.props.style.gridTemplateColumns);
}

// Sum of every fixed-px track + the column gaps: the space the TASK column never gets.
function fixedBudget(grid, gapPx = 8) {
  const tracks = grid.match(/minmax\([^)]*\)|[^\s]+/g);
  let px = 0;
  for (const t of tracks) {
    if (t.startsWith('minmax')) continue;
    const m = /^(\d+(?:\.\d+)?)px$/.exec(t);
    if (m) px += Number(m[1]);
  }
  return px + gapPx * (tracks.length - 1);
}

test('the task name is an editable cell carrying the row text', () => {
  const r = rows();
  const tree = K.taskTable(comp(), r, { showStatus: true, onChange() {} });
  const named = find(tree, n => n.type === 'input' && n.props.defaultValue === r[0].task);
  assert.equal(named.length, 1, 'the TASK cell should render the task name');
  assert.equal(named[0].props.style.minWidth, 0, 'the name cell must be allowed to shrink inside its track');
});

test('the TASK column has a floor and most of the slack', () => {
  const tree = K.taskTable(comp(), rows(), { showStatus: true, onChange() {} });
  const grid = gridsIn(tree)[0];
  assert.ok(grid, 'the table should lay out on a grid');
  const task = grid.match(/minmax\((\d+)px,([\d.]+)fr\)/);
  assert.ok(task, 'TASK should be minmax(<floor>px, <n>fr) — a bare 1fr collapses to nothing');
  assert.ok(Number(task[1]) >= 150, 'TASK needs at least a 150px floor, got ' + task[1]);
  const frs = [...grid.matchAll(/([\d.]+)fr/g)].map(m => Number(m[1]));
  assert.equal(Math.max(...frs), Number(task[2]), 'TASK should take the largest share of the slack');
});

test('the fixed columns leave room for the task name on a normal screen', () => {
  // The job schedule renders inside .ks-sched-grid (a 270px sidebar + 28px gap) on a ~1200px
  // page, so the table itself gets roughly 900px. Everything that is NOT the name column has
  // to fit well inside that or the name is what gets squeezed.
  for (const showStatus of [true, false]) {
    const grid = gridsIn(K.taskTable(comp(), rows(), { showStatus, onChange() {} }))[0];
    assert.ok(fixedBudget(grid) <= 660,
      'fixed columns + gaps (' + fixedBudget(grid) + 'px) crowd out the task name (showStatus=' + showStatus + ')');
  }
});

test('the desktop stepper stays compact enough for its column', () => {
  const tree = K.taskTable(comp(), rows(), { showStatus: true, onChange() {} });
  const steps = find(tree, n => n.type === 'button' && n.props.className === 'ks-step-btn');
  assert.ok(steps.length >= 4, 'duration and lag should both be steppers');
  for (const b of steps) {
    assert.ok(parseInt(b.props.style.width, 10) <= 24,
      'stepper buttons must stay narrow on desktop (index.html grows them to 44px on phones)');
  }
});

test('phones still get 44px touch targets for the compact desktop controls', () => {
  const html = readFileSync(resolve(repo, 'public/index.html'), 'utf8');
  const phone = html.slice(html.indexOf('@media'));
  assert.match(phone, /\.ks-step-btn\{[^}]*44px/, 'the phone media query must restore the stepper touch target');
  assert.match(phone, /\.ks-icon-btn\{min-width:44px/, 'the phone media query must restore the icon-button touch target');
});

test('a date typed in the field is the task’s DUE date, not its start', () => {
  const app = readFileSync(resolve(repo, 'public/field/app.js'), 'utf8');
  const row = app.slice(app.indexOf('task-date-inp'), app.indexOf('task-date-inp') + 300);
  assert.match(row, /value="' \+ esc\(r\.finish \|\| r\.start/,
    'the field date control should show the task finish (its due date)');
  const handler = app.slice(app.indexOf("'.task-date-inp'"), app.indexOf("'.task-date-inp'") + 900);
  assert.match(handler, /r\.finish = newISO;/, 'the typed date becomes the finish');
  assert.match(handler, /subWorkDays\(newISO/, 'the start is pulled back by the task duration');
  assert.match(handler, /r\.fixed = start;/, 'the resulting start is pinned so a desktop recompute preserves it');
});

test('desktop Field mode shows the due date and moving it re-dates the task backwards', () => {
  const r = rows();
  const saves = [];
  const c = {
    state: { jobId: 'j1', ksField: true, ksSchedView: 'list' },
    jobSchedule: r,
    ksJobCache: { j1: { schedule: r } },
    ksTick() {}, ksTouch() {}, setState() {}, ksSaveJobData() { saves.push(1); },
    ksLoadBoard() {}, computeScheduleRows: () => r, ksRecompute() {},
  };
  const tree = K.views.schedule(c);
  const dates = find(tree, n => n.type === 'input' && n.props.type === 'date' && /Due date/.test(n.props.title || ''));
  assert.equal(dates.length, r.length, 'field mode should show one due-date control per task');
  assert.equal(dates[0].props.value, r[0].finish, 'the single field-mode date is the task’s due date');

  // A 3-day task due Fri 2026-08-14 must start Wed 2026-08-12 — and stay pinned there.
  dates[0].props.onChange({ target: { value: '2026-08-14' } });
  assert.equal(r[0].finish, '2026-08-14');
  assert.equal(r[0].start, '2026-08-12');
  assert.equal(r[0].fixed, '2026-08-12', 'the derived start is pinned so a recompute preserves it');
  assert.equal(saves.length, 1, 'the change should save');
});

test('subWorkDays walks back over the weekend', () => {
  // Mon 2026-08-03 minus 1 working day = Fri 2026-07-31.
  assert.equal(K.subWorkDays(new Date('2026-08-03T00:00:00Z'), 1).toISOString().slice(0, 10), '2026-07-31');
});
