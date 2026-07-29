import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProject, applyProposal } from '../src/analysis.js';

test('analysis creates schedule, field, change-order, plan, estimate, and customer proposals', () => {
  const job = {
    id: 'j1',
    name: 'Test Build',
    version: 4,
    schedule: [
      { id: 'late', task: '1000 Foundation', start: '2026-01-01', finish: '2026-01-02', status: 'In Progress' },
      { id: 'soon', task: '2000 Framing', start: '2026-07-30', finish: '2026-08-05', status: 'Not Started', confirmed: false }
    ],
    pendingNotes: [{ id: 'n1', text: 'Owner added a window', target: 'estimate', status: 'pending' }],
    plans: [{ id: 'p1', name: 'structural-revision.pdf' }],
    estimate: { items: [{ name: 'Lumber', costLines: [{ id: 'l1', desc: 'Package', verified: false }] }] },
    changeOrders: []
  };
  const out = analyzeProject(job, { notes: [] }, { now: Date.parse('2026-07-29T12:00:00Z') });
  const kinds = new Set(out.proposals.map(p => p.kind));
  for (const kind of ['schedule-risk', 'field-task', 'change-order', 'plan-intake', 'estimate-review', 'customer-update']) {
    assert.equal(kinds.has(kind), true, kind);
  }
  assert.equal(out.brief.counts.overdue, 1);
  assert.equal(out.brief.counts.tentative, 1);
});

test('approved actionable proposals are idempotent', () => {
  const job = { id: 'j1', todos: [], changeOrders: [] };
  const todo = { action: { type: 'add-todo', text: 'Call electrician', sourceId: 'n1' } };
  assert.equal(applyProposal(job, todo).changed, true);
  assert.equal(applyProposal(job, todo).changed, false);
  const co = { action: { type: 'draft-change-order', title: 'Window', desc: 'Add one', sourceId: 'n1' } };
  assert.equal(applyProposal(job, co).changed, true);
  assert.equal(applyProposal(job, co).changed, false);
});
