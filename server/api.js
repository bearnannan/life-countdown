// ============================================================
// REST API สำหรับระบบแจ้งเตือนวาระ
// ------------------------------------------------------------
//  - GET  /api/notifications/status     — สถานะ (อ่านได้ทั่วไป)
//  - POST /api/notifications/run        — สั่งรันรอบ (ผู้ดูแล)
//  - POST /api/notifications/settings   — แก้การตั้งค่า (ผู้ดูแล)
//  - GET  /api/notifications/events     — บันทึกการส่ง + audit (ผู้ดูแล)
//  - POST /api/send-email               — ส่งอีเมลทดสอบ (ผู้ดูแล)
//
// ความปลอดภัย:
//  - งานที่ไวต่อสิทธิ์ต้องใช้ ADMIN_TOKEN (Authorization: Bearer ...)
//  - SMTP_PASS ไม่ออกจากระบบ — ตั้งค่าผ่านตัวแปรสภาพแวดล้อมเท่านั้น
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { openDatabase, recentEvents, recentAudit, audit, setSetting } from './db.js';
import { loadSettings, saveSettingsBlock, safeSettings } from './settings.js';
import { runCycle, getNotificationStatus } from './notification-engine.js';
import { deliverEmail } from './email-service.js';
import { validateRenderedEmail } from './email-templates.js';

const JSON_LIMIT = 1024 * 1024; // 1 MB

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > JSON_LIMIT) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function addDays(date, days) {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function samplePersonForType(type, body = {}) {
  const today = new Date();
  const fallbackDays = type === 'one_month' ? 25 : 145;
  const daysLeft = body.sampleDaysLeft !== undefined ? Number(body.sampleDaysLeft) : fallbackDays;
  return {
    name: body.sampleName || 'นายสมชาย ใจดี',
    position: body.samplePosition || 'ผู้ใหญ่บ้าน',
    positionLabel: body.samplePosition || 'ผู้ใหญ่บ้าน',
    village: 'หมู่ที่ 3 บ้านหนองหอย',
    tambon: 'หนองหอย',
    amphoe: 'เมืองเชียงใหม่',
    province: 'เชียงใหม่',
    startDate: new Date('2021-01-01'),
    endDate: addDays(today, daysLeft),
    daysLeft,
    today,
    role: 'village_headman',
  };
}

function testEmailSubject(type, renderedSubject) {
  const clean = String(renderedSubject || '').replace(/^\[[^\]]+\]\s*/, '').replace(/^(ทดสอบ|test)[:\s]*/i, '').trim();
  return `[ทดสอบ] ${clean}`;
}

/** ตรวจสอบ token ผู้ดูแล (timing-safe) */
function isAdmin(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return { ok: false, code: 503, reason: 'ADMIN_TOKEN ยังไม่ได้ตั้งค่าในตัวแปรสภาพแวดล้อม — ตั้งค่าเพื่อเปิดใช้งาน API สำหรับผู้ดูแล' };
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-admin-token'] || '');
  if (!token) return { ok: false, code: 401, reason: 'ไม่พบ token (Authorization: Bearer <ADMIN_TOKEN>)' };
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, code: 401, reason: 'token ไม่ถูกต้อง' };
  return { ok: true };
}

/**
 * สร้างตัวจัดการคำขอ /api/*
 * @param {object} deps { db, scheduler }
 */
export function createApi(deps = {}) {
  const db = deps.db || openDatabase();

  async function handle(req, res, url) {
    const method = req.method || 'GET';
    const path = url.pathname;

    // ---------- สถานะ (สาธารณะ: ตัวเลขสรุปเท่านั้น) ----------
    if (method === 'GET' && path === '/api/notifications/status') {
      const status = getNotificationStatus(db);
      const out = {
        ...status,
        nextRunAt: deps.scheduler ? deps.scheduler.nextRunAt : null,
        schedulerEnabled: deps.scheduler ? true : false,
      };
      return json(res, 200, out);
    }

    const admin = isAdmin(req);
    if (!admin.ok) return json(res, admin.code, { error: admin.reason });

    // ---------- สั่งรันรอบ ----------
    if (method === 'POST' && path === '/api/notifications/run') {
      audit(db, { actor: 'admin', action: 'notifications.run_requested', detail: 'manual trigger via API' });
      const summary = await runCycle({ db, settings: loadSettings(db), now: new Date() });
      return json(res, 200, { ok: true, summary });
    }

    // ---------- แก้การตั้งค่าแจ้งเตือน ----------
    if (method === 'POST' && path === '/api/notifications/settings') {
      const body = await readBody(req);
      const allowed = { notifications: 1, thresholds: 1, dashboardUrl: 1, personEmails: 1, email: 1 };
      for (const key of Object.keys(body)) {
        if (!allowed[key]) {
          return json(res, 400, { error: `ไม่อนุญาตให้แก้คีย์ "${key}"` });
        }
        if (key === 'email' && body.email && body.email.smtp) {
          const newPass = body.email.smtp.new_password || body.email.smtp.pass || body.email.smtp.password;
          if (typeof newPass === 'string' && newPass.trim().length > 0) {
            setSetting(db, 'notify.smtp.pass', newPass.trim());
            audit(db, { actor: 'admin', action: 'smtp.password_updated', detail: 'password updated via admin settings UI' });
          }
          delete body.email.smtp.pass;
          delete body.email.smtp.password;
          delete body.email.smtp.new_password;
        }
        saveSettingsBlock(db, key, body[key]);
      }
      audit(db, { actor: 'admin', action: 'notifications.settings_updated', detail: Object.keys(body).join(',') });
      return json(res, 200, { ok: true, settings: safeSettings(loadSettings(db)) });
    }

    // ---------- บันทึกการส่ง + audit ----------
    if (method === 'GET' && path === '/api/notifications/events') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      return json(res, 200, { events: recentEvents(db, limit), audit: recentAudit(db, Math.min(200, limit)) });
    }

    // ---------- ลองส่งใหม่ (Retry Failed Events) ----------
    if (method === 'POST' && path === '/api/notifications/retry') {
      const body = await readBody(req);
      const eventId = body.eventId;
      if (eventId) {
        db.prepare("UPDATE notification_events SET status = 'pending', retry_count = 0, error_message = NULL, updated_at = datetime('now') WHERE id = ?").run(eventId);
      } else {
        db.prepare("UPDATE notification_events SET status = 'pending', retry_count = 0, error_message = NULL, updated_at = datetime('now') WHERE status = 'failed'").run();
      }
      audit(db, { actor: 'admin', action: 'notifications.retry', detail: eventId ? `event #${eventId}` : 'all failed' });
      const summary = await runCycle({ db, settings: loadSettings(db), now: new Date() });
      return json(res, 200, { ok: true, summary });
    }

    // ---------- แสดงตัวอย่างอีเมล (Preview) ----------
    if (method === 'POST' && path === '/api/notifications/preview') {
      const body = await readBody(req);
      const settings = loadSettings(db);
      const type = body.type || 'six_month';

      let people = [];
      try { const { loadPeople } = await import('./notification-engine.js'); people = loadPeople({ personEmails: settings.personEmails || {} }); } catch {}

      let person = null;
      let dataSource = 'sample_test';
      if (body.sampleName || body.samplePosition || body.sampleDaysLeft !== undefined) {
        person = samplePersonForType(type, body);
      } else if (type === 'one_month') {
        const real = people.find((p) => p.endDate && p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 30);
        if (real) { person = real; dataSource = 'local_csv'; }
      } else if (type === 'six_month') {
        const real = people.find((p) => p.endDate && p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 180);
        if (real) { person = real; dataSource = 'local_csv'; }
      }
      if (!person) person = samplePersonForType(type, body);

      const customConfig = {
        subject: body.subject || undefined,
        templateHtml: body.templateHtml || undefined,
      };

      let rendered;
      if (type === 'annual_summary') {
        const { buildAnnualSummary, renderAnnual } = await import('./email-templates.js');
        const summary = buildAnnualSummary ? buildAnnualSummary(people, new Date()) : {
          year: new Date().getFullYear(),
          total: 181,
          counts: { village: 120, kamnan: 21, assistant: 40, expiring6: 12, expiring1: 3, expired: 0, active: 166, incomplete: 0 },
          expiringList: [
            { name: 'นายสมชาย ใจดี', positionLabel: 'ผู้ใหญ่บ้าน', endDateThai: '31 ธันวาคม 2569', daysLeft: 145, daysLeftText: 'เหลือ 145 วัน (ประมาณ 4 เดือน)' },
          ],
        };
        rendered = renderAnnual(summary, { dashboardUrl: settings.dashboardUrl, customConfig });
      } else if (type === 'one_month') {
        const { renderOneMonth } = await import('./email-templates.js');
        rendered = renderOneMonth(person, { dashboardUrl: settings.dashboardUrl, customConfig });
      } else {
        const { renderSixMonth } = await import('./email-templates.js');
        rendered = renderSixMonth(person, { dashboardUrl: settings.dashboardUrl, customConfig });
      }

      const validation = validateRenderedEmail(rendered);
      if (!validation.ok) {
        return json(res, 422, { ok: false, error: `Email template validation failed: ${validation.errors.join('; ')}` });
      }
      return json(res, 200, { ok: true, subject: rendered.subject, html: rendered.html, text: rendered.text });
    }

    // ---------- ส่งอีเมลทดสอบ (ใช้ SMTP/เทมเพลตปัจจุบัน) ----------
    if (method === 'POST' && (path === '/api/send-email' || path === '/api/send-test-email')) {
      const body = await readBody(req);
      const to = Array.isArray(body.to) ? body.to : String(body.to || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!to.length) return json(res, 400, { error: 'ต้องระบุผู้รับ (to)' });
      const settings = loadSettings(db);

      const type = body.type || 'six_month';
      let people = [];
      try { const { loadPeople } = await import('./notification-engine.js'); people = loadPeople({ personEmails: settings.personEmails || {} }); } catch {}

      let person = null;
      let dataSource = 'sample_test';
      if (body.sampleName || body.samplePosition || body.sampleDaysLeft !== undefined) {
        person = samplePersonForType(type, body);
      } else if (type === 'one_month') {
        const real = people.find((p) => p.endDate && p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 30);
        if (real) { person = real; dataSource = 'local_csv'; }
      } else if (type === 'six_month') {
        const real = people.find((p) => p.endDate && p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 180);
        if (real) { person = real; dataSource = 'local_csv'; }
      }
      if (!person) person = samplePersonForType(type, body);

      const typeCfg = settings.notifications[type] || {};
      const customConfig = {
        subject: body.subject || typeCfg.subject || undefined,
        templateHtml: body.templateHtml || typeCfg.templateHtml || undefined,
      };

      let rendered;
      if (type === 'annual_summary') {
        const { buildAnnualSummary, renderAnnual } = await import('./email-templates.js');
        const summary = buildAnnualSummary ? buildAnnualSummary(people, new Date()) : {
          year: new Date().getFullYear(),
          total: 181,
          counts: { village: 120, kamnan: 21, assistant: 40, expiring6: 12, expiring1: 3, expired: 0, active: 166, incomplete: 0 },
          expiringList: [
            { name: 'นายสมชาย ใจดี', positionLabel: 'ผู้ใหญ่บ้าน', endDateThai: '31 ธันวาคม 2569', daysLeft: 145, daysLeftText: 'เหลือ 145 วัน (ประมาณ 4 เดือน)' },
          ],
        };
        rendered = renderAnnual(summary, { dashboardUrl: settings.dashboardUrl, customConfig });
      } else if (type === 'one_month') {
        const { renderOneMonth } = await import('./email-templates.js');
        rendered = renderOneMonth(person, { dashboardUrl: settings.dashboardUrl, customConfig });
      } else {
        const { renderSixMonth } = await import('./email-templates.js');
        rendered = renderSixMonth(person, { dashboardUrl: settings.dashboardUrl, customConfig });
      }

      const { buildNotificationPayload } = await import('./notification-engine.js');
      const payload = buildNotificationPayload({ person, type, recipients: to, now: new Date(), dataSource });

      const resMail = await deliverEmail({
        db, settings, to, cc: [],
        subject: testEmailSubject(type, rendered.subject),
        html: rendered.html,
        text: rendered.text,
        meta: { actor: 'admin', type: `test_${type}` },
      });
      audit(db, { actor: 'admin', action: 'email.test', detail: resMail.ok ? `sent to ${to.join(',')}` : `failed: ${resMail.error}` });
      return json(res, resMail.ok ? 200 : 502, { ok: resMail.ok, messageId: resMail.messageId || null, error: resMail.error || null });
    }

    return json(res, 404, { error: 'ไม่พบ endpoint' });
  }

  return handle;
}
