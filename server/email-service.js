// ============================================================
// บริการส่งอีเมล (Email Service)
// ------------------------------------------------------------
// - ตรวจสอบผู้รับ (รูปแบบอีเมล) ก่อนส่ง
// - เลือก transport: 'smtp' (เซิร์ฟเวอร์จริง) หรือ 'console' (ทดสอบ/dev)
// - เก็บ messageId จากผู้ให้บริการเมื่อมี
// - โยน error พร้อมข้อความชัดเจนเมื่อส่งไม่สำเร็จ — อย่าทำให้ failed
//   กลายเป็น sent โดยเด็ดขาด
// ============================================================

import { sendMail as smtpSend } from './smtp.js';
import { audit } from './db.js';
import { validateRenderedEmail } from './email-templates.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** ตรวจสอบรูปแบบอีเมล (อนุญาตหลายราย คั่นด้วย ,) */
export function validateEmail(value) {
  if (value === null || value === undefined) return { ok: false, reason: 'ไม่มีอีเมล' };
  const list = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return { ok: false, reason: 'ไม่มีอีเมล' };
  for (const e of list) {
    if (!EMAIL_RE.test(e)) return { ok: false, reason: `รูปแบบอีเมลไม่ถูกต้อง: "${e}"`, email: e };
  }
  return { ok: true, emails: list };
}

/**
 * รวบรวมผู้รับจากรายการ + cc แล้วกรองรายที่ซ้ำกันและอีเมลที่รูปแบบไม่ถูกต้อง
 * @returns {{to:string[], cc:string[], dropped:string[]}} dropped = อีเมลที่ถูกตัดออก (รูปแบบผิด/ว่าง)
 */
export function collectRecipients({ to = [], cc = [], extra = [] } = {}) {
  const dropped = [];
  const pick = (list) => {
    const out = new Set();
    for (const s of list) {
      const e = String(s).trim();
      if (!e) continue;
      if (!EMAIL_RE.test(e)) { dropped.push(e); continue; }
      out.add(e);
    }
    return out;
  };
  const toSet = pick([...to, ...extra]);
  const ccSet = pick(cc);
  for (const e of ccSet) toSet.delete(e); // cc ที่ซ้ำกับ to ให้ถือเป็น to
  return { to: [...toSet], cc: [...ccSet], dropped };
}

/**
 * ส่งอีเมลตามการตั้งค่า
 * @param {object} args
 *   db, settings, { to, cc }, subject, html, text, meta (สำหรับ audit)
 * @returns {Promise<{ok:boolean, messageId?:string|null, error?:string}>}
 */
export async function deliverEmail({ db, settings, to, cc = [], subject, html, text, meta = {} }) {
  const from = settings.email.from;
  const recipients = collectRecipients({ to, cc });
  if (!recipients.to.length && !recipients.cc.length) {
    const reason = recipients.dropped.length
      ? `ไม่มีผู้รับที่ถูกต้อง (ตัดอีเมลที่รูปแบบไม่ถูกต้อง: ${recipients.dropped.join(', ')})`
      : 'ไม่มีผู้รับอีเมล (empty recipient list)';
    return { ok: false, error: reason };
  }

  const validation = validateRenderedEmail({ subject, html, text });
  if (!validation.ok) {
    return { ok: false, error: `Email template validation failed: ${validation.errors.join('; ')}` };
  }

  try {
    let result;
    const fromStr = from.name && from.address ? `${from.name} <${from.address}>` : (from.address || from.name || '');
    if (settings.email.transport === 'smtp') {
      const pass = settings.email.smtp.pass || process.env.SMTP_PASS || '';
      if (!pass && settings.email.smtp.user) {
        throw new Error('SMTP_PASS หรือรหัสผ่าน SMTP ยังไม่ได้ตั้งค่า');
      }
      result = await smtpSend({
        host: settings.email.smtp.host,
        port: settings.email.smtp.port,
        secure: settings.email.smtp.secure,
        rejectUnauthorized: settings.email.smtp.rejectUnauthorized !== false,
        user: settings.email.smtp.user || '',
        pass,
        from: fromStr,
        to: recipients.to,
        cc: recipients.cc,
        subject,
        html,
        text,
      });
    } else {
      // console transport — สำหรับทดสอบ/พัฒนา ไม่มีการส่งจริง
      const log = {
        transport: 'console',
        from: `${from.name} <${from.address}>`,
        to: recipients.to,
        cc: recipients.cc,
        subject,
        htmlLength: html.length,
        textLength: text.length,
        meta,
      };
      console.log('[email:console] ' + JSON.stringify(log));
      result = { messageId: `console-${Date.now()}` };
    }

    return { ok: true, messageId: result.messageId || null };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    try {
      audit(db, { actor: meta.actor || 'system', action: 'email.send_failed', detail: `${meta.type || ''} — ${msg}`.slice(0, 500) });
    } catch { /* อย่าให้ audit ล้มทำให้ส่งล้ม */ }
    return { ok: false, error: msg };
  }
}
