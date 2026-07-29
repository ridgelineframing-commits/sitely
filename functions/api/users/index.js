// Admin-only user management.
// GET  /api/users                     -> [{id,name,email,role,jobIds}]
// POST /api/users {role,name,email?,password,jobIds?} -> created user (no hash)
// role 'admin' is owner-only: the account owner signs in with APP_PASSWORD and is the
// only session allowed to add (or remove) other administrators.
import { getUsers, putUsers, passwordHash, PASSWORD_HASH_VERSION, PASSWORD_HASH_ITERATIONS, verifyPassword, newSalt, json, forbidden, sessionOf } from '../_lib.js';

const strip = u => ({ id: u.id, name: u.name, email: u.email || null, username: u.username || null, role: u.role, jobIds: u.jobIds || null });

export async function onRequestGet(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const users = await getUsers(context.env);
  return json(users.map(strip));
}

export async function onRequestPost(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
  const role = body && body.role;
  if (role !== 'admin' && role !== 'pm' && role !== 'customer') return json({ error: 'role must be admin, pm or customer' }, 400);
  // Only the account owner (the APP_PASSWORD login) may mint other administrators.
  if (role === 'admin' && !sessionOf(context).owner) return json({ error: 'only the account owner can add administrators' }, 403);
  const name = String((body && body.name) || '').trim().slice(0, 80);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const username = String((body && body.username) || '').trim().toLowerCase().slice(0, 80);
  const password = String((body && body.password) || '');
  const jobIds = Array.isArray(body && body.jobIds) ? body.jobIds.map(String) : [];
  if (!name) return json({ error: 'name required' }, 400);
  if (password.length < 12) return json({ error: 'password must be at least 12 characters' }, 400);
  if (role === 'customer' && !email) return json({ error: 'email required for customers' }, 400);
  if (role !== 'customer' && !username) return json({ error: 'username or email required for staff' }, 400);

  const users = await getUsers(context.env);
  if (role === 'customer' && users.some(u => u.role === 'customer' && String(u.email || '').toLowerCase() === email)) {
    return json({ error: 'a customer login with that email already exists' }, 400);
  }
  if (role !== 'customer' && users.some(u => [u.username, u.email].filter(Boolean).map(v => String(v).toLowerCase()).includes(username))) {
    return json({ error: 'that staff username is already in use' }, 400);
  }
  // Staff passwords double as their identity — they must be unique across team logins.
  for (const u of users) {
    if ((u.role === 'pm' || u.role === 'admin') && await verifyPassword(u, password)) {
      return json({ error: 'that password is already in use by another team login — pick a different one' }, 400);
    }
  }

  const salt = newSalt();
  const hash = await passwordHash(salt, password, PASSWORD_HASH_ITERATIONS);
  const user = {
    id: crypto.randomUUID(), role, name,
    email: role === 'customer' ? email : (email || null),
    username: role === 'customer' ? null : username,
    salt, hash, hashVersion: PASSWORD_HASH_VERSION, hashIterations: PASSWORD_HASH_ITERATIONS,
    jobIds: role === 'customer' ? jobIds : null,
    createdAt: Date.now()
  };
  users.push(user);
  await putUsers(context.env, users);
  return json(strip(user), 201);
}
