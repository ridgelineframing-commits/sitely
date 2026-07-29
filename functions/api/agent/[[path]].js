import { json, forbidden, sessionOf } from '../_lib.js';

// encodeURIComponent does NOT encode dots, so a '..' segment survives it intact
// and `new URL()` then resolves it — `/api/agent/%2E%2E/%2E%2E/admin` came out
// as https://sitely-agent.internal/admin, i.e. outside the /v1/ prefix this
// proxy is supposed to be confined to. Reject traversal segments outright
// rather than trying to encode our way around it.
function pathOf(context) {
  const p = context.params.path;
  const parts = (Array.isArray(p) ? p : (p ? [p] : [])).map(String);
  if (parts.some(s => s === '.' || s === '..' || s === '')) return null;
  return parts.map(encodeURIComponent).join('/');
}

export async function onRequest(context) {
  const session = sessionOf(context);
  if (session.role !== 'admin' && session.role !== 'pm') return forbidden();
  if (!context.env.AGENT_SERVICE) return json({ error: 'Sitely Agents service is not deployed yet' }, 503);
  const path = pathOf(context);
  if (path === null) return json({ error: 'bad request' }, 400);
  const incoming = context.request;
  const target = new URL('https://sitely-agent.internal/v1/' + path);
  target.search = new URL(incoming.url).search;
  const headers = new Headers(incoming.headers);
  headers.delete('Host');
  const init = { method: incoming.method, headers };
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') init.body = incoming.body;
  return context.env.AGENT_SERVICE.fetch(new Request(target, init));
}
