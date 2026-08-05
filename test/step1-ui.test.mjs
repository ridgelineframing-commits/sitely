import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScript, repo } from './helpers.mjs';

test('shared schedule actions keep due-date, completion and confirmation rules identical', () => {
  const A = loadScript('public/schedule-actions.js').ScheduleActions;
  const task = { days: 3, start: '2026-08-03', finish: '2026-08-05', status: 'Not Started', confirmed: false };
  A.setDueDate(task, '2026-08-14');
  assert.equal(task.start, '2026-08-12');
  assert.equal(task.fixed, '2026-08-12');
  A.setComplete(task, true); assert.equal(task.status, 'Complete'); assert.equal(task.pct, 1);
  A.toggleConfirmed(task); assert.equal(task.confirmed, true);
});

test('Field login sends identity and has an honest conflict state', () => {
  const app = readFileSync(resolve(repo, 'public/field/app.js'), 'utf8');
  const html = readFileSync(resolve(repo, 'public/field/index.html'), 'utf8');
  assert.match(html, /id="login-id"/);
  assert.match(app, /RS\.login\(pw, identity\)/);
  assert.match(app, /RS\.onConflict/);
  assert.doesNotMatch(app, /status-row"><span class="synced">✓ Synced/);
});

test('wide schedule workspace adapts before columns are clipped', () => {
  const html = readFileSync(resolve(repo, 'public/index.html'), 'utf8');
  assert.match(html, /max-width:1600px/);
  assert.match(html, /@media \(max-width: 1450px\)[\s\S]*?\.ks-sched-grid\{grid-template-columns:1fr/);
  assert.match(html, /aria-current="\{\{ t\.ariaCurrent \}\}"/);
});

test('job list no longer exposes permanent delete actions', () => {
  const js = readFileSync(resolve(repo, 'public/keystone.js'), 'utf8');
  assert.equal((js.match(/title: 'Delete job'/g) || []).length, 0);
  assert.match(js, /Delete this job/);
});
