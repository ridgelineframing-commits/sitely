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
