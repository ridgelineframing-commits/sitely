// Admin-only user management (single user).
// PUT    /api/users/:id {name?, password?, jobIds?} -> updated
// DELETE /api/users/:id                             -> { ok: true }
import { getUsers, putUsers, hashPassword, newSalt, json, forbidden, sessionOf } from '../_lib.js';

const strip = u => ({ id: u.id, name: u.name, email: u.email || null, role: u.role, jobIds: u.jobIds || null });

export async function onRequestPut(context) {
  const session = sessionOf(context);
  if (session.role !== 'admin') return forbidden();
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
  const users = await getUsers(context.env);
  const u = users.find(x => x.id === context.params.id);
  if (!u) return json({ error: 'not found' }, 404);
  // Same reasoning as delete: only the owner may re-key another administrator.
  if (u.role === 'admin' && !session.owner) return json({ error: 'only the account owner can change an administrator’s login' }, 403);
  if (body && typeof body.name === 'string' && body.name.trim()) u.name = body.name.trim().slice(0, 80);
  if (body && Array.isArray(body.jobIds)) u.jobIds = body.jobIds.map(String);
  if (body && typeof body.password === 'string' && body.password) {
    if (body.password.length < 4) return json({ error: 'password must be at least 4 characters' }, 400);
    u.salt = newSalt();
    u.hash = await hashPassword(u.salt, body.password);
  }
  await putUsers(context.env, users);
  return json(strip(u));
}

export async function onRequestDelete(context) {
  const session = sessionOf(context);
  if (session.role !== 'admin') return forbidden();
  const users = await getUsers(context.env);
  const target = users.find(x => x.id === context.params.id);
  // Removing an administrator is the owner's call alone — otherwise admins could lock
  // each other out of the account.
  if (target && target.role === 'admin' && !session.owner) {
    return json({ error: 'only the account owner can remove administrators' }, 403);
  }
  await putUsers(context.env, users.filter(x => x.id !== context.params.id));
  return json({ ok: true });
}
