// ============================================================
// แดชบอร์ดวาระคงเหลือ — UI logic
// - โหลด CSV → คำนวณวันคงเหลือจาก now → แสดง KPI / ตาราง
// - ค้นหา / กรอง / เรียงลำดับ
// - คำนวณใหม่อัตโนมัติเมื่อวันที่เปลี่ยน (เที่ยงคืนตามเวลาไทย)
// ============================================================

import { CONFIG } from './config.js';
import { parseCSV } from './csv.js';
import { buildRecords, computeKpis, filterRecords, sortRecords, STATUS } from './model.js';
import {
  getBangkokNow,
  todayInBangkok,
  formatThaiDate,
  formatDaysLeft,
  toISOString,
  parseDate,
} from './dates.js';
import { initNotifications } from './notifications.js';

const LS = {
  threshold: 'wara.threshold',
  reference: 'wara.referenceDate',
  sort: 'wara.sortKey',
};

const SORT_OPTIONS = {
  daysAsc: 'วันคงเหลือ น้อย → มาก',
  daysDesc: 'วันคงเหลือ มาก → น้อย',
  name: 'ชื่อ (ก–ฮ)',
  endDate: 'วันที่สิ้นสุดวาระ',
  province: 'จังหวัด',
};

const state = {
  config: loadConfig(),
  rows: [],
  records: [],
  query: '',
  statusFilter: 'all',
  sortKey: readLS(LS.sort, 'daysAsc'),
};

const $ = (sel) => document.querySelector(sel);
let lastAdminTrigger = null;

function readLS(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function loadConfig() {
  const cfg = { ...CONFIG };
  const t = readLS(LS.threshold, null);
  if (t !== null && Number.isFinite(Number(t))) {
    cfg.expiringSoonThresholdDays = Math.max(0, Math.round(Number(t)));
  }
  const r = readLS(LS.reference, null);
  if (r && parseDate(r)) cfg.dataReferenceDate = r;
  return cfg;
}

// ------------------------------------------------------------
// init
// ------------------------------------------------------------

async function init() {
  bindControls();
  updateClock();
  setInterval(updateClock, 1000);
  scheduleMidnightRefresh();
  initNotifications($('#notifBody'));

  try {
    const res = await fetch(state.config.csvUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('ไม่พบข้อมูลในไฟล์ CSV');
    state.rows = rows;
    render();
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  const box = $('#error');
  box.classList.remove('hidden');
  box.innerHTML = '';
  const h = document.createElement('strong');
  h.textContent = 'โหลดข้อมูลไม่สำเร็จ';
  const p = document.createElement('p');
  p.textContent = `${err.message || err}`;
  const tip = document.createElement('p');
  tip.className = 'muted';
  tip.textContent = 'ตรวจสอบว่าได้รันเซิร์ฟเวอร์แล้ว (npm start แล้วเปิด http://localhost:4173) และไฟล์ data/vara_utf8.csv อยู่ครบ';
  box.append(h, p, tip);
}

// ------------------------------------------------------------
// render
// ------------------------------------------------------------

function render() {
  if (!state.rows.length) return;
  const now = new Date();
  state.records = buildRecords(state.rows, state.config, now);
  renderKpis();
  renderFilters();
  renderTable();
  renderMeta(now);
  renderSettings();
}

function renderKpis() {
  const k = computeKpis(state.records);
  const cards = [
    { id: 'total', label: 'ทั้งหมด', count: k.total, sub: 'ราย', color: '#0f172a', bg: '#e2e8f0', icon: ICONS.users, filter: 'all' },
    { id: 'active', label: 'ดำรงวาระ', count: k.active, sub: `วันคงเหลือ > ${state.config.expiringSoonThresholdDays} วัน`, color: CONFIG.status.active.color, bg: '#dcfce7', icon: ICONS.check, filter: STATUS.ACTIVE },
    { id: 'expiring', label: 'ใกล้หมดวาระ', count: k.expiring, sub: `วันคงเหลือ ≤ ${state.config.expiringSoonThresholdDays} วัน`, color: CONFIG.status.expiring.color, bg: '#fef3c7', icon: ICONS.clock, filter: STATUS.EXPIRING },
    { id: 'expired', label: 'หมดวาระแล้ว', count: k.expired, sub: 'เกินวันสิ้นสุดวาระ', color: CONFIG.status.expired.color, bg: '#fee2e2', icon: ICONS.x, filter: STATUS.EXPIRED },
    { id: 'invalid', label: 'ข้อมูลไม่สมบูรณ์', count: k.invalid, sub: 'วาระ/วันที่ไม่ถูกต้อง', color: CONFIG.status.invalid.color, bg: '#f1f5f9', icon: ICONS.alert, filter: STATUS.INVALID },
  ];

  const wrap = $('#kpis');
  wrap.replaceChildren();
  for (const c of cards) {
    const el = document.createElement('button');
    el.className = 'kpi-card';
    el.style.setProperty('--accent', c.color);
    if (state.statusFilter === c.filter) el.classList.add('active');
    el.title = 'คลิกเพื่อกรอง';
    el.addEventListener('click', () => {
      state.statusFilter = c.filter;
      render();
    });

    const icon = document.createElement('span');
    icon.className = 'kpi-icon';
    icon.style.background = c.bg;
    icon.style.color = c.color;
    icon.innerHTML = c.icon;

    const body = document.createElement('span');
    body.className = 'kpi-body';

    const label = document.createElement('span');
    label.className = 'kpi-label';
    label.textContent = c.label;

    const count = document.createElement('span');
    count.className = 'kpi-count';
    count.textContent = String(c.count);

    const sub = document.createElement('span');
    sub.className = 'kpi-sub';
    sub.textContent = c.sub;

    body.append(label, count, sub);
    el.append(icon, body);
    wrap.appendChild(el);
  }
}

function renderFilters() {
  const chips = $('#chips');
  chips.replaceChildren();
  const defs = [
    { key: 'all', label: 'ทั้งหมด', count: state.records.length },
    { key: STATUS.ACTIVE, label: CONFIG.status.active.label, count: computeKpis(state.records).active },
    { key: STATUS.EXPIRING, label: CONFIG.status.expiring.label, count: computeKpis(state.records).expiring },
    { key: STATUS.EXPIRED, label: CONFIG.status.expired.label, count: computeKpis(state.records).expired },
    { key: STATUS.INVALID, label: CONFIG.status.invalid.label, count: computeKpis(state.records).invalid },
  ];
  for (const d of defs) {
    const b = document.createElement('button');
    b.className = 'chip';
    if (state.statusFilter === d.key) b.classList.add('active');
    b.dataset.status = d.key;
    b.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = d.label;
    const cnt = document.createElement('span');
    cnt.className = 'chip-count';
    cnt.textContent = String(d.count);
    b.append(span, cnt);
    b.addEventListener('click', () => {
      state.statusFilter = d.key;
      render();
    });
    chips.appendChild(b);
  }
}

function renderTable() {
  const tbody = $('#tbody');
  const filtered = filterRecords(state.records, state.query, state.statusFilter);
  const sorted = sortRecords(filtered, state.sortKey);
  const today = todayInBangkok(new Date());

  tbody.replaceChildren();
  $('#countInfo').textContent = `แสดง ${sorted.length} จาก ${state.records.length} ราย`;

  if (!sorted.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 10;
    td.className = 'empty';
    td.textContent = 'ไม่พบข้อมูลที่ตรงกับเงื่อนไข';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const r of sorted) frag.appendChild(renderRow(r, today));
  tbody.appendChild(frag);
}

function renderRow(r, today) {
  const tr = document.createElement('tr');
  if (r.status === STATUS.INVALID) tr.classList.add('row-invalid');

  const cell = (text, cls) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  };

  // ลำดับ
  tr.appendChild(cell(r.tor || String(r.id), 'cell-tor'));

  // ชื่อ (+ ป้ายเตือนข้อมูลไม่ครบ)
  const tdName = document.createElement('td');
  tdName.className = 'cell-name';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'name';
  nameSpan.textContent = r.name || 'ไม่ระบุชื่อ';
  tdName.appendChild(nameSpan);
  if (r.flags.length) {
    const flag = document.createElement('span');
    flag.className = 'flag';
    flag.textContent = '⚠';
    flag.title = r.flags.join('\n');
    tdName.appendChild(flag);
  }
  tr.appendChild(tdName);

  // ตำแหน่ง
  tr.appendChild(cell(r.position || '—', 'cell-pos'));

  // พื้นที่
  const tdArea = document.createElement('td');
  tdArea.className = 'cell-area';
  const lines = [r.village, [r.tambon, r.amphoe ? `อ.${r.amphoe}` : ''].filter(Boolean).join(' '), r.province].filter(Boolean);
  lines.forEach((ln, i) => {
    tdArea.appendChild(document.createTextNode(ln));
    if (i < lines.length - 1) tdArea.appendChild(document.createElement('br'));
  });
  if (!lines.length) tdArea.textContent = '—';
  tr.appendChild(tdArea);

  // วันที่เริ่มวาระ (ไม่มีในชุดข้อมูล → แสดง — อย่างตรงไปตรงมา)
  const tdStart = cell('—', 'cell-muted');
  tdStart.title = 'ไม่มีข้อมูลวันที่เริ่มวาระในชุดข้อมูลต้นทาง';
  tr.appendChild(tdStart);

  // วันที่สิ้นสุดวาระ
  const tdEnd = document.createElement('td');
  tdEnd.className = 'cell-end';
  if (r.endDate) {
    tdEnd.textContent = formatThaiDate(r.endDate);
    tdEnd.title = `ISO: ${toISOString(r.endDate)}`;
  } else {
    tdEnd.textContent = '—';
    tdEnd.className = 'cell-muted';
  }
  tr.appendChild(tdEnd);

  // วาระคงเหลือ (ข้อมูลเดิม)
  tr.appendChild(cell(r.waraRaw || '—', 'cell-muted'));

  // วันคงเหลือ
  const tdDays = document.createElement('td');
  tdDays.className = 'cell-days';
  const num = document.createElement('span');
  num.className = `days-num d-${r.status}`;
  num.textContent = r.daysLeft === null ? '—' : String(r.daysLeft);
  tdDays.appendChild(num);
  const human = document.createElement('span');
  human.className = 'days-human';
  human.textContent = formatDaysLeft(r.daysLeft, today, r.endDate);
  tdDays.appendChild(human);
  tr.appendChild(tdDays);

  // สถานะ
  const tdStatus = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `badge badge-${r.status}`;
  badge.textContent = CONFIG.status[r.status]?.label || r.status;
  tdStatus.appendChild(badge);
  tr.appendChild(tdStatus);

  // หมายเหตุ
  tr.appendChild(cell(r.notes || '—', 'cell-muted'));

  return tr;
}

function renderMeta(now) {
  const n = getBangkokNow(now);
  const ref = parseDate(state.config.dataReferenceDate);
  const time = `${String(n.hour).padStart(2, '0')}:${String(n.minute).padStart(2, '0')}:${String(n.second).padStart(2, '0')}`;
  $('#metaRef').textContent = ref ? formatThaiDate(ref) : 'ไม่ถูกต้อง';
  $('#metaThreshold').textContent = String(state.config.expiringSoonThresholdDays);
  $('#metaUpdated').textContent = time;
  $('#metaCount').textContent = String(state.records.length);
}

function renderSettings() {
  $('#thresholdInput').value = String(state.config.expiringSoonThresholdDays);
  const ref = parseDate(state.config.dataReferenceDate);
  $('#referenceInput').value = ref ? toISOString(ref) : '';
  $('#sortSelect').value = state.sortKey in SORT_OPTIONS ? state.sortKey : 'daysAsc';
}

// ------------------------------------------------------------
// controls
// ------------------------------------------------------------

function bindControls() {
  $('#searchInput').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderTable();
  });

  $('#sortSelect').addEventListener('change', (e) => {
    state.sortKey = e.target.value;
    writeLS(LS.sort, state.sortKey);
    renderTable();
  });

  $('#refreshBtn').addEventListener('click', () => render());

  $('#settingsBtn').addEventListener('click', () => {
    $('#settingsPanel').classList.toggle('hidden');
  });

  const setAdminDrawerOpen = (open) => {
    const panel = $('#notificationAdminPanel');
    const backdrop = $('#notificationAdminBackdrop');
    const trigger = $('#notifAdminTopbarBtn');
    if (!panel || !backdrop || !trigger) return;
    document.body.classList.toggle('notif-admin-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    backdrop.setAttribute('aria-hidden', String(!open));
    trigger.setAttribute('aria-expanded', String(open));
    trigger.title = open ? 'ปิดการตั้งค่าการแจ้งเตือน' : 'เปิดการตั้งค่าการแจ้งเตือน';
    if (open) {
      lastAdminTrigger = trigger;
      $('#notificationAdminCloseBtn')?.focus();
    } else {
      lastAdminTrigger?.focus?.();
    }
  };

  $('#notifAdminTopbarBtn')?.addEventListener('click', () => {
    const isOpen = document.body.classList.contains('notif-admin-open');
    setAdminDrawerOpen(!isOpen);
  });

  $('#notificationAdminCloseBtn')?.addEventListener('click', () => setAdminDrawerOpen(false));
  $('#notificationAdminBackdrop')?.addEventListener('click', () => setAdminDrawerOpen(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('notif-admin-open')) {
      setAdminDrawerOpen(false);
    }
  });

  $('#thresholdInput').addEventListener('change', (e) => {
    const v = Math.max(0, Math.round(Number(e.target.value) || 0));
    writeLS(LS.threshold, String(v));
    state.config = loadConfig();
    render();
  });

  $('#referenceInput').addEventListener('change', (e) => {
    const v = e.target.value; // YYYY-MM-DD จาก <input type="date">
    if (v && parseDate(v)) {
      writeLS(LS.reference, v);
      state.config = loadConfig();
      render();
    }
  });

  $('#resetSettingsBtn').addEventListener('click', () => {
    try {
      localStorage.removeItem(LS.threshold);
      localStorage.removeItem(LS.reference);
      localStorage.removeItem(LS.sort);
    } catch {
      /* ignore */
    }
    state.config = loadConfig();
    state.sortKey = 'daysAsc';
    render();
  });

  // คลิกหัวตารางเพื่อเรียง
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (key === 'daysAsc') {
        state.sortKey = state.sortKey === 'daysAsc' ? 'daysDesc' : 'daysAsc';
      } else {
        state.sortKey = key;
      }
      writeLS(LS.sort, state.sortKey);
      renderTable();
      renderSettings();
    });
  });

  // คำนวณใหม่เมื่อกลับมาที่แท็บ (เผื่อวันเปลี่ยนไปแล้ว)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });
}

// ------------------------------------------------------------
// นาฬิกา + รีเฟรชอัตโนมัติเที่ยงคืน
// ------------------------------------------------------------

function updateClock() {
  const n = getBangkokNow();
  const t = todayInBangkok();
  $('#clockNow').textContent = `${String(n.hour).padStart(2, '0')}:${String(n.minute).padStart(2, '0')}:${String(n.second).padStart(2, '0')} น.`;
  $('#clockDate').textContent = `${formatThaiDate(t)} (${toISOString(t)})`;
}

function msUntilNextBangkokMidnight() {
  const n = getBangkokNow();
  const nextMidnightUtc = Date.UTC(n.year, n.month - 1, n.day + 1);
  return nextMidnightUtc - Date.now() + 1500;
}

function scheduleMidnightRefresh() {
  setTimeout(() => {
    render(); // คำนวณวันคงเหลือใหม่จาก now ที่เปลี่ยนไป
    scheduleMidnightRefresh();
  }, Math.max(1000, msUntilNextBangkokMidnight()));
}

// ------------------------------------------------------------
// ไอคอน (SVG inline)
// ------------------------------------------------------------

const ICONS = {
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

init();
