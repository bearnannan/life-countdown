// ============================================================
// เทมเพลตอีเมลแจ้งเตือนวาระ (UI/UX Pro Max Edition)
// ------------------------------------------------------------
// - สอดคล้องมาตรฐานความปลอดภัย SPF / DKIM / DMARC และ Microsoft 365
// - ใช้ <table> และ inline CSS เพื่อรองรับ Outlook Desktop / Web / Gmail / iOS
// - ดีไซน์ทางการระดับหน่วยงานภาครัฐ (Government/Enterprise Tone)
// - สีหลัก: เขียวมหาดไทย (#15803d) / สีเตือน 6 เดือน (#d97706) / สีเตือน 1 เดือน (#dc2626)
// ============================================================

import { formatThaiDate, toISOString, formatDaysLeft, parseDate } from '../js/dates.js';

const BRAND = {
  primary: '#15803d',     // เขียวมหาดไทย/ทางการ
  primaryDark: '#166534',
  amber: '#d97706',       // ส้มเตือน 6 เดือน
  amberBg: '#fef3c7',
  amberBorder: '#fde68a',
  red: '#dc2626',         // แดงเตือน 1 เดือน
  redBg: '#fee2e2',
  redBorder: '#fecaca',
  slate: '#475569',
  slateLight: '#64748b',
  textMain: '#0f172a',
  textMuted: '#334155',
  bg: '#f8fafc',
  cardBg: '#ffffff',
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

/** โครงสร้างหลักของอีเมล (Pure Table Layout, 640px Max Width) */
export function layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:'Sarabun','TH Sarabun New',-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};padding:24px 8px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background-color:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <!-- Header Bar -->
        <tr><td style="background-color:${BRAND.primary};padding:18px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#ffffff;font-size:17px;font-weight:bold;letter-spacing:0.2px;">
                ระบบติดตามวาระการดำรงตำแหน่ง
              </td>
              <td align="right" style="color:#e2e8f0;font-size:12px;font-weight:normal;">
                กรมการปกครอง · กระทรวงมหาดไทย
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Main Body Content -->
        <tr><td style="padding:24px 28px;">
          ${bodyHtml}
        </td></tr>

        <!-- Official Footer -->
        <tr><td style="padding:16px 28px;background-color:#fafbfc;border-top:1px solid ${BRAND.border};color:${BRAND.slateLight};font-size:12px;line-height:1.6;">
          <p style="margin:0 0 4px;font-weight:bold;color:${BRAND.slate};">
            เอกสารรายงานสารสนเทศเพื่อการบริหารจัดการวาระการดำรงตำแหน่ง
          </p>
          <p style="margin:0;">
            อีเมลนี้จัดส่งโดยระบบประมวลผลอัตโนมัติ — กรุณาอย่าตอบกลับอีเมลนี้โดยตรง
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** ส่วนแสดงรายละเอียดบุคคลแบบตารางทางการ (Executive Table Layout) */
function personTable(t, tone) {
  const isRed = tone === 'red';
  const highlightColor = isRed ? BRAND.red : BRAND.amber;
  const highlightBg = isRed ? BRAND.redBg : BRAND.amberBg;
  const highlightBorder = isRed ? BRAND.redBorder : BRAND.amberBorder;
  const badgeTitle = isRed ? 'ระยะเร่งด่วน: วาระคงเหลือไม่เกิน 30 วัน' : 'ระยะเตรียมการ: วาระคงเหลือประมาณ 6 เดือน';
  const areaPart = t.areaLabel ? `${t.areaLabel}` : '—';

  return `
    <!-- Urgency Status Pill -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td style="background-color:${highlightBg};border:1px solid ${highlightBorder};padding:10px 14px;border-radius:6px;color:${highlightColor};font-size:13px;font-weight:bold;">
          📌 ${badgeTitle}
        </td>
      </tr>
    </table>

    <!-- Main Data Table -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${BRAND.border};border-radius:6px;overflow:hidden;margin-bottom:18px;">
      <tr style="background-color:${BRAND.primary};">
        <th colspan="2" style="padding:9px 14px;color:#ffffff;font-size:13px;font-weight:bold;text-align:left;">
          ข้อมูลประวัติและสถานะวาระการดำรงตำแหน่ง
        </th>
      </tr>
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};width:32%;background-color:#fafbfc;color:${BRAND.slate};font-size:13px;font-weight:bold;">ชื่อ - สกุล</td>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};color:${BRAND.textMain};font-size:14px;font-weight:bold;">${esc(t.name)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};background-color:#fafbfc;color:${BRAND.slate};font-size:13px;font-weight:bold;">ตำแหน่ง</td>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};color:${BRAND.textMuted};font-size:13px;">${esc(t.positionLabel)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};background-color:#fafbfc;color:${BRAND.slate};font-size:13px;font-weight:bold;">พื้นที่ปฏิบัติหน้าที่</td>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};color:${BRAND.textMuted};font-size:13px;">${esc(areaPart)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};background-color:#fafbfc;color:${BRAND.slate};font-size:13px;font-weight:bold;">วันเริ่มดำรงตำแหน่ง</td>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};color:${BRAND.textMuted};font-size:13px;">${esc(t.startDateThai)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};background-color:#fafbfc;color:${BRAND.slate};font-size:13px;font-weight:bold;">วันสิ้นสุดวาระ</td>
        <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};color:${BRAND.textMuted};font-size:13px;font-weight:bold;">${esc(t.endDateThai)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;background-color:#fafbfc;color:${BRAND.slate};font-size:13px;font-weight:bold;">ระยะเวลาคงเหลือ</td>
        <td style="padding:10px 14px;color:${highlightColor};font-size:14px;font-weight:bold;">${esc(t.daysLeftText)} (${esc(t.statusText)})</td>
      </tr>
    </table>

    <!-- Next Action Steps / Administrative Guidance -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;border:1px solid ${BRAND.border};border-radius:6px;margin-bottom:12px;">
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:${BRAND.textMuted};">
          <p style="margin:0 0 4px;font-weight:bold;color:${BRAND.textMain};">คำแนะนำการดำเนินการทางธุรการ:</p>
          <ul style="margin:0;padding-left:18px;line-height:1.6;">
            ${isRed ? `
              <li>โปรดรายงานนายอำเภอและหน่วยงานทะเบียนท้องที่เพื่อเตรียมการตามระเบียบ</li>
              <li>จัดเตรียมเอกสารส่งมอบงานและบัญชีทรัพย์สินทางราชการก่อนครบกำหนดวาระ</li>
            ` : `
              <li>โปรดตรวจสอบความถูกต้องของประวัติและข้อมูลคุณสมบัติในระบบทะเบียน</li>
              <li>วางแผนและเตรียมขั้นตอนทางธุรการสำหรับการสรรหาหรือการเลือกตั้งล่วงหน้า</li>
            `}
          </ul>
        </td>
      </tr>
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
    area: [p.village, p.tambon, p.amphoe, p.province].filter(Boolean).join(' '),
    term_start_date: thaiDate(p.startDate),
    term_end_date: thaiDate(p.endDate),
    days_left: daysLeft !== null ? String(daysLeft) : '—',
    days_remaining: daysLeftText,
    status: statusText,
    months_left: String(monthsLeft),
    notification_type: p.notification_type || 'รายงานวาระการดำรงตำแหน่ง',
    year: String(p.year || new Date().getFullYear()),
    total_count: String(p.total_count ?? '—'),
    six_month_count: String(p.six_month_count ?? '—'),
    one_month_count: String(p.one_month_count ?? '—'),
    expired_count: String(p.expired_count ?? '—'),
    incomplete_count: String(p.incomplete_count ?? '—'),
    action_url: p.action_url || p.dashboardUrl || '',
    // ฟิลด์สำหรับ layout
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
  if (/\uFFFD/.test(combined)) errors.push('replacement characters detected');

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

/** 1) ข้อมูลวาระ 6 เดือนก่อนหมดวาระ */
export function renderSixMonth(p, opts = {}) {
  const dashboardUrl = publicActionUrl(opts.dashboardUrl);
  const t = templatePerson({ ...p, notification_type: 'รายงานวาระการดำรงตำแหน่ง 6 เดือน', dashboardUrl });
  const cfg = opts.customConfig || {};
  
  const customSubject = cfg.subject ? interpolateTemplate(cfg.subject, t) : null;
  const customBody = cfg.templateHtml ? interpolateTemplate(cfg.templateHtml, t, { escapeValues: true }) : null;

  const defaultBody = `
    <p style="font-size:15px;font-weight:bold;color:${BRAND.textMain};margin:0 0 14px;">
      รายงานข้อมูลวาระการดำรงตำแหน่ง (ล่วงหน้า 6 เดือน)
    </p>
    ${personTable(t, 'amber')}`;
  
  const defaultText = [
    `รายงานข้อมูลวาระการดำรงตำแหน่ง (ล่วงหน้า 6 เดือน): ${t.name}`,
    `--------------------------------------------------`,
    `ชื่อ-สกุล: ${t.name}`,
    `ตำแหน่ง: ${t.positionLabel}`,
    `พื้นที่: ${t.areaLabel}`,
    `วันเริ่มวาระ: ${t.startDateThai}`,
    `วันสิ้นสุดวาระ: ${t.endDateThai}`,
    `ระยะเวลาคงเหลือ: ${t.daysLeftText} (${t.statusText})`,
    `--------------------------------------------------`,
    dashboardUrl ? `แดชบอร์ด: ${dashboardUrl}` : '',
  ].filter(Boolean).join('\n');

  return {
    subject: customSubject || `รายงานวาระการดำรงตำแหน่ง ${t.year}: ${t.name}`,
    html: customBody || layout(`รายงานวาระการดำรงตำแหน่ง — ${t.name}`, defaultBody),
    text: cfg.templateText ? interpolateTemplate(cfg.templateText, t) : defaultText,
  };
}

/** 2) ข้อมูลวาระ 1 เดือนก่อนหมดวาระ */
export function renderOneMonth(p, opts = {}) {
  const dashboardUrl = publicActionUrl(opts.dashboardUrl);
  const t = templatePerson({ ...p, notification_type: 'รายงานวาระการดำรงตำแหน่ง 1 เดือน', dashboardUrl });
  const cfg = opts.customConfig || {};

  const customSubject = cfg.subject ? interpolateTemplate(cfg.subject, t) : null;
  const customBody = cfg.templateHtml ? interpolateTemplate(cfg.templateHtml, t, { escapeValues: true }) : null;

  const defaultBody = `
    <p style="font-size:15px;font-weight:bold;color:${BRAND.textMain};margin:0 0 14px;">
      รายงานข้อมูลวาระการดำรงตำแหน่ง (ล่วงหน้า 1 เดือน / เร่งด่วน)
    </p>
    ${personTable(t, 'red')}`;
  
  const defaultText = [
    `รายงานข้อมูลวาระการดำรงตำแหน่ง (ล่วงหน้า 1 เดือน / เร่งด่วน): ${t.name}`,
    `--------------------------------------------------`,
    `ชื่อ-สกุล: ${t.name}`,
    `ตำแหน่ง: ${t.positionLabel}`,
    `พื้นที่: ${t.areaLabel}`,
    `วันเริ่มวาระ: ${t.startDateThai}`,
    `วันสิ้นสุดวาระ: ${t.endDateThai}`,
    `ระยะเวลาคงเหลือ: ${t.daysLeftText} (${t.statusText})`,
    `--------------------------------------------------`,
    dashboardUrl ? `แดชบอร์ด: ${dashboardUrl}` : '',
  ].filter(Boolean).join('\n');

  return {
    subject: customSubject || `รายงานวาระการดำรงตำแหน่ง ${t.year}: ${t.name}`,
    html: customBody || layout(`รายงานวาระการดำรงตำแหน่ง — ${t.name}`, defaultBody),
    text: cfg.templateText ? interpolateTemplate(cfg.templateText, t) : defaultText,
  };
}

/** 3) สรุปประจำปี (31 ธันวาคม) */
export function renderAnnual(summary, opts = {}) {
  const dashboardUrl = publicActionUrl(opts.dashboardUrl);
  const cfg = opts.customConfig || {};
  const totalPersonnel = summary.total !== undefined ? summary.total : (summary.counts?.total ?? 0);
  const counts = summary.counts || {};
  const expiringList = summary.expiringList || [];

  const dataDict = {
    year: String(summary.year || new Date().getFullYear()),
    person_name: '',
    position: '',
    term_start_date: '',
    term_end_date: '',
    days_remaining: '',
    status: 'สรุปประจำปี',
    total_count: String(totalPersonnel),
    six_month_count: String(counts.expiring6 ?? 0),
    one_month_count: String(counts.expiring1 ?? 0),
    expired_count: String(counts.expired ?? 0),
    incomplete_count: String(counts.incomplete ?? 0),
    action_url: dashboardUrl,
    notification_type: 'สรุปการหมดวาระประจำปี',
  };

  const customSubject = cfg.subject ? interpolateTemplate(cfg.subject, dataDict) : null;
  const customBody = cfg.templateHtml ? interpolateTemplate(cfg.templateHtml, dataDict, { escapeValues: true }) : null;

  const rows = expiringList.map((p, i) => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid ${BRAND.border};font-size:13px;color:${BRAND.textMain};font-weight:bold;${i % 2 ? 'background-color:#fafbfc;' : ''}">${esc(p.name)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid ${BRAND.border};font-size:13px;color:${BRAND.textMuted};">${esc(p.positionLabel)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid ${BRAND.border};font-size:13px;color:${BRAND.textMuted};">${esc(p.endDateThai)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid ${BRAND.border};font-size:13px;text-align:right;color:${p.daysLeft <= 0 ? BRAND.red : p.daysLeft <= 30 ? BRAND.red : BRAND.amber};font-weight:bold;">${esc(p.daysLeftText)}</td>
    </tr>`).join('');

  const stat = (label, value, color = BRAND.textMain) => `
    <tr>
      <td style="padding:9px 14px;border:1px solid ${BRAND.border};font-size:13px;color:${BRAND.slate};">${esc(label)}</td>
      <td style="padding:9px 14px;border:1px solid ${BRAND.border};font-size:14px;font-weight:bold;color:${color};text-align:right;">${value}</td>
    </tr>`;

  const defaultBody = `
    <p style="font-size:15px;font-weight:bold;color:${BRAND.textMain};margin:0 0 6px;">
      รายงานสรุปสถานะวาระการดำรงตำแหน่งประจำปี ${summary.year}
    </p>
    <p style="font-size:13px;color:${BRAND.slateLight};margin:0 0 16px;">
      ข้อมูลประมวลผล ณ วันที่ 31 ธันวาคม ${summary.year}
    </p>

    <!-- สรุปตัวเลขสถิติภาพรวม -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${BRAND.border};border-radius:6px;overflow:hidden;margin-bottom:22px;">
      <tr style="background-color:${BRAND.primary};">
        <th colspan="2" style="padding:9px 14px;color:#ffffff;font-size:13px;font-weight:bold;text-align:left;">
          สถิติภาพรวมบุคลากรและการหมดวาระ
        </th>
      </tr>
      ${stat('จำนวนบุคลากรทั้งหมด (Total Personnel)', totalPersonnel, BRAND.primary)}
      ${stat('ผู้ใหญ่บ้าน (Village Headmen)', counts.village ?? 0)}
      ${stat('กำนัน (Subdistrict Headmen)', counts.kamnan ?? 0)}
      ${stat('ผู้ช่วยผู้ใหญ่บ้าน (Assistant Village Headmen)', counts.assistant ?? 0)}
      ${stat('วาระที่จะหมดภายใน 6 เดือน (Expiring Within 6 Months)', counts.expiring6 ?? 0, BRAND.amber)}
      ${stat('วาระที่จะหมดภายใน 1 เดือน (Expiring Within 1 Month)', counts.expiring1 ?? 0, BRAND.red)}
      ${stat('วาระที่หมดแล้ว (Already Expired)', counts.expired ?? 0, BRAND.red)}
      ${stat('ข้อมูลไม่สมบูรณ์ (Incomplete Data)', counts.incomplete ?? 0, BRAND.slate)}
      ${stat('วาระที่ยังดำรงอยู่ตามปกติ (Active)', counts.active ?? 0, BRAND.primary)}
    </table>

    <!-- ตารางรายชื่อผู้ใกล้หมดวาระ -->
    <p style="font-size:14px;font-weight:bold;color:${BRAND.textMain};margin:0 0 8px;">
      รายชื่อผู้มีวาระใกล้หมดอายุในปีถัดไป
    </p>
    ${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${BRAND.border};border-radius:6px;overflow:hidden;">
      <tr style="background-color:${BRAND.primary};">
        <th style="padding:9px 10px;color:#ffffff;font-size:13px;text-align:left;">ชื่อ - สกุล</th>
        <th style="padding:9px 10px;color:#ffffff;font-size:13px;text-align:left;">ตำแหน่ง</th>
        <th style="padding:9px 10px;color:#ffffff;font-size:13px;text-align:left;">วันสิ้นสุดวาระ</th>
        <th style="padding:9px 10px;color:#ffffff;font-size:13px;text-align:right;">วันคงเหลือ</th>
      </tr>
      ${rows}
    </table>` : '<p style="font-size:13px;color:#64748b;padding:12px;background-color:#fafbfc;border:1px solid #e2e8f0;border-radius:6px;">ไม่มีรายชื่อวาระใกล้หมดอายุในปีนี้</p>'}`;

  const defaultText = [
    `รายงานสรุปสถานะวาระการดำรงตำแหน่งประจำปี ${summary.year} (31 ธันวาคม)`,
    `==================================================`,
    `จำนวนบุคลากรทั้งหมด: ${summary.total}`,
    `ผู้ใหญ่บ้าน: ${counts.village ?? 0}`,
    `กำนัน: ${counts.kamnan ?? 0}`,
    `ผู้ช่วยผู้ใหญ่บ้าน: ${counts.assistant ?? 0}`,
    `วาระที่จะหมดภายใน 6 เดือน: ${counts.expiring6 ?? 0}`,
    `วาระที่จะหมดภายใน 1 เดือน: ${counts.expiring1 ?? 0}`,
    `วาระที่หมดแล้ว: ${counts.expired ?? 0}`,
    `ข้อมูลไม่สมบูรณ์: ${counts.incomplete ?? 0}`,
    `วาระที่ยังดำรงอยู่ตามปกติ: ${counts.active ?? 0}`,
    `==================================================`,
    `รายชื่อผู้ที่มีวาระใกล้หมดอายุ:`,
    ...expiringList.map((p) => `- ${p.name} (${p.positionLabel}) สิ้นสุด ${p.endDateThai} — ${p.daysLeftText}`),
    dashboardUrl ? `แดชบอร์ด: ${dashboardUrl}` : '',
  ].join('\n');

  return {
    subject: customSubject || `สรุปข้อมูลการหมดวาระประจำปี ${summary.year}`,
    html: customBody || layout(`สรุปวาระประจำปี ${summary.year}`, defaultBody),
    text: cfg.templateText ? interpolateTemplate(cfg.templateText, dataDict) : defaultText,
  };
}
