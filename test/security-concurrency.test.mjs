import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSWORD_HASH_ITERATIONS,
  PASSWORD_HASH_VERSION,
  hashPassword,
  newSalt,
  passwordHash,
  upgradePasswordHash,
  verifyPassword
} from '../functions/api/_lib.js';
import {
  checkLoginLimit,
  loginAttemptKey,
  recordLoginFailure
} from '../functions/api/_login-rate.js';
import { onRequestPut as putJob } from '../functions/api/jobs/[id].js';
import { onRequest as agentProxy } from '../functions/api/agent/[[path]].js';
import { onRequestPost as login } from '../functions/api/login.js';
import { makeKV } from './helpers.mjs';

test('new password hashes use versioned PBKDF2 and legacy hashes upgrade after verification', async () => {
  const salt = newSalt();
  const user = {
    salt,
    hash: await passwordHash(salt, 'correct horse battery staple'),
    hashVersion: PASSWORD_HASH_VERSION,
    hashIterations: PASSWORD_HASH_ITERATIONS
  };
  assert.equal(await verifyPassword(user, 'correct horse battery staple'), true);
  assert.equal(await verifyPassword(user, 'wrong password'), false);

  const legacy = { salt: 'old-salt', hash: await hashPassword('old-salt', 'legacy password') };
  assert.equal(await verifyPassword(legacy, 'legacy password'), true);
  assert.equal(await upgradePasswordHash(legacy, 'legacy password'), true);
  assert.equal(legacy.hashVersion, PASSWORD_HASH_VERSION);
  assert.equal(legacy.hashIterations, PASSWORD_HASH_ITERATIONS);
  assert.equal(await verifyPassword(legacy, 'legacy password'), true);
});

test('login failures are limited per IP and identity with Retry-After', async () => {
  const kv = makeKV();
  const env = { RIDGELINE_KV: kv };
  const request = new Request('https://sitely.example/api/login', {
    headers: { 'CF-Connecting-IP': '203.0.113.8' }
  });
  const key = await loginAttemptKey(request, 'casey');
  for (let i = 0; i < 6; i++) await recordLoginFailure(env, key);
  const limited = await checkLoginLimit(env, key);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
});

function jobContext(kv, body, role = 'admin') {
  return {
    request: new Request('https://sitely.example/api/jobs/j1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
    env: { RIDGELINE_KV: kv },
    params: { id: 'j1' },
    data: { session: { role, name: 'Test User' } }
  };
}

test('job writes require a matching version and reject stale or unauthenticated saves', async () => {
  const job = { id: 'j1', name: 'Example', version: 1, edits: {}, status: 'active' };
  const kv = makeKV({
    'job:j1': JSON.stringify(job),
    'jobs:index': JSON.stringify([{ id: 'j1', name: 'Example', version: 1 }])
  });

  assert.equal((await putJob(jobContext(kv, { name: 'No version' }))).status, 428);
  assert.equal((await putJob(jobContext(kv, { baseVersion: 1, name: 'Updated' }))).status, 200);
  assert.equal(JSON.parse(kv._store['job:j1']).version, 2);

  const stale = await putJob(jobContext(kv, { baseVersion: 1, name: 'Overwrite' }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentVersion, 2);
  assert.equal(JSON.parse(kv._store['job:j1']).name, 'Updated');

  assert.equal((await putJob(jobContext(kv, { baseVersion: 2 }, 'none'))).status, 403);
});

// --- follow-up review of the hardening commit -------------------------------

test('the agent proxy cannot be walked out of its /v1 prefix', async () => {
  // encodeURIComponent leaves dots alone, so '..' segments used to survive and
  // `new URL()` resolved them: /api/agent/%2E%2E/%2E%2E/admin reached
  // https://sitely-agent.internal/admin. Admin/PM-only and the agent worker
  // re-checks the session, but a proxy that can be walked off its own prefix is
  // a bug regardless of who is behind it.
  const seen = [];
  const env = { AGENT_SERVICE: { fetch: r => { seen.push(r.url); return new Response('ok'); } } };
  const ctx = path => ({
    request: new Request('https://sitely.example/api/agent/x', { method: 'GET' }),
    env,
    params: { path },
    data: { session: { role: 'admin', name: 'Test' } }
  });

  assert.equal((await agentProxy(ctx(['..', '..', 'admin']))).status, 400);
  assert.equal((await agentProxy(ctx(['.']))).status, 400);
  assert.equal(seen.length, 0, 'a traversal attempt must never reach the service');

  await agentProxy(ctx(['runs', 'abc-123']));
  assert.equal(seen[0], 'https://sitely-agent.internal/v1/runs/abc-123');

  // A legitimate segment that merely CONTAINS dots is not traversal.
  await agentProxy(ctx(['files', 'plan..v2.pdf']));
  assert.ok(seen[1].startsWith('https://sitely-agent.internal/v1/files/'));
});

test('sign-in matches email and username but never the display name', async () => {
  // A display name is printed on packets and shown to customers, so matching on
  // it makes every account addressable by something public. It also breaks the
  // second of two people with the same name, since `find` takes the first hit.
  const salt = newSalt();
  const users = [
    { id: 'u1', role: 'pm', name: 'Mike', username: 'mike.t', salt, hash: await passwordHash(salt, 'pw-one', PASSWORD_HASH_ITERATIONS), hashVersion: PASSWORD_HASH_VERSION, hashIterations: PASSWORD_HASH_ITERATIONS }
  ];
  const kv = makeKV({ users: JSON.stringify(users) });
  const env = { RIDGELINE_KV: kv, APP_PASSWORD: 'owner-pw' };
  const post = body => login({
    request: new Request('https://sitely.example/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify(body)
    }),
    env
  });

  assert.equal((await post({ identity: 'mike.t', password: 'pw-one' })).status, 200);
  assert.equal((await post({ identity: 'Mike', password: 'pw-one' })).status, 401);
});
