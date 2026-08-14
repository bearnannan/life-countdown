import { DEFAULT_SETTINGS, safeSettings } from './settings.js';

const EMAIL_JSON_KEYS = ['email', 'notifications', 'thresholds', 'scheduler', 'dashboardUrl', 'personEmails'];

function mergePlainObject(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const out = { ...(target && typeof target === 'object' && !Array.isArray(target) ? target : {}) };
  for (const [key, value] of Object.entries(source)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergePlainObject(out[key], value)
      : value;
  }
  return out;
}

export async function loadCloudSettings(db) {
  const s = structuredClone(DEFAULT_SETTINGS);
  const all = await db.getAllSettings();

  for (const key of EMAIL_JSON_KEYS) {
    const raw = all[`notify.${key}`];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) s[key] = mergePlainObject(s[key], parsed);
      else if (key === 'dashboardUrl' && typeof parsed === 'string') s[key] = parsed;
    } catch {
      // Keep defaults when stored JSON is invalid.
    }
  }

  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('notify.smtp.')) continue;
    const field = k.slice('notify.smtp.'.length);
    if (field === 'port') s.email.smtp.port = Number(v) || s.email.smtp.port;
    else if (field === 'secure') s.email.smtp.secure = String(v) === 'true';
    else if (field === 'rejectUnauthorized') s.email.smtp.rejectUnauthorized = String(v) !== 'false';
    else if (field in s.email.smtp) s.email.smtp[field] = v;
  }

  const dbPass = all['notify.smtp.pass'];
  if (dbPass) s.email.smtp.pass = dbPass;
  if (process.env.SMTP_PASS) s.email.smtp.pass = process.env.SMTP_PASS;
  s.email.hasPassword = Boolean(s.email.smtp.pass || process.env.SMTP_PASS);
  return s;
}

export async function saveCloudSettingsBlock(db, key, value) {
  await db.setSetting(`notify.${key}`, JSON.stringify(value));
}

export { safeSettings };
