// Auth middleware for all /api/* routes except /api/login and /api/feed/*.
// Sessions live in KV as 'session:<token>'. Value is JSON {role,name,userId,jobIds,tv}
// (legacy sessions stored the string '1' — treated as admin).
import { getUsers } from './_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname === '/api/login') return next();
  // Calendar feeds authenticate via the secret token in the URL (calendar apps can't send headers).
  if (url.pathname.startsWith('/api/feed/')) return next();

  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  const raw = await env.RIDGELINE_KV.get('session:' + token);
  if (!raw) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  // Legacy sessions were stored as the literal '1' (admin). Everything else is JSON.
  // Anything that doesn't parse into a session with a role is rejected — never fall open to admin.
  let session;
  if (raw === '1') {
    session = { role: 'admin' };
  } else {
    try { session = JSON.parse(raw); } catch (e) { session = null; }
  }
  if (!session || !session.role) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  // Live re-validation. PM/customer tokens carry a userId (admin / APP_PASSWORD tokens do
  // not). Re-check those against the users store on every request so that deleting a user,
  // changing their password, or changing a customer's job scope takes effect immediately
  // rather than lingering for the 90-day session lifetime.
  if (session.userId) {
    const u = (await getUsers(env)).find(x => x.id === session.userId);
    if (!u || (session.tv || 0) !== (u.tokenVersion || 0)) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
    }
    session.role = u.role;
    session.name = u.name || session.name;
    session.jobIds = u.role === 'customer' ? (u.jobIds || []) : [];
  }
  context.data.session = session;

  // Estimate templates are an admin-only area; gate them centrally.
  if (url.pathname.startsWith('/api/templates') && session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: JSON_HEADERS });
  }

  // Sliding expiry: refresh the session TTL to 90 days on every authed request.
  context.waitUntil(
    env.RIDGELINE_KV.put('session:' + token, raw === '1' ? '1' : JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 90 })
  );

  return next();
}
