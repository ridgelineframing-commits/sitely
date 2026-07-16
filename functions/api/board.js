// The Whiteboard — one shared company capture board (staff only, never customers).
// GET /api/board  -> { notes: [...] }
// PUT /api/board  -> replace the board
// Note shape: { id, text, items|null, jobId|null, by, ts }
//   items = [{id,text,done}] when the note is a checklist.
import { json, forbidden, sessionOf } from './_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function onRequestGet(context) {
  const { env } = context;
  if (sessionOf(context).role === 'customer') return forbidden();
  const raw = await env.RIDGELINE_KV.get('board');
  return new Response(raw || '{"notes":[]}', { headers: JSON_HEADERS });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (sessionOf(context).role === 'customer') return forbidden();
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
  const notes = (Array.isArray(body && body.notes) ? body.notes : [])
    .slice(0, 500)
    .filter(n => n && (typeof n.text === 'string' || Array.isArray(n.items)))
    .map(n => ({
      id: String(n.id || crypto.randomUUID()).slice(0, 40),
      text: String(n.text || '').slice(0, 4000),
      items: Array.isArray(n.items)
        ? n.items.slice(0, 100).filter(i => i && typeof i.text === 'string').map(i => ({
            id: String(i.id || crypto.randomUUID()).slice(0, 40),
            text: String(i.text).slice(0, 500),
            done: !!i.done
          }))
        : null,
      jobId: n.jobId ? String(n.jobId).slice(0, 60) : null,
      files: Array.isArray(n.files)
        ? n.files.slice(0, 20).filter(f => f && f.id).map(f => ({
            id: String(f.id).slice(0, 60),
            name: String(f.name || 'file').slice(0, 200),
            size: Number(f.size) || 0,
            type: String(f.type || '').slice(0, 100),
            jobId: f.jobId ? String(f.jobId).slice(0, 60) : null
          }))
        : null,
      by: String(n.by || '').slice(0, 60),
      ts: Number(n.ts) || Date.now()
    }));
  await env.RIDGELINE_KV.put('board', JSON.stringify({ notes }));
  return json({ ok: true, count: notes.length });
}
