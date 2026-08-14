import { buildRecords } from '../js/model.js';
import { CONFIG } from '../js/config.js';
import { todayInBangkok, addDuration, daysBetween, toISOString, formatThaiDate, formatDaysLeft } from '../js/dates.js';
import {
  classifyRole, POSITION_LABELS, POSITION_ROLES,
  NOTIFICATION_TYPES as T, notificationKey,
} from './settings.js';
import { collectRecipients } from './email-service.js';
import { sendMail as smtpSend } from './smtp.js';
import { renderSixMonth, renderOneMonth, renderAnnual, validateRenderedEmail } from './email-templates.js';
import { loadCloudSettings } from './cloud-settings.js';
import { loadSheetRows } from './google-sheets.js';
import { buildNotificationPayload } from './notification-engine.js';

const ST = Object.freeze({
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

const formatDaysLeftText = (d) => formatDaysLeft(d, null, null);

function addMonths(date, n) {
  return addDuration(date, { years: 0, months: n, days: 0 });
}

function inWindow(person, today, months) {
  if (!person.endDate || person.daysLeft === null || !Number.isFinite(person.daysLeft)) return false;
  if (person.daysLeft < 0) return false;
  const horizon = addMonths(today, months);
  return daysBetween(today, person.endDate) <= daysBetween(today, horizon);
}

function todayISO(now) {
  return toISOString(todayInBangkok(now));
}

function parseISO(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

export async function loadCloudPeople({ rows, config = CONFIG, personEmails = {}, now = new Date() } = {}) {
  const sourceRows = rows || await loadSheetRows();
  const records = buildRecords(sourceRows, config, now);
  const header = (sourceRows[0] || []).map((h) => String(h).replace(/\s+/g, ' ').trim());
  const emailCol = header.findIndex((h) => /อีเมล|email|e-mail/i.test(h));
  const emailByRowId = new Map();
  if (emailCol >= 0) {
    for (let i = 1; i < sourceRows.length; i++) emailByRowId.set(i, (sourceRows[i][emailCol] || '').trim());
  }

  const today = todayInBangkok(now);
  return records.map((r) => {
    const role = classifyRole(r.position);
    if (!role) return null;
    const personId = r.tor || `row-${r.id}`;
    return {
      ...r,
      personId,
      role,
      roleLabel: POSITION_LABELS[role],
      positionLabel: r.position,
      email: emailByRowId.get(r.id) || personEmails[r.name] || personEmails[personId] || personEmails[r.phone] || '',
      today,
    };
  }).filter(Boolean);
}

export function buildCloudAnnualSummary(people, now) {
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

    if (p.daysLeft === null || !Number.isFinite(p.daysLeft)) { counts.incomplete++; continue; }
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
      name: p.name,
      positionLabel: p.position,
      endDateThai: formatThaiDate(p.endDate),
      endDateISO: toISOString(p.endDate),
      daysLeft: p.daysLeft,
      daysLeftText: formatDaysLeftText(p.daysLeft),
    }));
  return { year: today.y, today, counts, expiringList };
}

export async function deliverCloudEmail({ settings, to, cc = [], subject, html, text }) {
  const recipients = collectRecipients({ to, cc });
  if (!recipients.to.length && !recipients.cc.length) return { ok: false, error: 'ไม่มีผู้รับอีเมล' };
  const validation = validateRenderedEmail({ subject, html, text });
  if (!validation.ok) return { ok: false, error: `Email template validation failed: ${validation.errors.join('; ')}` };
  if (settings.email.transport !== 'smtp') return { ok: true, messageId: `console-${Date.now()}` };
  const from = settings.email.from;
  const fromStr = from.name && from.address ? `${from.name} <${from.address}>` : (from.address || from.name || '');
  try {
    const result = await smtpSend({
      host: settings.email.smtp.host,
      port: settings.email.smtp.port,
      secure: settings.email.smtp.secure,
      rejectUnauthorized: settings.email.smtp.rejectUnauthorized !== false,
      user: settings.email.smtp.user || '',
      pass: settings.email.smtp.pass || process.env.SMTP_PASS || '',
      from: fromStr,
      to: recipients.to,
      cc: recipients.cc,
      subject,
      html,
      text,
    });
    return { ok: true, messageId: result.messageId || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function processPersonReminder({ db, settings, person, type, now, today, runId = null, dataSource = 'google_sheets_csv' }) {
  const typeCfg = settings.notifications[type];
  if (!typeCfg || typeCfg.enabled === false) return { action: 'disabled' };
  if (Array.isArray(typeCfg.roles) && typeCfg.roles.length > 0 && !typeCfg.roles.includes(person.role)) return { action: 'not_eligible' };
  const months = type === T.SIX_MONTH ? (typeCfg.thresholdMonths || settings.thresholds.sixMonthMonths || 6) : (typeCfg.thresholdMonths || settings.thresholds.oneMonthMonths || 1);
  if (!inWindow(person, today, months)) return { action: 'not_eligible' };

  const key = notificationKey(type, person.personId, toISOString(person.endDate));
  const rcpt = collectRecipients({
    to: [...(typeCfg.to || []), ...(typeCfg.includePerson !== false && person.email ? [person.email] : [])],
    cc: typeCfg.cc || [],
  });
  const recipients = [...rcpt.to, ...rcpt.cc];

  const payload = buildNotificationPayload({
    person,
    type,
    recipients,
    now,
    runId,
    dataSource,
  });

  await db.insertEventIgnore({
    notification_type: type,
    person_id: person.personId,
    person_name: person.name,
    position: person.positionLabel,
    term_start_date: person.startDate ? toISOString(person.startDate) : null,
    term_end_date: toISOString(person.endDate),
    recipient_email: recipients.join(', '),
    notification_key: key,
    status: ST.PENDING,
    trigger_at: now.toISOString(),
    payload_snapshot: JSON.stringify(payload),
    payload_hash: payload.payloadHash,
  });

  const row = await db.getEventByKey(key);
  if (!row || row.status === ST.SENT) return { action: 'already' };
  payload.notificationId = row.id;

  if (!rcpt.to.length && !rcpt.cc.length) {
    await db.updateEvent(row.id, { status: ST.SKIPPED, error_message: 'ไม่มีอีเมลผู้รับ', retry_count: settings.email.maxRetries });
    return { action: 'skipped' };
  }
  const claimed = await db.claimEvent(row.id, ST.PENDING);
  if (!claimed) return { action: 'already' };
  const render = type === T.SIX_MONTH ? renderSixMonth : renderOneMonth;
  const mail = render({ ...person, today }, { dashboardUrl: settings.dashboardUrl, customConfig: typeCfg });
  const res = await deliverCloudEmail({ settings, to: rcpt.to, cc: rcpt.cc, subject: mail.subject, html: mail.html, text: mail.text });
  if (res.ok) {
    await db.updateEvent(row.id, { status: ST.SENT, provider_message_id: res.messageId || null, error_message: null });
    await db.audit({ actor: 'scheduler', action: `notification.sent:${type}`, detail: JSON.stringify(payload) });
    return { action: 'sent', eventId: row.id };
  }
  await db.updateEvent(row.id, { status: ST.FAILED, error_message: String(res.error || 'ส่งไม่สำเร็จ').slice(0, 1000), retry_count: (row.retry_count || 0) + 1 });
  await db.audit({ actor: 'scheduler', action: `notification.failed:${type}`, detail: JSON.stringify({ ...payload, error: res.error }) });
  return { action: 'failed', eventId: row.id };
}

async function retryStuckEvents({ db, settings, now, people }) {
  const stuck = await db.stuckEvents(settings.email.maxRetries);
  let sent = 0, failed = 0, skipped = 0;
  for (const row of stuck || []) {
    const claimed = await db.claimEvent(row.id, row.status);
    if (!claimed) continue;
    if (row.notification_type === T.ANNUAL_SUMMARY) {
      const today = todayInBangkok(now);
      const evYear = Number(String(row.term_end_date).slice(0, 4));
      if (!(today.m === 12 && today.d === 31 && today.y === evYear)) {
        await db.updateEvent(row.id, { status: ST.SKIPPED, error_message: 'เกินช่วงเวลาสรุปประจำปี', retry_count: settings.email.maxRetries });
        skipped++;
        continue;
      }
      const summary = buildCloudAnnualSummary(people, now);
      const mail = renderAnnual(summary, { dashboardUrl: settings.dashboardUrl, customConfig: settings.notifications?.annual_summary });
      const recipients = (row.recipient_email || '').split(',').map((s) => s.trim()).filter(Boolean);
      const res = await deliverCloudEmail({ settings, to: recipients, cc: [], subject: mail.subject, html: mail.html, text: mail.text });
      if (res.ok) { await db.updateEvent(row.id, { status: ST.SENT, provider_message_id: res.messageId || null, error_message: null }); sent++; }
      else { await db.updateEvent(row.id, { status: ST.FAILED, error_message: String(res.error || 'ส่งไม่สำเร็จ').slice(0, 1000), retry_count: (row.retry_count || 0) + 1 }); failed++; }
      continue;
    }

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
    const res = await deliverCloudEmail({ settings, to: recipients, cc: [], subject: mail.subject, html: mail.html, text: mail.text });
    if (res.ok) {
      await db.updateEvent(row.id, { status: ST.SENT, provider_message_id: res.messageId || null, error_message: null });
      await db.audit({ actor: 'scheduler', action: `notification.sent:${row.notification_type}`, detail: JSON.stringify(payload) });
      sent++;
    } else {
      await db.updateEvent(row.id, { status: ST.FAILED, error_message: String(res.error || 'ส่งไม่สำเร็จ').slice(0, 1000), retry_count: (row.retry_count || 0) + 1 });
      await db.audit({ actor: 'scheduler', action: `notification.failed:${row.notification_type}`, detail: JSON.stringify({ ...payload, error: res.error }) });
      failed++;
    }
  }
  return { sent, failed, skipped };
}

async function processAnnualSummary({ db, settings, people, now }) {
  const cfg = settings.notifications.annual_summary;
  if (!cfg || cfg.enabled === false) return { action: 'disabled' };
  const today = todayInBangkok(now);
  if (!(today.m === 12 && today.d === 31)) return { action: 'not_dec31' };
  const summary = buildCloudAnnualSummary(people, now);
  const key = notificationKey(T.ANNUAL_SUMMARY, 'all', `${summary.year}-12-31`);
  const to = [...(cfg.to || [])];
  const cc = cfg.cc || [];
  await db.insertEventIgnore({
    notification_type: T.ANNUAL_SUMMARY,
    person_id: 'all',
    person_name: 'Annual Summary',
    position: null,
    term_start_date: null,
    term_end_date: `${summary.year}-12-31`,
    recipient_email: [...to, ...cc].join(', '),
    notification_key: key,
    status: ST.PENDING,
    trigger_at: now.toISOString(),
  });
  const row = await db.getEventByKey(key);
  if (!row || row.status === ST.SENT) return { action: 'already' };
  if (!to.length && !cc.length) {
    await db.updateEvent(row.id, { status: ST.SKIPPED, error_message: 'ไม่ได้กำหนดผู้รับสรุปประจำปี', retry_count: settings.email.maxRetries });
    return { action: 'skipped' };
  }
  const claimed = await db.claimEvent(row.id, ST.PENDING);
  if (!claimed) return { action: 'already' };
  const mail = renderAnnual(summary, { dashboardUrl: settings.dashboardUrl, customConfig: cfg });
  const res = await deliverCloudEmail({ settings, to, cc, subject: mail.subject, html: mail.html, text: mail.text });
  if (res.ok) {
    await db.updateEvent(row.id, { status: ST.SENT, provider_message_id: res.messageId || null, error_message: null });
    await db.audit({ actor: 'scheduler', action: 'notification.sent:annual_summary', detail: `${key} -> ${to.join(', ')}`.slice(0, 500) });
    return { action: 'sent', eventId: row.id };
  }
  await db.updateEvent(row.id, { status: ST.FAILED, error_message: String(res.error || 'ส่งไม่สำเร็จ').slice(0, 1000), retry_count: (row.retry_count || 0) + 1 });
  await db.audit({ actor: 'scheduler', action: 'notification.failed:annual_summary', detail: `${key} - ${res.error}`.slice(0, 500) });
  return { action: 'failed', eventId: row.id };
}

export async function runCloudCycle({ db, settings, now = new Date(), rows = null, config = CONFIG } = {}) {
  const currentSettings = settings || await loadCloudSettings(db);
  const started = Date.now();
  const today = todayInBangkok(now);
  const summary = { runAt: now.toISOString(), todayISO: todayISO(now), processed: 0, sent: 0, failed: 0, skipped: 0, already: 0, annual: null, errors: [] };
  try {
    const people = await loadCloudPeople({ rows, config, personEmails: currentSettings.personEmails || {}, now });
    const retry = await retryStuckEvents({ db, settings: currentSettings, now, people });
    summary.sent += retry.sent;
    summary.failed += retry.failed;
    summary.skipped += retry.skipped;
    for (const person of people) {
      for (const type of [T.SIX_MONTH, T.ONE_MONTH]) {
        const r = await processPersonReminder({ db, settings: currentSettings, person, type, now, today });
        summary.processed++;
        if (r.action === 'sent') summary.sent++;
        else if (r.action === 'failed') summary.failed++;
        else if (r.action === 'skipped') summary.skipped++;
        else if (r.action === 'already') summary.already++;
      }
    }
    summary.annual = await processAnnualSummary({ db, settings: currentSettings, people, now });
    await db.setSetting('notify.scheduler.last_run_at', now.toISOString());
    await db.setSetting('notify.scheduler.last_run_ms', String(Date.now() - started));
    await db.audit({ actor: 'scheduler', action: 'scheduler.run', detail: JSON.stringify({ sent: summary.sent, failed: summary.failed, skipped: summary.skipped, processed: summary.processed }) });
  } catch (err) {
    summary.errors.push(String(err?.message || err));
    await db.audit({ actor: 'scheduler', action: 'scheduler.error', detail: String(err?.message || err).slice(0, 500) }).catch(() => {});
  }
  return summary;
}

export async function getCloudNotificationStatus(db, settings = null) {
  const currentSettings = settings || await loadCloudSettings(db);
  let people = [];
  try {
    people = await loadCloudPeople({ personEmails: currentSettings.personEmails || {} });
  } catch {
    people = [];
  }
  const summary = buildCloudAnnualSummary(people, new Date());
  return {
    settings: currentSettings,
    counts: await db.notificationCounts(),
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
    lastRunAt: await db.getSetting('notify.scheduler.last_run_at'),
    lastRunMs: Number(await db.getSetting('notify.scheduler.last_run_ms') || 0),
  };
}
