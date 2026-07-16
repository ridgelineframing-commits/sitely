// Test helpers. The frontend files (keystone.js, sync.js, …) are browser IIFEs that attach
// to `window`; we evaluate them in a VM with a minimal browser-like global so they can be
// exercised under `node --test` with no bundler and no DOM.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '..');

export const stubReact = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity).filter(x => x != null) }),
};

// Load a browser <script> file into a fresh fake window and return that window.
export function loadScript(relPath, extra = {}) {
  const win = {
    console, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp,
    parseFloat, parseInt, isNaN, isFinite, Set, Map, Symbol, Promise,
    TextEncoder, TextDecoder, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, get length() { return 0; }, key() { return null; } },
    addEventListener() {}, navigator: { onLine: true }, fetch: () => {},
    ...extra,
  };
  win.window = win;
  win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(readFileSync(resolve(repo, relPath), 'utf8'), win);
  return win;
}

// Collect all text in a stub-React tree.
export function treeText(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach(n => treeText(n, out)); return out; }
  if (node.kids) node.kids.forEach(n => treeText(n, out));
  return out;
}

// A tiny in-memory KV mock (get/put/delete + prefix list) for the Pages Functions.
export function makeKV(seed = {}) {
  const store = { ...seed };
  return {
    _store: store,
    get: async k => (k in store ? store[k] : null),
    put: async (k, v) => { store[k] = v; },
    delete: async k => { delete store[k]; },
    list: async ({ prefix = '', cursor } = {}) => {
      const all = Object.keys(store).filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? +cursor : 0, page = all.slice(start, start + 100), end = start + page.length;
      return { keys: page.map(name => ({ name })), objects: page.map(name => ({ key: name })), list_complete: end >= all.length, truncated: end < all.length, cursor: String(end) };
    },
  };
}
