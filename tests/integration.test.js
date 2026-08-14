import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../js/csv.js';
import { buildRecords, computeKpis, STATUS } from '../js/model.js';
import { CONFIG } from '../js/config.js';

const NOW = new Date('2026-08-13T12:00:00+07:00'); // เวลาไทยคงที่

test('ชุดข้อมูลจริง: 181 รายการ คำนวณได้ครบ ไม่มีข้อมูลไม่สมบูรณ์', () => {
  const csv = readFileSync(new URL('../data/vara_utf8.csv', import.meta.url), 'utf8');
  const rows = parseCSV(csv);
  assert.equal(rows.length, 182); // 1 header + 181 ข้อมูล

  const recs = buildRecords(rows, CONFIG, NOW);
  assert.equal(recs.length, 181);

  const k = computeKpis(recs);
  assert.equal(k.total, 181);
  assert.equal(k.active + k.expiring + k.expired + k.invalid, 181);
  assert.equal(k.invalid, 0); // ทุกแถวมีวาระคงเหลือที่แปลงได้

  // ทุกคนมีชื่อ ตำแหน่ง และวันที่สิ้นสุดวาระที่คำนวณได้
  for (const r of recs) {
    assert.ok(r.name, `แถว ${r.id} ไม่มีชื่อ`);
    assert.ok(r.position, `แถว ${r.id} ไม่มีตำแหน่ง`);
    assert.ok(r.endDate, `แถว ${r.id} ไม่มีวันที่สิ้นสุดวาระ`);
  }
});

test('ชุดข้อมูลจริง: ตรวจสอบแถวแรกตรงตามข้อมูลต้นทาง', () => {
  const csv = readFileSync(new URL('../data/vara_utf8.csv', import.meta.url), 'utf8');
  const recs = buildRecords(parseCSV(csv), CONFIG, NOW);

  const r0 = recs[0];
  assert.equal(r0.name, 'นายสหภูมิ โตอาจ');
  assert.equal(r0.position, 'ผู้ใหญ่บ้าน');
  assert.equal(r0.village, 'หมู่ 13 หนองจิกน้ำดำ');
  assert.equal(r0.waraRaw, '5 ปี 1 เดือน');
  assert.deepEqual(r0.endDate, { y: 2031, m: 9, d: 13 }); // 13/8/2569 + 5 ปี 1 เดือน
  assert.equal(r0.daysLeft, 1857);
  assert.equal(r0.status, STATUS.ACTIVE);
});
