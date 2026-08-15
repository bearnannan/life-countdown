// ============================================================
// UI: ส่วนการแจ้งเตือนวาระ (Term Expiration Notifications)
// ------------------------------------------------------------
// - แสดงสถานะของ 6 เดือน / 1 เดือน / สรุปประจำปี (sent/failed/pending)
// - Last Run / Next Scheduled Run
// - ผู้ดูแล (ADMIN_TOKEN) เปิด/ปิดแต่ละชนิด กำหนดผู้รับ เกณฑ์
//   สั่งรันทันที และส่งอีเมลทดสอบ
// - งานที่ต้องสิทธิ์ทั้งหมดเรียกผ่าน API ฝั่งเซิร์ฟเวอร์ — SMTP_PASS
//   ไม่เคยถูกส่ง/แสดงในเบราว์เซอร์
// ============================================================

import { initSpotlightCards } from './spotlight.js';
import { initSpecularButtons } from './specular-button.js';
import { attachAdminBackground } from './admin-background.js';

const TYPE_LABELS = {
  six_month: {
    th: 'เตือน 6 เดือน',
    en: '6-Month Reminder',
    color: '#d97706',
    description: 'แจ้งเตือนรายบุคคลเมื่อวาระอยู่ในช่วง 6 เดือน',
  },
  one_month: {
    th: 'เตือน 1 เดือน',
    en: '1-Month Reminder',
    color: '#dc2626',
    description: 'แจ้งเตือนรายบุคคลเมื่อวาระเหลือประมาณ 1 เดือน',
  },
  annual_summary: {
    th: 'สรุปประจำปี (31 ธ.ค.)',
    en: 'Annual Summary',
    color: '#16a34a',
    description: 'ส่งรายงานสรุปสถานะวาระประจำปีให้ผู้ดูแล',
  },
};

const TOKEN_KEY = 'wara.adminToken';
let adminControlsCollapsed = true;
const TEMPLATE_VARIABLES = [
  ['person_name', 'ชื่อบุคคล'],
  ['position', 'ตำแหน่ง'],
  ['village', 'หมู่บ้าน'],
  ['subdistrict', 'ตำบล'],
  ['district', 'อำเภอ'],
  ['province', 'จังหวัด'],
  ['term_start_date', 'วันเริ่มวาระ'],
  ['term_end_date', 'วันสิ้นสุดวาระ'],
  ['days_left', 'วันคงเหลือ'],
  ['months_left', 'เดือนคงเหลือ'],
  ['year', 'ปีรายงาน'],
  ['total_count', 'จำนวนทั้งหมด'],
  ['six_month_count', 'จำนวน 6 เดือน'],
  ['one_month_count', 'จำนวน 1 เดือน'],
  ['expired_count', 'หมดวาระแล้ว'],
  ['incomplete_count', 'ข้อมูลไม่ครบ'],
  ['action_url', 'ลิงก์เปิดระบบ'],
];

const STATUS_LABELS = {
  sent: 'ส่งแล้ว',
  failed: 'ล้มเหลว',
  pending: 'รอส่ง',
  sending: 'กำลังส่ง',
  skipped: 'ข้าม',
};

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function chevronIcon(expanded) {
  return expanded
    ? `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5.25 12.5 10 7.75l4.75 4.75" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>`
    : `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5.25 7.5 10 12.25 14.75 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
}

function uiIcon(name) {
  const icons = {
    lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M12 14v2"/>',
    shield: '<path d="M12 3 19 6v5c0 4.2-2.8 7.4-7 9-4.2-1.6-7-4.8-7-9V6l7-3Z"/><path d="m9 12 2 2 4-5"/>',
    send: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    warning: '<path d="M10.3 4.2 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 3v4h-4"/><path d="M6 21v-4h4"/>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
}

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function writeToken(t) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

function applyAdminControlsState(container) {
  const isAdmin = readToken().length > 0;
  const toggle = container.querySelector('#adminControlsToggle');
  const controls = container.querySelector('#adminControls');
  if (!toggle || !controls) return;

  if (!isAdmin) adminControlsCollapsed = true;

  const expanded = isAdmin && !adminControlsCollapsed;
  controls.classList.toggle('is-locked', !isAdmin);
  controls.classList.toggle('is-collapsed', !expanded);

  toggle.disabled = !isAdmin;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('title', !isAdmin ? 'ต้องปลดล็อกผู้ดูแลก่อนขยายส่วนตั้งค่า' : (expanded ? 'ย่อส่วนตั้งค่า' : 'ขยายส่วนตั้งค่า'));
  toggle.setAttribute('aria-label', !isAdmin ? 'ต้องปลดล็อกผู้ดูแลก่อนขยายส่วนตั้งค่า' : (expanded ? 'ย่อส่วนตั้งค่า' : 'ขยายส่วนตั้งค่า'));
  toggle.innerHTML = chevronIcon(expanded);
}

async function api(path, { method = 'GET', body = null } = {}) {
  const token = readToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium' });
}

function splitEmails(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function statusText(status) {
  return STATUS_LABELS[status] || status || '—';
}

function roleDefaults(type) {
  return type === 'annual_summary' ? undefined : ['village_headman', 'kamnan', 'assistant_village_headman'];
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  const target = button.querySelector('.specular-button__label') || button;
  if (busy) {
    button.dataset.originalText = target.textContent;
    target.textContent = busyText;
    button.disabled = true;
  } else {
    target.textContent = button.dataset.originalText || target.textContent;
    button.disabled = false;
  }
}

function card(type, counts) {
  const meta = TYPE_LABELS[type];
  const c = counts || {};
  const total = (c.sent || 0) + (c.failed || 0) + (c.pending || 0) + (c.skipped || 0) + (c.sending || 0);
  const stat = (label, n, color) => `<div class="nstat"><span class="nstat-n" style="color:${color}">${n}</span><span class="nstat-l">${label}</span></div>`;
  return `
  <div class="notif-card" style="--accent:${meta.color}">
    <div class="notif-card-head">
      <span class="notif-type">${esc(meta.th)}<small>${esc(meta.en)}</small></span>
      <label class="toggle" title="เปิด/ปิด (ผู้ดูแล)">
        <input type="checkbox" data-toggle="${type}" ${counts?.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>
    <div class="notif-stats">
      ${stat('ส่งแล้ว', c.sent || 0, '#16a34a')}
      ${stat('ล้มเหลว', c.failed || 0, '#dc2626')}
      ${stat('รอส่ง', (c.pending || 0) + (c.sending || 0), '#d97706')}
      ${stat('ข้าม', c.skipped || 0, '#64748b')}
    </div>
    <div class="notif-total">รวม ${total} ครั้ง <span class="key-hint">key: ${esc(type === 'annual_summary' ? 'TERM_EXPIRATION_ANNUAL_SUMMARY:{year}' : `TERM_EXPIRATION_${type === 'six_month' ? '6_MONTHS' : '1_MONTH'}:{personId}:{termEndDate}`)}</span></div>
  </div>`;
}

function variableChips(type) {
  return TEMPLATE_VARIABLES.map(([value, label]) => (
    `<button type="button" class="var-chip" data-var="${value}" data-var-scope="${type}" title="${esc(label)}">+ {{${value}}}</button>`
  )).join('');
}

function roleCheckbox(type, role, label, cfg) {
  const roles = cfg.roles || roleDefaults(type) || [];
  return `
    <label class="role-check">
      <input type="checkbox" data-role="${type}" value="${role}" ${roles.includes(role) ? 'checked' : ''}>
      <span>${esc(label)}</span>
    </label>`;
}

function notificationWorkbench(notif, thresholds) {
  const rules = Object.keys(TYPE_LABELS).map((type, index) => {
    const meta = TYPE_LABELS[type];
    const cfg = notif[type] || {};
    return `
      <button type="button" class="rule-item ${index === 0 ? 'active' : ''}" data-rule-tab="${type}" style="--accent:${meta.color}">
        <span class="rule-title">${esc(meta.th)}</span>
        <span class="rule-desc">${esc(meta.description)}</span>
        <span class="rule-state">${cfg.enabled !== false ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
      </button>`;
  }).join('');

  const panels = Object.keys(TYPE_LABELS).map((type, index) => {
    const meta = TYPE_LABELS[type];
    const cfg = notif[type] || {};
    const threshold = type === 'six_month'
      ? (thresholds.sixMonthMonths ?? cfg.thresholdMonths ?? 6)
      : (thresholds.oneMonthMonths ?? cfg.thresholdMonths ?? 1);
    const recipientRows = `
      <div class="template-grid two-col">
        <label class="template-field">ผู้รับหลัก
          <input type="text" data-to="${type}" placeholder="admin@example.com, office@example.com" value="${esc((cfg.to || []).join(', '))}">
        </label>
        <label class="template-field">สำเนาถึง
          <input type="text" data-cc="${type}" placeholder="cc@example.com" value="${esc((cfg.cc || []).join(', '))}">
        </label>
      </div>
      ${type !== 'annual_summary' ? `
        <div class="role-grid">
          ${roleCheckbox(type, 'village_headman', 'ผู้ใหญ่บ้าน', cfg)}
          ${roleCheckbox(type, 'kamnan', 'กำนัน', cfg)}
          ${roleCheckbox(type, 'assistant_village_headman', 'ผู้ช่วยผู้ใหญ่บ้าน', cfg)}
          <label class="role-check">
            <input type="checkbox" data-person="${type}" ${cfg.includePerson !== false ? 'checked' : ''}>
            <span>รวมอีเมลของตัวบุคคลถ้ามี</span>
          </label>
        </div>` : ''}
      ${type !== 'annual_summary' ? `
        <label class="template-field compact-threshold">ช่วงแจ้งเตือน
          <input type="number" data-threshold="${type}" min="1" max="${type === 'six_month' ? 24 : 12}" value="${esc(String(threshold))}">
          <span>เดือน</span>
        </label>` : ''}`;

    return `
      <article class="rule-panel ${index === 0 ? '' : 'hidden'}" data-rule-panel="${type}">
        <div class="rule-panel-head" style="--accent:${meta.color}">
          <div>
            <h3>${esc(meta.th)}</h3>
            <p>${esc(meta.description)}</p>
          </div>
          <label class="switch-line">
            <span>${cfg.enabled !== false ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
            <span class="toggle">
              <input type="checkbox" data-toggle="${type}" ${cfg.enabled !== false ? 'checked' : ''}>
              <span class="slider"></span>
            </span>
          </label>
        </div>

        <div class="rule-tabs" role="tablist" aria-label="ตั้งค่า ${esc(meta.th)}">
          <button type="button" class="rule-subtab active" data-subtab="${type}:content">ตั้งค่าเนื้อหา</button>
          <button type="button" class="rule-subtab" data-subtab="${type}:recipients">ผู้รับและบทบาท</button>
          <button type="button" class="rule-subtab" data-subtab="${type}:preview">ตัวอย่างแบบสด</button>
          <button type="button" class="rule-subtab" data-subtab="${type}:test">ทดสอบส่งอีเมล</button>
        </div>

        <div class="subtab-panel" data-subtab-panel="${type}:content">
          <label class="template-field">หัวข้ออีเมล
            <input type="text" data-subject="${type}" value="${esc(cfg.subject || '')}" placeholder="แจ้งเตือน {{person_name}}">
          </label>
          <div class="variable-chips">${variableChips(type)}</div>
          <label class="template-field">เทมเพลต HTML
            <textarea data-template="${type}" rows="7" placeholder="ใส่ HTML พร้อมตัวแปร เช่น {{person_name}}">${esc(cfg.templateHtml || '')}</textarea>
          </label>
        </div>

        <div class="subtab-panel hidden" data-subtab-panel="${type}:recipients">
          ${recipientRows}
        </div>

        <div class="subtab-panel hidden" data-subtab-panel="${type}:preview">
          <div class="preview-actions">
            <button type="button" class="btn btn-sm render-preview-btn specular-button" data-specular-preset="secondary" data-render-preview="${type}">รีเฟรชตัวอย่าง</button>
            <span class="muted">ตัวอย่างใช้ข้อมูลจำลอง และไม่สร้างบันทึกการส่ง</span>
          </div>
          <div class="preview-result" data-preview-result="${type}"><div class="muted">กำลังโหลดตัวอย่าง...</div></div>
        </div>

        <div class="subtab-panel hidden" data-subtab-panel="${type}:test">
          <div class="test-row inline-test-row">
            <input type="email" data-test-to="${type}" placeholder="อีเมลผู้รับทดสอบ">
            <button type="button" class="btn btn-sm send-test-email-btn specular-button" data-specular-preset="primary" data-send-test="${type}">ส่งอีเมลทดสอบ</button>
            <span data-test-result="${type}" class="muted"></span>
          </div>
        </div>
      </article>`;
  }).join('');

  return `
    <section class="notification-workbench">
      <div class="workbench-head">
        <div>
          <h3>การตั้งค่าอีเมลแจ้งเตือน</h3>
          <p>จัดการเทมเพลต ผู้รับ ตัวอย่าง และการทดสอบส่งอีเมลสำหรับการแจ้งเตือนวาระ</p>
        </div>
        <button id="saveNotifSettings" class="btn btn-sm specular-button" data-specular-preset="primary" type="button">บันทึกการตั้งค่าและเทมเพลต</button>
      </div>
      <div class="notif-rule-grid">
        <aside class="rule-list">${rules}</aside>
        <div class="rule-editor">${panels}</div>
      </div>
    </section>
    <div class="admin-actions-row">
      <button id="runCycleBtn" class="btn btn-sm specular-button" data-specular-preset="secondary" type="button">รันรอบทันที</button>
      <button id="testEmailBtn" class="btn btn-sm specular-button" data-specular-preset="secondary" type="button">เปิดหน้าทดสอบของรายการแรก</button>
    </div>`;
}

function recipientEditor(type, cfg) {
  const id = `rcpt-${type}`;
  return `
  <div class="rcpt-row" data-rcpt="${type}">
    <label>${esc(TYPE_LABELS[type].th)} — ผู้รับ</label>
    <input type="text" data-to="${type}" placeholder="admin@example.com, office@example.com" value="${esc((cfg.to || []).join(', '))}">
    <div class="rcpt-sub">
      <input type="text" data-cc="${type}" placeholder="สำเนาถึง (ไม่บังคับ)" value="${esc((cfg.cc || []).join(', '))}">
      ${type !== 'annual_summary' ? `<label class="toggle-inline"><input type="checkbox" data-person="${type}" ${cfg.includePerson !== false ? 'checked' : ''}> รวมอีเมลของตัวบุคคล (ถ้ามี)</label>` : ''}
    </div>
  </div>`;
}

/** แสดงสถานะ + ตัวควบคุม */
export function renderNotificationStatus(container, status) {
  const s = status.settings || {};
  const notif = s.notifications || {};
  const thresholds = s.thresholds || {};
  const counts = status.counts || {};

  for (const type of Object.keys(TYPE_LABELS)) {
    const c = { ...(counts[type] || {}) };
    c.enabled = notif[type] ? notif[type].enabled !== false : true;
  }

  const cards = Object.keys(TYPE_LABELS).map((t) => card(t, { ...(counts[t] || {}), enabled: notif[t] ? notif[t].enabled !== false : true })).join('');

  const isAdmin = readToken().length > 0;
  const expanded = isAdmin && !adminControlsCollapsed;
  const isLocalHost = ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname || '');
  const adminHost = document.querySelector('#notificationAdminPanelBody');
  const adminMarkup = `
  <div class="notif-admin">
    <form class="admin-token-row" id="adminTokenForm">
      <label>รหัสปลดล็อกผู้ดูแล <input type="password" id="adminTokenInput" form="adminTokenForm" placeholder="${isLocalHost ? 'dev-token' : 'ADMIN_TOKEN'}" value="${esc(readToken())}" autocomplete="off"></label>
      <button id="adminTokenSave" class="btn btn-sm specular-button" data-specular-preset="primary" type="submit">ปลดล็อก</button>
      <button id="adminTokenDevFill" class="btn btn-sm dev-token-btn specular-button ${isLocalHost ? '' : 'hidden'}" data-specular-preset="secondary" type="button">ใช้ dev-token</button>
      <button type="button" id="adminControlsToggle" class="btn btn-sm admin-controls-toggle" ${isAdmin ? '' : 'disabled'} aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="adminControls" title="${!isAdmin ? 'ต้องปลดล็อกผู้ดูแลก่อนขยายส่วนตั้งค่า' : (expanded ? 'ย่อส่วนตั้งค่า' : 'ขยายส่วนตั้งค่า')}" aria-label="${!isAdmin ? 'ต้องปลดล็อกผู้ดูแลก่อนขยายส่วนตั้งค่า' : (expanded ? 'ย่อส่วนตั้งค่า' : 'ขยายส่วนตั้งค่า')}">${chevronIcon(expanded)}</button>
      <span class="muted" style="font-size:12px">ใช้สำหรับเปิด/ปิด กำหนดผู้รับ สั่งรัน และส่งทดสอบ โดยไม่ส่งรหัสผ่าน SMTP</span>
    </form>

    <div id="adminControls" class="admin-controls ${isAdmin ? '' : 'is-locked'} ${expanded ? '' : 'is-collapsed'}">
      <div class="admin-controls__bg" aria-hidden="true">
        <div class="admin-bg-aurora"></div>
        <div class="admin-bg-grid"></div>
        <div class="admin-bg-glow"></div>
        <div class="admin-bg-vignette"></div>
      </div>
      <div class="admin-controls__content">
        ${isAdmin ? '' : `<div class="admin-lock-banner">หน้านี้ดูได้เลย แต่ถ้าจะบันทึก/ส่งทดสอบ/ดูตัวอย่างแบบสด ต้องปลดล็อกก่อน${isLocalHost ? ' ตอนรัน local ที่เปิดให้ตอนนี้ใช้รหัส <code>dev-token</code>' : ''}</div>`}
        ${notificationWorkbench(notif, thresholds)}
        <div id="adminMsg" class="admin-msg"></div>
      </div>
    </div>

    <div class="admin-login-note ${isAdmin ? 'hidden' : ''}">
      ${uiIcon('lock')} กรอก ADMIN_TOKEN เพื่อจัดการการแจ้งเตือน (กำหนดในตัวแปรสภาพแวดล้อมของเซิร์ฟเวอร์)
    </div>
  </div>`;
  if (adminHost) adminHost.innerHTML = adminMarkup;

  container.innerHTML = `
  <div class="notif-grid">${cards}</div>

  <div class="notif-meta">
    <span>รอบล่าสุด: <b>${fmtDateTime(status.lastRunAt)}</b>${status.lastRunMs ? ` (${status.lastRunMs} ms)` : ''}</span>
    <span>รอบถัดไป: <b>${status.nextRunAt ? fmtDateTime(status.nextRunAt) : status.schedulerEnabled ? 'ทุก ' + (notif.scheduler?.tickMinutes || s.scheduler?.tickMinutes || 5) + ' นาที' : 'ปิดใช้งาน'}</b></span>
    <span>ช่องทางส่ง: <b>${esc(s.email?.transport || 'console')}</b> · SMTP: <b>${esc(s.email?.smtp?.host || '—')}:${esc(String(s.email?.smtp?.port ?? '—'))}</b> ${s.email?.hasPassword ? uiIcon('lock') : `${uiIcon('warning')} ยังไม่มีรหัสผ่าน (SMTP_PASS)`}</span>
  </div>

  <div class="notif-events">
    <div class="table-head notif-log-head">
      <h3>บันทึกการส่งล่าสุด</h3>
      <div class="log-tools">
        <input id="eventSearchInput" type="search" placeholder="ค้นหา log">
        <select id="eventStatusFilter" aria-label="กรองสถานะ log">
          <option value="">ทุกสถานะ</option>
          <option value="sent">ส่งแล้ว</option>
          <option value="failed">ล้มเหลว</option>
          <option value="pending">รอส่ง</option>
          <option value="skipped">ข้าม</option>
        </select>
        <button id="retryFailedBtn" class="btn btn-sm">ส่งซ้ำรายการที่ล้มเหลว</button>
        <button id="refreshEventsBtn" class="btn btn-sm" title="รีเฟรชบันทึกการส่ง" aria-label="รีเฟรชบันทึกการส่ง">${uiIcon('refresh')}</button>
      </div>
    </div>
    <div id="notifEventsTable" class="table-scroll"><div class="muted" style="padding:12px">กำลังโหลด...</div></div>
  </div>`;

  // --- ผูกเหตุการณ์ ---
  const showMsg = (text, ok = true) => {
    const el = adminRoot?.querySelector('#adminMsg');
    if (!el) return;
    el.textContent = text;
    el.className = 'admin-msg ' + (ok ? 'ok' : 'err');
    setTimeout(() => { el.textContent = ''; el.className = 'admin-msg'; }, 6000);
  };

  const smtp = s.email?.smtp || {};
  const requestRefresh = () => container.__refreshNotifications?.();
  const adminRoot = adminHost || container;
  const q = (sel) => adminRoot.querySelector(sel) || container.querySelector(sel);
  const qa = (sel) => {
    const nodes = [...adminRoot.querySelectorAll(sel)];
    return nodes.length ? nodes : [...container.querySelectorAll(sel)];
  };

  q('#adminTokenForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = q('#adminTokenInput').value.trim();
    writeToken(val);
    if (val.length > 0) adminControlsCollapsed = false;
    renderNotificationStatus(container, status);
    showMsg(val.length > 0 ? 'ปลดล็อกสิทธิ์ผู้ดูแลเรียบร้อยแล้ว' : 'บันทึก token แล้ว', true);
  });
  q('#adminTokenDevFill')?.addEventListener('click', () => {
    writeToken('dev-token');
    adminControlsCollapsed = false;
    renderNotificationStatus(container, status);
    showMsg('ปลดล็อกสิทธิ์ผู้ดูแลเรียบร้อยแล้ว', true);
  });
  q('#adminControlsToggle')?.addEventListener('click', () => {
    if (!readToken()) return;
    adminControlsCollapsed = !adminControlsCollapsed;
    applyAdminControlsState(adminRoot);
  });

  const smtpSectionHtml = `
  <div class="smtp-config-card ${isAdmin ? '' : 'is-locked'}">
    <div class="smtp-card-header">
      <div class="smtp-card-title">
        <span class="smtp-icon">${uiIcon('mail')}</span>
        <div>
          <h3>การตั้งค่าเซิร์ฟเวอร์ส่งอีเมล</h3>
          <p class="smtp-sub">ตั้งค่าเซิร์ฟเวอร์ SMTP และบทบาทที่จะรับการแจ้งเตือนตามเหตุการณ์</p>
        </div>
      </div>
      <button type="button" id="smtpTestBtnHeader" class="btn btn-sm specular-button" data-specular-preset="primary">${uiIcon('send')} ทดสอบส่งอีเมล</button>
    </div>

    <div class="smtp-form-grid">
      <div class="smtp-field">
        <label for="smtpHostInput">โฮสต์ SMTP</label>
        <input type="text" id="smtpHostInput" class="smtp-input" placeholder="smtp.gmail.com" value="${esc(smtp.host || 'smtp.gmail.com')}">
      </div>
      <div class="smtp-field">
        <label for="smtpPortInput">พอร์ต SMTP</label>
        <input type="number" id="smtpPortInput" class="smtp-input" placeholder="465" value="${esc(String(smtp.port || 465))}">
      </div>
      <div class="smtp-field">
        <label for="smtpUserInput">บัญชี SMTP</label>
        <input type="text" id="smtpUserInput" class="smtp-input" placeholder="user@example.com" value="${esc(smtp.user || '')}">
      </div>

      <div class="smtp-field">
        <label for="smtpSenderEmailInput">อีเมลผู้ส่ง</label>
        <input type="email" id="smtpSenderEmailInput" class="smtp-input" placeholder="noreply@example.com" value="${esc(s.email?.from?.address || smtp.user || '')}">
      </div>
      <div class="smtp-field">
        <label for="smtpSenderNameInput">ชื่อผู้ส่ง</label>
        <input type="text" id="smtpSenderNameInput" class="smtp-input" placeholder="StockFlow Notification" value="${esc(s.email?.from?.name || 'StockFlow Notification')}">
      </div>
      <div class="smtp-field">
        <label for="smtpPassInput">
          รหัสผ่าน SMTP 
          ${s.email?.hasPassword ? '<span class="badge-status badge-success">(ตั้งค่าไว้แล้ว)</span>' : '<span class="badge-status badge-warning">(ยังไม่ได้ตั้งค่า)</span>'}
        </label>
        <form id="smtpPassForm">
          <input
            type="text"
            aria-hidden="true"
            tabindex="-1"
            autocomplete="username"
            value="${esc(smtp.user || s.email?.from?.address || '')}"
            style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none"
          >
          <input type="password" id="smtpPassInput" form="smtpPassForm" class="smtp-input" placeholder="${s.email?.hasPassword ? '........ (ระบุใหม่เมื่อต้องการเปลี่ยน)' : 'กรอกรหัสผ่าน SMTP'}" autocomplete="current-password">
        </form>
      </div>
    </div>

    <div class="smtp-sec-grid">
      <div class="smtp-sec-box">
        <div class="sec-title"><span class="sec-icon">${uiIcon('lock')}</span> การเชื่อมต่อความปลอดภัย</div>
        <select id="smtpSecureSelect" class="smtp-select">
          <option value="465" ${smtp.port === 465 || smtp.secure ? 'selected' : ''}>SSL/TLS แบบเข้ารหัสทันที (Port 465 — Implicit TLS)</option>
          <option value="587" ${(!smtp.secure && smtp.port !== 25) || smtp.port === 587 ? 'selected' : ''}>STARTTLS (Port 587/25 — Explicit TLS)</option>
          <option value="25" ${smtp.port === 25 ? 'selected' : ''}>ไม่เข้ารหัส (Port 25)</option>
        </select>
        <div id="smtpSecureHelp" class="sec-help">
          SSL/TLS ทันที: เข้ารหัสซ็อกเก็ตตั้งแต่เริ่มเปิดการเชื่อมต่อไปยังเซิร์ฟเวอร์ SMTP (แนะนำสำหรับพอร์ต 465)
        </div>
      </div>

      <div class="smtp-sec-box">
        <div class="sec-title"><span class="sec-icon">${uiIcon('shield')}</span> การตรวจสอบใบรับรอง TLS</div>
        <label class="smtp-checkbox-label">
          <input type="checkbox" id="smtpRejectUnauthorizedCb" ${smtp.rejectUnauthorized !== false ? 'checked' : ''}>
          <span>ตรวจสอบว่าใบรับรองออกโดย CA ที่เชื่อถือได้</span>
        </label>
        <div class="sec-help">
          แนะนำเปิดใช้งานเสมอ หากปิดจะอนุญาตใบรับรอง Self-Signed ภายในองค์กร
        </div>
      </div>
    </div>

    <div class="smtp-footer-row">
      <div class="smtp-active-summary">
        <span class="summary-label">คอนฟิกที่มีผล:</span>
        <span id="activeHostBadge" class="active-badge badge-blue">${esc(smtp.host || 'smtp.gmail.com')}:${esc(String(smtp.port || 465))}</span>
        <span id="activeProtoBadge" class="active-badge badge-purple">${smtp.secure ? 'SSL/TLS ทันที' : 'STARTTLS'}</span>
        <span id="activeCertBadge" class="active-badge ${smtp.rejectUnauthorized !== false ? 'badge-green' : 'badge-amber'}">${smtp.rejectUnauthorized !== false ? 'ตรวจใบรับรอง TLS แล้ว' : 'ไม่ได้ตรวจใบรับรอง TLS'}</span>
      </div>

      <button type="button" id="saveSmtpServerBtn" class="btn btn-primary btn-lg specular-button" data-specular-preset="primary">${uiIcon('save')} บันทึกเซิร์ฟเวอร์ SMTP</button>
    </div>
  </div>`;

  // แทรกลงใน DOM ของ admin controls
  const adminContent = adminRoot.querySelector('.admin-controls__content') || adminRoot.querySelector('.admin-controls');
  if (adminContent && !adminRoot.querySelector('.smtp-config-card')) {
    adminContent.insertAdjacentHTML('afterbegin', smtpSectionHtml);
  }
  applyAdminControlsState(adminRoot);
  if (!isAdmin) {
    qa([
      '#saveNotifSettings',
      '#saveSmtpServerBtn',
      '#smtpTestBtnHeader',
      '#testEmailBtn',
      '#refreshEventsBtn',
      '#retryFailedBtn',
      '.send-test-email-btn',
    ].join(',')).forEach((button) => {
      button.disabled = true;
      button.title = 'กรอก ADMIN_TOKEN เพื่อใช้งานคำสั่งนี้';
    });
  }

  // --- Dynamic Badges & Select updates ---
  const updateSummaryBadges = () => {
    const host = q('#smtpHostInput')?.value.trim() || 'smtp.gmail.com';
    const port = q('#smtpPortInput')?.value.trim() || '465';
    const protoVal = q('#smtpSecureSelect')?.value;
    const isReject = q('#smtpRejectUnauthorizedCb')?.checked;

    const hostBadge = q('#activeHostBadge');
    if (hostBadge) hostBadge.textContent = `${host}:${port}`;

    const protoBadge = q('#activeProtoBadge');
    if (protoBadge) protoBadge.textContent = protoVal === '465' ? 'SSL/TLS ทันที' : protoVal === '587' ? 'STARTTLS' : 'ไม่เข้ารหัส';

    const certBadge = q('#activeCertBadge');
    if (certBadge) {
      certBadge.textContent = isReject ? 'ตรวจใบรับรอง TLS แล้ว' : 'ไม่ได้ตรวจใบรับรอง TLS';
      certBadge.className = `active-badge ${isReject ? 'badge-green' : 'badge-amber'}`;
    }

    const helpEl = q('#smtpSecureHelp');
    if (helpEl) {
      if (protoVal === '465') helpEl.textContent = 'SSL/TLS ทันที: เข้ารหัสซ็อกเก็ตตั้งแต่เริ่มเปิดการเชื่อมต่อไปยังเซิร์ฟเวอร์ SMTP (แนะนำสำหรับพอร์ต 465)';
      else if (protoVal === '587') helpEl.textContent = 'STARTTLS: เริ่มด้วยการเชื่อมต่อแบบธรรมดา แล้วจึงยกระดับเป็น TLS (แนะนำสำหรับพอร์ต 587/25)';
      else helpEl.textContent = 'ไม่เข้ารหัส: ส่งข้อมูลแบบไม่เข้ารหัส ไม่แนะนำสำหรับการใช้งานจริง';
    }
  };

  q('#smtpPortInput')?.addEventListener('input', (e) => {
    const port = Number(e.target.value);
    const sel = q('#smtpSecureSelect');
    if (port === 465 && sel) sel.value = '465';
    else if ((port === 587 || port === 25) && sel) sel.value = String(port);
    updateSummaryBadges();
  });

  q('#smtpSecureSelect')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const portInput = q('#smtpPortInput');
    if (portInput) {
      if (val === '465') portInput.value = '465';
      else if (val === '587') portInput.value = '587';
      else if (val === '25') portInput.value = '25';
    }
    updateSummaryBadges();
  });

  q('#smtpHostInput')?.addEventListener('input', updateSummaryBadges);
  q('#smtpRejectUnauthorizedCb')?.addEventListener('change', updateSummaryBadges);

  // --- Save SMTP Server ---
  q('#saveSmtpServerBtn')?.addEventListener('click', async () => {
    const host = q('#smtpHostInput').value.trim();
      const port = Number(q('#smtpPortInput').value) || 465;
    const user = q('#smtpUserInput').value.trim();
    const senderEmail = q('#smtpSenderEmailInput').value.trim();
    const senderName = q('#smtpSenderNameInput').value.trim();
    const newPass = q('#smtpPassInput').value.trim();
    const protoVal = q('#smtpSecureSelect').value;
    const secure = protoVal === '465';
    const rejectUnauthorized = q('#smtpRejectUnauthorizedCb').checked;

    if (!host) { showMsg('กรุณาระบุโฮสต์ SMTP', false); return; }

    const emailPayload = {
      transport: 'smtp',
      from: {
        name: senderName || 'StockFlow Notification',
        address: senderEmail || user || 'noreply@localhost',
      },
      smtp: {
        host,
        port,
        secure,
        user,
        rejectUnauthorized,
        new_password: newPass || undefined,
      },
    };

    try {
      showMsg('กำลังบันทึกตั้งค่า SMTP...', true);
      await api('/api/notifications/settings', { method: 'POST', body: { email: emailPayload } });
      showMsg('บันทึกการตั้งค่าเซิร์ฟเวอร์ SMTP สำเร็จแล้ว', true);
      q('#smtpPassInput').value = '';
      requestRefresh();
    } catch (err) {
      showMsg(`บันทึกไม่สำเร็จ: ${err.message}`, false);
    }
  });

  const openActiveTestPanel = () => {
    const activeType = q('.rule-item.active')?.dataset.ruleTab || 'six_month';
    const testTab = q(`[data-subtab="${activeType}:test"]`);
    testTab?.click();
    q(`[data-test-to="${activeType}"]`)?.focus();
  };

  q('#smtpTestBtnHeader')?.addEventListener('click', openActiveTestPanel);
  q('#testEmailBtn')?.addEventListener('click', openActiveTestPanel);

  q('#saveNotifSettings')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const sixMonths = Math.min(24, Math.max(1, Number(q('[data-threshold="six_month"]')?.value) || 6));
    const oneMonths = Math.min(12, Math.max(1, Number(q('[data-threshold="one_month"]')?.value) || 1));
    const nextNotifications = structuredClone(notif);

    for (const type of Object.keys(TYPE_LABELS)) {
      const prev = nextNotifications[type] || {};
      nextNotifications[type] = {
        ...prev,
        enabled: q(`[data-rule-panel="${type}"] [data-toggle="${type}"]`)?.checked !== false,
        to: splitEmails(q(`[data-to="${type}"]`)?.value),
        cc: splitEmails(q(`[data-cc="${type}"]`)?.value),
        subject: q(`[data-subject="${type}"]`)?.value || prev.subject || '',
        templateHtml: q(`[data-template="${type}"]`)?.value || '',
        roles: [...qa(`[data-role="${type}"]:checked`)].map((el) => el.value),
      };
      if (type !== 'annual_summary') {
        nextNotifications[type].includePerson = q(`[data-person="${type}"]`)?.checked !== false;
        nextNotifications[type].thresholdMonths = type === 'six_month' ? sixMonths : oneMonths;
      } else {
        delete nextNotifications[type].roles;
      }
    }

    try {
      setBusy(button, true, 'กำลังบันทึก...');
      const updated = await api('/api/notifications/settings', {
        method: 'POST',
        body: {
          notifications: nextNotifications,
          thresholds: { ...thresholds, sixMonthMonths: sixMonths, oneMonthMonths: oneMonths },
        },
      });
      showMsg('บันทึกการตั้งค่าการแจ้งเตือนแล้ว', true);
      renderNotificationStatus(container, { ...status, settings: updated.settings });
    } catch (err) {
      showMsg(`บันทึกไม่สำเร็จ: ${err.message}`, false);
    } finally {
      setBusy(button, false);
    }
  });

  q('#runCycleBtn')?.addEventListener('click', async (e) => {
    if (!confirm('ยืนยันการรันรอบแจ้งเตือนทันที?')) return;
    const button = e.currentTarget;
    try {
      setBusy(button, true, 'กำลังรัน...');
      const res = await api('/api/notifications/run', { method: 'POST' });
      const sum = res.summary || {};
      showMsg(`รันเสร็จแล้ว: ส่งแล้ว ${sum.sent || 0}, ล้มเหลว ${sum.failed || 0}, ข้าม ${sum.skipped || 0}`, true);
      requestRefresh();
    } catch (err) {
      showMsg(`รันไม่สำเร็จ: ${err.message}`, false);
    } finally {
      setBusy(button, false);
    }
  });

  const sendTestEmail = async (type = null) => {
    const selectedType = type || q('.rule-panel:not(.hidden)')?.dataset.rulePanel || 'six_month';
    const to = q(`[data-test-to="${selectedType}"]`)?.value.trim()
      || q('#testEmailTo')?.value.trim();
    if (!to) return;
    const resEl = q(`[data-test-result="${selectedType}"]`) || q('#testEmailResult');
    const button = q(`[data-send-test="${selectedType}"]`) || q('#sendTestEmailBtn');
    resEl.textContent = 'กำลังส่ง...';
    try {
      setBusy(button, true, 'ส่ง...');
      const r = await api('/api/send-test-email', {
        method: 'POST',
        body: {
          to,
          type: selectedType,
          subject: q(`[data-subject="${selectedType}"]`)?.value || '',
          templateHtml: q(`[data-template="${selectedType}"]`)?.value || '',
        },
      });
      resEl.textContent = r.ok ? `ส่งแล้ว (${r.messageId || '—'})` : `ส่งไม่สำเร็จ: ${r.error}`;
      resEl.className = 'muted ' + (r.ok ? 'ok' : 'err');
    } catch (err) {
      resEl.textContent = `ส่งไม่สำเร็จ: ${err.message}`;
      resEl.className = 'muted err';
    } finally {
      setBusy(button, false);
    }
  };

  q('#sendTestEmailBtn')?.addEventListener('click', sendTestEmail);
  qa('.send-test-email-btn').forEach((btn) => {
    btn.addEventListener('click', () => sendTestEmail(btn.dataset.sendTest));
  });
  q('#testEmailTo')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTestEmail();
  });

  const renderPreview = async (type = null) => {
    const selectedType = type || q('.rule-panel:not(.hidden)')?.dataset.rulePanel || 'six_month';
    const result = q(`[data-preview-result="${selectedType}"]`) || q('#previewResult');
    if (!result) return;
    if (!readToken()) {
      result.innerHTML = '<div class="muted">กรอก ADMIN_TOKEN เพื่อดูตัวอย่างแบบสด</div>';
      return;
    }
    result.innerHTML = '<div class="muted">กำลังโหลดตัวอย่าง...</div>';
    try {
      const rendered = await api('/api/notifications/preview', {
        method: 'POST',
        body: {
          type: selectedType,
          subject: q(`[data-subject="${selectedType}"]`)?.value || '',
          templateHtml: q(`[data-template="${selectedType}"]`)?.value || '',
        },
      });
      result.innerHTML = `
        <div class="preview-subject">${esc(rendered.subject)}</div>
        <iframe title="ตัวอย่างอีเมล" sandbox="" srcdoc="${esc(rendered.html)}"></iframe>`;
    } catch (err) {
      result.innerHTML = `<div class="muted err">โหลดตัวอย่างไม่สำเร็จ: ${esc(err.message)}</div>`;
    }
  };

  let previewTimer = 0;
  const schedulePreview = (type = null) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => renderPreview(type), 250);
  };

  qa('.rule-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.ruleTab;
      qa('.rule-item').forEach((el) => el.classList.toggle('active', el === btn));
      qa('.rule-panel').forEach((el) => el.classList.toggle('hidden', el.dataset.rulePanel !== type));
      renderPreview(type);
    });
  });

  qa('.rule-subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [type] = btn.dataset.subtab.split(':');
      const panel = q(`[data-rule-panel="${type}"]`);
      panel?.querySelectorAll('.rule-subtab').forEach((el) => el.classList.toggle('active', el === btn));
      panel?.querySelectorAll('.subtab-panel').forEach((el) => el.classList.toggle('hidden', el.dataset.subtabPanel !== btn.dataset.subtab));
      if (btn.dataset.subtab.endsWith(':preview')) renderPreview(type);
    });
  });

  qa('[data-subject], [data-template]').forEach((el) => {
    el.addEventListener('input', () => schedulePreview(el.dataset.subject || el.dataset.template));
  });
  qa('.render-preview-btn').forEach((btn) => {
    btn.addEventListener('click', () => renderPreview(btn.dataset.renderPreview));
  });
  qa('.var-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.rule-panel');
      const textarea = panel?.querySelector(`[data-template="${btn.dataset.varScope}"]`);
      const subject = panel?.querySelector(`[data-subject="${btn.dataset.varScope}"]`);
      const target = panel?.contains(document.activeElement) && document.activeElement.matches('input, textarea')
        ? document.activeElement
        : textarea || subject;
      if (!target) return;
      const token = `{{${btn.dataset.var}}}`;
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = `${target.value.slice(0, start)}${token}${target.value.slice(end)}`;
      target.focus();
      target.setSelectionRange(start + token.length, start + token.length);
      schedulePreview(btn.dataset.varScope);
    });
  });
  renderPreview();

  container.querySelector('#eventSearchInput')?.addEventListener('input', () => refreshEvents(container));
  container.querySelector('#eventStatusFilter')?.addEventListener('change', () => refreshEvents(container));
  container.querySelector('#retryFailedBtn')?.addEventListener('click', async (e) => {
    if (!confirm('ยืนยันส่งซ้ำรายการที่ล้มเหลวทั้งหมด?')) return;
    const button = e.currentTarget;
    try {
      setBusy(button, true, 'กำลังส่งซ้ำ...');
      await api('/api/notifications/retry', { method: 'POST', body: {} });
      showMsg('สั่งส่งซ้ำรายการที่ล้มเหลวแล้ว', true);
      requestRefresh();
    } catch (err) {
      showMsg(`ส่งซ้ำไม่สำเร็จ: ${err.message}`, false);
    } finally {
      setBusy(button, false);
    }
  });
  container.querySelector('#refreshEventsBtn').addEventListener('click', () => {
    if (!readToken()) {
      const tbody = container.querySelector('#notifEventsTable');
      if (tbody) tbody.innerHTML = '<div class="muted" style="padding:12px">กรอกรหัสปลดล็อกผู้ดูแลเพื่อดูบันทึกการส่ง</div>';
      return;
    }
    refreshEvents(container);
  });
  if (readToken()) {
    refreshEvents(container);
  } else {
    const tbody = container.querySelector('#notifEventsTable');
    if (tbody) tbody.innerHTML = '<div class="muted" style="padding:12px">กรอกรหัสปลดล็อกผู้ดูแลเพื่อดูบันทึกการส่ง</div>';
  }

  attachAdminBackground(document.querySelector('#adminControls'));
  initSpotlightCards('.notif-card, .smtp-config-card, .notification-workbench');
  initSpecularButtons('#retryFailedBtn, #refreshEventsBtn, #adminTokenSave, #adminTokenDevFill, #saveNotifSettings, #saveSmtpServerBtn, #smtpTestBtnHeader, #runCycleBtn, #testEmailBtn, .render-preview-btn, .send-test-email-btn');
}

async function refreshEvents(container) {
  const tbody = container.querySelector('#notifEventsTable');
  if (!tbody) return;
  tbody.innerHTML = '<div class="muted" style="padding:12px">กำลังโหลด...</div>';
  try {
    const data = await api('/api/notifications/events');
    const keyword = container.querySelector('#eventSearchInput')?.value.trim().toLowerCase() || '';
    const statusFilter = container.querySelector('#eventStatusFilter')?.value || '';
    let ev = data.events || [];
    if (statusFilter) ev = ev.filter((r) => r.status === statusFilter);
    if (keyword) {
      ev = ev.filter((r) => [r.notification_type, r.person_name, r.recipient_email, r.status, r.error_message]
        .some((v) => String(v || '').toLowerCase().includes(keyword)));
    }
    if (!ev.length) {
      tbody.innerHTML = '<div class="muted" style="padding:12px">ไม่พบ log ตามเงื่อนไขที่เลือก</div>';
      return;
    }
    const rows = ev.slice(0, 30).map((r) => `
      <tr class="${r.status === 'failed' ? 'row-invalid' : ''}">
        <td>${esc(TYPE_LABELS[r.notification_type]?.th || r.notification_type)}</td>
        <td>${esc(r.person_name || '—')}</td>
        <td class="cell-muted">${esc(r.recipient_email || '—')}</td>
        <td><span class="badge badge-${r.status === 'sent' ? 'active' : r.status === 'failed' ? 'expired' : r.status === 'pending' || r.status === 'sending' ? 'expiring' : 'invalid'}">${esc(statusText(r.status))}</span></td>
        <td class="cell-muted">${r.retry_count || 0}</td>
        <td class="cell-muted" title="${esc(r.error_message || '')}">${esc((r.error_message || '').slice(0, 40))}</td>
        <td class="cell-muted">${fmtDateTime(r.trigger_at)}</td>
        <td>${r.status === 'failed' ? `<button class="btn btn-sm retry-event-btn specular-button" data-specular-preset="secondary" data-event-id="${r.id}">ส่งซ้ำ</button>` : ''}</td>
      </tr>`).join('');
    tbody.innerHTML = `<div class="table-scroll"><table><thead><tr><th>ชนิด</th><th>บุคคล</th><th>ผู้รับ</th><th>สถานะ</th><th>ครั้งที่ลอง</th><th>ข้อผิดพลาด</th><th>เวลา</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    initSpecularButtons('.retry-event-btn');
    tbody.querySelectorAll('.retry-event-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          setBusy(btn, true, 'กำลังส่งซ้ำ...');
          await api('/api/notifications/retry', { method: 'POST', body: { eventId: Number(btn.dataset.eventId) } });
          await refreshEvents(container);
        } catch (err) {
          tbody.insertAdjacentHTML('afterbegin', `<div class="muted err" style="padding:8px 12px">ส่งซ้ำไม่สำเร็จ: ${esc(err.message)}</div>`);
        } finally {
          setBusy(btn, false);
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<div class="muted err" style="padding:12px">โหลดเหตุการณ์ไม่สำเร็จ: ${esc(err.message)}</div>`;
  }
}

/** เริ่มต้นส่วนแจ้งเตือน: โหลดสถานะ + อัปเดตทุก 60 วินาที */
export function initNotifications(container) {
  if (!container) return;
  async function refresh() {
    try {
      const status = await api('/api/notifications/status');
      renderNotificationStatus(container, status);
    } catch (err) {
      container.innerHTML = `<div class="muted err" style="padding:12px">โหลดสถานะการแจ้งเตือนไม่สำเร็จ: ${esc(err.message)}</div>`;
      const adminHost = document.querySelector('#notificationAdminPanelBody');
      if (adminHost) {
        adminHost.innerHTML = `<div class="muted err" style="padding:12px">โหลดหน้าตั้งค่าการแจ้งเตือนไม่สำเร็จ: ${esc(err.message)}</div>`;
      }
    }
  }
  container.__refreshNotifications = refresh;
  refresh();
  setInterval(() => {
    // อัปเดตใหม่เฉพาะเมื่อไม่ได้กำลังแก้ไขฟอร์ม (กันการลบข้อความที่ผู้ดูแลพิมพ์ค้าง)
    const adminHost = document.querySelector('#notificationAdminPanelBody');
    const editing = container.matches(':focus-within') || adminHost?.matches(':focus-within');
    if (document.visibilityState === 'visible' && !editing) refresh();
  }, 60_000);
}


