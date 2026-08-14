import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseCSV } from '../js/csv.js';

const DEFAULT_SHEET_ID = '1cq0Cal0O2Q3dCQ3FaPAJz9TnUKtsolTEOMiPva_pm-Q';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function hasGoogleConfig() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && privateKey());
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = privateKey();
  if (!email || !key) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL และ GOOGLE_PRIVATE_KEY ต้องถูกตั้งค่า');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const payload = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = createSign('RSA-SHA256').update(payload).sign(key, 'base64url');
  const assertion = `${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Google OAuth ${res.status}`);
  return data.access_token;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows) {
  return (rows || []).map((row) => (row || []).map(csvCell).join(',')).join('\n');
}

export async function loadSheetRows({
  spreadsheetId = process.env.GOOGLE_SHEETS_ID || DEFAULT_SHEET_ID,
  range = process.env.GOOGLE_SHEETS_RANGE || 'A:Z',
} = {}) {
  if (!hasGoogleConfig()) {
    const fallback = await readFile(new URL('../data/vara_utf8.csv', import.meta.url), 'utf8');
    return parseCSV(fallback);
  }
  const token = await getAccessToken();
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Google Sheets ${res.status}`);
  return data.values || [];
}

export async function loadSheetCsv(opts = {}) {
  return rowsToCsv(await loadSheetRows(opts));
}
