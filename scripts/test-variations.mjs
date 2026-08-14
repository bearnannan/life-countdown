import { sendMail } from '../server/smtp.js';
import { renderOneMonth } from '../server/email-templates.js';

async function run() {
  const person = {
    name: 'นางจรัญ พันธ์จันดี',
    position: 'ผู้ช่วยผู้ใหญ่บ้าน',
    positionLabel: 'ผู้ช่วยผู้ใหญ่บ้าน',
    village: 'หมู่ 14 อุบลพัฒนา',
    tambon: 'วังหมี',
    amphoe: 'วังน้ำเขียว',
    province: 'นครราชสีมา',
    startDate: null,
    endDate: { y: 2026, m: 9, d: 13 },
    daysLeft: 30,
    today: { y: 2026, m: 8, d: 14 },
    role: 'assistant_village_headman',
  };

  // B2: Table-style body for individual person (neutral styling like annual table)
  const tableHtml = `
    <p style="font-size:14px;color:#334155;margin:0 0 16px;">
      ข้อมูลวาระการดำรงตำแหน่ง: <b>{{person_name}}</b> ({{position}})
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:20px;">
      <tr style="background-color:#16a34a;">
        <th style="padding:8px 10px;color:#ffffff;font-size:13px;text-align:left;">ชื่อ</th>
        <th style="padding:8px 10px;color:#ffffff;font-size:13px;text-align:left;">ตำแหน่ง</th>
        <th style="padding:8px 10px;color:#ffffff;font-size:13px;text-align:left;">วันสิ้นสุดวาระ</th>
        <th style="padding:8px 10px;color:#ffffff;font-size:13px;text-align:right;">วันคงเหลือ</th>
      </tr>
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">{{person_name}}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">{{position}}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;">{{term_end_date}}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;color:#dc2626;font-weight:bold;">{{days_remaining}}</td>
      </tr>
    </table>
  `;

  const rendered = renderOneMonth(person, {
    customConfig: {
      templateHtml: tableHtml,
      subject: '[ทดสอบ] สรุปข้อมูลการหมดวาระประจำปี 2026 CONTROL (B2 15:40)',
    }
  });

  console.log('Sending B2 (Table Layout for Person + Control Subject)...');
  const res = await sendMail({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: 'ระบบแจ้งเตือนวาระ <' + process.env.SMTP_USER + '>',
    to: ['dopa-only-tm@forth.co.th'],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  console.log('B2 result:', res);
}

run().catch(console.error);
