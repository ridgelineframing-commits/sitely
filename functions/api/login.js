// POST /api/login  { password, email? }  ->  { token, role, name, owner? }
// - Owner (super administrator): APP_PASSWORD secret (no email) — the account holder
// - Administrator: their own password (no email) — same powers, except only the owner
//   may add or remove other administrators
// - Project manager: their own password (no email; staff passwords are unique)
// - Customer: email + password
import { getUsers, putUsers, verifyPassword, upgradePasswordHash, json } from './_lib.js';
import { loginAttemptKey, checkLoginLimit, recordLoginFailure, clearLoginFailures } from './_login-rate.js';

function timingSafeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

async function newSession(env, data) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  await env.RIDGELINE_KV.put('session:' + token, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 90 });
  return token;
}

export async function onRequestPost({ request, env }) {
  if (!env.APP_PASSWORD) {
    return json({ error: 'APP_PASSWORD secret is not configured' }, 500);
  }
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
  const pw = String((body && body.password) || '');
  const identity = String((body && (body.identity || body.email)) || '').trim().toLowerCase();
  const attemptKey = await loginAttemptKey(request, identity);
  const limited = await checkLoginLimit(env, attemptKey);
  if (limited) return limited;

  // Timing damping complements the persisted per-IP/per-identity attempt limit.
  await new Promise(r => setTimeout(r, 350));
  if (!pw) {
    await recordLoginFailure(env, attemptKey);
    return json({ error: 'wrong password' }, 401);
  }

  const users = await getUsers(env);
  if (identity) {
    // Email and username only — deliberately NOT the display name. A name is
    // printed on packets and shown to customers, so matching on it makes every
    // account addressable by something public, and because `find` takes the
    // first hit, two people called "Mike" would lock the second one out of
    // signing in at all.
    const u = users.find(x => [x.email, x.username]
      .filter(Boolean)
      .map(v => String(v).trim().toLowerCase())
      .includes(identity));
    if (u && await verifyPassword(u, pw)) {
      if (await upgradePasswordHash(u, pw)) await putUsers(env, users);
      await clearLoginFailures(env, attemptKey);
      const data = { role: u.role, name: u.name || u.email, userId: u.id };
      if (u.role === 'customer') data.jobIds = u.jobIds || [];
      const token = await newSession(env, data);
      return json({ token, role: u.role, name: u.name || u.email });
    }
    await recordLoginFailure(env, attemptKey);
    return json({ error: 'wrong password' }, 401);
  }

  // the account owner / super administrator
  if (timingSafeEqual(pw, env.APP_PASSWORD)) {
    await clearLoginFailures(env, attemptKey);
    const token = await newSession(env, { role: 'admin', name: 'Ridgeline', owner: true });
    return json({ token, role: 'admin', name: 'Ridgeline', owner: true });
  }

  // Backward compatibility for staff created before usernames were required.
  for (const u of users) {
    if ((u.role === 'admin' || u.role === 'pm') && !u.username && await verifyPassword(u, pw)) {
      if (await upgradePasswordHash(u, pw)) await putUsers(env, users);
      await clearLoginFailures(env, attemptKey);
      const token = await newSession(env, { role: u.role, name: u.name, userId: u.id });
      return json({ token, role: u.role, name: u.name });
    }
  }
  await recordLoginFailure(env, attemptKey);
  return json({ error: 'wrong password' }, 401);
}
