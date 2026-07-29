import { json, forbidden, sessionOf } from '../_lib.js';

function pathOf(context) {
  const p = context.params.path;
  return (Array.isArray(p) ? p : (p ? [p] : [])).map(encodeURIComponent).join('/');
}

export async function onRequest(context) {
  const session = sessionOf(context);
  if (session.role !== 'admin' && session.role !== 'pm') return forbidden();
  if (!context.env.AGENT_SERVICE) return json({ error: 'Sitely Agents service is not deployed yet' }, 503);
  const incoming = context.request;
  const target = new URL('https://sitely-agent.internal/v1/' + pathOf(context));
  target.search = new URL(incoming.url).search;
  const headers = new Headers(incoming.headers);
  headers.delete('Host');
  const init = { method: incoming.method, headers };
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') init.body = incoming.body;
  return context.env.AGENT_SERVICE.fetch(new Request(target, init));
}
