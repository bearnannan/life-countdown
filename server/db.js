// ============================================================
// ฐานข้อมูล — ใช้ node:sqlite (built-in ใน Node ≥ 22.5, ไม่มีแพ็กเกจภายนอก)
// ------------------------------------------------------------
// ฐานข้อมูลเป็น "แหล่งความจริง" สำหรับการป้องกันอีเมลซ้ำ:
// notification_events.notification_key มี UNIQUE constraint
// → การ INSERT แบบ OR IGNORE รับประกันว่าแต่ละคีย์จะถูกส่งครั้งเดียว
//   แม้รันหลายรอบพร้อมกัน (concurrent execution)
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTIFICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

const MIGRATIONS = [
  // ---------- system_settings: การตั้งค่าระบบ (SMTP, ผู้รับ, เปิด/ปิด, เกณฑ์) ----------
  `CREATE TABLE IF NOT EXISTS system_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ---------- notification_events: บันทึกการส่งแจ้งเตือน (แหล่งความจริงการห้ามซ้ำ) ----------
  `CREATE TABLE IF NOT EXISTS notification_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_type   TEXT NOT NULL,               -- six_month | one_month | annual_summary
    person_id           TEXT,                        -- รหัส/ลำดับคน (จาก CSV)
    person_name         TEXT,
    position            TEXT,
    term_start_date     TEXT,                        -- YYYY-MM-DD (ถ้ามี)
    term_end_date       TEXT NOT NULL,               -- YYYY-MM-DD — แหล่งความจริง
    recipient_email     TEXT NOT NULL,
    notification_key    TEXT NOT NULL UNIQUE,        -- เช่น TERM_EXPIRATION_6_MONTHS:{personId}:{endDate}
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sending','sent','failed','skipped')),
    trigger_at          TEXT,                        -- เวลาที่เข้าเงื่อนไข (ISO)
    provider_message_id TEXT,
    error_message       TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    payload_snapshot   TEXT,                        -- JSON snapshot of complete notification payload
    payload_hash       TEXT,                        -- SHA-256 hash of notification payload
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notif_type_status ON notification_events (notification_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_end_date   ON notification_events (term_end_date)`,

  // ---------- audit_log: ร่องรอยการดำเนินการของผู้ดูแล ----------
  `CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor      TEXT NOT NULL DEFAULT 'system',
    action     TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at)`,
];

/** เปิดฐานข้อมูล (สร้างไฟล์/ไดเรกทอรีและ schema หากยังไม่มี) */
export function openDatabase(path = process.env.NOTIFY_DB_PATH || 'data/notifications.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  for (const sql of MIGRATIONS) db.exec(sql);
  try { db.exec('ALTER TABLE notification_events ADD COLUMN payload_snapshot TEXT;'); } catch {}
  try { db.exec('ALTER TABLE notification_events ADD COLUMN payload_hash TEXT;'); } catch {}
  return db;
}

/** อ่านค่าเดียว (string) จาก system_settings */
export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/** อ่านค่าทุก key ที่ขึ้นต้นด้วย prefix */
export function getSettingsByPrefix(db, prefix) {
  const rows = db.prepare('SELECT key, value FROM system_settings WHERE key LIKE ?').all(`${prefix}%`);
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** บันทึกค่า (upsert) ลง system_settings */
export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, String(value));
}

/** เพิ่มบันทึก audit */
export function audit(db, { actor = 'system', action, detail = null }) {
  db.prepare('INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)').run(actor, action, detail);
}

/** จำนวนระเบียนแจ้งเตือนแบ่งตามชนิด/สถานะ */
export function notificationCounts(db) {
  const rows = db.prepare(`
    SELECT notification_type, status, COUNT(*) AS n
    FROM notification_events GROUP BY notification_type, status
  `).all();
  const out = { six_month: {}, one_month: {}, annual_summary: {} };
  for (const r of rows) {
    out[r.notification_type] = out[r.notification_type] || {};
    out[r.notification_type][r.status] = r.n;
  }
  return out;
}

/** ระเบียนแจ้งเตือนล่าสุด (สำหรับหน้าแดชบอร์ด/ทดสอบ) */
export function recentEvents(db, limit = 50) {
  return db.prepare(`
    SELECT * FROM notification_events
    ORDER BY id DESC LIMIT ?
  `).all(limit);
}

/** ระเบียน audit ล่าสุด */
export function recentAudit(db, limit = 50) {
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
}
