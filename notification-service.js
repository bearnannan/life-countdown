// =============================================================================
// notification-service.js — Notification Orchestrator
// Combines: data fetching → deduplication → template → SMTP → audit
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { sendMail, SmtpError } from './smtp-client.js';
import { buildSixMonthEmail, buildOneMonthEmail, buildAnnualSummaryEmail } from './email-templates.js';
import { fetchOfficers } from './data-source.js';

// ---------------------------------------------------------------------------
// Auto-load .env at top level
// ---------------------------------------------------------------------------
const envPath = new URL('.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
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
}

// ---------------------------------------------------------------------------
// Supabase REST helpers (zero dependency — native fetch + PostgREST)
// ---------------------------------------------------------------------------

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, key };
}

function supabaseHeaders() {
  const { key } = getSupabaseConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

/**
 * INSERT into a Supabase table with on_conflict support.
 */
async function supabaseInsert(table, data, options = {}) {
  const { url } = getSupabaseConfig();
  const queryParam = options.onConflict ? `?on_conflict=${encodeURIComponent(options.onConflict)}` : '';
  const resolution = options.resolution || (options.onConflict ? 'ignore-duplicates' : 'merge-duplicates');

  const response = await fetch(`${url}/rest/v1/${table}${queryParam}`, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      Prefer: `resolution=${resolution},return=representation`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    // If conflict (409) occurs on ignore-duplicates, treat as non-fatal
    if (response.status === 409 && options.onConflict) {
      return [];
    }
    const errBody = await response.text();
    throw new Error(`Supabase INSERT ${table} failed (${response.status}): ${errBody}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

/**
 * Call a Supabase RPC function. Handles 204 No Content for VOID return functions.
 */
async function supabaseRpc(functionName, params = {}) {
  const { url } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Supabase RPC ${functionName} failed (${response.status}): ${errBody}`);
  }

  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * SELECT from a Supabase table with query parameters.
 */
async function supabaseSelect(table, queryParams = '') {
  const { url } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${queryParams}`, {
    method: 'GET',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=representation',
    },
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Supabase SELECT ${table} failed (${response.status}): ${errBody}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

// ---------------------------------------------------------------------------
// Settings loader
// ---------------------------------------------------------------------------

function safeJsonParse(val) {
  if (typeof val !== 'string') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

/**
 * Load system settings from Supabase.
 * @returns {Promise<object>} Key-value map of settings
 */
async function loadSettings() {
  const rows = await supabaseSelect('system_settings', 'select=key,value');
  const settings = {};
  for (const row of rows) {
    const parsed = safeJsonParse(row.value);
    settings[row.key] = parsed;
  }
  return settings;
}

// ---------------------------------------------------------------------------
// Deduplication & State Management
// ---------------------------------------------------------------------------

/**
 * Generate a unique notification key for deduplication.
 * @param {string} type - Notification type
 * @param {string} personId - Officer ID
 * @param {string} termEndDate - ISO date
 * @returns {string}
 */
function generateNotificationKey(type, personId, termEndDate) {
  return `${type}:${personId}:${termEndDate}`;
}

/**
 * Create SHA-256 hash of email payload for audit trail.
 * @param {object} payload
 * @returns {string} Hex-encoded hash
 */
function hashPayload(payload) {
  return createHash('sha256')
    .update(JSON.stringify(payload), 'utf-8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/**
 * Insert an audit log entry.
 */
async function logAudit(action, detail = {}, actor = 'system') {
  try {
    await supabaseInsert('audit_log', {
      actor,
      action,
      detail: typeof detail === 'object' ? JSON.stringify(detail) : detail,
    });
  } catch (err) {
    console.error(`[audit] Failed to log: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send email with retry logic.
 * @param {object} mailOptions
 * @param {number} maxAttempts
 * @returns {Promise<object>} sendMail result
 */
async function sendWithRetry(mailOptions, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendMail(mailOptions);
    } catch (err) {
      const isRetryable = err instanceof SmtpError ? err.retryable : true;

      if (attempt === maxAttempts || !isRetryable) {
        throw err;
      }

      const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      console.log(`[smtp] Attempt ${attempt} failed, retrying in ${backoffMs / 1000}s: ${err.message}`);
      await sleep(backoffMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Core notification processing
// ---------------------------------------------------------------------------

/**
 * Process a single notification: insert → claim → send → update.
 * @param {object} params
 * @param {string} params.type
 * @param {object} params.officer
 * @param {string[]} params.adminEmails
 * @param {object} params.emailContent - { subject, html, text }
 */
async function processNotification({ type, officer, adminEmails, emailContent }) {
  const notificationKey = generateNotificationKey(type, officer.person_id, officer.term_end_date);

  const recipientTarget = officer.email || (adminEmails.length > 0 ? adminEmails.join(', ') : '');
  if (!recipientTarget) {
    console.log(`[notify] Skipping ${notificationKey} — no officer email and no admin email configured`);
    return { skipped: true, key: notificationKey };
  }

  // 1. INSERT with status=pending (ignore if already exists)
  await supabaseInsert('notification_events', {
    notification_type: type,
    person_id: officer.person_id,
    person_name: officer.name,
    position: officer.position,
    term_end_date: officer.term_end_date,
    recipient_email: recipientTarget,
    notification_key: notificationKey,
    status: 'pending',
  }, { onConflict: 'notification_key', resolution: 'ignore-duplicates' });

  // 2. Atomically claim: pending → sending
  const claimed = await supabaseRpc('claim_notification', {
    p_notification_key: notificationKey,
  });

  if (!claimed) {
    console.log(`[notify] Skipping ${notificationKey} — already processed or claimed`);
    return { skipped: true, key: notificationKey };
  }

  // 3. Build mail options
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const fromName = process.env.EMAIL_FROM_NAME || '';

  const to = officer.email || adminEmails;
  const cc = officer.email && adminEmails.length > 0 ? adminEmails : undefined;

  const mailOptions = {
    from,
    fromName,
    to,
    cc,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  };

  // 4. Send with retry
  try {
    const result = await sendWithRetry(mailOptions);

    // 5a. Mark as sent
    const payloadSnapshot = {
      to,
      cc,
      subject: emailContent.subject,
      messageId: result.messageId,
      sentAt: new Date().toISOString(),
    };

    await supabaseRpc('mark_notification_sent', {
      p_notification_key: notificationKey,
      p_payload_snapshot: payloadSnapshot,
      p_payload_hash: hashPayload(payloadSnapshot),
    });

    await logAudit('notification_sent', {
      notification_key: notificationKey,
      type,
      officer_name: officer.name,
      recipient: recipientTarget,
    });

    console.log(`[notify] ✅ Sent ${type} for ${officer.name} to ${recipientTarget}`);
    return { sent: true, key: notificationKey, messageId: result.messageId };

  } catch (err) {
    // 5b. Mark as failed
    await supabaseRpc('mark_notification_failed', {
      p_notification_key: notificationKey,
      p_error_message: err.message.substring(0, 500),
    });

    await logAudit('notification_failed', {
      notification_key: notificationKey,
      type,
      officer_name: officer.name,
      error: err.message.substring(0, 500),
    });

    console.error(`[notify] ❌ Failed ${type} for ${officer.name} (${recipientTarget}): ${err.message}`);
    return { failed: true, key: notificationKey, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Notification type processors
// ---------------------------------------------------------------------------

/**
 * Process 6-month warning notifications.
 */
async function processSixMonthNotifications(officers, adminEmails, threshold) {
  const eligible = officers.filter(o =>
    o.days_left !== null && o.days_left > 0 && o.days_left <= threshold
  );

  console.log(`[notify] 6-month: ${eligible.length} officers eligible (threshold: ${threshold} days)`);
  const results = [];

  for (const officer of eligible) {
    const emailContent = buildSixMonthEmail(officer);
    const result = await processNotification({
      type: 'six_month',
      officer,
      adminEmails,
      emailContent,
    });
    results.push(result);
  }

  return results;
}

/**
 * Process 1-month warning notifications.
 */
async function processOneMonthNotifications(officers, adminEmails, threshold) {
  const eligible = officers.filter(o =>
    o.days_left !== null && o.days_left >= 0 && o.days_left <= threshold
  );

  console.log(`[notify] 1-month: ${eligible.length} officers eligible (threshold: ${threshold} days)`);
  const results = [];

  for (const officer of eligible) {
    const emailContent = buildOneMonthEmail(officer);
    const result = await processNotification({
      type: 'one_month',
      officer,
      adminEmails,
      emailContent,
    });
    results.push(result);
  }

  return results;
}

/**
 * Process annual summary notification.
 * Triggered on Dec 31 or manually.
 */
async function processAnnualSummary(officers, adminEmails, today) {
  const year = new Date(today).getFullYear();

  // Officers expiring in the target year
  const expiringThisYear = officers.filter(o => {
    if (!o.term_end_date) return false;
    const endYear = new Date(o.term_end_date).getFullYear();
    return endYear === year;
  });

  if (expiringThisYear.length === 0) {
    console.log(`[notify] Annual summary: no officers expiring in ${year}`);
    return [];
  }

  if (!adminEmails || adminEmails.length === 0) {
    console.log('[notify] Annual summary: no admin emails configured');
    return [{ skipped: true, reason: 'no_admin_emails' }];
  }

  const emailContent = buildAnnualSummaryEmail(expiringThisYear, year);
  const notificationKey = `annual_summary:ALL:${year}`;

  // Insert + claim
  await supabaseInsert('notification_events', {
    notification_type: 'annual_summary',
    person_id: 'ALL',
    person_name: 'Annual Summary',
    position: 'All Roles',
    term_end_date: `${year}-12-31`,
    recipient_email: adminEmails.join(', '),
    notification_key: notificationKey,
    status: 'pending',
  }, { onConflict: 'notification_key', resolution: 'ignore-duplicates' });

  const claimed = await supabaseRpc('claim_notification', {
    p_notification_key: notificationKey,
  });

  if (!claimed) {
    console.log(`[notify] Annual summary ${year} already sent`);
    return [{ skipped: true, key: notificationKey }];
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const fromName = process.env.EMAIL_FROM_NAME || '';

  try {
    const result = await sendWithRetry({
      from,
      fromName,
      to: adminEmails,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    const payloadSnapshot = {
      to: adminEmails,
      subject: emailContent.subject,
      officerCount: expiringThisYear.length,
      messageId: result.messageId,
      sentAt: new Date().toISOString(),
    };

    await supabaseRpc('mark_notification_sent', {
      p_notification_key: notificationKey,
      p_payload_snapshot: payloadSnapshot,
      p_payload_hash: hashPayload(payloadSnapshot),
    });

    await logAudit('annual_summary_sent', {
      year,
      officer_count: expiringThisYear.length,
      recipients: adminEmails,
    });

    console.log(`[notify] ✅ Annual summary ${year} sent to ${adminEmails.join(', ')}`);
    return [{ sent: true, key: notificationKey }];

  } catch (err) {
    await supabaseRpc('mark_notification_failed', {
      p_notification_key: notificationKey,
      p_error_message: err.message.substring(0, 500),
    });

    await logAudit('annual_summary_failed', {
      year,
      error: err.message.substring(0, 500),
    });

    console.error(`[notify] ❌ Annual summary failed: ${err.message}`);
    return [{ failed: true, key: notificationKey, error: err.message }];
  }
}

// ---------------------------------------------------------------------------
// CRON_SECRET guard
// ---------------------------------------------------------------------------

/**
 * Verify CRON_SECRET for Vercel cron job authentication.
 * @param {string} authHeader - Authorization header value
 * @returns {boolean}
 */
export function verifyCronSecret(authHeader) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // Local dev mode — no guard
  return authHeader === `Bearer ${expected}`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full notification cycle.
 * Fetches officers, checks thresholds, sends emails, logs audits.
 *
 * @param {object} [options]
 * @param {object[]} [options.officers] - Override officer data (for testing)
 * @param {boolean}  [options.forceAnnual] - Force annual summary regardless of date
 * @returns {Promise<object>} Summary of sent/skipped/failed
 */
export async function runNotificationCycle(options = {}) {
  const startTime = Date.now();
  console.log(`\n[notify] ===== Notification Cycle Started =====`);
  console.log(`[notify] Time: ${new Date().toISOString()}`);

  // 1. Load settings
  const settings = await loadSettings();
  const notificationEnabled = settings.notification_enabled !== false;

  if (!notificationEnabled) {
    console.log('[notify] Notifications are disabled in system_settings');
    return { disabled: true };
  }

  let adminEmails = settings.admin_emails || [];
  if (typeof adminEmails === 'string') {
    adminEmails = [adminEmails];
  }

  const sixMonthThreshold = Number(settings.six_month_threshold) || 180;
  const oneMonthThreshold = Number(settings.one_month_threshold) || 30;

  // 2. Fetch officers (or use provided data)
  const officers = options.officers || await fetchOfficers();
  console.log(`[notify] Total officers: ${officers.length}`);

  // 3. Process notifications
  const results = {
    six_month: await processSixMonthNotifications(officers, adminEmails, sixMonthThreshold),
    one_month: await processOneMonthNotifications(officers, adminEmails, oneMonthThreshold),
    annual_summary: [],
  };

  // 4. Annual summary — check if Dec 31 or forced
  const now = new Date();
  const bangkokNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const isDecember31 = bangkokNow.getMonth() === 11 && bangkokNow.getDate() === 31;

  if (isDecember31 || options.forceAnnual) {
    const todayIso = `${bangkokNow.getFullYear()}-${String(bangkokNow.getMonth() + 1).padStart(2, '0')}-${String(bangkokNow.getDate()).padStart(2, '0')}`;
    results.annual_summary = await processAnnualSummary(officers, adminEmails, todayIso);
  }

  // 5. Summary
  const summary = {
    sent: 0,
    skipped: 0,
    failed: 0,
    duration_ms: Date.now() - startTime,
  };

  for (const typeResults of Object.values(results)) {
    for (const r of typeResults) {
      if (r.sent) summary.sent++;
      else if (r.skipped) summary.skipped++;
      else if (r.failed) summary.failed++;
    }
  }

  console.log(`[notify] ===== Cycle Complete =====`);
  console.log(`[notify] Sent: ${summary.sent} | Skipped: ${summary.skipped} | Failed: ${summary.failed} | Duration: ${summary.duration_ms}ms`);

  await logAudit('notification_cycle_complete', summary);

  return { results, summary };
}

// ---------------------------------------------------------------------------
// CLI execution — `node notification-service.js` or `npm run notify`
// ---------------------------------------------------------------------------
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule) {
  const forceAnnual = process.argv.includes('--annual');

  try {
    const result = await runNotificationCycle({ forceAnnual });
    console.log('\n[result]', JSON.stringify(result.summary, null, 2));
  } catch (err) {
    console.error('[fatal]', err);
    process.exit(1);
  }
}
