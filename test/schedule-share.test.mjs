import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers.mjs';

const SS = loadScript('public/schedule-share.js').ScheduleShare;

const job = () => ({
  name: 'Davi Residence',
  schedule: [
    { id: '1', task: 'Dig footings', group: 'Foundation', start: '2026-08-03', finish: '2026-08-05', status: 'Complete' },
    { id: '2', task: 'Pour footings', group: 'Foundation', start: '2026-08-06', finish: '2026-08-06', status: 'In Progress' },
    { id: '3', task: 'Frame walls', group: 'Framing', start: '2026-08-10', finish: '2026-08-18', status: 'Not Started' },
  ],
});

test('buildModel: full list is phases + tasks with progress and date ranges', () => {
  const m = SS.buildModel(job(), {});
  assert.equal(m.lines.length, 5); // 2 phase headers + 3 tasks
  assert.equal(m.lines[0].type, 'phase');
  assert.equal(m.lines[0].done, 1);
  assert.equal(m.lines[0].total, 2);
  assert.equal(m.lines[0].start, '2026-08-03');
});

test('hideCompleted drops completed tasks; collapseToPhases keeps only phase lines', () => {
  const hidden = SS.buildModel(job(), { hideCompleted: true });
  assert.ok(!hidden.lines.some(l => l.type === 'task' && l.name === 'Dig footings'));
  const collapsed = SS.buildModel(job(), { collapseToPhases: true });
  assert.equal(collapsed.lines.length, 2);
  assert.ok(collapsed.lines.every(l => l.type === 'phase'));
});

test('buildImagePdf produces a structurally valid single-page PDF with the JPEG embedded', () => {
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 0xFF, 0xD9]);
  const pdf = SS.buildImagePdf(jpeg, 2000, 3400);
  const txt = Buffer.from(pdf).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.3'));
  assert.ok(txt.trimEnd().endsWith('%%EOF'));
  assert.match(txt, /\/MediaBox\[0 0 612 792\]/);                 // portrait for a tall image
  assert.match(txt, new RegExp('/Filter/DCTDecode/Length ' + jpeg.length));
  // every xref offset must land exactly on its "N 0 obj"
  const xrefOff = parseInt(txt.slice(txt.lastIndexOf('startxref') + 9).trim(), 10);
  assert.equal(txt.slice(xrefOff, xrefOff + 4), 'xref');
  const rows = txt.slice(xrefOff).split('\n');
  for (let i = 1; i <= 5; i++) {
    const off = parseInt(rows[2 + i].slice(0, 10), 10);
    assert.equal(txt.slice(off, off + (i + ' 0 obj').length), i + ' 0 obj');
  }
});

test('landscape page is chosen for a wide image', () => {
  const txt = Buffer.from(SS.buildImagePdf(new Uint8Array([1, 2, 3]), 3400, 2000)).toString('latin1');
  assert.match(txt, /\/MediaBox\[0 0 792 612\]/);
});
