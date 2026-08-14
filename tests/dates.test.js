import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDurationWara,
  parseDate,
  getBangkokNow,
  todayInBangkok,
  addDuration,
  daysBetween,
  monthsDaysBetween,
  formatDaysLeft,
  formatThaiDate,
  toISOString,
} from '../js/dates.js';

// ---------- วาระคงเหลือ (duration) ----------

test('parseDurationWara: "5 ปี 1 เดือน" (ปกติ)', () => {
  assert.deepEqual(parseDurationWara('5 ปี 1 เดือน'), { years: 5, months: 1, days: 0 });
});

test('parseDurationWara: หลายรูปแบบ', () => {
  assert.deepEqual(parseDurationWara('26 ปี 10 เดือน'), { years: 26, months: 10, days: 0 });
  assert.deepEqual(parseDurationWara('0 ปี 2 เดือน'), { years: 0, months: 2, days: 0 });
  assert.deepEqual(parseDurationWara('10 ปี'), { years: 10, months: 0, days: 0 });
  assert.deepEqual(parseDurationWara('3 เดือน'), { years: 0, months: 3, days: 0 });
  assert.deepEqual(parseDurationWara('5 วัน'), { years: 0, months: 0, days: 5 });
  assert.deepEqual(parseDurationWara('๑ ปี ๒ เดือน'), { years: 1, months: 2, days: 0 }); // เลขไทย
});

test('parseDurationWara: ค่าว่าง/ไม่ถูกต้อง → null', () => {
  assert.equal(parseDurationWara(''), null);
  assert.equal(parseDurationWara('   '), null);
  assert.equal(parseDurationWara('abc'), null);
  assert.equal(parseDurationWara('5 ปี x'), null);
  assert.equal(parseDurationWara('-'), null);
  assert.equal(parseDurationWara(null), null);
  assert.equal(parseDurationWara(undefined), null);
});

test('parseDurationWara: "หมดวาระ" → ระยะเวลา 0', () => {
  assert.deepEqual(parseDurationWara('หมดวาระ'), { years: 0, months: 0, days: 0 });
});

// ---------- รูปแบบวันที่ไทย ----------

test('parseDate: ISO และรูปแบบไทย ว/ด/ป', () => {
  assert.deepEqual(parseDate('2026-08-13'), { y: 2026, m: 8, d: 13 });
  assert.deepEqual(parseDate('13/8/2569'), { y: 2026, m: 8, d: 13 }); // พ.ศ. → ค.ศ.
  assert.deepEqual(parseDate('13-08-2569'), { y: 2026, m: 8, d: 13 });
  assert.deepEqual(parseDate('13/08/2026'), { y: 2026, m: 8, d: 13 }); // ว/ด/ป ไม่ใช่ MM/DD/YYYY
  assert.deepEqual(parseDate('13 ส.ค. 2569'), { y: 2026, m: 8, d: 13 });
  assert.deepEqual(parseDate('13 สิงหาคม 2569'), { y: 2026, m: 8, d: 13 });
  assert.deepEqual(parseDate('31/12/2499'), { y: 1956, m: 12, d: 31 }); // พ.ศ. 2499
});

test('parseDate: ไม่สมมติว่าเป็น MM/DD/YYYY และคืนค่า null เมื่อไม่ถูกต้อง', () => {
  assert.equal(parseDate('08/13/2026'), null); // "เดือน 13" ไม่มี
  assert.equal(parseDate('31/02/2026'), null); // ก.พ. ไม่มี 31
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('garbage'), null);
  assert.equal(parseDate(null), null);
});

// ---------- โซนเวลา Asia/Bangkok ----------

test('getBangkokNow: แปลงเวลา UTC → เวลาไทย (UTC+7)', () => {
  // 2026-08-12 17:30 UTC = 2026-08-13 00:30 เวลาไทย
  const n = getBangkokNow(new Date('2026-08-12T17:30:00Z'));
  assert.deepEqual(
    { y: n.year, m: n.month, d: n.day, h: n.hour, mi: n.minute, s: n.second },
    { y: 2026, m: 8, d: 13, h: 0, mi: 30, s: 0 },
  );

  // 2026-08-13 02:00 UTC = 09:00 เวลาไทย วันเดียวกัน
  const n2 = getBangkokNow(new Date('2026-08-13T02:00:00Z'));
  assert.equal(n2.hour, 9);
  assert.deepEqual([n2.year, n2.month, n2.day], [2026, 8, 13]);
});

test('todayInBangkok: วันที่จะเปลี่ยนตามโซนเวลา', () => {
  // 20:30 UTC = 03:30 ของวันถัดไปในไทย
  assert.deepEqual(todayInBangkok(new Date('2026-08-12T20:30:00Z')), { y: 2026, m: 8, d: 13 });
});

// ---------- การคำนวณวันที่สิ้นสุดวาระ ----------

test('addDuration: วันที่สิ้นสุดวาระ = วันที่อ้างอิง + วาระคงเหลือ', () => {
  assert.deepEqual(addDuration({ y: 2026, m: 8, d: 13 }, { years: 5, months: 1, days: 0 }), { y: 2031, m: 9, d: 13 });
  assert.deepEqual(addDuration({ y: 2026, m: 8, d: 13 }, { years: 0, months: 1, days: 0 }), { y: 2026, m: 9, d: 13 });
  assert.deepEqual(addDuration({ y: 2026, m: 8, d: 13 }, { years: 26, months: 10, days: 0 }), { y: 2053, m: 6, d: 13 });
});

test('addDuration: ปัดวันที่เกินเดือนให้ถูกต้องตามปฏิทิน', () => {
  assert.deepEqual(addDuration({ y: 2026, m: 8, d: 31 }, { years: 0, months: 1, days: 0 }), { y: 2026, m: 9, d: 30 });
  assert.deepEqual(addDuration({ y: 2024, m: 2, d: 29 }, { years: 1, months: 0, days: 0 }), { y: 2025, m: 2, d: 28 }); // ปีอธิกสุรทิน
});

test('daysBetween: คำนวณแบบปฏิทินแม่นยำ ไม่มีปัญหา DST', () => {
  assert.equal(daysBetween({ y: 2026, m: 8, d: 13 }, { y: 2031, m: 9, d: 13 }), 1857);
  assert.equal(daysBetween({ y: 2026, m: 8, d: 13 }, { y: 2026, m: 8, d: 13 }), 0);
  assert.equal(daysBetween({ y: 2026, m: 8, d: 13 }, { y: 2026, m: 8, d: 12 }), -1);
  assert.equal(daysBetween({ y: 2024, m: 2, d: 28 }, { y: 2024, m: 3, d: 1 }), 2); // ข้ามปีอธิกสุรทิน
});

// ---------- รูปแบบแสดงผล ----------

test('monthsDaysBetween: แยก ปี/เดือน/วัน ตามปฏิทินจริง', () => {
  assert.deepEqual(monthsDaysBetween({ y: 2026, m: 8, d: 13 }, { y: 2026, m: 11, d: 25 }), { years: 0, months: 3, days: 12 });
  assert.deepEqual(monthsDaysBetween({ y: 2026, m: 8, d: 13 }, { y: 2031, m: 9, d: 13 }), { years: 5, months: 1, days: 0 });
  assert.deepEqual(monthsDaysBetween({ y: 2026, m: 8, d: 13 }, { y: 2026, m: 9, d: 1 }), { years: 0, months: 0, days: 19 });
});

test('formatDaysLeft: รูปแบบภาษาไทย', () => {
  const today = { y: 2026, m: 8, d: 13 };
  assert.equal(formatDaysLeft(1857, today, { y: 2031, m: 9, d: 13 }), 'เหลือ 5 ปี 1 เดือน');
  assert.equal(formatDaysLeft(102, today, { y: 2026, m: 11, d: 23 }), 'เหลือ 3 เดือน 10 วัน');
  assert.equal(formatDaysLeft(19, today, { y: 2026, m: 9, d: 1 }), 'เหลือ 19 วัน');
  assert.equal(formatDaysLeft(0, today, { y: 2026, m: 8, d: 13 }), 'หมดวาระวันนี้'); // สิ้นสุดวันนี้
  assert.equal(formatDaysLeft(-3, today, { y: 2026, m: 8, d: 10 }), 'หมดวาระแล้ว');
  assert.equal(formatDaysLeft(null, today, null), '—');
});

test('formatThaiDate / toISOString', () => {
  assert.equal(formatThaiDate({ y: 2026, m: 8, d: 13 }), '13 ส.ค. 2569');
  assert.equal(toISOString({ y: 2026, m: 8, d: 13 }), '2026-08-13');
});
