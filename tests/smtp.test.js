// ============================================================
// เทสต์ SMTP client — ใช้ fake SMTP server (node:net / node:tls)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendMail } from '../server/smtp.js';
import { fakeSmtp } from './helpers/fake-smtp.js';

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

test('SMTP: ส่งสำเร็จ — ตรวจคำสั่ง EHLO/MAIL/RCPT/DATA และ messageId', async () => {
  const fake = await fakeSmtp();
  try {
    const res = await sendMail({
      host: '127.0.0.1', port: fake.port, secure: false, user: '',
      from: 'noreply@example.com', to: ['a@example.com'], cc: ['b@example.com'],
      subject: 'ทดสอบ', html: '<p>hi</p>', text: 'hi',
    });
    assert.equal(res.messageId, 'ABC123');
    const cmds = fake.received.commands;
    assert.ok(cmds.some((c) => c.startsWith('EHLO')));
    assert.ok(cmds.some((c) => c.startsWith('MAIL FROM:<noreply@example.com>')));
    assert.ok(cmds.some((c) => c.startsWith('RCPT TO:<a@example.com>')));
    assert.ok(cmds.some((c) => c.startsWith('RCPT TO:<b@example.com>')));
    assert.ok(cmds.includes('DATA'));
    assert.ok(cmds.includes('.'));
    assert.ok(cmds.includes('QUIT'));
    assert.match(fake.received.data, /^Subject: =\?UTF-8\?B\?/m);
  } finally { await fake.stop(); }
});

test('SMTP: AUTH LOGIN — ตรวจ base64 user/pass ถูกส่ง', async () => {
  const fake = await fakeSmtp({ auth: true });
  try {
    await sendMail({
      host: '127.0.0.1', port: fake.port, secure: false, user: 'user1', pass: 'p@ss',
      from: 'noreply@example.com', to: ['a@example.com'], subject: 's', html: 'h', text: 't',
    });
    assert.equal(fake.received.authUser, 'user1');
    assert.equal(fake.received.authPass, 'p@ss');
    const cmds = fake.received.commands;
    assert.ok(cmds.includes('AUTH LOGIN'));
  } finally { await fake.stop(); }
});

test('SMTP: AUTH PLAIN ใช้เมื่อ server ไม่มี LOGIN', async () => {
  {
    const cmds = [];
    const srv = net.createServer((socket) => {
      let buf = '';
      socket.write('220 x\r\n');
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2); cmds.push(line);
          if (line.startsWith('EHLO')) socket.write('250-x\r\n250 AUTH PLAIN\r\n');
          else if (line.startsWith('AUTH PLAIN')) socket.write('235 2.7.0 Ok\r\n');
          else if (line.startsWith('MAIL FROM')) socket.write('250 Ok\r\n');
          else if (line.startsWith('RCPT TO')) socket.write('250 Ok\r\n');
          else if (line === 'DATA') socket.write('354 go\r\n');
          else if (line === '.') socket.write('250 Ok: queued <MID1>\r\n');
          else if (line === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
          else socket.write('250 Ok\r\n');
        }
      });
      socket.on('error', () => {});
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      await sendMail({ host: '127.0.0.1', port: srv.address().port, user: 'u', pass: 'p', from: 'f@x.com', to: ['a@x.com'], subject: 's', html: 'h', text: 't' });
      const plain = cmds.find((c) => c.startsWith('AUTH PLAIN '));
      assert.ok(plain);
      const decoded = Buffer.from(plain.replace('AUTH PLAIN ', ''), 'base64').toString('utf8');
      assert.equal(decoded, '\u0000u\u0000p');
    } finally { await new Promise((r) => srv.close(r)); }
  }
});

test('SMTP: auth ล้มเหลว → โยน SmtpError (AUTH) ไม่ใช่ sent', async () => {
  const fake = await fakeSmtp({ auth: true });
  fake.state.failWith = { cmd: 'AUTH LOGIN', reply: '535 5.7.8 Authentication credentials invalid' };
  try {
    await assert.rejects(
      sendMail({ host: '127.0.0.1', port: fake.port, secure: false, user: 'u', pass: 'bad', from: 'f@x.com', to: ['a@x.com'], subject: 's', html: 'h', text: 't' }),
      (err) => err.code === 'AUTH',
    );
  } finally { await fake.stop(); }
});

test('SMTP: ผู้รับถูกปฏิเสธ (RCPT 550) → โยน error REJECTED', async () => {
  const fake = await fakeSmtp();
  fake.state.failWith = { cmd: 'RCPT TO', reply: '550 5.1.1 No such user' };
  try {
    await assert.rejects(
      sendMail({ host: '127.0.0.1', port: fake.port, secure: false, user: '', from: 'f@x.com', to: ['ghost@x.com'], subject: 's', html: 'h', text: 't' }),
      (err) => err.code === 'REJECTED',
    );
  } finally { await fake.stop(); }
});

test('SMTP: ผู้ส่งถูกปฏิเสธ (MAIL FROM 550) → error SENDER_REJECTED', async () => {
  const fake = await fakeSmtp();
  fake.state.failWith = { cmd: 'MAIL FROM', reply: '550 5.7.1 Sender rejected' };
  try {
    await assert.rejects(
      sendMail({ host: '127.0.0.1', port: fake.port, secure: false, user: '', from: 'f@x.com', to: ['a@x.com'], subject: 's', html: 'h', text: 't' }),
      (err) => err.code === 'SENDER_REJECTED',
    );
  } finally { await fake.stop(); }
});

test('SMTP: ไม่มีผู้รับ → error NO_RECIPIENTS (ไม่พยายามเชื่อมต่อ)', async () => {
  await assert.rejects(
    sendMail({ host: '127.0.0.1', port: 1, secure: false, user: '', from: 'f@x.com', to: [], subject: 's', html: 'h', text: 't' }),
    (err) => err.code === 'NO_RECIPIENTS',
  );
});

test('SMTP: เชื่อมต่อไม่ได้ (พอร์ตปิด) → error CONNECT', async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  await assert.rejects(
    sendMail({ host: '127.0.0.1', port, secure: false, user: '', from: 'f@x.com', to: ['a@x.com'], subject: 's', html: 'h', text: 't' }),
    (err) => err.code === 'CONNECT',
  );
});

test('SMTP: DNS ไม่พบ host → error DNS', { timeout: 20000 }, async () => {
  await assert.rejects(
    sendMail({ host: 'smtp.does-not-exist.invalid', port: 25, secure: false, user: '', from: 'f@x.com', to: ['a@x.com'], subject: 's', html: 'h', text: 't', timeoutMs: 10000 }),
    (err) => err.code === 'DNS',
  );
});

// ---------- TLS: ใบรับรองที่ลงนามเอง ----------

test('SMTP/TLS: ตรวจสอบใบรับรองตามค่าเริ่มต้น — ใบรับรองลงนามเองถูกปฏิเสธ (TLS_CERT)', { skip: !hasOpenssl() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wara-cert-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
    const fake = await fakeSmtp({
      tlsOptions: { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    });
    try {
      await assert.rejects(
        sendMail({ host: '127.0.0.1', port: fake.port, secure: true, rejectUnauthorized: true, user: '', from: 'f@x.com', to: ['a@x.com'], subject: 's', html: 'h', text: 't', timeoutMs: 10000 }),
        (err) => err.code === 'TLS_CERT',
      );
    } finally { await fake.stop(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SMTP/TLS: rejectUnauthorized=false → ยอมรับใบรับรองที่ลงนามเองและส่งสำเร็จ', { skip: !hasOpenssl() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wara-cert-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
    const fake = await fakeSmtp({
      tlsOptions: { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    });
    try {
      const res = await sendMail({ host: '127.0.0.1', port: fake.port, secure: true, rejectUnauthorized: false, user: '', from: 'f@x.com', to: ['a@x.com'], subject: 's', html: 'h', text: 't', timeoutMs: 10000 });
      assert.equal(res.messageId, 'ABC123');
    } finally { await fake.stop(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
