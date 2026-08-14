// ============================================================
// ฟังก์ชันจัดการวันที่และเวลา
// ------------------------------------------------------------
// - ใช้โซนเวลา Asia/Bangkok เป็นหลัก
// - วันที่ภายในระบบถูก normalize เป็น { y, m, d } (ปฏิทินเกรกอเรียน)
//   เพื่อหลีกเลี่ยงปัญหา timezone / DST / รูปแบบวันที่ที่ต่างกัน
// - ปี พ.ศ. (พุทธศักราช) จะแปลงเป็น ค.ศ. อัตโนมัติเมื่อปี >= 2400
// - ไม่สมมติว่าเป็นรูปแบบ MM/DD/YYYY — รูปแบบไทยคือ ว/ด/ป
// ============================================================

const THAI_DIGITS = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };
const FULLWIDTH_DIGITS = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9' };

export const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const THAI_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** แปลงเลขไทย / เลขเต็มความกว้างเป็นเลขอารบิก */
export function normalizeDigits(value) {
  return String(value)
    .replace(/[๐-๙]/g, (d) => THAI_DIGITS[d])
    .replace(/[０-９]/g, (d) => FULLWIDTH_DIGITS[d]);
}

/** จำนวนวันสูงสุดของเดือน (คำนวณผ่าน UTC เพื่อหลีกเลี่ยง DST) */
export function lastDayOfMonthUTC(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** วันที่ { y, m, d } → ค่า UTC เที่ยงคืน (สำหรับผลต่างแบบปฏิทิน) */
export function toUTCDate({ y, m, d }) {
  return Date.UTC(y, m - 1, d);
}

/** ผลต่างวันแบบปฏิทิน (end - start) แม่นยำ ไม่มีปัญหา DST/timezone */
export function daysBetween(start, end) {
  return Math.round((toUTCDate(end) - toUTCDate(start)) / 86400000);
}

/**
 * แปลงค่า "วาระคงเหลือ" เช่น "5 ปี 1 เดือน", "0 ปี 2 เดือน", "3 เดือน", "5 วัน"
 * → { years, months, days }   คืนค่า null ถ้ารูปแบบไม่ถูกต้องหรือว่าง
 */
export function parseDurationWara(input) {
  if (input === null || input === undefined) return null;
  const s = normalizeDigits(input).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/หมดวาระ|หมดอายุ|สิ้นสุดวาระ/.test(s)) return { years: 0, months: 0, days: 0 };
  if (/^(?:ไม่ระบุ|ไม่มี|n\/a|na|-|–)$/i.test(s)) return null;

  const m = s.match(/^(?:(?<y>\d+)\s*ปี)?(?:\s*(?<mo>\d+)\s*เดือน)?(?:\s*(?<d>\d+)\s*วัน)?$/);
  if (!m || (!m.groups.y && !m.groups.mo && !m.groups.d)) return null;

  return {
    years: m.groups.y ? Number(m.groups.y) : 0,
    months: m.groups.mo ? Number(m.groups.mo) : 0,
    days: m.groups.d ? Number(m.groups.d) : 0,
  };
}

/**
 * เพิ่มระยะเวลา (ปี/เดือน/วัน) ให้กับวันที่
 * วันที่เกินเดือน (เช่น 31 → 30) จะถูกปัดให้ถูกต้องตามปฏิทิน
 */
export function addDuration(date, dur) {
  if (!date || !dur) return null;
  const total = date.y * 12 + (date.m - 1) + dur.years * 12 + dur.months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const clamped = { y: ty, m: tm, d: Math.min(date.d, lastDayOfMonthUTC(ty, tm)) };
  if (!dur.days) return clamped;

  const ms = toUTCDate(clamped) + dur.days * 86400000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function validateYMD(y, m, d) {
  if (!Number.isInteger(y) || y < 1 || !Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > lastDayOfMonthUTC(y, m)) return null;
  return { y, m, d };
}

/** แปลงปี พ.ศ. → ค.ศ. (ปี >= 2400 ถือเป็นพุทธศักราช) */
function toGregorianYear(y) {
  return y >= 2400 ? y - 543 : y;
}

/** หาเลขเดือนจากชื่อเดือนไทย (ย่อ/เต็ม) */
export function thaiMonthNumber(name) {
  const n = normalizeDigits(name).trim();
  for (let i = 0; i < 12; i++) {
    if (n === THAI_MONTHS_FULL[i] || n.startsWith(THAI_MONTHS_SHORT[i])) return i + 1;
  }
  return null;
}

/**
 * แปลงวันที่จากหลายรูปแบบ (ไม่สมมติว่าเป็น MM/DD/YYYY):
 *  - ISO:          "2026-08-13", "2026/8/13"
 *  - ไทย (ว/ด/ป):  "13/8/2569", "13-08-2569"
 *  - ไทย (ชื่อเดือน): "13 ส.ค. 2569", "13 สิงหาคม 2569"
 * รองรับเลขไทย (๐-๙) และปี พ.ศ.
 * คืนค่า { y, m, d } หรือ null ถ้าไม่ถูกต้อง
 */
export function parseDate(input) {
  if (typeof input !== 'string') return null;
  const s = normalizeDigits(input).trim();
  if (!s) return null;

  // ISO: YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validateYMD(toGregorianYear(Number(m[1])), Number(m[2]), Number(m[3]));

  // ไทย: ว/ด/ป หรือ ว/ด/พ.ศ.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return validateYMD(toGregorianYear(y), Number(m[2]), Number(m[1]));
  }

  // ไทย: "13 ส.ค. 2569" / "13 สิงหาคม 2569"
  m = s.match(/^(\d{1,2})\s+([\u0E00-\u0E7F.]+)\s+(\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mo = thaiMonthNumber(m[2]);
    if (mo === null) return null;
    return validateYMD(toGregorianYear(y), mo, Number(m[1]));
  }

  return null;
}

/**
 * เวลาปัจจุบันในโซนเวลาที่กำหนด (ค่าเริ่มต้น Asia/Bangkok)
 * @param {Date} [now] — ใช้ในเทสต์ได้โดยส่งค่า Date คงที่
 */
export function getBangkokNow(now = new Date(), timezone = 'Asia/Bangkok') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : NaN;
  };

  let hour = get('hour');
  if (hour === 24) hour = 0; // บางเครื่องยนต์ให้ '24' ตอนเที่ยงคืน

  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute'), second: get('second') };
}

/** วันนี้ (เฉพาะวันที่) ในโซนเวลาไทย */
export function todayInBangkok(now = new Date(), timezone = 'Asia/Bangkok') {
  const n = getBangkokNow(now, timezone);
  return { y: n.year, m: n.month, d: n.day };
}

function addMonthsClamped(date, n = 1) {
  const total = date.y * 12 + (date.m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return { y: ty, m: tm, d: Math.min(date.d, lastDayOfMonthUTC(ty, tm)) };
}

/**
 * แยกช่วงเวลาระหว่างวันนี้กับวันสิ้นสุดเป็น ปี/เดือน/วัน ตามปฏิทินจริง
 * เช่น 13 ส.ค. → 25 พ.ย. = { years: 0, months: 3, days: 12 }
 */
export function monthsDaysBetween(today, end) {
  if (!today || !end) return { years: 0, months: 0, days: 0 };
  if (toUTCDate(end) < toUTCDate(today)) return { years: 0, months: 0, days: 0 };

  let months = 0;
  let cursor = today;
  for (let i = 0; i < 2400; i++) {
    const next = addMonthsClamped(cursor);
    if (toUTCDate(next) > toUTCDate(end)) break;
    cursor = next;
    months++;
  }

  const years = Math.floor(months / 12);
  const restMonths = months % 12;
  const days = Math.round((toUTCDate(end) - toUTCDate(cursor)) / 86400000);
  return { years, months: restMonths, days };
}

/**
 * รูปแบบภาษาไทย:
 *  "เหลือ 5 ปี 1 เดือน", "เหลือ 3 เดือน 12 วัน", "เหลือ 125 วัน",
 *  "หมดวาระวันนี้", "หมดวาระแล้ว", "—"
 */
export function formatDaysLeft(daysLeft, today, end) {
  if (daysLeft === null || daysLeft === undefined || !Number.isFinite(daysLeft)) return '—';
  if (daysLeft < 0) return 'หมดวาระแล้ว';
  if (daysLeft === 0) return 'หมดวาระวันนี้';

  const { years, months, days } = monthsDaysBetween(today, end);
  const parts = [];
  if (years > 0) parts.push(`${years} ปี`);
  if (months > 0) parts.push(`${months} เดือน`);
  if (days > 0) parts.push(`${days} วัน`);
  if (parts.length === 0) return `เหลือ ${daysLeft} วัน`;
  return `เหลือ ${parts.join(' ')}`;
}

/** รูปแบบวันที่ไทย เช่น "13 ส.ค. 2569" (ปี พ.ศ.) */
export function formatThaiDate(date) {
  if (!date) return '—';
  return `${date.d} ${THAI_MONTHS_SHORT[date.m - 1]} ${date.y + 543}`;
}

/** ISO YYYY-MM-DD */
export function toISOString(date) {
  if (!date) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${date.y}-${p(date.m)}-${p(date.d)}`;
}
