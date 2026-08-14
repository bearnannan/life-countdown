// =============================================================================
// email-templates.js — Email Template Builder (Minimal/Clean Style)
// 3 notification types: six_month, one_month, annual_summary
// =============================================================================

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Format ISO date to Thai readable: "15 มีนาคม 2027" */
function formatThaiDate(isoDate) {
  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  const d = new Date(isoDate);
  return `${d.getDate()} ${thaiMonths[d.getMonth()]} ${d.getFullYear()}`;
}

/** Common HTML wrapper — minimal, clean, inline styles only */
function wrapHtml(bodyContent) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family:'Sarabun', 'Noto Sans Thai', 'Helvetica Neue', Arial, sans-serif; font-size:15px; line-height:1.6; color:#1a1a1a; background-color:#f5f5f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; max-width:600px; width:100%;">
        <tr><td style="padding:32px 28px;">
${bodyContent}
        </td></tr>
        <tr><td style="padding:16px 28px; border-top:1px solid #e5e5e5;">
          <p style="margin:0; font-size:12px; color:#888; text-align:center;">
            ระบบแจ้งเตือนวาระอัตโนมัติ — Life Countdown Dashboard
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Get the dashboard URL from env, or empty string */
function getDashboardUrl() {
  return process.env.DASHBOARD_URL || '';
}

// ---------------------------------------------------------------------------
// 1. Six-Month Warning
// ---------------------------------------------------------------------------

/**
 * Build email content for 6-month term expiration warning.
 * @param {object} officer
 * @param {string} officer.name
 * @param {string} officer.position
 * @param {string} officer.village
 * @param {string} officer.sub_district
 * @param {string} officer.term_end_date - ISO date
 * @param {number} officer.days_left
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildSixMonthEmail(officer) {
  const year = new Date(officer.term_end_date).getFullYear();
  const subject = `รายงานวาระการดำรงตำแหน่ง ${year}: ${officer.name}`;
  const thaiDate = formatThaiDate(officer.term_end_date);
  const dashboardUrl = getDashboardUrl();
  const dashboardLine = dashboardUrl
    ? `<p style="margin:16px 0 0;"><a href="${dashboardUrl}" style="color:#2563eb; text-decoration:none;">ดูรายละเอียดเพิ่มเติมที่แดชบอร์ด →</a></p>`
    : '';

  const html = wrapHtml(`
          <p style="margin:0 0 20px; font-size:16px; font-weight:600; color:#b45309;">
            ⚠️ แจ้งเตือนล่วงหน้า 6 เดือน — วาระใกล้สิ้นสุด
          </p>
          <p style="margin:0 0 12px;">เรียน ${officer.name},</p>
          <p style="margin:0 0 16px;">
            ระบบแจ้งเตือนวาระอัตโนมัติตรวจพบว่าวาระการดำรงตำแหน่งของท่านจะสิ้นสุดภายในระยะเวลา
            <strong>${officer.days_left} วัน</strong> กรุณาเตรียมการที่เกี่ยวข้องล่วงหน้า
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px; font-size:14px;">
            <tr><td style="padding:4px 12px 4px 0; color:#666;">ชื่อ-สกุล:</td><td style="padding:4px 0;">${officer.name}</td></tr>
            <tr><td style="padding:4px 12px 4px 0; color:#666;">ตำแหน่ง:</td><td style="padding:4px 0;">${officer.position}</td></tr>
            <tr><td style="padding:4px 12px 4px 0; color:#666;">พื้นที่:</td><td style="padding:4px 0;">หมู่บ้าน${officer.village} ต.${officer.sub_district}</td></tr>
            <tr><td style="padding:4px 12px 4px 0; color:#666;">วันสิ้นสุดวาระ:</td><td style="padding:4px 0;"><strong>${thaiDate}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0; color:#666;">วันคงเหลือ:</td><td style="padding:4px 0;"><strong>${officer.days_left} วัน</strong></td></tr>
          </table>
          <p style="margin:0; font-size:14px; color:#555;">
            กรุณาเตรียมการวางแผนงบประมาณ ตรวจสอบคุณสมบัติ และดำเนินกระบวนการสรรหาหรือเลือกตั้งใหม่ตามระเบียบที่เกี่ยวข้อง
          </p>
          ${dashboardLine}`);

  const text = `⚠️ แจ้งเตือนล่วงหน้า 6 เดือน — วาระใกล้สิ้นสุด

เรียน ${officer.name},

ระบบแจ้งเตือนวาระอัตโนมัติตรวจพบว่าวาระการดำรงตำแหน่งของท่านจะสิ้นสุดภายในระยะเวลา ${officer.days_left} วัน

ชื่อ-สกุล: ${officer.name}
ตำแหน่ง: ${officer.position}
พื้นที่: หมู่บ้าน${officer.village} ต.${officer.sub_district}
วันสิ้นสุดวาระ: ${thaiDate}
วันคงเหลือ: ${officer.days_left} วัน

กรุณาเตรียมการวางแผนงบประมาณ ตรวจสอบคุณสมบัติ และดำเนินกระบวนการสรรหาหรือเลือกตั้งใหม่ตามระเบียบที่เกี่ยวข้อง
${dashboardUrl ? `\nดูรายละเอียดเพิ่มเติม: ${dashboardUrl}` : ''}
---
ระบบแจ้งเตือนวาระอัตโนมัติ — Life Countdown Dashboard`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// 2. One-Month Warning
// ---------------------------------------------------------------------------

/**
 * Build email content for 1-month (critical) term expiration warning.
 * @param {object} officer - Same shape as buildSixMonthEmail
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildOneMonthEmail(officer) {
  const year = new Date(officer.term_end_date).getFullYear();
  const subject = `รายงานวาระการดำรงตำแหน่ง ${year}: ${officer.name}`;
  const thaiDate = formatThaiDate(officer.term_end_date);
  const dashboardUrl = getDashboardUrl();
  const dashboardLine = dashboardUrl
    ? `<p style="margin:16px 0 0;"><a href="${dashboardUrl}" style="color:#2563eb; text-decoration:none;">ดูรายละเอียดเพิ่มเติมที่แดชบอร์ด →</a></p>`
    : '';

  const html = wrapHtml(`
          <p style="margin:0 0 20px; font-size:16px; font-weight:600; color:#dc2626;">
            🔴 แจ้งเตือนเร่งด่วน — วาระจะสิ้นสุดภายใน 1 เดือน
          </p>
          <p style="margin:0 0 12px;">เรียน ${officer.name},</p>
          <p style="margin:0 0 16px;">
            วาระการดำรงตำแหน่งของท่านจะสิ้นสุดภายใน
            <strong style="color:#dc2626;">${officer.days_left} วัน</strong>
            กรุณาดำเนินการเตรียมส่งมอบภารกิจและอุปกรณ์ทางราชการโดยเร่งด่วน
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px; font-size:14px;">
            <tr><td style="padding:4px 12px 4px 0; color:#666;">ชื่อ-สกุล:</td><td style="padding:4px 0;">${officer.name}</td></tr>
            <tr><td style="padding:4px 12px 4px 0; color:#666;">ตำแหน่ง:</td><td style="padding:4px 0;">${officer.position}</td></tr>
            <tr><td style="padding:4px 12px 4px 0; color:#666;">พื้นที่:</td><td style="padding:4px 0;">หมู่บ้าน${officer.village} ต.${officer.sub_district}</td></tr>
            <tr><td style="padding:4px 12px 4px 0; color:#666;">วันสิ้นสุดวาระ:</td><td style="padding:4px 0;"><strong style="color:#dc2626;">${thaiDate}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0; color:#666;">วันคงเหลือ:</td><td style="padding:4px 0;"><strong style="color:#dc2626;">${officer.days_left} วัน</strong></td></tr>
          </table>
          <p style="margin:0; font-size:14px; color:#555;">
            กรุณาเตรียมส่งมอบภารกิจและอุปกรณ์ทางราชการ และประสานงานกับผู้ที่เกี่ยวข้องเพื่อดำเนินการรับสมัครคัดเลือกผู้ดำรงตำแหน่งรายใหม่
          </p>
          ${dashboardLine}`);

  const text = `🔴 แจ้งเตือนเร่งด่วน — วาระจะสิ้นสุดภายใน 1 เดือน

เรียน ${officer.name},

วาระการดำรงตำแหน่งของท่านจะสิ้นสุดภายใน ${officer.days_left} วัน

ชื่อ-สกุล: ${officer.name}
ตำแหน่ง: ${officer.position}
พื้นที่: หมู่บ้าน${officer.village} ต.${officer.sub_district}
วันสิ้นสุดวาระ: ${thaiDate}
วันคงเหลือ: ${officer.days_left} วัน

กรุณาเตรียมส่งมอบภารกิจและอุปกรณ์ทางราชการ และประสานงานกับผู้ที่เกี่ยวข้องเพื่อดำเนินการรับสมัครคัดเลือกผู้ดำรงตำแหน่งรายใหม่
${dashboardUrl ? `\nดูรายละเอียดเพิ่มเติม: ${dashboardUrl}` : ''}
---
ระบบแจ้งเตือนวาระอัตโนมัติ — Life Countdown Dashboard`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// 3. Annual Summary
// ---------------------------------------------------------------------------

/**
 * Build email content for annual summary report.
 * @param {object[]} officers - Array of officer objects expiring in the target year
 * @param {number} year - ค.ศ. year (e.g. 2026)
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildAnnualSummaryEmail(officers, year) {
  const subject = `สรุปข้อมูลการหมดวาระประจำปี ${year}`;
  const dashboardUrl = getDashboardUrl();
  const dashboardLine = dashboardUrl
    ? `<p style="margin:16px 0 0;"><a href="${dashboardUrl}" style="color:#2563eb; text-decoration:none;">ดูรายละเอียดเพิ่มเติมที่แดชบอร์ด →</a></p>`
    : '';

  // Build officer list
  const officerListHtml = officers.map((o, i) => `
            <tr>
              <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:13px;">${i + 1}</td>
              <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:13px;">${o.name}</td>
              <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:13px;">${o.position}</td>
              <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:13px;">ต.${o.sub_district}</td>
              <td style="padding:6px 8px; border-bottom:1px solid #eee; font-size:13px;">${formatThaiDate(o.term_end_date)}</td>
            </tr>`).join('');

  const officerListText = officers.map((o, i) =>
    `  ${i + 1}. ${o.name} (${o.position}) — ต.${o.sub_district} — หมดวาระ ${formatThaiDate(o.term_end_date)}`
  ).join('\n');

  const html = wrapHtml(`
          <p style="margin:0 0 20px; font-size:16px; font-weight:600; color:#059669;">
            📊 สรุปข้อมูลการหมดวาระประจำปี ${year}
          </p>
          <p style="margin:0 0 12px;">เรียน ผู้บริหาร/ทีมงานปกครอง,</p>
          <p style="margin:0 0 16px;">
            รายงานสรุปเจ้าหน้าที่ที่จะครบวาระหรือหมดวาระในปี ${year}
            จำนวน <strong>${officers.length} ราย</strong>
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px; border:1px solid #e5e5e5; border-radius:4px; border-collapse:collapse;">
            <tr style="background-color:#f8f9fa;">
              <th style="padding:8px; text-align:left; font-size:12px; color:#666; border-bottom:2px solid #ddd;">#</th>
              <th style="padding:8px; text-align:left; font-size:12px; color:#666; border-bottom:2px solid #ddd;">ชื่อ-สกุล</th>
              <th style="padding:8px; text-align:left; font-size:12px; color:#666; border-bottom:2px solid #ddd;">ตำแหน่ง</th>
              <th style="padding:8px; text-align:left; font-size:12px; color:#666; border-bottom:2px solid #ddd;">ตำบล</th>
              <th style="padding:8px; text-align:left; font-size:12px; color:#666; border-bottom:2px solid #ddd;">วันหมดวาระ</th>
            </tr>
${officerListHtml}
          </table>
          <p style="margin:0; font-size:14px; color:#555;">
            กรุณาตรวจสอบข้อมูลและดำเนินการวางแผนทรัพยากรบุคคลตามระเบียบที่เกี่ยวข้อง
          </p>
          ${dashboardLine}`);

  const text = `📊 สรุปข้อมูลการหมดวาระประจำปี ${year}

เรียน ผู้บริหาร/ทีมงานปกครอง,

รายงานสรุปเจ้าหน้าที่ที่จะครบวาระหรือหมดวาระในปี ${year} จำนวน ${officers.length} ราย

รายชื่อ:
${officerListText}

กรุณาตรวจสอบข้อมูลและดำเนินการวางแผนทรัพยากรบุคคลตามระเบียบที่เกี่ยวข้อง
${dashboardUrl ? `\nดูรายละเอียดเพิ่มเติม: ${dashboardUrl}` : ''}
---
ระบบแจ้งเตือนวาระอัตโนมัติ — Life Countdown Dashboard`;

  return { subject, html, text };
}
