import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../js/csv.js';

test('parseCSV: เครื่องหมายคำพูดและเครื่องหมายจุลภาคในฟิลด์', () => {
  const rows = parseCSV('a,b,c\n"x,y",z,"he said ""hi"""\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['x,y', 'z', 'he said "hi"']);
});

test('parseCSV: บรรทัดใหม่ภายในฟิลด์ที่อยู่ในเครื่องหมายคำพูด', () => {
  const rows = parseCSV('ชื่อ,โทร\n"สมชาย\nใจดี","081-111-2222"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'สมชาย\nใจดี');
  assert.equal(rows[1][1], '081-111-2222');
});

test('parseCSV: CRLF และ BOM', () => {
  const rows = parseCSV('\uFEFFa,b\r\n1,2\r\n3,4\r\n');
  assert.equal(rows[0][0], 'a');
  assert.equal(rows[1][0], '1');
  assert.equal(rows[2][0], '3');
  assert.equal(rows.length, 3);
});

test('parseCSV: ไฟล์ข้อมูลจริงมี 182 แถว (1 header + 181 ข้อมูล)', () => {
  const csv = readFileSync(new URL('../data/vara_utf8.csv', import.meta.url), 'utf8');
  const rows = parseCSV(csv);
  assert.equal(rows.length, 182);
  assert.equal(rows[0].length, 17);
});
