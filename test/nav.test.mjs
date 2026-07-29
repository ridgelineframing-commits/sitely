import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repo } from './helpers.mjs';

// The top nav is a decision, not an accident: Home is the hub (no separate Projects page),
// and Templates/Catalog/Settings stay reachable in one click. Pin it so a refactor can't
// quietly reorganize it again.
const html = readFileSync(resolve(repo, 'public/index.html'), 'utf8');
const tabBlock = html.slice(html.indexOf('let tabDefs'), html.indexOf('const tabs = tabDefs'));

test('the admin top nav is Home · Whiteboard · Schedules · Templates · Catalog · Settings', () => {
  for (const pair of [
    "['home', 'KS:Home', 'Home']",
    "['sched', 'KS:SchedHub', 'Schedules']",
    "['templates', 'KS:Templates', 'Templates']",
    "['catalog', 'KS:Catalog', 'Catalog']",
    "['settings', 'KS:Settings', 'Settings']",
  ]) assert.ok(tabBlock.includes(pair), 'missing tab: ' + pair);
  assert.ok(tabBlock.includes('boardLabel'), 'the Whiteboard tab carries its live count');
});

test('there is no separate Projects page and nothing is buried behind a More tab', () => {
  assert.ok(!tabBlock.includes("'Projects'"), 'Home is the hub — no Projects tab');
  assert.ok(!tabBlock.includes("'More'"), 'no catch-all More tab');
  assert.ok(!tabBlock.includes("'Today'"), 'the home tab is called Home');
});

test('PMs get Home, Whiteboard and Schedules', () => {
  const pm = tabBlock.slice(tabBlock.indexOf("role === 'pm'"));
  for (const t of ['KS:Home', 'KS:Board', 'KS:SchedHub']) assert.ok(pm.includes(t), 'PM tab missing: ' + t);
  assert.ok(!pm.includes('KS:Catalog'), 'PMs never see pricing');
});

test('no dead agent-service wiring is left behind', () => {
  const ks = readFileSync(resolve(repo, 'public/keystone.js'), 'utf8');
  assert.ok(!html.includes('KS:Agent'), 'agent route gone from the shell');
  assert.ok(!ks.includes('viewAgent'), 'agent view gone');
  assert.ok(!ks.includes('/agent/'), 'no calls to an undeployed agent service');
  const toml = readFileSync(resolve(repo, 'wrangler.toml'), 'utf8');
  assert.ok(!toml.includes('AGENT_SERVICE'), 'no service binding to a worker that does not exist');
});
