import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, stubReact, treeText } from './helpers.mjs';

const K = loadScript('public/keystone.js', {
  React: stubReact,
  RidgelineSync: { userName: () => 'Zac' },
}).Keystone;

function findClickableByText(node, txt) {
  if (!node || typeof node !== 'object') return null;
  const text = treeText(node).join(' ');
  if (node.props && node.props.onClick && text.includes(txt)) return node;
  for (const k of (node.kids || [])) { const r = findClickableByText(k, txt); if (r) return r; }
  return null;
}

function hubComponent() {
  const calls = [];
  return {
    calls,
    state: { jobs: [{ id: 'j1', name: 'Vorse Residence' }, { id: 'j2', name: 'Maybe House' }, { id: 'j3', name: 'Admin' }], role: 'admin' },
    ksJobCache: {
      j1: { status: 'active', customer: { address: '123 Main St, Ridgefield, WA' }, schedule: [{ task: '10 Excavation', start: '2026-07-27', finish: '2026-07-29', status: 'In Progress' }] },
      j2: { status: 'prospect', schedule: [] },
      j3: { status: 'active', schedule: [] },
    },
    ksApi: () => Promise.resolve({}),
    ksTick() {}, openJob(id) { calls.push(['open', id]); }, go(t) { calls.push(['go', t]); }, setState() {},
  };
}

test('Schedules hub: week chips, project rail, prospects collapsed, weather city picked up', () => {
  const c = hubComponent();
  const text = treeText(K.views.schedHub(c)).join(' ');
  assert.ok(text.includes('Vorse Residence'), 'active job listed');
  assert.ok(text.includes('now: Excavation'), 'current task summarized on the row');
  assert.ok(text.includes('WEEKS'), '2/3/4-week selector present');
  assert.ok(text.includes('1 prospect'), 'prospects behind an expander');
  assert.ok(!text.includes('Maybe House'), 'prospect rows hidden until expanded');
  assert.ok(text.includes('Ridgefield'), 'weather city derived from the job-site address');
  assert.ok(text.includes('Admin'), 'company catch-all pinned in the rail');
});

test('clicking a hub project row opens that job’s schedule', () => {
  const c = hubComponent();
  const row = findClickableByText(K.views.schedHub(c), 'Vorse Residence');
  assert.ok(row, 'expected a clickable project row');
  row.props.onClick();
  assert.deepEqual(c.calls, [['open', 'j1'], ['go', 'KS:Schedule']]);
});

function schedComponent(view) {
  return {
    state: { jobs: [{ id: 'j1', name: 'Vorse' }], jobId: 'j1', role: 'admin', ksSchedView: view, ksField: false },
    jobSchedule: [
      { id: 't1', task: '10 Excavation', group: 'Sitework', days: 3, start: '2026-07-27', finish: '2026-07-29', status: 'In Progress', confirmed: true },
      { id: 't2', task: '20 Footings', group: 'Foundation', days: 2, start: '2026-07-30', finish: '2026-07-31', status: 'Not Started' },
    ],
    jobCustomer: { address: '123 Main St, Ridgefield, WA' },
    ksBoardCache: { notes: [{ id: 'n1', text: 'Order rebar', jobId: 'j1', ts: 1 }] },
    ksLoadBoard() {}, ksSaveBoard() {}, ksSaveJobData() {}, ksTick() {}, go() {}, setState() {},
    ksRecompute() {}, computeScheduleRows: () => [],
  };
}

test('schedule view chips offer List / Timeline / Calendar / Agenda, with the to-dos strip', () => {
  const text = treeText(K.views.schedule(schedComponent('list'))).join(' ');
  for (const lbl of ['List', 'Timeline', 'Calendar', 'Agenda']) assert.ok(text.includes(lbl), lbl + ' chip present');
  assert.ok(text.includes('TO-DOS & NOTES'), 'whiteboard strip on the schedule screen');
  assert.ok(text.includes('Order rebar'), 'this job’s board note surfaces in the strip');
});

test('agenda view groups by start day with status pills and firm chips', () => {
  const text = treeText(K.views.schedule(schedComponent('agenda'))).join(' ');
  assert.ok(text.includes('Excavation'));
  assert.ok(text.includes('Footings'));
  assert.ok(text.includes('IN PROGRESS'), 'status pill rendered');
  assert.ok(text.includes('3-week lookahead'), 'lookahead filter offered');
  assert.ok(text.includes('Sitework'), 'phase shown on the row');
});

test('calendar view renders the week grid with a weeks selector and the job’s weather city', () => {
  const text = treeText(K.views.schedule(schedComponent('calendar'))).join(' ');
  assert.ok(text.includes('MON') && text.includes('SUN'), 'day-of-week header');
  assert.ok(text.includes('WEEKS'), 'weeks selector');
  assert.ok(text.includes('Ridgefield'), 'weather city from the job address');
});
