// ============================================================
// เทสต์ระบบแจ้งเตือนวาระ — ครอบคลุม 20 สถานการณ์จากข้อกำหนด
// ------------------------------------------------------------
// ใช้ :memory: SQLite + console transport (ไม่ส่งอีเมลจริง)
// ทุกเทสต์ผ่าน runCycle โดยตรง (ไม่ได้ผ่าน API)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { loadSettings } from '../server/settings.js';
import { runCycle, buildAnnualSummary, loadPeople } from '../server/notification-engine.js';

// ---------- เครื่องมือช่วย ----------

const HEADER = ['ลำดับ TOR', 'หมู่บ้าน', 'ตำบล', 'อำเภอ', 'จังหวัด', 'เจ้าหน้าที่ประจำพื้นที่ (ชื่อ)', 'ตำแหน่ง', 'เบอร์โทรติดต่อ', 'วาระคงเหลือ', 'หมายเหตุ', 'อีเมล'];
const row = (tor, name, position, wara, email = '') => [tor, 'หมู่ 1', 'ตำบลกลาง', 'อำเภอกลาง', 'จังหวัดกลาง', name, position, `081-0000${tor}`, wara, '', email];

const NOW = new Date('2026-08-13T09:00:00+07:00');
const REF = '2026-08-13';

function makeCsv(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'wara-notif-'));
  const path = join(dir, 'people.csv');
  writeFileSync(path, [HEADER.join(','), ...rows.map((r) => r.join(','))].join('\n'), 'utf8');
  return { dir, path };
}

function makeSettings(db, overrides = {}) {
  const s = loadSettings(db);
  s.email.transport = 'console';
  s.notifications.six_month.to = ['admin@example.com'];
  s.notifications.one_month.to = ['admin@example.com'];
  s.notifications.annual_summary.to = ['boss@example.com'];
  Object.assign(s, overrides);
  return s;
}

const config = { dataReferenceDate: REF, expiringSoonThresholdDays: 30 };

function events(db) {
  return db.prepare('SELECT * FROM notification_events ORDER BY id').all();
}
function countByStatus(ev, status) {
  return ev.filter((e) => e.status === status).length;
}
function countByType(ev, type) {
  return ev.filter((e) => e.notification_type === type).length;
}

// ---------- 1. เหลือมากกว่า 6 เดือน ----------

test('1. เหลือมากกว่า 6 เดือน → ไม่มีการแจ้งเตือน', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายนาน', 'ผู้ใหญ่บ้าน', '1 ปี', 'a@example.com')]);
  try {
    const s1 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: NOW });
    assert.equal(s1.sent, 0);
    assert.equal(s1.failed, 0);
    assert.equal(events(db).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 2. หมดวาระในอีก 6 เดือนพอดี ----------

test('2. หมดวาระในอีก 6 เดือนพอดี → ส่งเตือน 6 เดือน 1 ครั้ง', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายพอดี', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com')]);
  try {
    const s1 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(s1.sent, 1);
    assert.equal(countByType(ev, 'six_month'), 1);
    assert.equal(ev[0].person_name, 'นายพอดี');
    assert.equal(ev[0].status, 'sent');
    assert.equal(ev[0].term_end_date, '2027-02-13');
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 3. อยู่ในช่วง 6 เดือน ----------

test('3. เหลือ ~5 เดือน 20 วัน (ในหน้าต่าง 6 เดือน) → ส่งเตือน 6 เดือน', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายในหน้าต่าง', 'กำนัน', '0 ปี 5 เดือน 20 วัน', 'a@example.com')]);
  try {
    const s1 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: NOW });
    assert.equal(s1.sent, 1);
    assert.equal(countByType(events(db), 'six_month'), 1);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 4. หมดวาระในอีก 1 เดือนพอดี ----------

test('4. หมดวาระในอีก 1 เดือนพอดี → ส่งเตือน 1 เดือน (และ 6 เดือนด้วย ตามหลักอิสระต่อกัน)', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายเดือนเดียว', 'ผู้ใหญ่บ้าน', '0 ปี 1 เดือน', 'a@example.com')]);
  try {
    const s1 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(countByType(ev, 'one_month'), 1);
    assert.equal(countByType(ev, 'six_month'), 1);
    assert.equal(s1.sent, 2);
    const om = ev.find((e) => e.notification_type === 'one_month');
    assert.equal(om.term_end_date, '2026-09-13');
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 5. อยู่ในช่วง 1 เดือน ----------

test('5. เหลือ ~25 วัน (ในหน้าต่าง 1 เดือน) → ส่งเตือน 1 เดือน', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายยี่สิบห้าวัน', 'ผู้ช่วยผู้ใหญ่บ้าน', '0 ปี 0 เดือน 25 วัน', 'a@example.com')]);
  try {
    const s1 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: NOW });
    assert.equal(s1.sent, 2); // 1 เดือน + 6 เดือน
    assert.equal(countByType(events(db), 'one_month'), 1);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 6. วาระหมดแล้ว ----------

test('6. วาระหมดแล้ว (daysLeft < 0) → ไม่แจ้งเตือน', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายหมดแล้ว', 'ผู้ใหญ่บ้าน', '0 ปี 1 เดือน')]);
  try {
    // อ้างอิงในอดีต → สิ้นสุดวาระก่อนวันนี้
    const s1 = await runCycle({ db, settings: makeSettings(db), config: { dataReferenceDate: '2026-01-01', expiringSoonThresholdDays: 30 }, csvUrl: path, now: NOW });
    assert.equal(events(db).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 7. ไม่มีอีเมลบุคคล + ไม่มีผู้รับบริหาร → skipped ----------

test('7. บุคคลไม่มีอีเมล และไม่กำหนดผู้รับบริหาร → skipped พร้อมบันทึกเหตุผล', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายไม่มีเมล', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', '')]);
  try {
    const s = makeSettings(db);
    s.notifications.six_month.to = [];
    s.notifications.six_month.includePerson = true;
    const s1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(s1.skipped, 1);
    assert.equal(ev[0].status, 'skipped');
    assert.match(ev[0].error_message, /ไม่มีอีเมลผู้รับ/);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 8. อีเมลรูปแบบไม่ถูกต้อง ----------

test('8. อีเมลบุคคลไม่ถูกต้อง → ถูกตัดออกจากผู้รับ (ไม่นับว่าส่งสำเร็จให้คนนั้น)', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายเมลผิด', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'not-an-email')]);
  try {
    const s = makeSettings(db); // admin@example.com ยังเป็นผู้รับ
    const s1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(ev[0].status, 'sent');
    assert.equal(ev[0].recipient_email, 'admin@example.com'); // อีเมลผิดถูกตัด
    assert.ok(!ev[0].recipient_email.includes('not-an-email'));
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

test('8b. ผู้รับทั้งหมดไม่ถูกต้อง → failed (ไม่ใช่ sent)', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายเมลผิดหมด', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'not-an-email')]);
  try {
    const s = makeSettings(db);
    s.notifications.six_month.to = ['bad@@'];
    const s1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(ev[0].status, 'failed');
    assert.match(ev[0].error_message, /ไม่ถูกต้อง|ไม่มีผู้รับ/);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 9. SMTP ไม่พร้อมใช้งาน ----------

test('9. SMTP ไม่พร้อมใช้งาน (connection refused) → failed ไม่ใช่ sent', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายส่งไม่ได้', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com')]);
  try {
    const s = makeSettings(db);
    s.email.transport = 'smtp';
    s.email.smtp = { host: '127.0.0.1', port: 1, secure: false, user: '' };
    s.email.hasPassword = false;
    const s1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(s1.failed, 1);
    assert.equal(ev[0].status, 'failed');
    assert.match(ev[0].error_message, /SMTP|เชื่อมต่อ|ECONNREFUSED|socket/i);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

test('9b. กำหนด SMTP user แต่ไม่มี SMTP_PASS → failed (ไม่รั่วรหัสผ่าน)', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายไม่มีพาส', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com')]);
  try {
    const s = makeSettings(db);
    s.email.transport = 'smtp';
    s.email.smtp = { host: '127.0.0.1', port: 587, secure: false, user: 'smtpuser', pass: '' };
    s.email.hasPassword = false;
    const s1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(ev[0].status, 'failed');
    assert.match(ev[0].error_message, /SMTP_PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 10/11. รันซ้ำ / รอบซ้ำ → ไม่ส่งซ้ำ ----------

test('10/11. รันรอบซ้ำหลายครั้ง → แต่ละ key ส่งครั้งเดียว', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายซ้ำ', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com')]);
  try {
    const s = makeSettings(db);
    const r1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const r2 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const r3 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    assert.equal(r1.sent, 1);
    assert.equal(r2.sent, 0);
    assert.equal(r3.sent, 0);
    const ev = events(db);
    assert.equal(countByStatus(ev, 'sent'), 1);
    assert.equal(countByType(ev, 'six_month'), 1);
    // key ไม่ซ้ำกัน
    assert.equal(new Set(ev.map((e) => e.notification_key)).size, ev.length);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 12/13. ได้ 6 เดือนแล้ว → ยังต้องได้ 1 เดือนเมื่อถึงเวลา ----------

test('12/13. ได้รับ 6 เดือนแล้ว ไม่ส่งซ้ำ แต่เมื่อเข้า 1 เดือน ต้องได้รับ 1 เดือน', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายตามขั้น', 'ผู้ใหญ่บ้าน', '0 ปี 3 เดือน', 'a@example.com')]);
  try {
    const s = makeSettings(db);
    // T0: เหลือ 3 เดือน → เตือน 6 เดือน เท่านั้น
    const t0 = new Date('2026-08-13T09:00:00+07:00');
    const r1 = await runCycle({ db, settings: s, config, csvUrl: path, now: t0 });
    assert.equal(countByType(events(db), 'six_month'), 1);
    assert.equal(countByType(events(db), 'one_month'), 0);

    // T1: +2.5 เดือน (เหลือ ~15 วัน) → 1 เดือนต้องส่ง, 6 เดือนห้ามส่งซ้ำ
    const t1 = new Date('2026-10-28T09:00:00+07:00');
    const r2 = await runCycle({ db, settings: s, config, csvUrl: path, now: t1 });
    const ev = events(db);
    assert.equal(countByType(ev, 'one_month'), 1);
    assert.equal(countByType(ev, 'six_month'), 1); // ไม่เพิ่ม
    assert.equal(countByStatus(ev, 'sent'), 2);

    // T2: รันซ้ำ → ไม่มีอะไรใหม่
    const r3 = await runCycle({ db, settings: s, config, csvUrl: path, now: t1 });
    assert.equal(r3.sent, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 14. 31 ธันวาคม → สรุปประจำปี ----------

test('14. 31 ธ.ค. → ส่งสรุปประจำปี พร้อมตัวเลขครบ', async () => {
  const db = openDatabase(':memory:');
  const rows = [
    row(1, 'นายผญบ', 'ผู้ใหญ่บ้าน', '0 ปี 5 เดือน 20 วัน', 'a@example.com'), // expiring 6 เดือน (33 วัน)
    row(2, 'นายกำนัน', 'กำนัน', '0 ปี 4 เดือน 18 วัน', 'b@example.com'),     // expiring 1 เดือน (สิ้นสุด 31 ธ.ค.)
    row(3, 'นายผู้ช่วย', 'ผู้ช่วยผู้ใหญ่บ้าน', '1 ปี', 'c@example.com'),       // active
    row(4, 'นายผญบ2', 'ผู้ใหญ่บ้าน', '5 ปี', 'd@example.com'),              // active
  ];
  const { dir, path } = makeCsv(rows);
  try {
    const dec31 = new Date('2026-12-31T09:00:00+07:00');
    const s = makeSettings(db);
    const r1 = await runCycle({ db, settings: s, config, csvUrl: path, now: dec31 });
    const ev = events(db);
    const annual = ev.find((e) => e.notification_type === 'annual_summary');
    assert.ok(annual, 'ต้องมี annual_summary event');
    assert.equal(annual.status, 'sent');
    assert.equal(annual.notification_key, 'TERM_EXPIRATION_ANNUAL_SUMMARY:all:2026-12-31');
    // สรุปตัวเลขจาก buildAnnualSummary
    const people = loadPeople({ csvUrl: path, config, now: dec31 });
    const summary = buildAnnualSummary(people, dec31);
    assert.equal(summary.counts.village, 2);
    assert.equal(summary.counts.kamnan, 1);
    assert.equal(summary.counts.assistant, 1);
    assert.equal(summary.counts.expiring6, 2); // ผญบ + กำนัน
    assert.equal(summary.counts.expiring1, 1); // กำนัน (สิ้นสุดวันนี้)
    assert.equal(summary.counts.active, 2);
    assert.equal(summary.counts.expired, 0);
    assert.equal(summary.expiringList.length, 2); // กำนัน + ผญบ
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 15. 1 มกราคม → ไม่ส่งสรุปปีก่อนซ้ำ ----------

test('15. 1 ม.ค. → ไม่ส่งสรุปประจำปี และสรุปปีก่อนไม่ถูกส่งซ้ำ', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายเอ', 'ผู้ใหญ่บ้าน', '0 ปี 5 เดือน', 'a@example.com')]);
  try {
    const s = makeSettings(db);
    const dec31 = new Date('2026-12-31T09:00:00+07:00');
    await runCycle({ db, settings: s, config, csvUrl: path, now: dec31 });
    assert.equal(countByType(events(db), 'annual_summary'), 1);

    // 1 ม.ค. 2570 → annual action = not_dec31 (ไม่สร้าง event ใหม่)
    const jan1 = new Date('2027-01-01T09:00:00+07:00');
    const r2 = await runCycle({ db, settings: s, config, csvUrl: path, now: jan1 });
    assert.equal(r2.annual.action, 'not_dec31');
    assert.equal(countByType(events(db), 'annual_summary'), 1);

    // รันซ้ำในวัน 31 ธ.ค. ปีเดียวกัน → already (ไม่ส่งซ้ำ)
    const r3 = await runCycle({ db, settings: s, config, csvUrl: path, now: dec31 });
    assert.equal(r3.annual.action, 'already');
    assert.equal(countByType(events(db), 'annual_summary'), 1);
    // สรุปประจำปีส่งครั้งเดียว; ส่วนบุคคลอาจได้ 6M/1M แยกตามเวลา
    assert.equal(countByType(events(db).filter((e) => e.notification_type === 'annual_summary'), 'annual_summary'), 1);
    assert.equal(events(db).filter((e) => e.notification_type === 'annual_summary')[0].status, 'sent');
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 16. หลายคนวันสิ้นสุดเดียวกัน ----------

test('16. หลายคนมีวันสิ้นสุดวาระเดียวกัน → ต่างคนต่างได้แจ้งเตือน (key แยกตาม personId)', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([
    row(1, 'นายคนแรก', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com'),
    row(2, 'นายคนสอง', 'กำนัน', '0 ปี 6 เดือน', 'b@example.com'),
  ]);
  try {
    const r1 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(r1.sent, 2);
    assert.equal(ev.length, 2);
    assert.equal(new Set(ev.map((e) => e.notification_key)).size, 2);
    assert.equal(ev[0].term_end_date, ev[1].term_end_date);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 17. หลายตำแหน่ง ----------

test('17. ทั้ง 3 ตำแหน่ง (ผู้ใหญ่บ้าน/กำนัน/ผู้ช่วย) ได้รับการแจ้งเตือน และตำแหน่งอื่นไม่ถูกนับ', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([
    row(1, 'นายผญบ', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com'),
    row(2, 'นายกำนัน', 'กำนัน', '0 ปี 6 เดือน', 'b@example.com'),
    row(3, 'นายผู้ช่วย', 'ผู้ช่วยผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'c@example.com'),
    row(4, 'นายผสม', 'กำนัน / ผู้ช่วยผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'd@example.com'),
    row(5, 'นายไม่ใช่', 'สารวัตรกำนัน', '0 ปี 6 เดือน', 'e@example.com'),
  ]);
  try {
    const people = loadPeople({ csvUrl: path, config, now: NOW });
    assert.equal(people.length, 4); // สารวัตรกำนัน ถูกตัดออก
    const r1 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: NOW });
    assert.equal(r1.sent, 4);
    const ev = events(db);
    const positions = new Set(ev.map((e) => e.position));
    assert.ok(positions.has('ผู้ใหญ่บ้าน'));
    assert.ok(positions.has('กำนัน'));
    assert.ok(positions.has('ผู้ช่วยผู้ใหญ่บ้าน'));
    assert.ok(![...ev].some((e) => e.person_name === 'นายไม่ใช่'));
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 18. โซนเวลา Asia/Bangkok ----------

test('18. โซนเวลา: เที่ยงคืนข้ามวันตามเวลาไทย (UTC ยังเป็นวันก่อน) → นับตามวันไทย', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายข้ามวัน', 'ผู้ใหญ่บ้าน', '0 ปี 0 เดือน 0 วัน', 'a@example.com')]);
  try {
    // 2026-12-31T17:30:00Z = 2027-01-01T00:30:00+07:00 → วันไทยเป็น 1 ม.ค. 2570
    const bkkNewYear = new Date('2026-12-31T17:30:00Z');
    const r = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: bkkNewYear });
    // สรุปประจำปีต้องไม่ส่ง (วันไทยไม่ใช่ 31 ธ.ค.)
    assert.equal(r.annual.action, 'not_dec31');

    // 2026-12-31T16:30:00Z = 2026-12-31T23:30:00+07:00 → ยังเป็น 31 ธ.ค. ตามเวลาไทย
    const bkkDec31 = new Date('2026-12-31T16:30:00Z');
    const r2 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: bkkDec31 });
    assert.equal(r2.annual.action, 'sent');
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

test('18b. วันคงเหลือคำนวณตามวันไทย (ไม่ใช่ UTC)', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายตีสาม', 'ผู้ใหญ่บ้าน', '0 ปี 1 เดือน', 'a@example.com')]);
  try {
    // 2026-09-01T20:00:00Z = 2026-09-02T03:00:00+07:00 → วันไทย 2 ก.ย. → วาระสิ้นสุด 13 ก.ย. → เหลือ 11 วัน
    const now = new Date('2026-09-01T20:00:00Z');
    const people = loadPeople({ csvUrl: path, config, now });
    assert.equal(people[0].daysLeft, 11);
    const r = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now });
    assert.ok(r.sent >= 1); // อยู่ในหน้าต่าง 1 เดือน
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 19. สถานะการส่ง + audit ----------

test('19. บันทึกสถานะการส่งครบ (type/person/recipient/key/status/error) + audit', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([
    row(1, 'นายสำเร็จ', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com'),
    row(2, 'นายล้มเหลว', 'กำนัน', '0 ปี 6 เดือน', 'not-an-email'), // อีเมลบุคคลไม่ถูกต้อง + ไม่มีผู้รับบริหาร
  ]);
  try {
    const s = makeSettings(db);
    s.notifications.six_month.to = [];
    s.notifications.one_month.to = [];
    const r1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(ev.length, 2); // 2 คน × six_month (วาระ 6 เดือน ไม่เข้า 1 เดือน)
    const ok = ev.find((e) => e.person_name === 'นายสำเร็จ' && e.notification_type === 'six_month');
    const bad = ev.find((e) => e.person_name === 'นายล้มเหลว' && e.notification_type === 'six_month');
    assert.equal(ok.status, 'sent');
    assert.ok(ok.provider_message_id); // console-xxxx
    assert.equal(ok.notification_type, 'six_month');
    assert.equal(ok.term_end_date, '2027-02-13');
    assert.equal(ok.recipient_email, 'a@example.com');
    assert.equal(bad.status, 'failed');
    assert.ok(bad.error_message);

    // audit
    const auditRows = db.prepare("SELECT action FROM audit_log WHERE action LIKE 'notification.%' ORDER BY id").all();
    assert.ok(auditRows.some((a) => a.action.includes('notification.sent')));
    assert.ok(auditRows.some((a) => a.action.includes('notification.failed')));
    assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='scheduler.run'").get().n >= 1);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 19b. Retry: ล้มเหลวแล้วลองใหม่ในรอบถัดไป ----------

test('19b. ส่งล้มเหลว → failed; รอบถัดไป (SMTP กลับมาทำงาน) → retry สำเร็จ', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายรีไทร', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com')]);
  try {
    const s = makeSettings(db);
    s.email.maxRetries = 3;
    // รอบแรก: SMTP ไม่พร้อม
    s.email.transport = 'smtp';
    s.email.smtp = { host: '127.0.0.1', port: 1, secure: false, user: '' };
    s.email.hasPassword = false;
    const r1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    let ev = events(db);
    assert.equal(ev[0].status, 'failed');
    assert.equal(ev[0].retry_count, 1);

    // รอบสอง: เปลี่ยนเป็น console (SMTP กลับมา) → retry สำเร็จ
    s.email.transport = 'console';
    const r2 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    ev = events(db);
    assert.equal(ev[0].status, 'sent');
    assert.equal(ev[0].retry_count, 1); // นับเฉพาะ failed ที่เพิ่ม
    assert.equal(r2.sent, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- 20. รันพร้อมกัน (concurrency) → ไม่ส่งซ้ำ ----------

test('20. รัน 2 รอบพร้อมกัน (Promise.all) → แต่ละ key ส่งครั้งเดียว', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายพร้อมกัน', 'ผู้ใหญ่บ้าน', '0 ปี 6 เดือน', 'a@example.com')]);
  try {
    const s = makeSettings(db);
    const [a, b] = await Promise.all([
      runCycle({ db, settings: s, config, csvUrl: path, now: NOW }),
      runCycle({ db, settings: s, config, csvUrl: path, now: NOW }),
    ]);
    const ev = events(db);
    assert.equal(countByStatus(ev, 'sent'), 1, 'ส่งสำเร็จต้องมีเพียง 1 ครั้ง');
    assert.equal(countByType(ev, 'six_month'), 1);
    assert.equal(a.sent + b.sent, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- ตั้งปิดชนิดการแจ้งเตือน ----------

test('ปิดการแจ้งเตือน 6 เดือน → ไม่ส่ง 6 เดือน แต่ยังส่ง 1 เดือน', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายปิด', 'ผู้ใหญ่บ้าน', '0 ปี 0 เดือน 20 วัน', 'a@example.com')]);
  try {
    const s = makeSettings(db);
    s.notifications.six_month.enabled = false;
    const r1 = await runCycle({ db, settings: s, config, csvUrl: path, now: NOW });
    const ev = events(db);
    assert.equal(countByType(ev, 'six_month'), 0);
    assert.equal(countByType(ev, 'one_month'), 1);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});

// ---------- ข้อมูลไม่สมบูรณ์ (ไม่มีวาระ) → ไม่แจ้งเตือน ----------

test('ข้อมูลวาระไม่สมบูรณ์ → ไม่สร้าง event แจ้งเตือน', async () => {
  const db = openDatabase(':memory:');
  const { dir, path } = makeCsv([row(1, 'นายไม่มีวาระ', 'ผู้ใหญ่บ้าน', '', 'a@example.com')]);
  try {
    const r1 = await runCycle({ db, settings: makeSettings(db), config, csvUrl: path, now: NOW });
    assert.equal(events(db).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); db.close(); }
});
