import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, stubReact } from './helpers.mjs';

// Load keystone with the browser bits the "Move to Whiteboard" flow touches.
const K = loadScript('public/keystone.js', {
  React: stubReact,
  confirm: () => true,
  prompt: () => 'Punch list',
  RidgelineSync: { userName: () => 'Zac' },
}).Keystone;

// Find a node that has an onClick and whose descendant text contains `txt`.
function findClickableByText(node, txt) {
  if (!node || typeof node !== 'object') return null;
  const text = [];
  (function walk(n) {
    if (n == null) return;
    if (typeof n === 'string' || typeof n === 'number') { text.push(String(n)); return; }
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.kids) n.kids.forEach(walk);
  })(node.kids || []);
  if (node.props && node.props.onClick && text.join(' ').includes(txt)) return node;
  for (const k of (node.kids || [])) { const r = findClickableByText(k, txt); if (r) return r; }
  return null;
}

function makeComponent() {
  return {
    state: { jobs: [{ id: 'davi', name: 'Davi' }], jobId: 'davi', role: 'admin' },
    jobSchedule: [
      { id: 't-1', task: 'Clean windows', status: 'Not Started' },      // undated → to-do
      { id: 't-2', task: 'Hang doors', status: 'Complete' },            // undated → to-do (done)
      { id: 't3', task: 'Framing', start: '2026-08-01', status: 'Not Started' }, // dated → real task
    ],
    jobTodos: [], ksBoardCache: { notes: [] },
    ksLoadBoard() {}, ksSaveBoard() {}, ksSaveJobData() {}, ksTick() {}, go() {}, openJob() {},
  };
}

test('To-dos view surfaces "Move to Whiteboard" only when undated to-dos exist', () => {
  assert.ok(findClickableByText(K.views.todos(makeComponent()), 'Move to Whiteboard'));
  const none = makeComponent(); none.jobSchedule = [{ id: 't3', task: 'Framing', start: '2026-08-01' }];
  assert.equal(findClickableByText(K.views.todos(none), 'Move to Whiteboard'), null);
});

test('Move to Whiteboard rolls undated to-dos into one editable checklist and clears the schedule rows', () => {
  const c = makeComponent();
  findClickableByText(K.views.todos(c), 'Move to Whiteboard').props.onClick();

  assert.equal(c.ksBoardCache.notes.length, 1);
  const note = c.ksBoardCache.notes[0];
  assert.equal(note.jobId, 'davi');
  assert.equal(note.items.length, 2);                                            // only the undated ones
  assert.equal(note.items.find(i => i.text === 'Hang doors').done, true);        // checked-off preserved
  assert.equal(note.items.find(i => i.text === 'Clean windows').done, false);
  assert.deepEqual(c.jobSchedule.map(t => t.id), ['t3']);                        // dated task kept, undated cleared
});
