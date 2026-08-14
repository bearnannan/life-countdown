// ============================================================
// Fake SMTP server สำหรับเทสต์ (node:net / node:tls)
// ------------------------------------------------------------
// รองรับ:
//  - โหมดธรรมดา และโหมด TLS ทันที (implicit TLS)
//  - AUTH LOGIN / AUTH PLAIN
//  - การจำลองความล้มเหลว (state.failWith)
//  - บันทึกคำสั่งที่ได้รับ + เนื้อหาอีเมล
// ============================================================

import net from 'node:net';
import tls from 'node:tls';

export function fakeSmtp({ auth = false, tlsOptions = null } = {}) {
  const received = { commands: [], data: '', authUser: null, authPass: null, authPlain: null };
  const state = { failWith: null };

  function attach(socket) {
    let buf = '';
    let inData = false;
    let dataLines = [];
    let step = 'greet';

    socket.write('220 fake ESMTP ready\r\n');
    const reply = (s) => socket.write(s + '\r\n');

    const handle = (line) => {
      received.commands.push(line);
      if (state.failWith && line.startsWith(state.failWith.cmd)) {
        reply(state.failWith.reply);
        return;
      }
      if (inData) {
        if (line === '.') {
          inData = false;
          received.data = dataLines.join('\n');
          dataLines = [];
          reply('250 2.0.0 Ok: queued as <ABC123>');
        } else {
          dataLines.push(line);
        }
        return;
      }
      if (line === 'EHLO wara-dashboard') {
        reply('250-fake\r\n250-SIZE 10240000\r\n250 ' + (auth ? 'AUTH PLAIN LOGIN' : '8BITMIME'));
      } else if (line === 'STARTTLS') {
        reply('220 2.0.0 Ready to start TLS');
      } else if (line === 'AUTH LOGIN') {
        step = 'user';
        reply('334 VXNlcm5hbWU6');
      } else if (step === 'user') {
        step = 'pass';
        received.authUser = Buffer.from(line, 'base64').toString('utf8');
        reply('334 UGFzc3dvcmQ6');
      } else if (step === 'pass') {
        step = 'done';
        received.authPass = Buffer.from(line, 'base64').toString('utf8');
        reply('235 2.7.0 Authentication successful');
      } else if (line.startsWith('AUTH PLAIN ')) {
        received.authPlain = line;
        step = 'done';
        reply('235 2.7.0 Authentication successful');
      } else if (line.startsWith('MAIL FROM')) {
        reply('250 2.1.0 Ok');
      } else if (line.startsWith('RCPT TO')) {
        reply('250 2.1.5 Ok');
      } else if (line === 'DATA') {
        inData = true;
        reply('354 End data with <CR><LF>.<CR><LF>');
      } else if (line === 'QUIT') {
        reply('221 2.0.0 Bye');
        socket.end();
      } else {
        reply('250 Ok');
      }
    };

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        handle(line);
      }
    });
    socket.on('error', () => {});
  }

  return new Promise((resolve) => {
    if (tlsOptions) {
      const srv = tls.createServer(tlsOptions, attach);
      srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, stop: () => new Promise((r) => srv.close(r)), received, state }));
    } else {
      const srv = net.createServer(attach);
      srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, stop: () => new Promise((r) => srv.close(r)), received, state }));
    }
  });
}
