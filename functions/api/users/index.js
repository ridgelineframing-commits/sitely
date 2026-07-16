// Admin-only user management.
// GET  /api/users                     -> [{id,name,email,role,jobIds}]
// POST /api/users {role,name,email?,password,jobIds?} -> created user (no hash)
import { getUsers, putUsers, hashPassword, newSalt, json, forbidden, sessionOf } from '../_lib.js';

const strip = u => ({ id: u.id, name: u.name, email: u.email || null, role: u.role, jobIds: u.jobIds || null });

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
  if (role !== 'pm' && role !== 'customer') return json({ error: 'role must be pm or customer' }, 400);
  const name = String((body && body.name) || '').trim().slice(0, 80);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  const jobIds = Array.isArray(body && body.jobIds) ? body.jobIds.map(String) : [];
  if (!name) return json({ error: 'name required' }, 400);
  if (password.length < 4) return json({ error: 'password must be at least 4 characters' }, 400);
  if (role === 'customer' && !email) return json({ error: 'email required for customers' }, 400);

  const users = await getUsers(context.env);
  if (role === 'customer' && users.some(u => u.role === 'customer' && String(u.email || '').toLowerCase() === email)) {
    return json({ error: 'a customer login with that email already exists' }, 400);
  }
  // PM passwords double as their identity — they must be unique across team logins.
  for (const u of users) {
    if (u.role === 'pm' && await hashPassword(u.salt, password) === u.hash) {
      return json({ error: 'that password is already in use by another team login — pick a different one' }, 400);
    }
  }

  const salt = newSalt();
  const user = {
    id: crypto.randomUUID(), role, name,
    email: role === 'customer' ? email : (email || null),
    salt, hash: await hashPassword(salt, password),
    jobIds: role === 'customer' ? jobIds : null,
    createdAt: Date.now()
  };
  users.push(user);
  await putUsers(context.env, users);
  return json(strip(user), 201);
}
