// ============================================================
// ตัวขับเคลื่อนการแจ้งเตือนวาระ (Notification Engine)
// ------------------------------------------------------------
// หลักการ:
//   Term End Date (จาก CSV → วันที่อ้างอิง + วาระคงเหลือ) เป็นแหล่งความจริง
//   Eligibility = วันนี้ (Asia/Bangkok) เทียบกับวันสิ้นสุดวาระ
//   การห้ามส่งซ้ำ = notification_events.notification_key UNIQUE
//     + การ "claim" แถว (pending→sending) กันการส่งซ้ำตอนรันพร้อมกัน
// ============================================================

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { parseCSV } from '../js/csv.js';
import { buildRecords } from '../js/model.js';
import { todayInBangkok, addDuration, daysBetween, toISOString, formatThaiDate, formatDaysLeft, parseDate } from '../js/dates.js';

const formatDaysLeftText = (d) => formatDaysLeft(d, null, null);
import { CONFIG } from '../js/config.js';
import {
  openDatabase, getSetting, setSetting, audit, notificationCounts,
  NOTIFICATION_STATUS as ST,
} from './db.js';
import {
  loadSettings, safeSettings, classifyRole, POSITION_LABELS, POSITION_ROLES,
  NOTIFICATION_TYPES as T, notificationKey,
} from './settings.js';
import { deliverEmail, collectRecipients } from './email-service.js';
import { renderSixMonth, renderOneMonth, renderAnnual } from './email-templates.js';

/** สร้างโครงสร้างข้อมูลแจ้งเตือนมาตรฐานพร้อม Payload Hash สำหรับ Audit */
export function buildNotificationPayload({
  eventId = null,
  person,
  type,
  recipients = [],
  now = new Date(),
  runId = null,
  dataSource = 'csv',
}) {
  const today = todayInBangkok(now);
  const endDateISO = person.endDate ? toISOString(person.endDate) : (person.term_end_date || '');
  const daysLeft = person.daysLeft !== undefined && person.daysLeft !== null
    ? person.daysLeft
    : (endDateISO ? daysBetween(today, parseDate(endDateISO)) : null);

  const payload = {
    notificationId: eventId,
    personId: String(person.personId || person.tor || (person.id ? `row-${person.id}` : 'all')),
    personName: person.name || person.person_name || '—',
    position: person.positionLabel || person.position || '—',
    role: person.role || classifyRole(person.position) || 'all',
    village: person.village || '',
    tambon: person.tambon || person.subdistrict || '',
    amphoe: person.amphoe || person.district || '',
    province: person.province || '',
    termStartDate: person.startDate ? toISOString(person.startDate) : (person.term_start_date || null),
    termEndDate: endDateISO,
    calculatedRemainingDays: daysLeft,
    daysRemainingText: formatDaysLeft(daysLeft, today, parseDate(endDateISO)),
    statusText: person.statusText || (daysLeft === null ? 'ข้อมูลไม่สมบูรณ์' : daysLeft < 0 ? 'หมดวาระแล้ว' : daysLeft <= 30 ? 'ใกล้หมดวาระ' : 'ดำรงวาระ'),
    notificationThreshold: type,
    recipientEmail: recipients,
    generatedTimestamp: now.toISOString(),
    jobRunId: runId || `run-${now.getTime()}`,
    dataSource,
  };

  const hashStr = `${payload.personId}:${payload.termEndDate}:${payload.calculatedRemainingDays}:${payload.notificationThreshold}:${(payload.recipientEmail || []).join(',')}`;
  payload.payloadHash = createHash('sha256').update(hashStr, 'utf8').digest('hex');
  return payload;
}

/** อ่านข้อมูลบุคคลจาก CSV (ใช้ buildRecords เดิมของแดชบอร์ด) + อีเมล */
export function loadPeople({
  csvUrl = CONFIG.csvUrl,
  config = CONFIG,
  personEmailsPath = 'data/person-emails.csv',
  personEmails = {},
  now = new Date(),
} = {}) {
  const csv = readFileSync(csvUrl, 'utf8');
  const rows = parseCSV(csv);
  const records = buildRecords(rows, config, now);

  // คอลัมน์อีเมล (ถ้ามีใน CSV ต้นทาง: 'อีเมล' / 'email' / 'e-mail')
  const header = (rows[0] || []).map((h) => String(h).replace(/\s+/g, ' ').trim());
  const emailCol = header.findIndex((h) => /อีเมล|email|e-mail/i.test(h));
  const emailByRowId = new Map();
  if (emailCol >= 0) {
    for (let i = 1; i < rows.length; i++) emailByRowId.set(i, (rows[i][emailCol] || '').trim());
  }

  // ไฟล์อีเมลเสริม data/person-emails.csv (ชื่อ,อีเมล)
  const emailByName = {};
  if (existsSync(personEmailsPath)) {
    const erows = parseCSV(readFileSync(personEmailsPath, 'utf8'));
    const eh = (erows[0] || []).map((h) => String(h).replace(/\s+/g, ' ').trim());
    const nIdx = eh.findIndex((h) => /ชื่อ|name/i.test(h));
    const eIdx = eh.findIndex((h) => /อีเมล|email|e-mail/i.test(h));
    if (nIdx >= 0 && eIdx >= 0) {
      for (let i = 1; i < erows.length; i++) {
        const nm = (erows[i][nIdx] || '').trim();
        if (nm) emailByName[nm] = (erows[i][eIdx] || '').trim();
      }
    }
  }

  const today = todayInBangkok(now);
  return records.map((r) => {
    const role = classifyRole(r.position);
    if (!role) return null; // ไม่ใช่ 3 ตำแหน่งเป้าหมาย
    const personId = r.tor || `row-${r.id}`;
    const email =
      emailByRowId.get(r.id) ||
      emailByName[r.name] ||
      personEmails[r.name] ||
      personEmails[personId] ||
      personEmails[r.phone] ||
      '';
    return {
      ...r,
      personId,
      role,
      roleLabel: POSITION_LABELS[role],
      positionLabel: r.position,
      email,
      today,
    };
  }).filter(Boolean);
}

/** วันที่ใน Bangkok บวก n เดือนตามปฏิทิน (ปัดวันเกินเดือน) */
export function addMonths(date, n) {
  return addDuration(date, { years: 0, months: n, days: 0 });
}

/** อยู่ในช่วงแจ้งเตือนหรือไม่: today <= endDate <= today + n เดือน */
export function inWindow(person, today, months) {
  if (!person.endDate || person.daysLeft === null || !Number.isFinite(person.daysLeft)) return false;
  if (person.daysLeft < 0) return false; // หมดวาระแล้ว → ไม่แจ้งเตือน
  const horizon = addMonths(today, months);
  return daysBetween(today, person.endDate) <= daysBetween(today, horizon);
}

/** วันที่ Bangkok ของวันนี้ในรูปแบบ ISO */
function todayISO(now) {
  return toISOString(todayInBangkok(now));
}

function parseISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** ข้อมูลสรุปประจำปี */
export function buildAnnualSummary(people, now) {
  const today = todayInBangkok(now);
  const six = addMonths(today, 6);
  const one = addMonths(today, 1);

  const counts = {
    total: people.length,
    village: 0, kamnan: 0, assistant: 0,
    expiring6: 0, expiring1: 0, expired: 0, active: 0, incomplete: 0,
  };
  for (const p of people) {
    if (p.role === POSITION_ROLES.VILLAGE_HEADMAN) counts.village++;
    else if (p.role === POSITION_ROLES.KAMNAN) counts.kamnan++;
    else if (p.role === POSITION_ROLES.ASSISTANT_VILLAGE_HEADMAN) counts.assistant++;

    if (p.daysLeft === null || !Number.isFinite(p.daysLeft)) {
      counts.incomplete++;
      continue;
    }
    if (p.daysLeft < 0) { counts.expired++; continue; }
    if (daysBetween(today, p.endDate) <= daysBetween(today, one)) { counts.expiring1++; counts.expiring6++; }
    else if (daysBetween(today, p.endDate) <= daysBetween(today, six)) counts.expiring6++;
    else counts.active++;
  }

  const expiringList = people
    .filter((p) => p.endDate && p.daysLeft !== null && Number.isFinite(p.daysLeft) && p.daysLeft >= 0
      && daysBetween(today, p.endDate) <= daysBetween(today, six))
    .sort((a, b) => daysBetween(today, a.endDate) - daysBetween(today, b.endDate))
    .map((p) => ({
      name: p.name, positionLabel: p.position, endDateThai: formatThaiDate(p.endDate),
      endDateISO: toISOString(p.endDate), daysLeft: p.daysLeft, daysLeftText: formatDaysLeftText(p.daysLeft),
    }));

  return { year: today.y, today, counts, expiringList };
}

/**
 * สร้าง/จัดการเหตุการณ์แจ้งเตือนสำหรับคนคนหนึ่ง (6 เดือน / 1 เดือน)
 * @returns {Promise<{action: 'sent'|'failed'|'skipped'|'already'|'disabled'|'not_eligible', eventId?:number}>}
 */
async function processPersonReminder({ db, settings, person, type, now, today, runId = null, dataSource = 'csv' }) {
  const typeCfg = settings.notifications[type];
  if (!typeCfg || typeCfg.enabled === false) return { action: 'disabled' };

  // ตรวจสอบบทบาทที่กำหนด
  if (Array.isArray(typeCfg.roles) && typeCfg.roles.length > 0 && !typeCfg.roles.includes(person.role)) {
    return { action: 'not_eligible' };
  }

  const months = type === T.SIX_MONTH ? (typeCfg.thresholdMonths || settings.thresholds.sixMonthMonths || 6) : (typeCfg.thresholdMonths || settings.thresholds.oneMonthMonths || 1);
  if (!inWindow(person, today, months)) return { action: 'not_eligible' };

  const key = notificationKey(type, person.personId, toISOString(person.endDate));
  const adminTo = typeCfg.to || [];
  const adminCc = typeCfg.cc || [];
  const usePerson = typeCfg.includePerson !== false;
  const rawTo = [...adminTo];
  if (usePerson && person.email) rawTo.push(person.email);
  // กรองผู้รับที่รูปแบบไม่ถูกต้องออกก่อนบันทึก/ส่ง
  const rcpt = collectRecipients({ to: rawTo, cc: adminCc });
  const to = rcpt.to;
  const cc = rcpt.cc;
  const recipients = [...to, ...cc];

  const payload = buildNotificationPayload({
    person,
    type,
    recipients,
    now,
    runId,
    dataSource,
  });

  // 1) สร้างระเบียน (UNIQUE key) — ถ้ามีอยู่แล้ว = เคยจัดการแล้ว
  db.prepare(`
    INSERT OR IGNORE INTO notification_events
      (notification_type, person_id, person_name, position, term_start_date, term_end_date,
       recipient_email, notification_key, status, trigger_at, payload_snapshot, payload_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    type, person.personId, person.name, person.positionLabel,
    person.startDate ? toISOString(person.startDate) : null,
    toISOString(person.endDate),
    recipients.join(', '),
    key,
    now.toISOString(),
    JSON.stringify(payload),
    payload.payloadHash,
  );

  const row = db.prepare('SELECT * FROM notification_events WHERE notification_key = ?').get(key);
  if (!row) return { action: 'already' };
  payload.notificationId = row.id;

  // ถ้าส่งสำเร็จแล้ว → ไม่ต้องทำอะไร (ห้ามส่งซ้ำเด็ดขาด)
  if (row.status === ST.SENT) return { action: 'already' };

  // ไม่มีผู้รับที่ถูกต้อง
  if (!to.length && !cc.length) {
    if (rcpt.dropped.length) {
      // มีอีเมลแต่รูปแบบไม่ถูกต้อง → failed (พยายามส่งแต่ไม่สำเร็จ) และไม่ retry
      db.prepare(`
        UPDATE notification_events SET status = 'failed', error_message = ?,
               retry_count = ?, updated_at = datetime('now')
        WHERE id = ? AND status NOT IN ('sent','sending')
      `).run(`ไม่มีผู้รับที่ถูกต้อง (ตัดอีเมลที่รูปแบบไม่ถูกต้อง: ${rcpt.dropped.join(', ')})`, settings.email.maxRetries, row.id);
      audit(db, { actor: 'scheduler', action: `notification.failed:${type}`, detail: JSON.stringify({ ...payload, error: 'invalid recipient' }) });
      return { action: 'failed' };
    }
    // ไม่มีอีเมลในบันทึกเลย → skipped (บันทึกไว้เป็นหลักฐาน ไม่ส่งซ้ำ)
    db.prepare(`
      UPDATE notification_events SET status = 'skipped', error_message = 'ไม่มีอีเมลผู้รับ (บุคคลไม่มีอีเมล และไม่มีการกำหนดผู้รับฝ่ายบริหาร)',
             retry_count = ?, updated_at = datetime('now')
      WHERE id = ? AND status NOT IN ('sent','sending')
    `).run(settings.email.maxRetries, row.id);
    return { action: 'skipped' };
  }

  // 2) claim แถว (pending → sending) กันส่งซ้ำตอนรันพร้อมกัน
  const claim = db.prepare(`
    UPDATE notification_events SET status = 'sending', updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(row.id);
  if (claim.changes === 0) return { action: 'already' }; // มี process อื่นกำลังส่งอยู่

  // 3) ส่งอีเมล
  const render = type === T.SIX_MONTH ? renderSixMonth : renderOneMonth;
  const mail = render({ ...person, today }, { dashboardUrl: settings.dashboardUrl, customConfig: typeCfg });
  const res = await deliverEmail({
    db, settings,
    to, cc,
    subject: mail.subject, html: mail.html, text: mail.text,
    meta: { actor: 'scheduler', type, payload },
  });

  if (res.ok) {
    db.prepare(`
      UPDATE notification_events SET status = 'sent', provider_message_id = ?, error_message = NULL,
             updated_at = datetime('now')
      WHERE id = ?
    `).run(res.messageId || null, row.id);
    audit(db, { actor: 'scheduler', action: `notification.sent:${type}`, detail: JSON.stringify(payload) });
    return { action: 'sent', eventId: row.id };
  }

  // 4) ล้มเหลว → failed + retry_count (ถ้ายังไม่เกิน max จะลองใหม่ในรอบถัดไป)
  db.prepare(`
    UPDATE notification_events SET status = 'failed', error_message = ?,
           retry_count = retry_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(String(res.error || 'ส่งไม่สำเร็จ').slice(0, 1000), row.id);
  audit(db, { actor: 'scheduler', action: `notification.failed:${type}`, detail: JSON.stringify({ ...payload, error: res.error }) });
  return { action: 'failed', eventId: row.id };
}

/** ลองส่งซ้ำสำหรับแถว failed/pending ที่เหลือค้าง (ไม่เกิน maxRetries) */
async function retryStuckEvents({ db, settings, now, people }) {
  const stuck = db.prepare(`
    SELECT * FROM notification_events
    WHERE status IN ('failed','pending') AND retry_count < ?
    ORDER BY id ASC LIMIT 100
  `).all(settings.email.maxRetries);

  let sent = 0, failed = 0, skipped = 0;
  for (const row of stuck) {
    const claim = db.prepare(`
      UPDATE notification_events SET status = 'sending', updated_at = datetime('now')
      WHERE id = ? AND status = ?
    `).run(row.id, row.status);
    if (claim.changes === 0) continue;

    // สรุปประจำปี: ส่งซ้ำได้เฉพาะในวัน 31 ธ.ค. ของปีนั้นเท่านั้น (กันส่งสรุปเก่าช้า)
    if (row.notification_type === T.ANNUAL_SUMMARY) {
      const today = todayInBangkok(now);
      const evYear = Number(String(row.term_end_date).slice(0, 4));
      if (!(today.m === 12 && today.d === 31 && today.y === evYear)) {
        db.prepare(`UPDATE notification_events SET status='skipped', error_message='เกินช่วงเวลาสรุปประจำปี', retry_count=?, updated_at=datetime('now') WHERE id=?`)
          .run(settings.email.maxRetries, row.id);
        skipped++;
        continue;
      }
      const summary = buildAnnualSummary(people, now);
      const mail = renderAnnual(summary, { dashboardUrl: settings.dashboardUrl, customConfig: settings.notifications?.annual_summary });
      const recipients = (row.recipient_email || '').split(',').map((s) => s.trim()).filter(Boolean);
      const res = await deliverEmail({ db, settings, to: recipients, cc: [], subject: mail.subject, html: mail.html, text: mail.text, meta: { actor: 'scheduler', type: T.ANNUAL_SUMMARY, retry: true } });
      if (res.ok) {
        db.prepare(`UPDATE notification_events SET status='sent', provider_message_id=?, error_message=NULL, updated_at=datetime('now') WHERE id=?`).run(res.messageId || null, row.id);
        sent++;
      } else {
        db.prepare(`UPDATE notification_events SET status='failed', error_message=?, retry_count=retry_count+1, updated_at=datetime('now') WHERE id=?`).run(String(res.error || 'ส่งไม่สำเร็จ').slice(0, 1000), row.id);
        failed++;
      }
      continue;
    }

    // แจ้งเตือนรายบุคคล: ใช้ payload_snapshot หากมีเพื่อรักษาความสมบูรณ์ของข้อมูล
    let payload = null;
    let personObj = null;
    if (row.payload_snapshot) {
      try {
        payload = JSON.parse(row.payload_snapshot);
        personObj = {
          name: payload.personName,
          positionLabel: payload.position,
          position: payload.position,
          village: payload.village || '',
          tambon: payload.tambon || '',
          amphoe: payload.amphoe || '',
          province: payload.province || '',
          startDate: parseISO(payload.termStartDate),
          endDate: parseISO(payload.termEndDate),
          daysLeft: payload.calculatedRemainingDays,
          statusText: payload.statusText,
          today: todayInBangkok(now),
        };
      } catch {
        payload = null;
      }
    }

    if (!personObj) {
      const match = people.find((p) => String(p.personId) === String(row.person_id));
      personObj = match || {
        name: row.person_name, positionLabel: row.position,
        endDate: parseISO(row.term_end_date), startDate: parseISO(row.term_start_date),
        daysLeft: row.term_end_date ? daysBetween(todayInBangkok(now), parseISO(row.term_end_date)) : null,
        today: todayInBangkok(now),
        village: '', tambon: '', amphoe: '', province: '',
      };
      payload = buildNotificationPayload({
        eventId: row.id,
        person: personObj,
        type: row.notification_type,
        recipients: (row.recipient_email || '').split(',').map((s) => s.trim()).filter(Boolean),
        now,
        dataSource: 'retry',
      });
    }

    const render = row.notification_type === T.SIX_MONTH ? renderSixMonth : renderOneMonth;
    const mail = render(personObj, { dashboardUrl: settings.dashboardUrl, customConfig: settings.notifications?.[row.notification_type] });
    const recipients = (row.recipient_email || '').split(',').map((s) => s.trim()).filter(Boolean);
    const res = await deliverEmail({ db, settings, to: recipients, cc: [], subject: mail.subject, html: mail.html, text: mail.text, meta: { actor: 'scheduler', type: row.notification_type, retry: true, payload } });
    if (res.ok) {
      db.prepare(`UPDATE notification_events SET status='sent', provider_message_id=?, error_message=NULL, updated_at=datetime('now') WHERE id=?`).run(res.messageId || null, row.id);
      audit(db, { actor: 'scheduler', action: `notification.sent:${row.notification_type}`, detail: JSON.stringify(payload) });
      sent++;
    } else {
      db.prepare(`UPDATE notification_events SET status='failed', error_message=?, retry_count=retry_count+1, updated_at=datetime('now') WHERE id=?`).run(String(res.error || 'ส่งไม่สำเร็จ').slice(0, 1000), row.id);
      audit(db, { actor: 'scheduler', action: `notification.failed:${row.notification_type}`, detail: JSON.stringify({ ...payload, error: res.error }) });
      failed++;
    }
  }
  return { sent, failed, skipped };
}

/** สร้าง/ส่งสรุปประจำปี (31 ธ.ค.) */
async function processAnnualSummary({ db, settings, people, now }) {
  const cfg = settings.notifications.annual_summary;
  if (!cfg || cfg.enabled === false) return { action: 'disabled' };
  const today = todayInBangkok(now);
  if (!(today.m === 12 && today.d === 31)) return { action: 'not_dec31' };

  const summary = buildAnnualSummary(people, now);
  const key = notificationKey(T.ANNUAL_SUMMARY, 'all', `${summary.year}-12-31`);
  const to = [...(cfg.to || [])];
  const cc = cfg.cc || [];

  db.prepare(`
    INSERT OR IGNORE INTO notification_events
      (notification_type, person_id, person_name, position, term_start_date, term_end_date,
       recipient_email, notification_key, status, trigger_at, created_at, updated_at)
    VALUES ('annual_summary', 'all', 'Annual Summary', NULL, NULL, ?,
            ?, ?, 'pending', ?, datetime('now'), datetime('now'))
  `).run(`${summary.year}-12-31`, to.join(', '), key, now.toISOString());

  const row = db.prepare('SELECT * FROM notification_events WHERE notification_key = ?').get(key);
  if (!row) return { action: 'already' };
  if (row.status === ST.SENT) return { action: 'already' };
  if (!to.length && !cc.length) {
    db.prepare(`UPDATE notification_events SET status='skipped', error_message='ไม่ได้กำหนดผู้รับสรุปประจำปี', retry_count=?, updated_at=datetime('now') WHERE id=?`)
      .run(settings.email.maxRetries, row.id);
    return { action: 'skipped' };
  }

  const claim = db.prepare(`UPDATE notification_events SET status='sending', updated_at=datetime('now') WHERE id=? AND status='pending'`).run(row.id);
  if (claim.changes === 0) return { action: 'already' };

  const mail = renderAnnual(summary, { dashboardUrl: settings.dashboardUrl, customConfig: cfg });
  const res = await deliverEmail({ db, settings, to, cc, subject: mail.subject, html: mail.html, text: mail.text, meta: { actor: 'scheduler', type: T.ANNUAL_SUMMARY } });

  if (res.ok) {
    db.prepare(`UPDATE notification_events SET status='sent', provider_message_id=?, error_message=NULL, updated_at=datetime('now') WHERE id=?`)
      .run(res.messageId || null, row.id);
    audit(db, { actor: 'scheduler', action: 'notification.sent:annual_summary', detail: `${key} → ${to.join(', ')}`.slice(0, 500) });
    return { action: 'sent', eventId: row.id };
  }
  db.prepare(`UPDATE notification_events SET status='failed', error_message=?, retry_count=retry_count+1, updated_at=datetime('now') WHERE id=?`)
    .run(String(res.error || 'ส่งไม่สำเร็จ').slice(0, 1000), row.id);
  audit(db, { actor: 'scheduler', action: 'notification.failed:annual_summary', detail: `${key} — ${res.error}`.slice(0, 500) });
  return { action: 'failed', eventId: row.id };
}

/**
 * รันรอบการประเมินและส่งแจ้งเตือน 1 รอบ
 * @param {object} opts { db, settings, now, csvUrl, config, personEmailsPath, personEmails }
 * @returns {Promise<object>} สรุปผลรอบ
 */
export async function runCycle(opts = {}) {
  const db = opts.db || openDatabase();
  const settings = opts.settings || loadSettings(db);
  const now = opts.now || new Date();

  const started = Date.now();
  const today = todayInBangkok(now);
  const summary = { runAt: now.toISOString(), todayISO: todayISO(now), processed: 0, sent: 0, failed: 0, skipped: 0, already: 0, annual: null, errors: [] };

  try {
    const people = loadPeople({
      csvUrl: opts.csvUrl || CONFIG.csvUrl,
      config: opts.config || CONFIG,
      personEmailsPath: opts.personEmailsPath,
      personEmails: opts.personEmails || settings.personEmails || {},
      now,
    });

    // --- ลองส่งซ้ำรายการที่ค้างจากรอบก่อน (crash recovery / SMTP ล้ม) ก่อนจัดการใหม่ ---
    // (รันก่อน เพื่อไม่ให้รอบเดียวกัน retry รายการที่เพิ่ง failed ในรอบนี้)
    const retry = await retryStuckEvents({ db, settings, now, people });
    summary.sent += retry.sent;
    summary.failed += retry.failed;
    summary.skipped += retry.skipped;

    // --- แจ้งเตือนรายบุคคล: 6 เดือน และ 1 เดือน (อิสระต่อกัน) ---
    for (const person of people) {
      for (const type of [T.SIX_MONTH, T.ONE_MONTH]) {
        const r = await processPersonReminder({ db, settings, person, type, now, today });
        summary.processed++;
        if (r.action === 'sent') summary.sent++;
        else if (r.action === 'failed') summary.failed++;
        else if (r.action === 'skipped') summary.skipped++;
        else if (r.action === 'already') summary.already++;
      }
    }

    // --- สรุปประจำปี (31 ธ.ค. ตามเวลาไทย) ---
    summary.annual = await processAnnualSummary({ db, settings, people, now });

    setSetting(db, 'notify.scheduler.last_run_at', now.toISOString());
    setSetting(db, 'notify.scheduler.last_run_ms', String(Date.now() - started));
    audit(db, { actor: 'scheduler', action: 'scheduler.run', detail: JSON.stringify({ sent: summary.sent, failed: summary.failed, skipped: summary.skipped, processed: summary.processed }) });
  } catch (err) {
    summary.errors.push(String(err && err.message || err));
    audit(db, { actor: 'scheduler', action: 'scheduler.error', detail: String(err && err.message || err).slice(0, 500) });
  }
  return summary;
}

/** ภาพรวมสถานะสำหรับ API/แดชบอร์ด */
export function getNotificationStatus(db, settings = loadSettings(db)) {
  let people = [];
  try {
    people = loadPeople({ personEmails: settings.personEmails || {} });
  } catch {
    people = [];
  }
  const summary = buildAnnualSummary(people, new Date());
  return {
    settings: safeSettings(settings),
    counts: notificationCounts(db),
    eligible: {
      total: summary.counts.total,
      six_month: summary.counts.expiring6,
      one_month: summary.counts.expiring1,
      expired: summary.counts.expired,
      incomplete: summary.counts.incomplete,
      village: summary.counts.village,
      kamnan: summary.counts.kamnan,
      assistant: summary.counts.assistant,
    },
    lastRunAt: getSetting(db, 'notify.scheduler.last_run_at'),
    lastRunMs: Number(getSetting(db, 'notify.scheduler.last_run_ms') || 0),
  };
}

