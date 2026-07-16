import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadScript, unzip, repo } from './helpers.mjs';
import { resolve } from 'node:path';

const tpl = readFileSync(resolve(repo, 'public/uploads/template.xlsx'));

// Load export.js with the browser bits it needs + a capture hook for the produced blob.
function makeExporter() {
  let blob = null;
  const win = loadScript('public/export.js', {
    DecompressionStream, CompressionStream,
    fetch: async () => new Response(tpl),
    document: { createElement: () => ({ click() {}, remove() {}, style: {}, set href(v) {}, set download(v) {} }), body: { appendChild() {} } },
    URL: { createObjectURL: b => { blob = b; return 'blob:x'; }, revokeObjectURL() {} },
  });
  return async edits => { await win.RidgelineExportXlsx(edits); return unzip(new Uint8Array(await blob.arrayBuffer())); };
}

test('edits are routed to the correct worksheet by name, not file order', async () => {
  const files = await makeExporter()({
    'Estimate!ZZ100': 987654321,
    'Schedule!ZZ100': 123456789,
    'Read Me!ZZ100': 555555555,
  });
  // Per this template: Estimate=sheet4, Schedule=sheet6, Read Me=sheet1.
  assert.match(files['xl/worksheets/sheet4.xml'].toString(), /987654321/);
  assert.match(files['xl/worksheets/sheet6.xml'].toString(), /123456789/);
  assert.match(files['xl/worksheets/sheet1.xml'].toString(), /555555555/);
  // No cross-contamination
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'].toString(), /987654321/);
  assert.doesNotMatch(files['xl/worksheets/sheet5.xml'].toString(), /987654321/);
});

test('editing a cell yields exactly one <row> for that row (no self-closing duplicate)', async () => {
  const files = await makeExporter()({ 'Estimate!ZZ100': 42 });
  const xml = files['xl/worksheets/sheet4.xml'].toString();
  const row100 = (xml.match(/<row r="100"[ />]/g) || []).length;
  assert.equal(row100, 1, 'row 100 must appear exactly once');
  assert.match(xml, /<c r="ZZ100"[^>]*><v>42<\/v><\/c>/);
});
