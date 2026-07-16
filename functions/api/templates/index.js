// GET  /api/templates                    -> [{id, name, itemCount, updatedAt}]
// POST /api/templates {name, itemIds}    -> meta
// Admin-only (the middleware also gates /api/templates; this is defense in depth).
import { sessionOf, forbidden } from '../_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function getIndex(env) {
  const raw = await env.RIDGELINE_KV.get('templates:index');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

export async function onRequestGet(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const { env } = context;
  return new Response(JSON.stringify(await getIndex(env)), { headers: JSON_HEADERS });
}

export async function onRequestPost(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) {
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: JSON_HEADERS });
  }
  const name = String((body && body.name) || '').trim().slice(0, 120) || 'Untitled Template';
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
  const id = crypto.randomUUID();
  const now = Date.now();
  const tpl = { id, name, itemIds, updatedAt: now };
  const meta = { id, name, itemCount: itemIds.length, updatedAt: now };

  const index = await getIndex(env);
  index.push(meta);
  await env.RIDGELINE_KV.put('template:' + id, JSON.stringify(tpl));
  await env.RIDGELINE_KV.put('templates:index', JSON.stringify(index));
  return new Response(JSON.stringify(meta), { status: 201, headers: JSON_HEADERS });
}
