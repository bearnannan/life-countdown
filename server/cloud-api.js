import { timingSafeEqual } from 'node:crypto';
import { createSupabaseDb } from './supabase-rest.js';
import { loadCloudSettings, saveCloudSettingsBlock, safeSettings } from './cloud-settings.js';
import { runCloudCycle, getCloudNotificationStatus, deliverCloudEmail, loadCloudPeople, buildCloudAnnualSummary } from './cloud-notification-engine.js';
import { loadSheetCsv } from './google-sheets.js';
import { validateRenderedEmail, renderAnnual, renderOneMonth, renderSixMonth } from './email-templates.js';
import { buildNotificationPayload } from './notification-engine.js';

const JSON_LIMIT = 1024 * 1024;

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.statusCode = code;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > JSON_LIMIT) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function adminCheck(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return { ok: false, code: 503, reason: 'ADMIN_TOKEN ยังไม่ได้ตั้งค่า' };
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-admin-token'] || '');
  if (!token) return { ok: false, code: 401, reason: 'ไม่พบ token (Authorization: Bearer <ADMIN_TOKEN>)' };
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, code: 401, reason: 'token ไม่ถูกต้อง' };
  return { ok: true };
}

function cronCheck(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return { ok: false, code: 503, reason: 'CRON_SECRET ยังไม่ได้ตั้งค่า' };
  const header = req.headers.authorization || '';
  if (header !== `Bearer ${expected}`) return { ok: false, code: 401, reason: 'Unauthorized cron request' };
  return { ok: true };
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

async function findPersonForPreview(type, body, settings) {
  if (body.sampleName || body.samplePosition || body.sampleDaysLeft !== undefined) {
    return { person: samplePersonForType(type, body), dataSource: 'sample_test' };
  }
  let people = [];
  try {
    people = await loadCloudPeople({ personEmails: settings.personEmails || {} });
  } catch {
    people = [];
  }
  if (type === 'one_month') {
    const real = people.find((p) => p.endDate && p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 30);
    if (real) return { person: real, dataSource: 'google_sheets_csv' };
  } else if (type === 'six_month') {
    const real = people.find((p) => p.endDate && p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 180);
    if (real) return { person: real, dataSource: 'google_sheets_csv' };
  }
  return { person: samplePersonForType(type, body), dataSource: 'sample_test' };
}

async function renderPreviewEmailWithType(type, body, settings, person) {
  const customConfig = {
    subject: body.subject || undefined,
    templateHtml: body.templateHtml || undefined,
  };
  if (type === 'annual_summary') {
    let people = [];
    try { people = await loadCloudPeople({ personEmails: settings.personEmails || {} }); } catch {}
    const summary = buildCloudAnnualSummary(people, new Date());
    return renderAnnual(summary, { dashboardUrl: settings.dashboardUrl, customConfig });
  }
  return type === 'one_month'
    ? renderOneMonth(person, { dashboardUrl: settings.dashboardUrl, customConfig })
    : renderSixMonth(person, { dashboardUrl: settings.dashboardUrl, customConfig });
}

async function renderPreviewEmail(type, body, settings) {
  const { person } = await findPersonForPreview(type, body, settings);
  return renderPreviewEmailWithType(type, body, settings, person);
}

export async function handleCloudApi(req, res, route) {
  try {
    const db = createSupabaseDb();
    const method = req.method || 'GET';

    if (method === 'GET' && route === 'source/vara-csv') {
      return sendText(res, 200, await loadSheetCsv(), 'text/csv; charset=utf-8');
    }

    if (method === 'GET' && route === 'notifications/status') {
      const status = await getCloudNotificationStatus(db);
      return sendJson(res, 200, {
        ...status,
        settings: safeSettings(status.settings),
        nextRunAt: null,
        schedulerEnabled: true,
      });
    }

    if (route === 'cron/notifications') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const cron = cronCheck(req);
      if (!cron.ok) return sendJson(res, cron.code, { error: cron.reason });
      const summary = await runCloudCycle({ db, settings: await loadCloudSettings(db), now: new Date() });
      return sendJson(res, 200, { ok: !summary.errors.length, summary });
    }

    const admin = adminCheck(req);
    if (!admin.ok) return sendJson(res, admin.code, { error: admin.reason });

    if (method === 'POST' && route === 'notifications/run') {
      await db.audit({ actor: 'admin', action: 'notifications.run_requested', detail: 'manual trigger via Vercel API' });
      const summary = await runCloudCycle({ db, settings: await loadCloudSettings(db), now: new Date() });
      return sendJson(res, 200, { ok: true, summary });
    }

    if (method === 'POST' && route === 'notifications/settings') {
      const body = await readBody(req);
      const allowed = { notifications: 1, thresholds: 1, dashboardUrl: 1, personEmails: 1, email: 1 };
      for (const key of Object.keys(body)) {
        if (!allowed[key]) return sendJson(res, 400, { error: `ไม่อนุญาตให้แก้คีย์ "${key}"` });
        if (key === 'email' && body.email?.smtp) {
          const newPass = body.email.smtp.new_password || body.email.smtp.pass || body.email.smtp.password;
          if (typeof newPass === 'string' && newPass.trim()) {
            await db.setSetting('notify.smtp.pass', newPass.trim());
            await db.audit({ actor: 'admin', action: 'smtp.password_updated', detail: 'password updated via admin settings UI' });
          }
          delete body.email.smtp.pass;
          delete body.email.smtp.password;
          delete body.email.smtp.new_password;
        }
        await saveCloudSettingsBlock(db, key, body[key]);
      }
      await db.audit({ actor: 'admin', action: 'notifications.settings_updated', detail: Object.keys(body).join(',') });
      return sendJson(res, 200, { ok: true, settings: safeSettings(await loadCloudSettings(db)) });
    }

    if (method === 'GET' && route === 'notifications/events') {
      const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
      return sendJson(res, 200, { events: await db.recentEvents(limit), audit: await db.recentAudit(Math.min(200, limit)) });
    }

    if (method === 'POST' && route === 'notifications/retry') {
      const body = await readBody(req);
      await db.resetFailed(body.eventId || null);
      await db.audit({ actor: 'admin', action: 'notifications.retry', detail: body.eventId ? `event #${body.eventId}` : 'all failed' });
      const summary = await runCloudCycle({ db, settings: await loadCloudSettings(db), now: new Date() });
      return sendJson(res, 200, { ok: true, summary });
    }

    if (method === 'POST' && route === 'notifications/preview') {
      const body = await readBody(req);
      const settings = await loadCloudSettings(db);
      const type = body.type || 'six_month';
      const rendered = await renderPreviewEmail(type, body, settings);
      const validation = validateRenderedEmail(rendered);
      if (!validation.ok) return sendJson(res, 422, { ok: false, error: `Email template validation failed: ${validation.errors.join('; ')}` });
      return sendJson(res, 200, { ok: true, subject: rendered.subject, html: rendered.html, text: rendered.text });
    }

    if (method === 'POST' && route === 'send-test-email') {
      const body = await readBody(req);
      const to = Array.isArray(body.to) ? body.to : String(body.to || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!to.length) return sendJson(res, 400, { error: 'ต้องระบุผู้รับ (to)' });
      const settings = await loadCloudSettings(db);
      const type = body.type || 'six_month';
      const { person, dataSource } = await findPersonForPreview(type, body, settings);
      const rendered = await renderPreviewEmailWithType(type, body, settings, person);
      const payload = buildNotificationPayload({ person, type, recipients: to, now: new Date(), dataSource });
      const resMail = await deliverCloudEmail({ settings, to, cc: [], subject: testEmailSubject(type, rendered.subject), html: rendered.html, text: rendered.text });
      await db.audit({ actor: 'admin', action: 'email.test', detail: JSON.stringify({ ...payload, ok: resMail.ok, messageId: resMail.messageId || null, error: resMail.error || null }) });
      return sendJson(res, resMail.ok ? 200 : 502, { ok: resMail.ok, messageId: resMail.messageId || null, error: resMail.error || null, payload });
    }

    return sendJson(res, 404, { error: 'ไม่พบ endpoint' });
  } catch (err) {
    return sendJson(res, 500, { error: err?.message || String(err) });
  }
}
