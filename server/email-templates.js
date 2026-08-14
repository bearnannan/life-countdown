// ============================================================
// เทมเพลตอีเมลแจ้งเตือนวาระ — HTML แบบ inline CSS รองรับ Gmail/Outlook
// ------------------------------------------------------------
// - ใช้ <table> (ไม่ใช่ flex/grid) เพื่อความเข้ากันได้กับ Outlook
// - สี/แบรนด์อ้างอิงจากแดชบอร์ด: เขียว #16a34a / เหลือง #d97706 / แดง #dc2626
// - ทุกเทมเพลตมีเวอร์ชันข้อความธรรมดา (text) กำกับไว้ด้วย
// ============================================================

import { formatThaiDate, toISOString, formatDaysLeft, parseDate } from '../js/dates.js';

const BRAND = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
  slate: '#475569',
  bg: '#f6f7f9',
  border: '#e2e8f0',
};

/** หนี HTML เพื่อกัน XSS/injection จากข้อมูลบุคคล */
export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toYmd(value) {
  if (!value) return null;
  if (Number.isInteger(value.y) && Number.isInteger(value.m) && Number.isInteger(value.d)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
  }
  if (typeof value === 'string') return parseDate(value);
  return null;
}

const thaiDate = (d) => {
  const ymd = toYmd(d);
  return ymd ? formatThaiDate(ymd) : '—';
};
const isoDate = (d) => {
  const ymd = toYmd(d);
  return ymd ? toISOString(ymd) : '';
};

function publicActionUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return '';
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return '';
    return url.href;
  } catch {
    return '';
  }
}

/** โครงหลักของอีเมล (table 760px, responsive) */
function layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};padding:16px 8px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background-color:#ffffff;border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
        <tr><td style="background-color:${BRAND.green};padding:16px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#ffffff;font-size:18px;font-weight:bold;">ระบบแจ้งเตือนวาระการดำรงตำแหน่ง</td>
              <td align="right" style="color:#e8f5ec;font-size:12px;">Term Expiration Notices</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid ${BRAND.border};color:${BRAND.slate};font-size:12px;">
          อีเมลนี้ส่งโดยอัตโนมัติจากระบบติดตามวาระการดำรงตำแหน่ง — กรุณาอย่าตอบกลับอีเมลนี้โดยตรง
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** การ์ดข้อมูลบุคคลที่ใช้ร่วมกันในเทมเพลตแจ้งเตือนรายบุคคล */
function personCard(p, tone) {
  const color = tone === 'red' ? BRAND.red : BRAND.amber;
  const badgeText = p.daysLeft < 0 ? 'หมดวาระแล้ว' : p.daysLeft === 0 ? 'หมดวาระวันนี้' : `เหลือ ${p.daysLeft} วัน`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-left:4px solid ${color};border-radius:6px;margin-bottom:16px;">
    <tr><td style="padding:16px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:17px;font-weight:bold;color:#0f172a;">${esc(p.name)}</td>
          <td align="right"><span style="display:inline-block;background-color:${color};color:#ffffff;font-size:12px;font-weight:bold;padding:4px 10px;border-radius:12px;">${esc(badgeText)}</span></td>
        </tr>
        <tr><td colspan="2" style="font-size:13px;color:${BRAND.slate};padding-top:2px;">${esc(p.positionLabel)} · ${esc(p.areaLabel || '')}</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:13px;color:#334155;">
        <tr>
          <td style="padding:4px 0;width:50%;">วันเริ่มวาระ: <b>${esc(p.startDateThai)}</b></td>
          <td style="padding:4px 0;width:50%;">วันสิ้นสุดวาระ: <b>${esc(p.endDateThai)}</b></td>
        </tr>
        <tr>
          <td style="padding:4px 0;">วันคงเหลือ: <b>${esc(p.daysLeftText)}</b></td>
          <td style="padding:4px 0;">สถานะ: <b>${esc(p.statusText)}</b></td>
        </tr>
      </table>
    </td></tr>
  </table>`;
}

/** แปลงข้อมูลบุคคล → ฟิลด์ที่เทมเพลตใช้ */
export function templatePerson(p) {
  const daysLeft = p.daysLeft ?? null;
  const monthsLeft = daysLeft !== null && daysLeft >= 0 ? Math.round(daysLeft / 30.4375) : 0;
  const todayYmd = toYmd(p.today);
  const endDateYmd = toYmd(p.endDate);
  const daysLeftText = formatDaysLeft(p.daysLeft, todayYmd, endDateYmd);
  const statusText = p.statusText || (daysLeft === null ? 'ข้อมูลไม่สมบูรณ์' : daysLeft < 0 ? 'หมดวาระแล้ว' : daysLeft <= 30 ? 'ใกล้หมดวาระ' : 'ดำรงวาระ');
  return {
    person_name: p.name || '—',
    position: p.positionLabel || p.position || '—',
    village: p.village || '—',
    subdistrict: p.tambon || p.subdistrict || '—',
    district: p.amphoe || p.district || '—',
    province: p.province || '—',
    term_start_date: thaiDate(p.startDate),
    term_end_date: thaiDate(p.endDate),
    days_left: daysLeft !== null ? String(daysLeft) : '—',
    days_remaining: daysLeftText,
    status: statusText,
    months_left: String(monthsLeft),
    notification_type: p.notification_type || 'แจ้งเตือนวาระ',
    year: String(p.year || new Date().getFullYear()),
    total_count: String(p.total_count ?? '—'),
    six_month_count: String(p.six_month_count ?? '—'),
    one_month_count: String(p.one_month_count ?? '—'),
    expired_count: String(p.expired_count ?? '—'),
    incomplete_count: String(p.incomplete_count ?? '—'),
    action_url: p.action_url || p.dashboardUrl || '',
    // ฟิลด์เดิมสำหรับ layout
    name: p.name || '—',
    positionLabel: p.positionLabel || p.position || '—',
    areaLabel: [p.village, p.tambon, p.amphoe, p.province].filter(Boolean).join(' · '),
    startDateThai: thaiDate(p.startDate),
    endDateThai: thaiDate(p.endDate),
    endDateISO: isoDate(p.endDate),
    daysLeft: p.daysLeft,
    daysLeftText,
    statusText,
  };
}

/** แทนที่ตัวแปรไดนามิกในข้อความเทมเพลต เช่น {{person_name}} */
export function interpolateTemplate(str, data = {}, options = {}) {
  if (!str) return '';
  const escapeValues = options.escapeValues === true;
  return String(str).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (data[key] === undefined || data[key] === null) return match;
    const value = String(data[key]);
    return escapeValues ? esc(value) : value;
  });
}

export function validateRenderedEmail(rendered = {}) {
  const errors = [];
  const html = String(rendered.html || '');
  const text = String(rendered.text || '');
  const subject = String(rendered.subject || '');
  const combined = [subject, html, text].join('\n');

  if (!subject.trim()) errors.push('missing subject');
  if (!html.trim()) errors.push('missing html body');
  for (const [name, value] of [['subject', subject], ['html', html], ['text', text]]) {
    if (Buffer.from(value, 'utf8').toString('utf8') !== value) {
      errors.push(`${name} is not valid UTF-8`);
    }
  }
  if (/�|��/.test(combined)) errors.push('replacement characters detected');

  const missingVars = [...new Set(combined.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) || [])];
  if (missingVars.length) errors.push(`unresolved template variables: ${missingVars.join(', ')}`);

  const invalidAttrs = [
    /role=(["'])?resentation/i,
    /width=(["'])?00%/i,
    /align=(["'])?ight/i,
    /align=(["'])?enter/i,
    /cellpadding=(["'])?cellspacing/i,
    /colspan=(["'])?style=/i,
    /\w+=(["'])?[^"'>]*&quot;/i,
  ];
  if (invalidAttrs.some((pattern) => pattern.test(html))) {
    errors.push('invalid or corrupted HTML attributes detected');
  }

  return { ok: errors.length === 0, errors };
}

/** 1) เตือน 6 เดือนก่อนหมดวาระ */
export function renderSixMonth(p, opts = {}) {
  const dashboardUrl = publicActionUrl(opts.dashboardUrl);
  const t = templatePerson({ ...p, notification_type: 'แจ้งเตือนใกล้หมดวาระ 6 เดือน', dashboardUrl });
  const cfg = opts.customConfig || {};
  
  const customSubject = cfg.subject ? interpolateTemplate(cfg.subject, t) : null;
  const customBody = cfg.templateHtml ? interpolateTemplate(cfg.templateHtml, t, { escapeValues: true }) : null;

  const defaultBody = `
    <p style="font-size:14px;color:#334155;margin:0 0 4px;">เรียน ท่านผู้เกี่ยวข้อง</p>
    <p style="font-size:14px;color:#334155;margin:0 0 16px;">
      วาระการดำรงตำแหน่งของ <b>${esc(t.name)}</b> (${esc(t.positionLabel)})
      กำลังจะหมดอายุในอีกประมาณ <b style="color:${BRAND.amber};">6 เดือน</b>
      โปรดตรวจสอบข้อมูลและวางแผนการดำเนินการตามขั้นตอนที่เกี่ยวข้อง
    </p>
    ${personCard(t, 'amber')}`;
  
  const defaultText = [
    `ข้อมูลวาระคงเหลือ: ประมาณ 6 เดือน`,
    ``,
    `ชื่อ: ${t.name}`,
    `ตำแหน่ง: ${t.positionLabel}`,
    `พื้นที่: ${t.areaLabel}`,
    `วันเริ่มวาระ: ${t.startDateThai}`,
    `วันสิ้นสุดวาระ: ${t.endDateThai}`,
    `วันคงเหลือ: ${t.daysLeftText}`,
    `สถานะ: ${t.statusText}`,
    dashboardUrl ? `แดชบอร์ด: ${dashboardUrl}` : '',
  ].filter(Boolean).join('\n');

  return {
    subject: customSubject || `ข้อมูลวาระคงเหลือ 6 เดือน: ${t.name} (${t.endDateThai})`,
    html: customBody || layout(`เตือนวาระ 6 เดือน — ${t.name}`, defaultBody),
    text: cfg.templateText ? interpolateTemplate(cfg.templateText, t) : defaultText,
  };
}

/** 2) เตือน 1 เดือนก่อนหมดวาระ */
export function renderOneMonth(p, opts = {}) {
  const dashboardUrl = publicActionUrl(opts.dashboardUrl);
  const t = templatePerson({ ...p, notification_type: 'แจ้งเตือนใกล้หมดวาระ 1 เดือน', dashboardUrl });
  const cfg = opts.customConfig || {};

  const customSubject = cfg.subject ? interpolateTemplate(cfg.subject, t) : null;
  const customBody = cfg.templateHtml ? interpolateTemplate(cfg.templateHtml, t, { escapeValues: true }) : null;

  const defaultBody = `
    <p style="font-size:14px;color:#334155;margin:0 0 4px;">เรียน ท่านผู้เกี่ยวข้อง</p>
    <p style="font-size:14px;color:#334155;margin:0 0 16px;">
      วาระการดำรงตำแหน่งของ <b>${esc(t.name)}</b> (${esc(t.positionLabel)})
      กำลังจะหมดอายุในอีกประมาณ <b style="color:${BRAND.red};">1 เดือน</b>
      โปรดตรวจสอบข้อมูลและวางแผนการดำเนินการตามขั้นตอนที่เกี่ยวข้อง
    </p>
    ${personCard(t, 'red')}`;
  
  const defaultText = [
    `ข้อมูลวาระคงเหลือ: ประมาณ 1 เดือน`,
    ``,
    `ชื่อ: ${t.name}`,
    `ตำแหน่ง: ${t.positionLabel}`,
    `พื้นที่: ${t.areaLabel}`,
    `วันเริ่มวาระ: ${t.startDateThai}`,
    `วันสิ้นสุดวาระ: ${t.endDateThai}`,
    `วันคงเหลือ: ${t.daysLeftText}`,
    `สถานะ: ${t.statusText}`,
    dashboardUrl ? `แดชบอร์ด: ${dashboardUrl}` : '',
  ].filter(Boolean).join('\n');

  return {
    subject: customSubject || `ข้อมูลวาระคงเหลือ 1 เดือน: ${t.name} (${t.endDateThai})`,
    html: customBody || layout(`เตือนวาระ 1 เดือน — ${t.name}`, defaultBody),
    text: cfg.templateText ? interpolateTemplate(cfg.templateText, t) : defaultText,
  };
}

/** 3) สรุปประจำปี (31 ธันวาคม) */
export function renderAnnual(summary, opts = {}) {
  const dashboardUrl = publicActionUrl(opts.dashboardUrl);
  const cfg = opts.customConfig || {};
  const dataDict = {
    year: String(summary.year),
    person_name: '',
    position: '',
    term_start_date: '',
    term_end_date: '',
    days_remaining: '',
    status: 'สรุปประจำปี',
    total_count: String(summary.total),
    six_month_count: String(summary.counts.expiring6),
    one_month_count: String(summary.counts.expiring1),
    expired_count: String(summary.counts.expired),
    incomplete_count: String(summary.counts.incomplete || 0),
    action_url: dashboardUrl,
    notification_type: 'สรุปการหมดวาระประจำปี',
  };

  const customSubject = cfg.subject ? interpolateTemplate(cfg.subject, dataDict) : null;
  const customBody = cfg.templateHtml ? interpolateTemplate(cfg.templateHtml, dataDict, { escapeValues: true }) : null;

  const rows = summary.expiringList.map((p, i) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid ${BRAND.border};font-size:13px;${i % 2 ? 'background-color:#fafbfc;' : ''}">${esc(p.name)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BRAND.border};font-size:13px;">${esc(p.positionLabel)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BRAND.border};font-size:13px;">${esc(p.endDateThai)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid ${BRAND.border};font-size:13px;text-align:right;color:${p.daysLeft <= 0 ? BRAND.red : p.daysLeft <= 30 ? BRAND.amber : '#334155'};font-weight:bold;">${esc(p.daysLeftText)}</td>
    </tr>`).join('');

  const stat = (label, value, color = '#334155') => `
    <tr>
      <td style="padding:8px 12px;border:1px solid ${BRAND.border};font-size:13px;color:${BRAND.slate};">${esc(label)}</td>
      <td style="padding:8px 12px;border:1px solid ${BRAND.border};font-size:15px;font-weight:bold;color:${color};text-align:right;">${value}</td>
    </tr>`;

  const defaultBody = `
    <p style="font-size:14px;color:#334155;margin:0 0 16px;">
      สรุปสถานะวาระการดำรงตำแหน่งประจำปี <b>${summary.year}</b> (ณ วันที่ 31 ธันวาคม)
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
      ${stat('จำนวนบุคลากรทั้งหมด (Total Personnel)', summary.total)}
      ${stat('ผู้ใหญ่บ้าน (Village Headmen)', summary.counts.village)}
      ${stat('กำนัน (Subdistrict Headmen)', summary.counts.kamnan)}
      ${stat('ผู้ช่วยผู้ใหญ่บ้าน (Assistant Village Headmen)', summary.counts.assistant)}
      ${stat('วาระที่จะหมดภายใน 6 เดือน (Expiring Within 6 Months)', summary.counts.expiring6, BRAND.amber)}
      ${stat('วาระที่จะหมดภายใน 1 เดือน (Expiring Within 1 Month)', summary.counts.expiring1, BRAND.red)}
      ${stat('วาระที่หมดแล้ว (Already Expired)', summary.counts.expired, BRAND.red)}
      ${stat('ข้อมูลไม่สมบูรณ์ (Incomplete Data)', summary.counts.incomplete || 0, BRAND.slate)}
      ${stat('วาระที่ยังดำรงอยู่ (Active)', summary.counts.active, BRAND.green)}
    </table>
    <p style="font-size:14px;font-weight:bold;color:#0f172a;margin:0 0 8px;">รายชื่อผู้ที่มีวาระใกล้หมดอายุ</p>
    ${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${BRAND.border};">
      <tr style="background-color:${BRAND.green};">
        <th style="padding:8px 10px;color:#ffffff;font-size:13px;text-align:left;">ชื่อ</th>
        <th style="padding:8px 10px;color:#ffffff;font-size:13px;text-align:left;">ตำแหน่ง</th>
        <th style="padding:8px 10px;color:#ffffff;font-size:13px;text-align:left;">วันสิ้นสุดวาระ</th>
        <th style="padding:8px 10px;color:#ffffff;font-size:13px;text-align:right;">วันคงเหลือ</th>
      </tr>
      ${rows}
    </table>` : '<p style="font-size:13px;color:#64748b;">ไม่มีรายชื่อวาระใกล้หมดอายุในปีนี้</p>'}`;

  const defaultText = [
    `สรุปวาระการดำรงตำแหน่งประจำปี ${summary.year} (31 ธันวาคม)`,
    ``,
    `จำนวนบุคลากรทั้งหมด: ${summary.total}`,
    `ผู้ใหญ่บ้าน: ${summary.counts.village}`,
    `กำนัน: ${summary.counts.kamnan}`,
    `ผู้ช่วยผู้ใหญ่บ้าน: ${summary.counts.assistant}`,
    `วาระที่จะหมดภายใน 6 เดือน: ${summary.counts.expiring6}`,
    `วาระที่จะหมดภายใน 1 เดือน: ${summary.counts.expiring1}`,
    `วาระที่หมดแล้ว: ${summary.counts.expired}`,
    `ข้อมูลไม่สมบูรณ์: ${summary.counts.incomplete || 0}`,
    `วาระที่ยังดำรงอยู่: ${summary.counts.active}`,
    ``,
    `รายชื่อผู้ที่มีวาระใกล้หมดอายุ:`,
    ...summary.expiringList.map((p) => `- ${p.name} (${p.positionLabel}) สิ้นสุด ${p.endDateThai} — ${p.daysLeftText}`),
    dashboardUrl ? `แดชบอร์ด: ${dashboardUrl}` : '',
  ].join('\n');

  return {
    subject: customSubject || `[สรุปประจำปี] สถานะวาระการดำรงตำแหน่ง ${summary.year} — 31 ธันวาคม`,
    html: customBody || layout(`สรุปวาระประจำปี ${summary.year}`, defaultBody),
    text: cfg.templateText ? interpolateTemplate(cfg.templateText, dataDict) : defaultText,
  };
}
