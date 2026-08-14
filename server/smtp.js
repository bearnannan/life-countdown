// ============================================================
// SMTP client ขนาดเล็ก (ไม่พึ่งแพ็กเกจ) — ใช้ node:net + node:tls
// ------------------------------------------------------------
// รองรับ:
//  - พอร์ต 465 (implicit TLS) และ 587/25 (STARTTLS)
//  - ปิด STARTTLS ได้ (protocol 'none') และตรวจ/ไม่ตรวจใบรับรอง TLS
//  - AUTH PLAIN / AUTH LOGIN
//  - MAIL FROM / RCPT TO (หลายคน) / DATA
//  - หมดเวลา (timeout) ทุกคำสั่ง เพื่อไม่ให้ค้างตลอดไป
//  - แยกข้อความ error ที่เป็นมิตรต่อผู้ใช้ (DNS/TLS/cert/auth/reject)
//  - ไม่มีการ log ข้อมูลลับ (รหัสผ่าน ฯลฯ) ลงคอนโซล
// ============================================================

import net from 'node:net';
import tls from 'node:tls';

const CRLF = '\r\n';
const DEFAULT_TIMEOUT_MS = 15000;

function extractEnvelopeFrom(value) {
  const text = String(value || '').trim();
  const match = text.match(/<([^<>@\s]+@[^<>]+)>/);
  if (match) return match[1].trim();
  return text;
}

function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeader(value) {
  const text = sanitizeHeader(value);
  if (!/[^\x20-\x7E]/.test(text)) return text;
  const words = [];
  let current = '';
  for (const char of text) {
    if (Buffer.byteLength(current + char, 'utf8') > 36) {
      if (current) words.push(`=?UTF-8?B?${Buffer.from(current, 'utf8').toString('base64')}?=`);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) words.push(`=?UTF-8?B?${Buffer.from(current, 'utf8').toString('base64')}?=`);
  return words.join(' ');
}

function encodeAddressHeader(value) {
  const text = sanitizeHeader(value);
  const match = text.match(/^(.*)<([^<>@\s]+@[^<>\s]+)>$/);
  if (!match) return encodeHeader(text);
  const name = match[1].trim().replace(/^"|"$/g, '');
  const email = match[2].trim();
  return name ? `${encodeHeader(name)} <${email}>` : `<${email}>`;
}

function toMimeBase64(value) {
  const encoded = Buffer.from(String(value || ''), 'utf8').toString('base64');
  return encoded.match(/.{1,76}/g)?.join(CRLF) || '';
}

function messageIdFor(sender) {
  const email = extractEnvelopeFrom(sender);
  const domain = (email.split('@')[1] || 'localhost').replace(/[^\w.-]/g, '') || 'localhost';
  const unique = `${Date.now()}.${Math.random().toString(16).slice(2)}`;
  return `<${unique}@${domain}>`;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class SmtpError extends Error {
  constructor(message, { code = null, response = null } = {}) {
    super(message);
    this.name = 'SmtpError';
    this.code = code;
    this.response = response;
  }
}

/** แปลง error จากการเชื่อมต่อ/TLS เป็นรหัสที่สื่อความหมาย */
function mapConnectError(err, host, port) {
  const code = err && err.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new SmtpError(`ไม่พบชื่อโดเมนของ SMTP host "${host}" (DNS lookup ล้มเหลว)`, { code: 'DNS' });
  }
  if (code === 'ECONNREFUSED') {
    return new SmtpError(`เซิร์ฟเวอร์ SMTP ปฏิเสธการเชื่อมต่อ (${host}:${port}) — ตรวจสอบ Host/Port และไฟร์วอลล์`, { code: 'CONNECT' });
  }
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new SmtpError(`เชื่อมต่อ SMTP หมดเวลา (${host}:${port}) — ตรวจสอบเครือข่ายหรือกรองไฟร์วอลล์`, { code: 'TIMEOUT' });
  }
  return new SmtpError(`เชื่อมต่อ SMTP ไม่ได้ (${host}:${port}): ${err.message}`, { code: 'CONNECT' });
}

/** แปลง error จาก TLS handshake โดยเฉพาะกรณีใบรับรอง */
function mapTlsError(err, host) {
  const code = err && err.code;
  const certCodes = [
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID', 'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'HOSTNAME_MISMATCH',
  ];
  if (certCodes.includes(code)) {
    return new SmtpError(
      `การตรวจสอบใบรับรอง TLS ของ ${host} ล้มเหลว (${code}) — หากเป็นใบรับรองที่ลงนามเอง ให้เปิดตัวเลือก "อนุญาตใบรับรองที่ลงนามเอง" เฉพาะผู้ดูแล`,
      { code: 'TLS_CERT' },
    );
  }
  return new SmtpError(`การเชื่อมต่อ TLS/SSL กับ ${host} ล้มเหลว: ${err.message}`, { code: 'TLS' });
}

/** อ่านบรรทัดตอบกลับ (รองรับ multiline: 250-... / 250 ...) */
function parseResponse(lines) {
  if (!lines.length) return { code: 0, lines: [], message: '' };
  const code = Number(lines[0].slice(0, 3));
  const last = lines[lines.length - 1];
  return {
    code,
    lines,
    message: last.length > 4 ? last.slice(4) : last,
    ok: code >= 200 && code < 400,
  };
}

/** ตรวจสอบว่า server ประกาศความสามารถในรายการ EHLO (ตัดรหัสตอบกลับ 250-/250 ) */
function hasCapability(extensions, name) {
  return extensions.some((line) => line.replace(/^\d{3}[- ]/, '').trim().toUpperCase().startsWith(name.toUpperCase()));
}

/**
 * ส่งอีเมลผ่าน SMTP
 * @param {object} opts
 *   host, port, secure (true = TLS ทันที),
 *   starttls (เมื่อ secure=false และ server รองรับ → ใช้ STARTTLS; ค่าเริ่มต้น true),
 *   rejectUnauthorized (ตรวจใบรับรอง TLS; ค่าเริ่มต้น true),
 *   user, pass ('' = ไม่ต้อง auth), from, to, cc, subject, html, text, timeoutMs
 * @returns {Promise<{messageId: string|null}>}
 */
export async function sendMail(opts) {
  const {
    host, port = 587, secure = false, starttls = true,
    rejectUnauthorized = true,
    user = '', pass = '',
    from, to = [], cc = [], subject, html, text = '',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  if (!host) throw new SmtpError('ไม่พบ SMTP host', { code: 'CONFIG' });
  const recipients = [...new Set([...to, ...cc].map((s) => s.trim()).filter(Boolean))];
  if (!recipients.length) throw new SmtpError('ไม่มีผู้รับอีเมล', { code: 'NO_RECIPIENTS' });

  const needAuth = Boolean(user);
  // SNI ใช้กับชื่อโดเมนเท่านั้น (IP ไม่สามารถใช้เป็น servername ได้)
  const servername = net.isIP(host) ? undefined : host;

  // --- เชื่อมต่อ (TLS ทันที หรือ plain แล้วค่อย STARTTLS) ---
  let socket;
  await new Promise((resolve, reject) => {
    const onError = (err) => reject(secure ? mapTlsError(err, host) : mapConnectError(err, host, port));
    if (secure) {
      socket = tls.connect({ host, port, servername, rejectUnauthorized }, resolve);
      socket.once('error', onError);
    } else {
      socket = net.connect({ host, port }, resolve);
      socket.once('error', onError);
    }
  });

  const timeout = setTimeout(() => {
    socket.destroy(new SmtpError(`SMTP หมดเวลา (${host}:${port}) — เซิร์ฟเวอร์ไม่ตอบสนอง`, { code: 'TIMEOUT' }));
  }, timeoutMs);

  const cleanup = () => clearTimeout(timeout);

  // --- โปรโตคอลเล็ก ๆ: ส่งคำสั่ง รอตอบกลับ (รองรับ multiline) ---
  let buffer = '';
  let pendingResolve = null;
  let lastError = null;

  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    if (!pendingResolve || !buffer.includes(CRLF)) return;
    // ใช้ทุกบรรทัดที่สมบูรณ์ที่มีอยู่ (รองรับคำตอบหลายบรรทัด) เก็บเศษบรรทัดท้ายไว้
    const parts = buffer.split(CRLF);
    buffer = parts.pop();
    const complete = parts;
    if (!complete.length) return;
    const res = parseResponse(complete);
    if (res.code >= 400) {
      lastError = new SmtpError(`SMTP ตอบกลับผิดพลาด (${res.code}): ${res.message}`, { code: `SMTP_${res.code}`, response: complete.join(CRLF) });
    }
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(res);
  };
  socket.on('data', onData);
  socket.on('error', (err) => {
    lastError = err instanceof SmtpError ? err : new SmtpError(`SMTP error: ${err.message}`, { code: 'SOCKET' });
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve({ code: 0, message: lastError.message, ok: false, error: lastError });
    }
  });
  socket.on('close', () => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve({ code: 0, message: 'connection closed', ok: false, error: lastError || new SmtpError('การเชื่อมต่อ SMTP ปิดก่อนตอบกลับ', { code: 'CLOSED' }) });
    }
  });

  const readGreeting = () => new Promise((resolve) => { pendingResolve = resolve; });
  const cmd = (line) => new Promise((resolve) => {
    pendingResolve = resolve;
    socket.write(line + CRLF);
  });
  const expectOk = (res, what) => {
    if (!res.ok || res.error) {
      throw res.error || new SmtpError(`${what} ล้มเหลว (SMTP ${res.code})`, { code: `SMTP_${res.code}` });
    }
    return res;
  };

  try {
    // --- Greeting ---
    let res = await readGreeting();
    expectOk(res, 'Greeting');

    // --- EHLO ---
    res = await cmd(`EHLO wara-dashboard`);
    expectOk(res, 'EHLO');
    let extensions = res.lines.slice(1);

    // --- STARTTLS (ถ้า secure=false และได้รับอนุญาตให้ใช้ STARTTLS และ server รองรับ) ---
    if (!secure && starttls && hasCapability(extensions, 'STARTTLS')) {
      res = await cmd('STARTTLS');
      expectOk(res, 'STARTTLS');
      await new Promise((resolve, reject) => {
        socket.removeAllListeners('data');
        const tlsSocket = tls.connect({ socket, servername, rejectUnauthorized }, () => {
          socket = tlsSocket;
          buffer = '';
          socket.on('data', onData);
          socket.on('error', () => {});
          resolve();
        });
        tlsSocket.once('error', (err) => reject(mapTlsError(err, host)));
      });
      res = await cmd(`EHLO wara-dashboard`);
      expectOk(res, 'EHLO (หลัง STARTTLS)');
      extensions = res.lines.slice(1);
    }

    // --- AUTH ---
    if (needAuth) {
      const authLine = extensions.find((l) => /^\d{3}[- ]?AUTH/i.test(l.trim())) || '';
      if (hasCapability(extensions, 'AUTH') && /LOGIN/i.test(authLine)) {
        res = await cmd('AUTH LOGIN');
        if (!res.ok || res.code !== 334) throw new SmtpError(`เซิร์ฟเวอร์ไม่รองรับ AUTH LOGIN: ${res.message}`, { code: 'AUTH' });
        res = await cmd(Buffer.from(user, 'utf8').toString('base64'));
        if (res.code !== 334) throw new SmtpError(`AUTH LOGIN ล้มเหลว: ${res.message}`, { code: 'AUTH' });
        res = await cmd(Buffer.from(pass, 'utf8').toString('base64'));
        if (!res.ok) throw new SmtpError(`การยืนยันตัวตน SMTP ล้มเหลว (${res.code}): ${res.message}`, { code: 'AUTH' });
      } else {
        // AUTH PLAIN (\0user\0pass)
        res = await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64')}`);
        if (!res.ok) throw new SmtpError(`การยืนยันตัวตน SMTP ล้มเหลว (${res.code}): ${res.message}`, { code: 'AUTH' });
      }
    }

    // --- MAIL FROM / RCPT TO ---
    const envelopeFrom = extractEnvelopeFrom(from);
    res = await cmd(`MAIL FROM:<${envelopeFrom}>`);
    if (!res.ok) throw new SmtpError(`เซิร์ฟเวอร์ปฏิเสธผู้ส่ง (${res.code}): ${res.message}`, { code: 'SENDER_REJECTED' });
    for (const rcpt of recipients) {
      res = await cmd(`RCPT TO:<${rcpt}>`);
      if (!res.ok) {
        throw new SmtpError(`ผู้รับถูกปฏิเสธ (${rcpt}): ${res.message}`, { code: 'REJECTED', response: res.message });
      }
    }

    // --- DATA ---
    res = await cmd('DATA');
    if (res.code !== 354) throw new SmtpError(`DATA ล้มเหลว: ${res.message}`, { code: 'SMTP_354' });

    const boundary = `----_=${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const safeText = text || stripHtml(html || '');
    const safeHtml = html || `<pre>${safeText}</pre>`;
    const headerLines = [
      `Date: ${new Date().toUTCString()}`,
      `From: ${encodeAddressHeader(from)}`,
      `To: ${to.join(', ')}`,
      cc.length ? `Cc: ${cc.join(', ')}` : null,
      `Subject: ${encodeHeader(subject)}`,
      `Message-ID: ${messageIdFor(from)}`,
      `Reply-To: ${encodeAddressHeader(from)}`,
      'Content-Language: th',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    ].filter(Boolean);

    const bodyParts = [
      '--' + boundary,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      toMimeBase64(safeText),
      '',
      '--' + boundary,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      toMimeBase64(safeHtml),
      '',
      '--' + boundary + '--',
    ];

    const rawMessage = [...headerLines, '', ...bodyParts].join(CRLF);
    // RFC 5321 section 4.5.2: Dot-stuffing (ความโปร่งใสของข้อมูล)
    const dotStuffed = rawMessage.replace(/^\./gm, '..');
    const finalData = dotStuffed + CRLF + '.';

    res = await cmd(finalData);
    if (!res.ok) throw new SmtpError(`เซิร์ฟเวอร์ปฏิเสธอีเมล (${res.code}): ${res.message}`, { code: 'REJECTED' });
    const messageId = (res.message.match(/<([^<>]+)>/) || [null, null])[1];

    // --- QUIT ---
    try { await cmd('QUIT'); } catch { /* ไม่ต้องกังวล */ }
    cleanup();
    socket.destroy();
    return { messageId };
  } catch (err) {
    cleanup();
    socket.destroy();
    throw err;
  }
}

/** QP สำหรับเนื้อหาอีเมล — กันตัวอักษรพิเศษและบรรทัดยาวเกิน 76 ตัวอักษร */
