// ============================================================
// โมเดลข้อมูล: แปลงแถว CSV → บันทึกพร้อมวันที่สิ้นสุดวาระ
// และวันคงเหลือที่คำนวณจากเวลาปัจจุบัน (now)
// ============================================================

import {
  parseDurationWara,
  addDuration,
  daysBetween,
  todayInBangkok,
  parseDate,
} from './dates.js';

export const STATUS = {
  ACTIVE: 'active',
  EXPIRING: 'expiring',
  EXPIRED: 'expired',
  INVALID: 'invalid',
};

/**
 * จัดสถานะตามจำนวนวันคงเหลือ (ลำดับความสำคัญ):
 *  - daysLeft < 0                                → EXPIRED (หมดวาระแล้ว)
 *  - 0 <= daysLeft <= threshold                  → EXPIRING (ใกล้หมดวาระ รวมถึงวันสิ้นสุดพอดี)
 *  - daysLeft > threshold                        → ACTIVE (ดำรงวาระ)
 *  - daysLeft เป็น null / ไม่ใช่ตัวเลข            → INVALID (ข้อมูลไม่สมบูรณ์)
 */
export function classify(daysLeft, thresholdDays) {
  if (daysLeft === null || daysLeft === undefined || !Number.isFinite(daysLeft)) return STATUS.INVALID;
  if (daysLeft < 0) return STATUS.EXPIRED;
  if (daysLeft <= thresholdDays) return STATUS.EXPIRING;
  return STATUS.ACTIVE;
}

/**
 * สร้างบันทึก (record) จากแถว CSV
 * @param {string[][]} rows แถวจาก parseCSV (แถวแรกคือ header)
 * @param {object} config  CONFIG (dataReferenceDate, expiringSoonThresholdDays)
 * @param {Date} [now]     เวลาปัจจุบัน (ส่งค่าได้ในเทสต์)
 */
export function buildRecords(rows, config, now = new Date()) {
  const header = (rows[0] || []).map((h) => String(h).replace(/\s+/g, ' ').trim());
  const col = {
    tor: header.findIndex((h) => h.includes('ลำดับ')),
    house: header.findIndex((h) => h.includes('เลขที่')),
    village: header.findIndex((h) => h.includes('หมู่บ้าน')),
    tambon: header.findIndex((h) => h.includes('ตำบล')),
    amphoe: header.findIndex((h) => h.includes('อำเภอ')),
    province: header.findIndex((h) => h.includes('จังหวัด')),
    name: header.findIndex((h) => h.includes('เจ้าหน้าที่ประจำพื้นที่') || h.includes('ชื่อ')),
    position: header.findIndex((h) => h.includes('ตำแหน่ง')),
    phone: header.findIndex((h) => h.includes('เบอร์โทร')),
    wara: header.findIndex((h) => h.includes('วาระคงเหลือ')),
    notes: header.findIndex((h) => h.includes('หมายเหตุ')),
  };

  const today = todayInBangkok(now);
  const reference = parseDate(config.dataReferenceDate);
  const threshold = Math.max(0, Math.round(Number(config.expiringSoonThresholdDays) || 0));

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i];
    const get = (k) => (k >= 0 ? (raw[k] ?? '') : '').toString().trim();

    const rec = {
      id: i,
      tor: get(col.tor),
      house: get(col.house),
      name: get(col.name),
      position: get(col.position),
      village: get(col.village),
      tambon: get(col.tambon),
      amphoe: get(col.amphoe),
      province: get(col.province),
      phone: get(col.phone).replace(/\s+/g, ' '),
      notes: get(col.notes),
      waraRaw: get(col.wara),
      duration: null, // { years, months, days }
      endDate: null,  // { y, m, d } — แหล่งความจริงของวันคงเหลือ
      startDate: null, // ไม่มีข้อมูลวันที่เริ่มวาระในชุดข้อมูลต้นทาง
      daysLeft: null,
      status: STATUS.INVALID,
      flags: [],
    };

    if (!rec.name) rec.flags.push('ไม่มีชื่อ');
    if (!rec.waraRaw) {
      rec.flags.push('ไม่มีข้อมูลวาระคงเหลือ');
    } else {
      const dur = parseDurationWara(rec.waraRaw);
      if (!dur) {
        rec.flags.push(`รูปแบบวาระคงเหลือไม่ถูกต้อง: "${rec.waraRaw}"`);
      } else {
        rec.duration = dur;
      }
    }
    if (!reference) rec.flags.push('วันที่อ้างอิง (dataReferenceDate) ไม่ถูกต้อง');

    if (rec.duration && reference) {
      rec.endDate = addDuration(reference, rec.duration);
      if (rec.endDate) {
        rec.daysLeft = daysBetween(today, rec.endDate);
        rec.status = classify(rec.daysLeft, threshold);
      } else {
        rec.flags.push('ไม่สามารถคำนวณวันที่สิ้นสุดวาระได้');
      }
    }

    records.push(rec);
  }
  return records;
}

/** นับจำนวนตามสถานะ */
export function computeKpis(records) {
  const k = { total: records.length, active: 0, expiring: 0, expired: 0, invalid: 0 };
  for (const r of records) {
    if (r.status === STATUS.ACTIVE) k.active++;
    else if (r.status === STATUS.EXPIRING) k.expiring++;
    else if (r.status === STATUS.EXPIRED) k.expired++;
    else k.invalid++;
  }
  return k;
}

/** ข้อความที่ใช้ค้นหา */
export function searchText(rec) {
  return [
    rec.tor, rec.house, rec.name, rec.position,
    rec.village, rec.tambon, rec.amphoe, rec.province,
    rec.phone, rec.notes, rec.waraRaw,
  ].join(' ').toLowerCase();
}

/** กรองตามคำค้นหาและสถานะ ('all' = ทุกสถานะ) */
export function filterRecords(records, query, statusFilter) {
  const q = (query || '').trim().toLowerCase();
  return records.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!q) return true;
    return searchText(r).includes(q);
  });
}

const utcOf = (d) => (d ? Date.UTC(d.y, d.m - 1, d.d) : Infinity);

function nullLast(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return 0;
}

/**
 * เรียงลำดับ
 * keys: daysAsc, daysDesc, name, endDate, province
 * ค่า null (ข้อมูลไม่สมบูรณ์) จะถูกจัดไว้ท้ายสุดเสมอ
 */
export function sortRecords(records, key) {
  const arr = [...records];
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'th');

  arr.sort((a, b) => {
    switch (key) {
      case 'daysDesc':
        return (
          nullLast(a.daysLeft, b.daysLeft)
          || (b.daysLeft - a.daysLeft)
          || utcOf(a.endDate) - utcOf(b.endDate)
          || byName(a, b)
        );
      case 'name':
        return byName(a, b) || nullLast(a.daysLeft, b.daysLeft);
      case 'endDate':
        return nullLast(a.endDate, b.endDate) || utcOf(a.endDate) - utcOf(b.endDate) || byName(a, b);
      case 'province':
        return (a.province || '').localeCompare(b.province || '', 'th') || byName(a, b);
      case 'daysAsc':
      default:
        return (
          nullLast(a.daysLeft, b.daysLeft)
          || (a.daysLeft - b.daysLeft)
          || utcOf(a.endDate) - utcOf(b.endDate)
          || byName(a, b)
        );
    }
  });
  return arr;
}
