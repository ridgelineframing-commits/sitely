import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, stubReact } from './helpers.mjs';

const K = loadScript('public/keystone.js', { React: stubReact }).Keystone;

test('parseCsv handles quoted fields with commas, escaped quotes and CRLF', () => {
  const rows = K.parseCsv('a,"b, c",d\r\n"x ""q""",y,z\r\n');
  // JSON round-trip: parseCsv's arrays come from the VM realm, so deepEqual sees foreign prototypes
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [['a', 'b, c', 'd'], ['x "q"', 'y', 'z']]);
});

test('applyVendorCsv updates prices by sku_id and reports blanks/unknowns', () => {
  const book = [{ id: 's1', price: 1 }, { id: 's2', price: 2 }, { id: 's3', price: 3 }];
  const rows = [
    ['sku_id', 'group', 'description', 'unit', 'qty', 'your_price'],
    ['s1', 'Framing lumber', '2x4 stud', 'EA', '1', '$4.50'],
    ['s2', 'Framing lumber', '2x6 stud', 'EA', '1', ''],          // vendor left it blank
    ['nope', 'Framing lumber', 'mystery', 'EA', '1', '9'],        // sku_id edited/unknown
    ['s3', 'Sheet goods', 'OSB', 'EA', '1', '1,250.00'],          // thousands separator
  ];
  const res = K.applyVendorCsv(book, rows);
  assert.equal(res.updated, 2);
  assert.equal(res.blank, 1);
  assert.equal(res.skipped, 1);
  assert.equal(book[0].price, 4.5);
  assert.equal(book[1].price, 2);       // blank price untouched
  assert.equal(book[2].price, 1250);
});

test('applyVendorCsv rejects negative and non-numeric prices instead of writing garbage', () => {
  const book = [{ id: 's1', price: 5 }];
  const res = K.applyVendorCsv(book, [['s1', '', '', '', '1', '-2'], ['s1', '', '', '', '1', 'call us']]);
  assert.equal(res.updated, 0);
  assert.equal(res.skipped, 2);
  assert.equal(book[0].price, 5);
});

test('wxCityOf pulls the city out of a street address', () => {
  assert.equal(K.wxCityOf('123 Main St, Battle Ground, WA 98604'), 'Battle Ground');
  assert.equal(K.wxCityOf('Ridgefield'), 'Ridgefield');
  assert.equal(K.wxCityOf(''), null);
});
