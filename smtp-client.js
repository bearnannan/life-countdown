// =============================================================================
// smtp-client.js — Native SMTP Client for Gmail
// Uses only node:net, node:tls, node:crypto (zero external dependencies)
// Supports Port 465 (Implicit TLS) and Port 587 (STARTTLS)
// =============================================================================

import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Configuration defaults
// ---------------------------------------------------------------------------
const TIMEOUT_CONNECT  = 10_000; // 10s — connection establishment
const TIMEOUT_COMMAND  = 15_000; // 15s — waiting for SMTP response
const TIMEOUT_IDLE     = 30_000; // 30s — idle socket timeout

// ---------------------------------------------------------------------------
// SmtpError — typed error for SMTP failures
// ---------------------------------------------------------------------------
export class SmtpError extends Error {
  /** @param {string} message @param {string} [code] @param {boolean} [retryable] */
  constructor(message, code = '', retryable = false) {
    super(message);
    this.name = 'SmtpError';
    this.code = code;
    this.retryable = retryable;
  }
}

// ---------------------------------------------------------------------------
// RFC 5322 Date formatting
// ---------------------------------------------------------------------------
function formatRfc5322Date(date = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const d = days[date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const mon = months[date.getMonth()];
  const year = date.getFullYear();
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');

  // Timezone offset
  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzH = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
  const tzM = String(Math.abs(tzOffset) % 60).padStart(2, '0');

  return `${d}, ${day} ${mon} ${year} ${h}:${m}:${s} ${tzSign}${tzH}${tzM}`;
}

// ---------------------------------------------------------------------------
// RFC 2047 — Encode non-ASCII header values (Thai display name)
// ---------------------------------------------------------------------------
function encodeRfc2047(text) {
  if (/^[\x20-\x7E]+$/.test(text)) return text; // Pure ASCII — no encoding needed
  const encoded = Buffer.from(text, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

// ---------------------------------------------------------------------------
// Build MIME multipart message (text/plain + text/html)
// ---------------------------------------------------------------------------
function buildMimeMessage({ from, fromName, to, cc, subject, html, text }) {
  const boundary = `----=_Part_${randomUUID().replace(/-/g, '')}`;
  const messageId = `<${randomUUID()}@life-countdown.local>`;
  const dateHeader = formatRfc5322Date();
  const encodedFrom = fromName
    ? `${encodeRfc2047(fromName)} <${from}>`
    : from;
  const encodedSubject = encodeRfc2047(subject);

  const toAddresses = Array.isArray(to) ? to.join(', ') : to;
  const ccAddresses = cc
    ? (Array.isArray(cc) ? cc.join(', ') : cc)
    : null;

  let headers = [
    `Date: ${dateHeader}`,
    `From: ${encodedFrom}`,
    `To: ${toAddresses}`,
  ];

  if (ccAddresses) {
    headers.push(`Cc: ${ccAddresses}`);
  }

  headers.push(
    `Subject: ${encodedSubject}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );

  // NOTE: Intentionally omitting Auto-Submitted, Precedence, X-Mailer
  // to avoid M365 bot classification

  const plainPart = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(text || '', 'utf-8').toString('base64'),
  ].join('\r\n');

  const htmlPart = [
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(html || '', 'utf-8').toString('base64'),
  ].join('\r\n');

  const body = [
    ``,
    plainPart,
    ``,
    htmlPart,
    ``,
    `--${boundary}--`,
  ].join('\r\n');

  const fullMessage = headers.join('\r\n') + '\r\n' + body;

  return { fullMessage, messageId };
}

// ---------------------------------------------------------------------------
// SmtpConnection — manages a single SMTP session
// ---------------------------------------------------------------------------
class SmtpConnection {
  /** @type {import('node:net').Socket | import('node:tls').TLSSocket} */
  #socket = null;
  #buffer = '';
  #config;
  #debug;

  /**
   * @param {object} config
   * @param {string} config.host
   * @param {number} config.port
   * @param {boolean} config.secure - true = port 465 implicit TLS
   * @param {string} config.user
   * @param {string} config.pass
   * @param {boolean} [debug]
   */
  constructor(config, debug = false) {
    this.#config = config;
    this.#debug = debug;
  }

  /** Log SMTP conversation when debug is on */
  #log(direction, data) {
    if (!this.#debug) return;
    const prefix = direction === 'S' ? '← S:' : '→ C:';
    const lines = String(data).trim().split('\n');
    for (const line of lines) {
      console.log(`  ${prefix} ${line.trim()}`);
    }
  }

  /**
   * Wait for SMTP response line(s) ending with a final reply (code + space).
   * @param {number} [timeout]
   * @returns {Promise<{code: number, text: string}>}
   */
  #waitForResponse(timeout = TIMEOUT_COMMAND) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SmtpError('SMTP response timeout', 'TIMEOUT', true));
      }, timeout);

      const onData = (chunk) => {
        this.#buffer += chunk.toString();

        // SMTP multi-line: "250-xxx\r\n250 xxx\r\n"
        // Final line has code + space (not code + dash)
        const lines = this.#buffer.split('\r\n');
        const lastComplete = lines.slice(0, -1); // All complete lines

        // Check if we have a final response line
        for (let i = lastComplete.length - 1; i >= 0; i--) {
          const line = lastComplete[i];
          const match = line.match(/^(\d{3})\s/);
          if (match) {
            clearTimeout(timer);
            this.#socket.removeListener('data', onData);
            this.#socket.removeListener('error', onError);

            const code = parseInt(match[1], 10);
            const fullText = lastComplete.join('\n');
            this.#buffer = lines[lines.length - 1]; // Keep remainder
            this.#log('S', fullText);
            resolve({ code, text: fullText });
            return;
          }
        }
      };

      const onError = (err) => {
        clearTimeout(timer);
        this.#socket.removeListener('data', onData);
        reject(new SmtpError(`Socket error: ${err.message}`, 'SOCKET_ERROR', true));
      };

      this.#socket.on('data', onData);
      this.#socket.once('error', onError);
    });
  }

  /**
   * Send an SMTP command and wait for response.
   * @param {string} command
   * @param {number} [expectedCode]
   * @returns {Promise<{code: number, text: string}>}
   */
  async #sendCommand(command, expectedCode = null) {
    this.#log('C', command.startsWith('AUTH') ? 'AUTH PLAIN ****' : command);
    this.#socket.write(command + '\r\n');

    const response = await this.#waitForResponse();

    if (expectedCode && response.code !== expectedCode) {
      const is4xx = response.code >= 400 && response.code < 500;
      throw new SmtpError(
        `Expected ${expectedCode}, got ${response.code}: ${response.text}`,
        String(response.code),
        is4xx
      );
    }

    return response;
  }

  /**
   * Establish connection (Implicit TLS or plain TCP).
   */
  async #connect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SmtpError('Connection timeout', 'CONN_TIMEOUT', true));
      }, TIMEOUT_CONNECT);

      const { host, port, secure } = this.#config;

      if (secure) {
        // Port 465 — Implicit TLS
        this.#socket = tlsConnect({
          host,
          port,
          servername: host,
          rejectUnauthorized: true,
        }, () => {
          clearTimeout(timer);
          this.#socket.setTimeout(TIMEOUT_IDLE);
          resolve();
        });
      } else {
        // Port 587 — Plain TCP first, then STARTTLS
        this.#socket = createConnection({ host, port }, () => {
          clearTimeout(timer);
          this.#socket.setTimeout(TIMEOUT_IDLE);
          resolve();
        });
      }

      this.#socket.once('error', (err) => {
        clearTimeout(timer);
        reject(new SmtpError(`Connection failed: ${err.message}`, 'CONN_ERROR', true));
      });

      this.#socket.once('timeout', () => {
        this.#socket.destroy();
        reject(new SmtpError('Socket idle timeout', 'IDLE_TIMEOUT', true));
      });
    });
  }

  /**
   * Upgrade plain connection to TLS (STARTTLS).
   */
  async #upgradeToTls() {
    return new Promise((resolve, reject) => {
      const { host } = this.#config;

      const tlsSocket = tlsConnect({
        socket: this.#socket,
        servername: host,
        rejectUnauthorized: true,
      }, () => {
        this.#socket = tlsSocket;
        this.#socket.setTimeout(TIMEOUT_IDLE);
        this.#socket.once('timeout', () => {
          this.#socket.destroy();
        });
        resolve();
      });

      tlsSocket.once('error', (err) => {
        reject(new SmtpError(`TLS upgrade failed: ${err.message}`, 'TLS_ERROR', true));
      });
    });
  }

  /**
   * Full SMTP session: connect → EHLO → [STARTTLS] → AUTH → MAIL/RCPT → DATA → QUIT
   * @param {object} mailOptions
   * @returns {Promise<{messageId: string}>}
   */
  async send(mailOptions) {
    const { host, port, secure, user, pass } = this.#config;
    const { from, fromName, to, cc, subject, html, text } = mailOptions;

    const allRecipients = [
      ...(Array.isArray(to) ? to : [to]),
      ...(cc ? (Array.isArray(cc) ? cc : [cc]) : []),
    ];

    try {
      // 1. Connect
      this.#log('C', `Connecting to ${host}:${port} (${secure ? 'Implicit TLS' : 'STARTTLS'})...`);
      await this.#connect();

      // 2. Wait for greeting
      const greeting = await this.#waitForResponse(TIMEOUT_CONNECT);
      if (greeting.code !== 220) {
        throw new SmtpError(`Unexpected greeting: ${greeting.code} ${greeting.text}`, String(greeting.code));
      }

      // 3. EHLO
      const senderDomain = from.split('@')[1] || 'localhost';
      await this.#sendCommand(`EHLO ${senderDomain}`);

      // 4. STARTTLS (port 587 only)
      if (!secure) {
        await this.#sendCommand('STARTTLS', 220);
        await this.#upgradeToTls();
        this.#buffer = '';
        // Re-EHLO after TLS upgrade
        await this.#sendCommand(`EHLO ${senderDomain}`);
      }

      // 5. AUTH PLAIN
      const authString = Buffer.from(`\0${user}\0${pass}`).toString('base64');
      await this.#sendCommand(`AUTH PLAIN ${authString}`, 235);

      // 6. MAIL FROM
      await this.#sendCommand(`MAIL FROM:<${from}>`, 250);

      // 7. RCPT TO (all recipients)
      for (const recipient of allRecipients) {
        await this.#sendCommand(`RCPT TO:<${recipient}>`, 250);
      }

      // 8. DATA
      await this.#sendCommand('DATA', 354);

      // 9. Send MIME message
      const { fullMessage, messageId } = buildMimeMessage({
        from, fromName, to, cc, subject, html, text,
      });

      // Dot-stuffing: lines starting with "." get an extra "."
      const stuffed = fullMessage.replace(/\r\n\./g, '\r\n..');
      this.#socket.write(stuffed + '\r\n.\r\n');
      this.#log('C', '[message body sent]');

      const dataResponse = await this.#waitForResponse();
      if (dataResponse.code !== 250) {
        throw new SmtpError(
          `DATA rejected: ${dataResponse.code} ${dataResponse.text}`,
          String(dataResponse.code),
          dataResponse.code >= 400 && dataResponse.code < 500
        );
      }

      // 10. QUIT
      try {
        await this.#sendCommand('QUIT', 221);
      } catch {
        // QUIT failure is non-critical — email was already accepted
      }

      return { messageId };

    } finally {
      // Ensure socket cleanup
      if (this.#socket) {
        this.#socket.removeAllListeners();
        if (!this.#socket.destroyed) {
          this.#socket.destroy();
        }
        this.#socket = null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API: sendMail()
// ---------------------------------------------------------------------------

/**
 * Send an email using the native SMTP client.
 *
 * @param {object} options
 * @param {string}          options.from     - Sender email address
 * @param {string}          [options.fromName] - Sender display name (Thai supported)
 * @param {string|string[]} options.to       - Recipient(s)
 * @param {string|string[]} [options.cc]     - CC recipient(s)
 * @param {string}          options.subject  - Email subject (Thai supported)
 * @param {string}          options.html     - HTML body
 * @param {string}          options.text     - Plain-text body
 * @param {boolean}         [options.debug]  - Print SMTP conversation
 * @returns {Promise<{success: boolean, messageId: string}>}
 */
export async function sendMail(options) {
  const config = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: (process.env.SMTP_SECURE ?? 'true') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  };

  if (!config.user || !config.pass) {
    throw new SmtpError('SMTP_USER and SMTP_PASS environment variables are required', 'CONFIG_ERROR');
  }

  const from = options.from || process.env.EMAIL_FROM || config.user;
  const fromName = options.fromName || process.env.EMAIL_FROM_NAME || '';

  const conn = new SmtpConnection(config, options.debug ?? false);

  const result = await conn.send({
    from,
    fromName,
    to: options.to,
    cc: options.cc,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  return { success: true, messageId: result.messageId };
}
