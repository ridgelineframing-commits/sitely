// GET /api/feed-token -> { token }  (creates one on first call; admin only)
import { forbidden, sessionOf } from './_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function onRequestGet(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const env = context.env;
  let token = await env.RIDGELINE_KV.get('feedtoken');
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    await env.RIDGELINE_KV.put('feedtoken', token);
  }
  return new Response(JSON.stringify({ token }), { headers: JSON_HEADERS });
}
