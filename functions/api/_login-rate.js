import { json } from './_lib.js';

const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES = 6;

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const raw = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(raw)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export async function loginAttemptKey(request, identity) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  return 'login-attempt:' + await digest(ip + '|' + String(identity || '').trim().toLowerCase());
}

export async function checkLoginLimit(env, key) {
  let state = null;
  try { state = JSON.parse(await env.RIDGELINE_KV.get(key) || 'null'); } catch (e) {}
  const now = Date.now();
  if (!state || now - Number(state.startedAt || 0) > WINDOW_SECONDS * 1000) return null;
  if (Number(state.failures || 0) < MAX_FAILURES) return null;
  const retry = Math.max(1, Math.ceil((WINDOW_SECONDS * 1000 - (now - state.startedAt)) / 1000));
  const response = json({ error: 'too many sign-in attempts', retryAfter: retry }, 429);
  response.headers.set('Retry-After', String(retry));
  return response;
}

export async function recordLoginFailure(env, key) {
  const now = Date.now();
  let state = null;
  try { state = JSON.parse(await env.RIDGELINE_KV.get(key) || 'null'); } catch (e) {}
  if (!state || now - Number(state.startedAt || 0) > WINDOW_SECONDS * 1000) {
    state = { failures: 0, startedAt: now };
  }
  state.failures = Number(state.failures || 0) + 1;
  await env.RIDGELINE_KV.put(key, JSON.stringify(state), { expirationTtl: WINDOW_SECONDS });
}

export async function clearLoginFailures(env, key) {
  try { await env.RIDGELINE_KV.delete(key); } catch (e) {}
}

export const LOGIN_LIMITS = { windowSeconds: WINDOW_SECONDS, maxFailures: MAX_FAILURES };
