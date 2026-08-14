// ============================================================
// การตั้งค่าระบบแจ้งเตือน — รวมค่าเริ่มต้น + system_settings (DB) + env
// ------------------------------------------------------------
// ลำดับความสำคัญ: env (SMTP_PASS ฯลฯ) > system_settings (DB) > ค่าเริ่มต้น
// ความปลอดภัย: SMTP_PASS อ่านจากตัวแปรสภาพแวดล้อมเท่านั้น และ
//  API ไม่เคยส่งคืนค่ารหัสผ่าน — ส่งคืนแค่สถานะ "hasPassword"
// ============================================================

import { getSetting, getSettingsByPrefix, setSetting } from './db.js';

export const NOTIFICATION_TYPES = Object.freeze({
  SIX_MONTH: 'six_month',
  ONE_MONTH: 'one_month',
  ANNUAL_SUMMARY: 'annual_summary',
});

export const POSITION_ROLES = Object.freeze({
  VILLAGE_HEADMAN: 'village_headman',       // ผู้ใหญ่บ้าน
  KAMNAN: 'kamnan',                         // กำนัน (หัวหน้าตำบล)
  ASSISTANT_VILLAGE_HEADMAN: 'assistant_village_headman', // ผู้ช่วยผู้ใหญ่บ้าน
});

export const POSITION_LABELS = Object.freeze({
  [POSITION_ROLES.VILLAGE_HEADMAN]: 'ผู้ใหญ่บ้าน',
  [POSITION_ROLES.KAMNAN]: 'กำนัน',
  [POSITION_ROLES.ASSISTANT_VILLAGE_HEADMAN]: 'ผู้ช่วยผู้ใหญ่บ้าน',
});

/**
 * แปลงข้อความตำแหน่ง → บทบาทหลัก หรือ null ถ้าไม่ใช่ 3 ตำแหน่งเป้าหมาย
 * ลำดับตรวจ: กำนัน > ผู้ช่วยผู้ใหญ่บ้าน (คำเต็ม) > ผู้ใหญ่บ้าน > ผู้ช่วย
 * (ต้องตรวจ "ผู้ช่วยผู้ใหญ่บ้าน" ก่อน "ผู้ใหญ่บ้าน" เพราะคำหลังเป็นส่วนหนึ่งของคำแรก)
 */
export function classifyRole(position) {
  if (!position) return null;
  const p = String(position).trim();
  if (/^กำนัน/.test(p)) return POSITION_ROLES.KAMNAN;                     // กำนัน, กำนันตำบลX, กำนันผู้ใหญ่บ้าน, กำนัน/ผู้ช่วย
  if (p.includes('ผู้ช่วยผู้ใหญ่บ้าน')) return POSITION_ROLES.ASSISTANT_VILLAGE_HEADMAN; // ผู้ช่วยผู้ใหญ่บ้าน
  if (p.includes('ผู้ใหญ่บ้าน')) return POSITION_ROLES.VILLAGE_HEADMAN;    // ผู้ใหญ่บ้าน, ผู้ใหญ่บ้าน/ผู้ช่วย
  if (p.includes('ผู้ช่วย')) return POSITION_ROLES.ASSISTANT_VILLAGE_HEADMAN; // ผู้ช่วยกำนัน ฯลฯ
  return null;
}

/** ค่าเริ่มต้นของระบบแจ้งเตือน */
export const DEFAULT_SETTINGS = Object.freeze({
  // การส่งอีเมล
  email: {
    transport: process.env.EMAIL_TRANSPORT || 'console', // 'smtp' | 'console'
    from: {
      name: process.env.EMAIL_FROM_NAME || 'ระบบแจ้งเตือนวาระ',
      address: process.env.EMAIL_FROM || 'noreply@localhost',
    },
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: String(process.env.SMTP_SECURE ?? 'true').toLowerCase() === 'true',
      user: process.env.SMTP_USER || '',
      rejectUnauthorized: String(process.env.SMTP_REJECT_UNAUTHORIZED ?? 'true').toLowerCase() !== 'false',
    },
    hasPassword: Boolean(process.env.SMTP_PASS),
    maxRetries: Number(process.env.EMAIL_MAX_RETRIES) || 3,
  },

  // การเปิด/ปิดและผู้รับของแต่ละชนิดการแจ้งเตือน
  notifications: {
    six_month: {
      enabled: true,
      thresholdMonths: 6,
      roles: ['village_headman', 'kamnan', 'assistant_village_headman'],
      to: (process.env.NOTIFY_6M_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
      cc: (process.env.NOTIFY_6M_CC || '').split(',').map((s) => s.trim()).filter(Boolean),
      bcc: [],
      includePerson: String(process.env.NOTIFY_6M_INCLUDE_PERSON ?? 'true').toLowerCase() !== 'false',
      subject: 'แจ้งเตือนใกล้หมดวาระ 6 เดือน — {{person_name}}',
      templateHtml: '',
    },
    one_month: {
      enabled: true,
      thresholdMonths: 1,
      roles: ['village_headman', 'kamnan', 'assistant_village_headman'],
      to: (process.env.NOTIFY_1M_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
      cc: (process.env.NOTIFY_1M_CC || '').split(',').map((s) => s.trim()).filter(Boolean),
      bcc: [],
      includePerson: String(process.env.NOTIFY_1M_INCLUDE_PERSON ?? 'true').toLowerCase() !== 'false',
      subject: 'แจ้งเตือนใกล้หมดวาระ 1 เดือน — {{person_name}}',
      templateHtml: '',
    },
    annual_summary: {
      enabled: true,
      sendTime: '09:00',
      to: (process.env.NOTIFY_ANNUAL_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
      cc: (process.env.NOTIFY_ANNUAL_CC || '').split(',').map((s) => s.trim()).filter(Boolean),
      bcc: [],
      subject: 'สรุปข้อมูลการหมดวาระประจำปี {{year}}',
      templateHtml: '',
    },
  },

  // เกณฑ์ช่วงเวลาแจ้งเตือน (เดือนตามปฏิทิน)
  thresholds: {
    sixMonthMonths: 6,
    oneMonthMonths: 1,
  },

  scheduler: {
    tickMinutes: Number(process.env.SCHEDULER_TICK_MINUTES) || 5,
    enabled: String(process.env.ENABLE_SCHEDULER ?? 'true').toLowerCase() !== 'false',
  },

  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:4173',
});

const EMAIL_JSON_KEYS = ['email', 'notifications', 'thresholds', 'scheduler', 'dashboardUrl'];

function mergePlainObject(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const out = { ...(target && typeof target === 'object' && !Array.isArray(target) ? target : {}) };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mergePlainObject(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** อ่านการตั้งค่าปัจจุบัน: เริ่มต้น + ค่าที่ผู้ดูแลบันทึกใน DB (JSON) */
export function loadSettings(db) {
  const s = structuredClone(DEFAULT_SETTINGS);

  // JSON blocks ที่บันทึกผ่าน UI
  for (const key of EMAIL_JSON_KEYS) {
    const raw = getSetting(db, `notify.${key}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          s[key] = mergePlainObject(s[key], parsed);
        } else if (key === 'dashboardUrl' && typeof parsed === 'string') {
          s[key] = parsed;
        }
      } catch {
        // ค่าที่เสียใน DB → ใช้ค่าเริ่มต้น (บันทึก audit ไว้แล้วตอนเขียน)
      }
    }
  }

  // ค่า SMTP เดี่ยว (host/port/user/pass) ที่บันทึกผ่าน DB
  const smtpPrefix = getSettingsByPrefix(db, 'notify.smtp.');
  for (const [k, v] of Object.entries(smtpPrefix)) {
    const field = k.slice('notify.smtp.'.length);
    if (field === 'port') s.email.smtp.port = Number(v) || s.email.smtp.port;
    else if (field === 'secure') s.email.smtp.secure = String(v) === 'true';
    else if (field === 'rejectUnauthorized') s.email.smtp.rejectUnauthorized = String(v) !== 'false';
    else if (field in s.email.smtp) s.email.smtp[field] = v;
  }

  const dbPass = getSetting(db, 'notify.smtp.pass');
  if (dbPass) s.email.smtp.pass = dbPass;

  // env มีผลเหนือ DB สำหรับค่าที่สำคัญ (รหัสผ่าน ฯลฯ)
  if (process.env.SMTP_PASS) s.email.smtp.pass = process.env.SMTP_PASS;
  s.email.hasPassword = Boolean(s.email.smtp.pass || process.env.SMTP_PASS);
  return s;
}

/** บันทึกบล็อกการตั้งค่า JSON (ผ่าน API — เฉพาะผู้ดูแล) */
export function saveSettingsBlock(db, key, value) {
  setSetting(db, `notify.${key}`, JSON.stringify(value));
}

/** เวอร์ชันที่ปลอดภัยสำหรับแสดงผล — ไม่มีรหัสผ่าน */
export function safeSettings(s) {
  const clone = structuredClone(s);
  const hasPass = Boolean(clone.email?.smtp?.pass || process.env.SMTP_PASS);
  if (clone.email && clone.email.smtp) delete clone.email.smtp.pass;
  if (clone.email) clone.email.hasPassword = hasPass;
  return clone;
}

/** สร้าง notification key แบบกำหนดได้ (deterministic) */
export function notificationKey(type, personId, termEndISO) {
  const prefix = {
    [NOTIFICATION_TYPES.SIX_MONTH]: 'TERM_EXPIRATION_6_MONTHS',
    [NOTIFICATION_TYPES.ONE_MONTH]: 'TERM_EXPIRATION_1_MONTH',
    [NOTIFICATION_TYPES.ANNUAL_SUMMARY]: 'TERM_EXPIRATION_ANNUAL_SUMMARY',
  }[type];
  return `${prefix}:${personId}:${termEndISO}`;
}
