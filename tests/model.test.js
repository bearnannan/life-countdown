import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecords,
  computeKpis,
  classify,
  filterRecords,
  sortRecords,
  STATUS,
} from '../js/model.js';
import { daysBetween } from '../js/dates.js';
import { CONFIG } from '../js/config.js';

const HEADER = [
  'ลำดับ TOR', 'บ้าน\nเลขที่', 'หมู่บ้าน', 'ตำบล', 'อำเภอ', 'จังหวัด',
  'Latitude', 'Longitude', 'sea level (m)', 'ความสูงเสา (ม.)',
  'สถานที่ติดตั้งเสา', 'สถานที่วางเครื่อง', 'เจ้าหน้าที่ประจำพื้นที่ (ชื่อ)',
  'ตำแหน่ง', 'เบอร์โทรติดต่อ', 'วาระคงเหลือ', 'หมายเหตุ',
];

// แถวตัวอย่างสั้น: [ลำดับ, บ้านเลขที่, หมู่บ้าน, ตำบล, อำเภอ, จังหวัด, ... , ชื่อ, ตำแหน่ง, โทร, วาระ, หมายเหตุ]
const row = (tor, name, position, wara, opts = {}) => [
  tor, '1', opts.village || 'หมู่ 1', opts.tambon || 'ตำบลกลาง', opts.amphoe || 'อำเภอกลาง',
  opts.province || 'จังหวัดกลาง', '', '', '', '', '', '',
  name, position, opts.phone || '', wara, opts.notes || '',
];

const NOW = new Date('2026-08-13T09:00:00+07:00'); // เวลาไทยคงที่สำหรับเทสต์

const cfg = (overrides = {}) => ({ ...CONFIG, ...overrides });

// ---------- สถานะ ----------

test('classify: สถานะและลำดับความสำคัญ', () => {
  assert.equal(classify(100, 30), STATUS.ACTIVE);
  assert.equal(classify(30, 30), STATUS.EXPIRING);
  assert.equal(classify(1, 30), STATUS.EXPIRING);
  assert.equal(classify(0, 30), STATUS.EXPIRING); // สิ้นสุดวาระวันนี้ → ยังไม่ถือว่าหมดวาระ
  assert.equal(classify(-1, 30), STATUS.EXPIRED);
  assert.equal(classify(null, 30), STATUS.INVALID);
  assert.equal(classify(0, 0), STATUS.EXPIRING);  // เกณฑ์ 0
});

// ---------- วาระปกติ ----------

test('buildRecords: วาระปกติ → Active พร้อมวันที่สิ้นสุดที่ถูกต้อง', () => {
  const recs = buildRecords([HEADER, row('1', 'นายสหภูมิ โตอาจ', 'ผู้ใหญ่บ้าน', '5 ปี 1 เดือน')], cfg(), NOW);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.deepEqual(r.endDate, { y: 2031, m: 9, d: 13 }); // อ้างอิง 13/8/2569 + 5 ปี 1 เดือน
  assert.equal(r.daysLeft, 1857);
  assert.equal(r.status, STATUS.ACTIVE);
  assert.deepEqual(r.flags, []);
});

// ---------- ใกล้หมดวาระ ----------

test('buildRecords: สิ้นสุดวาระวันนี้ → 0 วัน → ใกล้หมดวาระ (ยังไม่หมด)', () => {
  const recs = buildRecords(
    [HEADER, row('2', 'นายใกล้หมด', 'ผู้ใหญ่บ้าน', '0 ปี 1 เดือน')],
    cfg({ dataReferenceDate: '2026-07-13' }), // อ้างอิง 1 เดือนก่อน → สิ้นสุดวันนี้
    NOW,
  );
  const r = recs[0];
  assert.equal(r.daysLeft, 0);
  assert.equal(r.status, STATUS.EXPIRING);
  assert.deepEqual(r.endDate, { y: 2026, m: 8, d: 13 });
});

test('buildRecords: เหลือไม่กี่วัน → ใกล้หมดวาระ', () => {
  const recs = buildRecords(
    [HEADER, row('3', 'นายใกล้หมด', 'กำนัน', '0 ปี 1 เดือน')],
    cfg({ dataReferenceDate: '2026-07-28' }), // สิ้นสุด 28/8/2569 → เหลือ 15 วัน
    NOW,
  );
  assert.equal(recs[0].daysLeft, 15);
  assert.equal(recs[0].status, STATUS.EXPIRING);
});

// ---------- หมดวาระแล้ว ----------

test('buildRecords: เกินวันสิ้นสุด → หมดวาระแล้ว', () => {
  const recs = buildRecords(
    [HEADER, row('4', 'นายหมดวาระ', 'ผู้ใหญ่บ้าน', '0 ปี 1 เดือน')],
    cfg({ dataReferenceDate: '2025-01-01' }), // สิ้นสุด 1/2/2568 → เกินมานานแล้ว
    NOW,
  );
  const r = recs[0];
  assert.equal(r.daysLeft, daysBetween({ y: 2026, m: 8, d: 13 }, { y: 2025, m: 2, d: 1 }));
  assert.ok(r.daysLeft < 0);
  assert.equal(r.status, STATUS.EXPIRED);
});

// ---------- ข้อมูลขาด/ไม่ถูกต้อง ----------

test('buildRecords: วาระว่าง → ข้อมูลไม่สมบูรณ์ + flag', () => {
  const recs = buildRecords([HEADER, row('5', 'นายว่าง', 'ผู้ใหญ่บ้าน', '')], cfg(), NOW);
  assert.equal(recs[0].status, STATUS.INVALID);
  assert.equal(recs[0].daysLeft, null);
  assert.equal(recs[0].endDate, null);
  assert.ok(recs[0].flags.some((f) => f.includes('ไม่มีข้อมูลวาระคงเหลือ')));
});

test('buildRecords: วาระรูปแบบไม่ถูกต้อง → ข้อมูลไม่สมบูรณ์ + flag', () => {
  const recs = buildRecords([HEADER, row('6', 'นายผิด', 'ผู้ใหญ่บ้าน', 'xyz ปี')], cfg(), NOW);
  assert.equal(recs[0].status, STATUS.INVALID);
  assert.ok(recs[0].flags.some((f) => f.includes('รูปแบบวาระคงเหลือไม่ถูกต้อง')));
});

test('buildRecords: วันที่อ้างอิงไม่ถูกต้อง → ข้อมูลไม่สมบูรณ์ทุกแถว', () => {
  const recs = buildRecords(
    [HEADER, row('7', 'นายเอ', 'ผู้ใหญ่บ้าน', '5 ปี')],
    cfg({ dataReferenceDate: 'bad-date' }),
    NOW,
  );
  assert.equal(recs[0].status, STATUS.INVALID);
  assert.equal(recs[0].daysLeft, null);
});

// ---------- KPI ----------

test('computeKpis: รวมเท่ากับจำนวนทั้งหมด', () => {
  const recs = buildRecords(
    [
      HEADER,
      row('1', 'นายเอ', 'ผู้ใหญ่บ้าน', '5 ปี'),
      row('2', 'นายบี', 'กำนัน', '0 ปี 1 เดือน', { village: 'หมู่ 2' }),
      row('3', 'นายซี', 'ผู้ใหญ่บ้าน', ''),
    ],
    cfg({ dataReferenceDate: '2026-07-13' }),
    NOW,
  );
  const k = computeKpis(recs);
  assert.equal(k.total, 3);
  assert.equal(k.active, 1);    // 5 ปี → Active
  assert.equal(k.expiring, 1);  // สิ้นสุดวันนี้ → ใกล้หมดวาระ
  assert.equal(k.expired, 0);
  assert.equal(k.invalid, 1);   // ไม่มีวาระ
  assert.equal(k.active + k.expiring + k.expired + k.invalid, k.total);
});

// ---------- ค้นหา / กรอง ----------

test('filterRecords: ค้นหาชื่อ/พื้นที่ และกรองสถานะ', () => {
  const recs = buildRecords(
    [
      HEADER,
      row('1', 'นายสมชาย ใจดี', 'ผู้ใหญ่บ้าน', '5 ปี', { village: 'หมู่ 1 สุขใจ', tambon: 'ตำบลกมลาไสย', province: 'จังหวัดกาญจนบุรี' }),
      row('2', 'นางสมหญิง', 'กำนัน', '0 ปี 1 เดือน', { village: 'หมู่ 2', province: 'จังหวัดสุโขทัย' }),
    ],
    cfg({ dataReferenceDate: '2026-07-13' }),
    NOW,
  );
  assert.equal(filterRecords(recs, 'สมชาย', 'all').length, 1);
  assert.equal(filterRecords(recs, 'สุโขทัย', 'all').length, 1);
  assert.equal(filterRecords(recs, 'กมลาไสย', 'all').length, 1);
  assert.equal(filterRecords(recs, 'xyz', 'all').length, 0);
  assert.equal(filterRecords(recs, '', STATUS.EXPIRING).length, 1);
  assert.equal(filterRecords(recs, '', STATUS.ACTIVE).length, 1);
});

// ---------- เรียงลำดับ ----------

test('sortRecords: เรียงตามวันคงเหลือ น้อย→มาก (null ท้ายสุด)', () => {
  const recs = buildRecords(
    [
      HEADER,
      row('1', 'นายเอ', 'ผู้ใหญ่บ้าน', '5 ปี'),
      row('2', 'นายบี', 'ผู้ใหญ่บ้าน', '0 ปี 1 เดือน'),
      row('3', 'นายซี', 'ผู้ใหญ่บ้าน', ''),
    ],
    cfg({ dataReferenceDate: '2026-07-13' }),
    NOW,
  );
  const sorted = sortRecords(recs, 'daysAsc');
  assert.equal(sorted[0].name, 'นายบี'); // 0 วัน
  assert.equal(sorted[1].name, 'นายเอ'); // ยังอีกหลายปี
  assert.equal(sorted[2].name, 'นายซี'); // ข้อมูลไม่สมบูรณ์ → ท้ายสุด
});

// ---------- ขึ้นกับ now ----------

test('daysLeft เปลี่ยนตาม now (ไม่อยู่นิ่ง)', () => {
  const rows = [HEADER, row('1', 'นายเอ', 'ผู้ใหญ่บ้าน', '0 ปี 2 เดือน')];
  const r1 = buildRecords(rows, cfg({ dataReferenceDate: '2026-07-13' }), new Date('2026-08-13T00:00:00+07:00'))[0];
  const r2 = buildRecords(rows, cfg({ dataReferenceDate: '2026-07-13' }), new Date('2026-08-20T00:00:00+07:00'))[0];
  assert.equal(r1.daysLeft, 31);
  assert.equal(r2.daysLeft, 24);
  assert.equal(r1.daysLeft - r2.daysLeft, 7); // 7 วันผ่านไป → ลดลง 7 วัน
});
