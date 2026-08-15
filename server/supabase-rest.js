function getSupabaseUrl() {
  return process.env.SUPABASE_URL || '';
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function requireConfig() {
  if (!getSupabaseUrl() || !getSupabaseKey()) {
    throw new Error('SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ต้องถูกตั้งค่าสำหรับ production');
  }
}

function endpoint(path) {
  return `${getSupabaseUrl().replace(/\/$/, '')}/rest/v1/${path}`;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  requireConfig();
  const key = getSupabaseKey();
  const res = await fetch(endpoint(path), {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Supabase REST ${res.status}`);
  }
  return data;
}

const memoryStore = {
  settings: {},
  events: [],
  audit: [],
  idCounter: 1,
};

export function createSupabaseDb() {
  if (!getSupabaseUrl() || !getSupabaseKey()) {
    // Memory fallback when Supabase is not configured (e.g. dev/preview mode)
    return {
      async getSetting(key) { return memoryStore.settings[key] || null; },
      async getAllSettings() { return { ...memoryStore.settings }; },
      async setSetting(key, value) { memoryStore.settings[key] = String(value); },
      async audit({ actor = 'system', action, detail = null }) {
        memoryStore.audit.unshift({ id: memoryStore.idCounter++, actor, action, detail, created_at: new Date().toISOString() });
      },
      async notificationCounts() {
        const out = { six_month: {}, one_month: {}, annual_summary: {} };
        for (const row of memoryStore.events) {
          out[row.notification_type] = out[row.notification_type] || {};
          out[row.notification_type][row.status] = (out[row.notification_type][row.status] || 0) + 1;
        }
        return out;
      },
      async recentEvents(limit = 50) { return memoryStore.events.slice(0, Number(limit) || 50); },
      async recentAudit(limit = 50) { return memoryStore.audit.slice(0, Number(limit) || 50); },
      async insertEventIgnore(event) {
        const existing = memoryStore.events.find((e) => e.notification_key === event.notification_key);
        if (!existing) {
          memoryStore.events.unshift({ id: memoryStore.idCounter++, ...event, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        }
      },
      async getEventByKey(notificationKey) {
        return memoryStore.events.find((e) => e.notification_key === notificationKey) || null;
      },
      async getEventById(id) {
        return memoryStore.events.find((e) => e.id === Number(id)) || null;
      },
      async claimEvent(id, status = 'pending') {
        const ev = memoryStore.events.find((e) => e.id === Number(id) && e.status === status);
        if (ev) {
          ev.status = 'sending';
          ev.updated_at = new Date().toISOString();
          return { ...ev };
        }
        return null;
      },
      async updateEvent(id, patch) {
        const ev = memoryStore.events.find((e) => e.id === Number(id));
        if (ev) {
          Object.assign(ev, patch, { updated_at: new Date().toISOString() });
          return { ...ev };
        }
        return null;
      },
      async resetFailed(eventId = null) {
        for (const ev of memoryStore.events) {
          if ((!eventId || ev.id === Number(eventId)) && ev.status === 'failed') {
            ev.status = 'pending';
            ev.retry_count = 0;
            ev.error_message = null;
            ev.updated_at = new Date().toISOString();
          }
        }
      },
      async stuckEvents(maxRetries) {
        return memoryStore.events.filter((e) => (e.status === 'failed' || e.status === 'pending') && (e.retry_count || 0) < Number(maxRetries));
      },
    };
  }

  return {
    async getSetting(key) {
      const rows = await request(`system_settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
      return rows?.[0]?.value || null;
    },

    async getAllSettings() {
      const rows = await request('system_settings?select=key,value');
      const out = {};
      for (const row of rows || []) out[row.key] = row.value;
      return out;
    },

    async setSetting(key, value) {
      await request('system_settings?on_conflict=key', {
        method: 'POST',
        body: [{ key, value: String(value), updated_at: new Date().toISOString() }],
        headers: { Prefer: 'resolution=merge-duplicates' },
      });
    },

    async audit({ actor = 'system', action, detail = null }) {
      await request('audit_log', {
        method: 'POST',
        body: [{ actor, action, detail }],
        headers: { Prefer: 'return=minimal' },
      });
    },

    async notificationCounts() {
      const rows = await request('notification_events?select=notification_type,status');
      const out = { six_month: {}, one_month: {}, annual_summary: {} };
      for (const row of rows || []) {
        out[row.notification_type] = out[row.notification_type] || {};
        out[row.notification_type][row.status] = (out[row.notification_type][row.status] || 0) + 1;
      }
      return out;
    },

    async recentEvents(limit = 50) {
      return request(`notification_events?select=*&order=id.desc&limit=${Number(limit) || 50}`);
    },

    async recentAudit(limit = 50) {
      return request(`audit_log?select=*&order=id.desc&limit=${Number(limit) || 50}`);
    },

    async insertEventIgnore(event) {
      try {
        await request('notification_events?on_conflict=notification_key', {
          method: 'POST',
          body: [{ ...event, updated_at: new Date().toISOString() }],
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        });
      } catch (err) {
        if (String(err?.message || err).includes('payload_') || String(err?.message || err).includes('column')) {
          const { payload_snapshot, payload_hash, ...safeEvent } = event;
          await request('notification_events?on_conflict=notification_key', {
            method: 'POST',
            body: [{ ...safeEvent, updated_at: new Date().toISOString() }],
            headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          });
        } else {
          throw err;
        }
      }
    },

    async getEventByKey(notificationKey) {
      const rows = await request(`notification_events?notification_key=eq.${encodeURIComponent(notificationKey)}&select=*&limit=1`);
      return rows?.[0] || null;
    },

    async getEventById(id) {
      const rows = await request(`notification_events?id=eq.${Number(id)}&select=*&limit=1`);
      return rows?.[0] || null;
    },

    async claimEvent(id, status = 'pending') {
      const rows = await request(`notification_events?id=eq.${Number(id)}&status=eq.${encodeURIComponent(status)}&select=*`, {
        method: 'PATCH',
        body: { status: 'sending', updated_at: new Date().toISOString() },
        headers: { Prefer: 'return=representation' },
      });
      return rows?.[0] || null;
    },

    async updateEvent(id, patch) {
      const rows = await request(`notification_events?id=eq.${Number(id)}&select=*`, {
        method: 'PATCH',
        body: { ...patch, updated_at: new Date().toISOString() },
        headers: { Prefer: 'return=representation' },
      });
      return rows?.[0] || null;
    },

    async resetFailed(eventId = null) {
      const filter = eventId ? `id=eq.${Number(eventId)}` : 'status=eq.failed';
      await request(`notification_events?${filter}`, {
        method: 'PATCH',
        body: { status: 'pending', retry_count: 0, error_message: null, updated_at: new Date().toISOString() },
        headers: { Prefer: 'return=minimal' },
      });
    },

    async stuckEvents(maxRetries) {
      return request(`notification_events?status=in.(failed,pending)&retry_count=lt.${Number(maxRetries)}&select=*&order=id.asc&limit=100`);
    },
  };
}
