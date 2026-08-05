// GET /api/catalog  -> catalog doc (admin) / schedule-template-only stub (pm) / 403 (customer)
// PUT /api/catalog  -> replace catalog doc (admin only)
import { json, forbidden, sessionOf } from './_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function onRequestGet(context) {
  const session = sessionOf(context);
  if (session.role === 'customer') return forbidden();
  const raw = await context.env.RIDGELINE_KV.get('catalog');
  if (!raw) return json({ error: 'not found' }, 404);
  if (session.role === 'admin') return new Response(raw, { headers: JSON_HEADERS });
  // PM: no pricing — just enough for the scheduler
  const cat = JSON.parse(raw);
  return json({
    version: cat.version, updatedAt: cat.updatedAt,
    settings: { defaultMarkupPct: 0, salesTaxPct: 0 },
    categories: [], items: [], priceList: [], exclusions: [],
    scheduleTemplate: cat.scheduleTemplate || null,
    contractors: (cat.contractors || []).filter(c => c && c.active !== false).map(c => ({
      id: String(c.id || '').slice(0, 40), company: String(c.company || '').slice(0, 160),
      contact: String(c.contact || '').slice(0, 120), email: String(c.email || '').slice(0, 200),
      phone: String(c.phone || '').slice(0, 60), trade: String(c.trade || '').slice(0, 120)
    }))
  });
}

export async function onRequestPut(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad request' }, 400); }
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
    return json({ error: 'invalid catalog' }, 400);
  }
  body.updatedAt = Date.now();
  await context.env.RIDGELINE_KV.put('catalog', JSON.stringify(body));
  return json({ ok: true, updatedAt: body.updatedAt });
}
