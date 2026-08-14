// =============================================================================
// test-smtp.js — SMTP Connectivity & Test Email Script
// Usage:
//   node test-smtp.js --check        # Test SMTP connectivity only
//   node test-smtp.js --send <email> # Send a test email
// =============================================================================

import { sendMail } from './smtp-client.js';
import { readFileSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Inline .env loader (zero dependency)
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = new URL('.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

  if (!existsSync(envPath)) {
    console.warn('[env] No .env file found, using existing environment variables');
    return;
  }

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
  console.log('[env] ✅ Loaded .env file\n');
}

// ---------------------------------------------------------------------------
// Check required environment variables
// ---------------------------------------------------------------------------
function checkEnvVars() {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const optional = ['SMTP_SECURE', 'EMAIL_FROM', 'EMAIL_FROM_NAME'];
  let allOk = true;

  console.log('📋 Environment Variables Check:');
  console.log('─'.repeat(50));

  for (const key of required) {
    const value = process.env[key];
    if (value) {
      const masked = key.includes('PASS')
        ? value.substring(0, 4) + '****'
        : value;
      console.log(`  ✅ ${key} = ${masked}`);
    } else {
      console.log(`  ❌ ${key} = (missing!)`);
      allOk = false;
    }
  }

  for (const key of optional) {
    const value = process.env[key];
    console.log(`  ${value ? '✅' : '⚠️'} ${key} = ${value || '(not set)'}`);
  }

  console.log('─'.repeat(50));
  return allOk;
}

// ---------------------------------------------------------------------------
// SMTP connectivity check (connect + EHLO + AUTH + QUIT)
// ---------------------------------------------------------------------------
async function checkSmtpConnectivity() {
  console.log('\n🔌 SMTP Connectivity Test:');
  console.log('─'.repeat(50));

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const secure = (process.env.SMTP_SECURE ?? 'true') === 'true';

  console.log(`  Host: ${host}`);
  console.log(`  Port: ${port}`);
  console.log(`  Mode: ${secure ? 'Implicit TLS (465)' : 'STARTTLS (587)'}`);
  console.log('');

  try {
    // Send a minimal test — to ourselves, but we won't actually deliver
    // Just test AUTH by sending to our own address
    console.log('  Attempting connection + authentication...');
    const result = await sendMail({
      to: process.env.SMTP_USER, // send to self
      subject: '[Test] SMTP Connectivity Check',
      text: 'This is an automated SMTP connectivity test from Life Countdown.',
      html: '<p>This is an automated SMTP connectivity test from <strong>Life Countdown</strong>.</p>',
      debug: true,
    });

    console.log('\n  ✅ SMTP connectivity test PASSED');
    console.log(`  Message-ID: ${result.messageId}`);
    return true;
  } catch (err) {
    console.error(`\n  ❌ SMTP connectivity test FAILED`);
    console.error(`  Error: ${err.message}`);

    // Diagnostic hints
    if (err.message.includes('AUTH')) {
      console.error('\n  💡 Hint: Authentication failed. Please check:');
      console.error('     1. SMTP_USER is your full Gmail address');
      console.error('     2. SMTP_PASS is a 16-character Google App Password (not your account password)');
      console.error('     3. 2-Step Verification is enabled on your Google Account');
    } else if (err.message.includes('connect') || err.message.includes('timeout')) {
      console.error('\n  💡 Hint: Connection failed. Please check:');
      console.error('     1. Network connectivity to smtp.gmail.com');
      console.error('     2. Firewall is not blocking port ' + port);
      console.error('     3. Try switching SMTP_PORT between 465 and 587');
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// Send test email
// ---------------------------------------------------------------------------
async function sendTestEmail(recipient) {
  console.log(`\n📧 Sending Test Email to: ${recipient}`);
  console.log('─'.repeat(50));

  const now = new Date();
  const subject = `[ทดสอบ] ระบบแจ้งเตือนวาระ Life Countdown — ${now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`;

  const html = `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"></head>
<body style="font-family:'Sarabun','Noto Sans Thai',Arial,sans-serif; font-size:15px; line-height:1.6; color:#1a1a1a; padding:20px;">
  <h2 style="color:#059669; margin-bottom:16px;">✅ ทดสอบการส่งอีเมลสำเร็จ</h2>
  <p>อีเมลนี้ถูกส่งจากระบบ <strong>Life Countdown</strong> เพื่อทดสอบการเชื่อมต่อ SMTP</p>
  <table style="margin:16px 0; font-size:14px;">
    <tr><td style="padding:4px 12px 4px 0; color:#666;">เวลาที่ส่ง:</td><td>${now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td></tr>
    <tr><td style="padding:4px 12px 4px 0; color:#666;">SMTP Host:</td><td>${process.env.SMTP_HOST}</td></tr>
    <tr><td style="padding:4px 12px 4px 0; color:#666;">SMTP Port:</td><td>${process.env.SMTP_PORT}</td></tr>
    <tr><td style="padding:4px 12px 4px 0; color:#666;">From:</td><td>${process.env.EMAIL_FROM || process.env.SMTP_USER}</td></tr>
  </table>
  <p style="color:#888; font-size:13px; border-top:1px solid #eee; padding-top:12px; margin-top:20px;">
    หากท่านได้รับอีเมลนี้ใน <strong>Inbox</strong> (ไม่ใช่ Spam/Junk) แสดงว่าระบบทำงานปกติ
  </p>
</body>
</html>`;

  const text = `✅ ทดสอบการส่งอีเมลสำเร็จ

อีเมลนี้ถูกส่งจากระบบ Life Countdown เพื่อทดสอบการเชื่อมต่อ SMTP

เวลาที่ส่ง: ${now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
SMTP Host: ${process.env.SMTP_HOST}
SMTP Port: ${process.env.SMTP_PORT}
From: ${process.env.EMAIL_FROM || process.env.SMTP_USER}

หากท่านได้รับอีเมลนี้ใน Inbox (ไม่ใช่ Spam/Junk) แสดงว่าระบบทำงานปกติ`;

  try {
    const result = await sendMail({
      to: recipient,
      subject,
      html,
      text,
      debug: true,
    });

    console.log(`\n✅ Test email sent successfully!`);
    console.log(`   Message-ID: ${result.messageId}`);
    console.log(`\n📌 Next steps:`);
    console.log(`   1. Check "${recipient}" inbox for the test email`);
    console.log(`   2. Verify it landed in Inbox (not Spam/Junk/Promotions)`);
    console.log(`   3. Check that Thai characters display correctly`);
    return true;
  } catch (err) {
    console.error(`\n❌ Failed to send test email: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  Life Countdown — SMTP Test Script            ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  loadEnv();

  const args = process.argv.slice(2);
  const mode = args[0] || '--check';

  // 1. Always check env vars first
  const envOk = checkEnvVars();
  if (!envOk) {
    console.error('\n❌ Missing required environment variables. Please configure .env file.');
    process.exit(1);
  }

  if (mode === '--check') {
    // Connectivity check only
    const ok = await checkSmtpConnectivity();
    process.exit(ok ? 0 : 1);

  } else if (mode === '--send') {
    const recipient = args[1];
    if (!recipient || !recipient.includes('@')) {
      console.error('\n❌ Usage: node test-smtp.js --send <email@example.com>');
      process.exit(1);
    }
    const ok = await sendTestEmail(recipient);
    process.exit(ok ? 0 : 1);

  } else {
    console.log('Usage:');
    console.log('  node test-smtp.js --check          Test SMTP connectivity');
    console.log('  node test-smtp.js --send <email>   Send a test email');
    process.exit(0);
  }
}

main();
