import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers.mjs';

const E = loadScript('public/engine.js').RidgelineEngine;
const s = (y, m, d) => E.dateToSerial(new Date(Date.UTC(y, m - 1, d)));
const iso = ser => E.serialToDate(ser).toISOString().slice(0, 10);

// Evaluate a single formula in a one-sheet workbook.
function evalWB(cells) {
  const wb = new E.Workbook({ sheets: [{ name: 'S', cells }] });
  return ref => wb.value('S', ref);
}

test('WORKDAY skips weekends (holidays absent → unchanged)', () => {
  const v = evalWB({ A1: { v: s(2024, 12, 23) }, C1: { f: 'WORKDAY(A1,3)' } });
  assert.equal(iso(v('C1')), '2024-12-26'); // Mon +3 working days = Thu
});

test('WORKDAY honors the holidays argument', () => {
  const v = evalWB({
    A1: { v: s(2024, 12, 23) },
    B1: { v: s(2024, 12, 25) }, B2: { v: s(2024, 12, 26) }, // Wed + Thu holidays
    C1: { f: 'WORKDAY(A1,3,B1:B2)' },
  });
  assert.equal(iso(v('C1')), '2024-12-30'); // skips the two holidays + the weekend
});

test('NETWORKDAYS counts business days, honoring holidays', () => {
  const base = { A1: { v: s(2024, 12, 23) }, B1: { v: s(2024, 12, 25) }, B2: { v: s(2024, 12, 26) } };
  assert.equal(evalWB({ ...base, D1: { f: 'NETWORKDAYS(A1,A1+7)' } })('D1'), 6);
  assert.equal(evalWB({ ...base, D1: { f: 'NETWORKDAYS(A1,A1+7,B1:B2)' } })('D1'), 4);
});

test('arithmetic precedence and unary minus match Excel', () => {
  const v = evalWB({ A1: { f: '-2^2' }, A2: { f: '2^3^2' }, A3: { f: '1+2*3' } });
  assert.equal(v('A1'), 4);    // -(2^2)=... Excel: (-2)^2 = 4
  assert.equal(v('A2'), 64);   // left-assoc: (2^3)^2
  assert.equal(v('A3'), 7);
});

test('IF / IFERROR propagate and catch errors', () => {
  const v = evalWB({ A1: { f: 'IFERROR(1/0,42)' }, A2: { f: 'IF(1>0,"y","n")' } });
  assert.equal(v('A1'), 42);
  assert.equal(v('A2'), 'y');
});
