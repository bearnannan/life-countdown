// =============================================================================
// data-source.js — Google Sheets Data Fetcher (Zero Dependency)
// Uses node:crypto for RS256 JWT signing, native fetch for HTTP
// Supports Thai duration parsing ("5 ปี 1 เดือน") + Reference Date calculation
// =============================================================================

import { createSign } from 'node:crypto';

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------
function getConfig() {
  const sheetsId = process.env.GOOGLE_SHEETS_ID;
  const sheetsRange = process.env.GOOGLE_SHEETS_RANGE || 'A:Z';
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!sheetsId || !serviceAccountEmail || !privateKey) {
    throw new Error(
      'Missing Google Sheets config: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY'
    );
  }

  const cleanKey = privateKey.replace(/\\n/g, '\n');
  const referenceDate = process.env.DATA_REFERENCE_DATE || '2026-08-13';

  return { sheetsId, sheetsRange, serviceAccountEmail, privateKey: cleanKey, referenceDate };
}

// ---------------------------------------------------------------------------
// JWT Signing (RS256) for Google Service Account
// ---------------------------------------------------------------------------

function base64url(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createServiceAccountJwt(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const segments = `${base64url(header)}.${base64url(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(segments);
  const signature = signer.sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${segments}.${signature}`;
}

// ---------------------------------------------------------------------------
// Token Exchange — JWT → Access Token
// ---------------------------------------------------------------------------

async function getAccessToken(jwt) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google token exchange failed (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Fetch Sheet Data
// ---------------------------------------------------------------------------

async function fetchSheetValues(sheetsId, range, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetsId)}/values/${encodeURIComponent(range)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google Sheets API error (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  return data.values || [];
}

// ---------------------------------------------------------------------------
// Date & Duration Math
// ---------------------------------------------------------------------------

function normalizeDigits(input) {
  return String(input ?? '').replace(/[๐-๙]/g, (ch) => String(ch.charCodeAt(0) - 0x0e50));
}

function lastDayOfMonthUTC(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toUTCDate({ y, m, d }) {
  return Date.UTC(y, m - 1, d);
}

export function parseDurationWara(input) {
  if (input === null || input === undefined) return null;
  const s = normalizeDigits(input).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/หมดวาระ|หมดอายุ|สิ้นสุดวาระ/.test(s)) return { years: 0, months: 0, days: 0 };
  if (/^(?:ไม่ระบุ|ไม่มี|n\/a|na|-|–)$/i.test(s)) return null;

  const m = s.match(/^(?:(?<y>\d+)\s*ปี)?(?:\s*(?<mo>\d+)\s*เดือน)?(?:\s*(?<d>\d+)\s*วัน)?$/);
  if (!m || (!m.groups.y && !m.groups.mo && !m.groups.d)) return null;

  return {
    years: m.groups.y ? Number(m.groups.y) : 0,
    months: m.groups.mo ? Number(m.groups.mo) : 0,
    days: m.groups.d ? Number(m.groups.d) : 0,
  };
}

export function addDuration(date, dur) {
  if (!date || !dur) return null;
  const total = date.y * 12 + (date.m - 1) + dur.years * 12 + dur.months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const clamped = { y: ty, m: tm, d: Math.min(date.d, lastDayOfMonthUTC(ty, tm)) };
  if (!dur.days) return clamped;

  const ms = toUTCDate(clamped) + dur.days * 86400000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function parseYMD(str) {
  if (!str) return null;
  const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toISO({ y, m, d }) {
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

function getTodayBangkok() {
  const now = new Date();
  const bangkokDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return {
    y: bangkokDate.getFullYear(),
    m: bangkokDate.getMonth() + 1,
    d: bangkokDate.getDate()
  };
}

function calcDaysBetween(start, end) {
  return Math.round((toUTCDate(end) - toUTCDate(start)) / 86400000);
}

// ---------------------------------------------------------------------------
// Parse & Transform Officers from Raw Rows
// ---------------------------------------------------------------------------

function parseOfficers(rows, referenceDateStr) {
  if (!rows || rows.length < 2) return [];

  const headers = rows[0].map(h => String(h || '').replace(/\s+/g, ' ').trim());

  // Find column indices
  const colTor = headers.findIndex(h => h.includes('ลำดับ'));
  const colName = headers.findIndex(h => h.includes('เจ้าหน้าที่') || h.includes('ชื่อ'));
  const colPosition = headers.findIndex(h => h.includes('ตำแหน่ง'));
  const colVillage = headers.findIndex(h => h.includes('หมู่บ้าน'));
  const colTambon = headers.findIndex(h => h.includes('ตำบล'));
  const colPhone = headers.findIndex(h => h.includes('เบอร์โทร'));
  const colWara = headers.findIndex(h => h.includes('วาระคงเหลือ'));
  const colEmail = headers.findIndex(h => h.toLowerCase().includes('email') || h.includes('อีเมล'));

  const today = getTodayBangkok();
  const refDate = parseYMD(referenceDateStr) || { y: 2026, m: 8, d: 13 };

  const officers = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const get = (idx) => (idx >= 0 && idx < row.length ? String(row[idx] || '').trim() : '');

    const name = get(colName);
    if (!name) continue; // skip unnamed rows

    const tor = get(colTor) || String(i);
    const position = get(colPosition);
    const village = get(colVillage);
    const subDistrict = get(colTambon);
    const phone = get(colPhone);
    const waraRaw = get(colWara);
    const email = get(colEmail); // might be empty in initial sheet, notifications can route to admin/officer email

    // Calculate term end date from duration + reference date
    let termEndDate = null;
    let daysLeft = null;

    if (waraRaw) {
      // Check if it's already an ISO date (YYYY-MM-DD)
      if (/^\d{4}-\d{2}-\d{2}$/.test(waraRaw)) {
        termEndDate = waraRaw;
        const endYMD = parseYMD(termEndDate);
        daysLeft = calcDaysBetween(today, endYMD);
      } else {
        const dur = parseDurationWara(waraRaw);
        if (dur) {
          const endDateObj = addDuration(refDate, dur);
          if (endDateObj) {
            termEndDate = toISO(endDateObj);
            daysLeft = calcDaysBetween(today, endDateObj);
          }
        }
      }
    }

    officers.push({
      person_id: tor,
      name,
      position,
      village,
      sub_district: subDistrict,
      phone,
      wara_raw: waraRaw,
      term_end_date: termEndDate,
      email: email || '',
      days_left: daysLeft,
    });
  }

  return officers;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchOfficers(options = {}) {
  const config = getConfig();
  const refDate = options.referenceDate || config.referenceDate;

  // 1. Create signed JWT
  const jwt = createServiceAccountJwt(config.serviceAccountEmail, config.privateKey);

  // 2. Exchange for access token
  const accessToken = await getAccessToken(jwt);

  // 3. Fetch sheet data
  const rows = await fetchSheetValues(config.sheetsId, config.sheetsRange, accessToken);

  // 4. Parse and transform
  const officers = parseOfficers(rows, refDate);

  console.log(`[data-source] Fetched ${officers.length} officers from Google Sheets (Reference Date: ${refDate})`);
  return officers;
}
