// GET /api/mcp-token -> { token, connectorUrl }  (creates one on first call; admin only)
// The token is the secret in the MCP connector URL: /mcp/<token>
import { forbidden, sessionOf } from './_lib.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function onRequestGet(context) {
  if (sessionOf(context).role !== 'admin') return forbidden();
  const env = context.env;
  let token = await env.RIDGELINE_KV.get('mcptoken');
  if (!token) {
    token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    await env.RIDGELINE_KV.put('mcptoken', token);
  }
  const origin = new URL(context.request.url).origin;
  return new Response(JSON.stringify({ token, connectorUrl: origin + '/mcp/' + token }), { headers: JSON_HEADERS });
}
