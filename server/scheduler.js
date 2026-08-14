// ============================================================
// ตัวจัดตารางการแจ้งเตือน (Scheduler)
// ------------------------------------------------------------
// สองโหมด (ใช้กลไกเดียวกัน — idempotent ทั้งคู่):
//  1. โหมด server:  วนรันทุก SCHEDULER_TICK_MINUTES นาที (ค่าเริ่มต้น 5)
//                   เริ่มต้นเมื่อเปิด server.js (ปิดได้ด้วย ENABLE_SCHEDULER=false)
//  2. โหมด cron/CLI: node server/scheduler.js — รัน 1 รอบแล้วจบ
//                   ใช้ร่วมกับ cron:  0 0 * * *  cd /path && node server/scheduler.js
//
// ทั้งสองโหมดใช้ runCycle เดียวกัน ซึ่งมี UNIQUE key ในฐานข้อมูล
// → รันซ้ำกี่รอบก็ไม่ส่งอีเมลซ้ำ
// ============================================================

import { fileURLToPath } from 'node:url';
import { openDatabase, getSetting, setSetting } from './db.js';
import { loadSettings } from './settings.js';
import { runCycle, getNotificationStatus } from './notification-engine.js';

/**
 * สร้าง scheduler แบบวนรอบ
 * @param {object} opts { db, settings, tickMinutes, runNow }
 */
export function createScheduler(opts = {}) {
  const db = opts.db || openDatabase();
  const tickMinutes = opts.tickMinutes || 5;
  const intervalMs = tickMinutes * 60 * 1000;

  let timer = null;
  let running = false;
  let lastSummary = null;
  let nextRunAt = null;

  async function tick(now = new Date()) {
    if (running) return lastSummary; // กันการซ้อนรอบ
    running = true;
    try {
      lastSummary = await runCycle({ db, settings: opts.settings || loadSettings(db), now });
    } finally {
      running = false;
    }
    // คำนวณรอบถัดไป (เวลาไทย)
    nextRunAt = new Date(Date.now() + intervalMs);
    return lastSummary;
  }

  function start() {
    if (timer) return;
    // รอบแรก: รอ 10 วินาทีให้ server พร้อม แล้วรัน
    setTimeout(() => tick(), 10_000);
    timer = setInterval(() => tick(), intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return {
    db, tick, start, stop,
    get lastRunAt() { return lastSummary ? lastSummary.runAt : getSetting(db, 'notify.scheduler.last_run_at'); },
    get lastSummary() { return lastSummary; },
    get nextRunAt() { return nextRunAt; },
    status() { return getNotificationStatus(db); },
  };
}

/** โหมด CLI: รันหนึ่งรอบแล้วจบ (สำหรับ cron) */
export async function runOnce(cliOpts = {}) {
  const db = openDatabase();
  const settings = loadSettings(db);
  const summary = await runCycle({ db, settings, now: cliOpts.now || new Date() });
  console.log('[notify] ' + JSON.stringify(summary, null, 2));
  db.close();
  return summary;
}

// รันโดยตรง: node server/scheduler.js
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runOnce().then((s) => {
    process.exitCode = s.errors.length ? 1 : 0;
  });
}
