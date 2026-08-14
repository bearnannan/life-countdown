import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSixMonth, validateRenderedEmail } from '../server/email-templates.js';
import { sendMail } from '../server/smtp.js';
import { fakeSmtp } from './helpers/fake-smtp.js';

function decodeMimePart(data, contentType) {
  const start = data.indexOf(`Content-Type: ${contentType}; charset=UTF-8`);
  assert.notEqual(start, -1);
  const section = data.slice(start);
  const bodyStart = section.indexOf('\n\n');
  assert.notEqual(bodyStart, -1);
  const encoded = section
    .slice(bodyStart + 2)
    .split('\n--')[0]
    .replace(/\s/g, '');
  return Buffer.from(encoded, 'base64').toString('utf8');
}

test('email renderer: custom HTML template is the final HTML and variables are escaped', () => {
  const templateHtml = [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">',
    '<tr><td align="right">{{person_name}}</td></tr>',
    '<tr><td>{{position}} | {{term_start_date}} | {{term_end_date}} | {{days_remaining}} | {{status}}</td></tr>',
    '</table>',
  ].join('');

  const rendered = renderSixMonth({
    name: 'นายสมชาย ใจดี',
    positionLabel: 'ผู้ใหญ่บ้าน',
    startDate: { y: 2021, m: 1, d: 1 },
    endDate: { y: 2026, m: 8, d: 18 },
    daysLeft: 5,
    today: { y: 2026, m: 8, d: 13 },
  }, {
    customConfig: {
      subject: 'แจ้งเตือน {{person_name}} {{status}}',
      templateHtml,
      templateText: '{{person_name}} {{days_remaining}}',
    },
  });

  assert.equal(rendered.html.startsWith('<table role="presentation"'), true);
  assert.equal(rendered.html.includes('<!DOCTYPE html>'), false);
  assert.match(rendered.html, /width="100%"/);
  assert.match(rendered.html, /align="right"/);
  assert.match(rendered.html, /นายสมชาย ใจดี/);
  assert.match(rendered.html, /ผู้ใหญ่บ้าน/);
  assert.match(rendered.html, /5/);
  assert.match(rendered.html, /ใกล้หมดวาระ/);
  assert.deepEqual(validateRenderedEmail(rendered), { ok: true, errors: [] });
});

test('email renderer: validation rejects broken HTML attributes and replacement characters', () => {
  const rendered = {
    subject: 'x',
    html: '<table role="resentation" width="00%" cellpadding="cellspacing="><tr><td>��</td></tr></table>',
    text: 'x',
  };
  const validation = validateRenderedEmail(rendered);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((err) => err.includes('replacement characters')));
  assert.ok(validation.errors.some((err) => err.includes('HTML attributes')));
});

test('email renderer: does not send localhost dashboard URLs to recipients', () => {
  const rendered = renderSixMonth({
    name: 'นายสมชาย ใจดี',
    positionLabel: 'ผู้ใหญ่บ้าน',
    startDate: { y: 2021, m: 1, d: 1 },
    endDate: { y: 2026, m: 8, d: 18 },
    daysLeft: 5,
    today: { y: 2026, m: 8, d: 13 },
  }, {
    dashboardUrl: 'http://localhost:4173',
    customConfig: {
      subject: 'แจ้งเตือน {{person_name}}',
      templateHtml: '<a href="{{action_url}}">เปิดแดชบอร์ด</a>',
      templateText: '{{action_url}}',
    },
  });

  assert.equal(rendered.html, '<a href="">เปิดแดชบอร์ด</a>');
  assert.equal(rendered.text, '');
  assert.equal(rendered.html.includes('localhost'), false);
  assert.deepEqual(validateRenderedEmail(rendered), { ok: true, errors: [] });
});

test('SMTP MIME: sends UTF-8 HTML as base64 without corrupting Thai or attributes', async () => {
  const fake = await fakeSmtp();
  try {
    const html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="right">ระบบแจ้งเตือนวาระ นายสมชาย ใจดี</td></tr></table>';
    const text = 'ระบบแจ้งเตือนวาระ นายสมชาย ใจดี';
    const result = await sendMail({
      host: '127.0.0.1',
      port: fake.port,
      secure: false,
      user: '',
      from: 'ระบบแจ้งเตือนวาระ <wara.noreply.app@gmail.com>',
      to: ['watchara@example.com'],
      subject: 'ทดสอบ แจ้งเตือนใกล้หมดวาระ 6 เดือน',
      html,
      text,
    });

    assert.equal(result.messageId, 'ABC123');
    assert.ok(fake.received.commands.includes('MAIL FROM:<wara.noreply.app@gmail.com>'));
    assert.match(fake.received.data, /^From: =\?UTF-8\?B\?.* <wara\.noreply\.app@gmail\.com>/m);
    assert.match(fake.received.data, /^Subject: =\?UTF-8\?B\?/m);
    assert.match(fake.received.data, /^Message-ID: <.+@gmail\.com>/m);
    assert.match(fake.received.data, /^Reply-To: =\?UTF-8\?B\?.* <wara\.noreply\.app@gmail\.com>/m);
    assert.match(fake.received.data, /^Content-Language: th$/m);
    // Auto-Submitted / X-Auto-Response-Suppress ถูกนำออกเพื่อให้ Microsoft 365 Groups แสดงอีเมลใน shared mailbox
    assert.equal(/^Auto-Submitted:/m.test(fake.received.data), false, 'Auto-Submitted header should be absent');
    assert.equal(/^X-Auto-Response-Suppress:/m.test(fake.received.data), false, 'X-Auto-Response-Suppress header should be absent');
    assert.match(fake.received.data, /Content-Type: text\/html; charset=UTF-8/);
    assert.match(fake.received.data, /Content-Transfer-Encoding: base64/);

    const decodedHtml = decodeMimePart(fake.received.data, 'text/html');
    assert.equal(decodedHtml, html);
    assert.equal(decodedHtml.includes('��'), false);
    assert.match(decodedHtml, /role="presentation"/);
    assert.match(decodedHtml, /width="100%"/);
    assert.match(decodedHtml, /align="right"/);

    const decodedText = decodeMimePart(fake.received.data, 'text/plain');
    assert.equal(decodedText, text);
  } finally {
    await fake.stop();
  }
});
