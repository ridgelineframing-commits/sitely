// GET    /api/mcp-token -> { token, connectorUrl }  (mints one on first call; admin only)
// POST   /api/mcp-token -> { token, connectorUrl }  (ROTATES: generates a new token, old URL dies)
// DELETE /api/mcp-token -> { ok: true }              (REVOKES: disables the connector entirely)
// The token is the secret in the MCP connector URL: /mcp/<token>
import { forbidden, sessionOf } from './_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const mint = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
const tokenResponse = (request, token) => {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify({ token, connectorUrl: origin + '/mcp/' + token }), { headers: JSON_HEADERS });
};

export async function onRequestGet(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const env = context.env;
  let token = await env.RIDGELINE_KV.get('mcptoken');
  if (!token) { token = mint(); await env.RIDGELINE_KV.put('mcptoken', token); }
  return tokenResponse(context.request, token);
}

// Rotate: overwrite with a fresh token so any leaked connector URL immediately stops working.
export async function onRequestPost(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const token = mint();
  await context.env.RIDGELINE_KV.put('mcptoken', token);
  return tokenResponse(context.request, token);
}

// Revoke: delete the token so the /mcp/<token> endpoint rejects everything until re-minted.
export async function onRequestDelete(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  await context.env.RIDGELINE_KV.delete('mcptoken');
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}
