import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile?.(); } catch {}

import { loadSheetCsv } from './server/google-sheets.js';
import { handleCloudApi } from './server/cloud-api.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);
const isMainScript = Boolean(process.argv[1] && (fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith('server.js')));

let scheduler = null;
let apiHandler = null;
let server = null;

if (isMainScript && !isVercel) {
  const { createScheduler } = await import('./server/scheduler.js');
  const { createApi } = await import('./server/api.js');

  scheduler = createScheduler();
  if (scheduler.status().settings.scheduler.enabled) {
    scheduler.start();
    console.log('[scheduler] เริ่มทำงาน — วนทุก ' + scheduler.status().settings.scheduler.tickMinutes + ' นาที (ปิดได้: ENABLE_SCHEDULER=false)');
  } else {
    console.log('[scheduler] ปิดอยู่ (ENABLE_SCHEDULER=false) — ใช้ node server/scheduler.js หรือ cron แทน');
  }
  apiHandler = createApi({ db: scheduler.db, scheduler });
}

export default async function handler(req, res) {
  try {
    const host = req.headers?.host || 'localhost';
    const reqUrl = new URL(req.url || '/', `http://${host}`);

    if (reqUrl.pathname.startsWith('/api/')) {
      if (isVercel || !apiHandler) {
        const route = reqUrl.pathname.replace(/^\/api\//, '');
        return await handleCloudApi(req, res, route);
      }
      if (req.method === 'GET' && reqUrl.pathname === '/api/source/vara-csv') {
        const csv = await loadSheetCsv();
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(csv);
        return;
      }
      await apiHandler(req, res, reqUrl);
      return;
    }

    let urlPath = decodeURIComponent(reqUrl.pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';

    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not a file');

    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

if (isMainScript && !isVercel) {
  server = createServer(handler).listen(PORT, () => {
    const addr = server.address();
    const port = addr && typeof addr === 'object' ? addr.port : PORT;
    console.log(`แดชบอร์ดวาระคงเหลือ: http://localhost:${port}`);
  });
}

export { scheduler, server, handler };
