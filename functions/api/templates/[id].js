// GET    /api/templates/:id                    -> {id, name, itemIds, updatedAt}
// PUT    /api/templates/:id {name?, itemIds?}  -> meta
// DELETE /api/templates/:id                    -> {ok}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function getIndex(env) {
  const raw = await env.RIDGELINE_KV.get('templates:index');
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

export async function onRequestGet({ env, params }) {
  const raw = await env.RIDGELINE_KV.get('template:' + params.id);
  if (!raw) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS });
  return new Response(raw, { headers: JSON_HEADERS });
}

export async function onRequestPut({ request, env, params }) {
  const raw = await env.RIDGELINE_KV.get('template:' + params.id);
  if (!raw) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS });
  let body;
  try { body = await request.json(); } catch (e) {
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: JSON_HEADERS });
  }
  const tpl = JSON.parse(raw);
  if (body && typeof body.name === 'string' && body.name.trim()) tpl.name = body.name.trim().slice(0, 120);
  if (body && Array.isArray(body.itemIds)) tpl.itemIds = body.itemIds;
  tpl.updatedAt = Date.now();

  const meta = { id: tpl.id, name: tpl.name, itemCount: tpl.itemIds.length, updatedAt: tpl.updatedAt };
  const index = await getIndex(env);
  const i = index.findIndex(t => t.id === tpl.id);
  if (i >= 0) index[i] = meta; else index.push(meta);

  await env.RIDGELINE_KV.put('template:' + tpl.id, JSON.stringify(tpl));
  await env.RIDGELINE_KV.put('templates:index', JSON.stringify(index));
  return new Response(JSON.stringify(meta), { headers: JSON_HEADERS });
}

export async function onRequestDelete({ env, params }) {
  const index = await getIndex(env);
  await env.RIDGELINE_KV.delete('template:' + params.id);
  await env.RIDGELINE_KV.put('templates:index', JSON.stringify(index.filter(t => t.id !== params.id)));
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}
