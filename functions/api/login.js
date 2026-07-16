// POST /api/login  { password, email? }  ->  { token, role, name }
// - Admin: APP_PASSWORD secret (no email)
// - Project manager: their own password (no email; passwords are unique per PM)
// - Customer: email + password
import { getUsers, hashPassword, json } from './_lib.js';

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
  const email = String((body && body.email) || '').trim().toLowerCase();

  // Basic brute-force damper: small constant delay on every attempt.
  await new Promise(r => setTimeout(r, 350));
  if (!pw) return json({ error: 'wrong password' }, 401);

  if (email) {
    // customer sign-in
    const users = await getUsers(env);
    const u = users.find(x => x.role === 'customer' && String(x.email || '').toLowerCase() === email);
    if (u && timingSafeEqual(await hashPassword(u.salt, pw), u.hash)) {
      const token = await newSession(env, { role: 'customer', name: u.name || u.email, userId: u.id, jobIds: u.jobIds || [], tv: u.tokenVersion || 0 });
      return json({ token, role: 'customer', name: u.name || u.email });
    }
    return json({ error: 'wrong password' }, 401);
  }

  if (timingSafeEqual(pw, env.APP_PASSWORD)) {
    const token = await newSession(env, { role: 'admin', name: 'Ridgeline' });
    return json({ token, role: 'admin', name: 'Ridgeline' });
  }

  // project managers sign in with just their password
  const users = await getUsers(env);
  for (const u of users) {
    if (u.role === 'pm' && timingSafeEqual(await hashPassword(u.salt, pw), u.hash)) {
      const token = await newSession(env, { role: 'pm', name: u.name, userId: u.id, tv: u.tokenVersion || 0 });
      return json({ token, role: 'pm', name: u.name });
    }
  }
  return json({ error: 'wrong password' }, 401);
}
