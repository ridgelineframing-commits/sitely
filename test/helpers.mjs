// Shared test helpers. The frontend files (engine.js, export.js, keystone.js) are browser
// IIFEs that attach to `window`; we evaluate them in a VM with a minimal browser-like global
// so they can be exercised under `node --test` with no bundler and no DOM.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '..');

// Load a browser <script> file into a fresh fake window and return that window.
export function loadScript(relPath, extra = {}) {
  const win = {
    console, Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp,
    parseFloat, parseInt, isNaN, isFinite, Set, Map, Symbol, Promise,
    TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer,
    Blob, Response, setTimeout, clearTimeout,
    ...extra,
  };
  win.window = win;
  win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(readFileSync(resolve(repo, relPath), 'utf8'), win);
  return win;
}

// A stub React whose createElement builds a plain tree we can search.
export const stubReact = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity).filter(x => x != null) }),
};

// Collect all text found in a stub-React tree.
export function treeText(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach(n => treeText(n, out)); return out; }
  if (node.kids) node.kids.forEach(n => treeText(n, out));
  return out;
}

// Minimal reader for the ZIP writeZip() produces: stored (0) or raw-deflate (8), sizes in the
// local header, no data descriptors. Returns { '<name>': Buffer }.
export function unzip(bytes) {
  const buf = Buffer.from(bytes);
  const out = {};
  let p = 0;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const compSize = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 30, p + 30 + nameLen);
    const dataStart = p + 30 + nameLen + extraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    out[name] = method === 0 ? Buffer.from(comp) : zlib.inflateRawSync(comp);
    p = dataStart + compSize;
  }
  return out;
}
