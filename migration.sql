-- ============================================================================
-- Life Countdown — Notification Engine Database Schema Migration
-- Target: Supabase PostgreSQL (Compatible with new & existing tables)
-- Run this migration via Supabase SQL Editor
-- ============================================================================

-- =========================
-- 1. system_settings table
-- =========================
CREATE TABLE IF NOT EXISTS system_settings (
  key          TEXT PRIMARY KEY,
  value        JSONB NOT NULL DEFAULT '""'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial settings
INSERT INTO system_settings (key, value) VALUES
  ('admin_emails',         '["dopa-only-tm@forth.co.th"]'::jsonb),
  ('notification_enabled', 'true'::jsonb),
  ('six_month_threshold',  '180'::jsonb),
  ('one_month_threshold',  '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =========================
-- 2. notification_events table & column migration
-- =========================
CREATE TABLE IF NOT EXISTS notification_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL,
  person_id         TEXT,
  term_end_date     TEXT,
  recipient_email   TEXT NOT NULL,
  notification_key  TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending',
  payload_snapshot  JSONB,
  payload_hash      TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns safely if table already existed
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS payload_snapshot JSONB;
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS payload_hash TEXT;
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0;
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS person_name TEXT;
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS position TEXT;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_notification_events_status
  ON notification_events (status);
CREATE INDEX IF NOT EXISTS idx_notification_events_type_person
  ON notification_events (notification_type, person_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_created
  ON notification_events (created_at DESC);

-- =========================
-- 3. audit_log table
-- =========================
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       TEXT NOT NULL DEFAULT 'system',
  action      TEXT NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON audit_log (action);

-- =========================
-- 4. RPC: claim_notification
-- Atomic state transition: pending → sending
-- =========================
CREATE OR REPLACE FUNCTION claim_notification(p_notification_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rows_affected INTEGER;
BEGIN
  UPDATE notification_events
  SET status = 'sending',
      attempt_count = COALESCE(attempt_count, 0) + 1,
      updated_at = NOW()
  WHERE notification_key = p_notification_key
    AND status = 'pending';

  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$;

-- =========================
-- 5. RPC: mark_notification_sent
-- Update status to sent with payload snapshot + hash
-- =========================
CREATE OR REPLACE FUNCTION mark_notification_sent(
  p_notification_key TEXT,
  p_payload_snapshot JSONB,
  p_payload_hash     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE notification_events
  SET status = 'sent',
      payload_snapshot = p_payload_snapshot,
      payload_hash = p_payload_hash,
      updated_at = NOW()
  WHERE notification_key = p_notification_key
    AND status = 'sending';
END;
$$;

-- =========================
-- 6. RPC: mark_notification_failed
-- Update status to failed with error message
-- =========================
CREATE OR REPLACE FUNCTION mark_notification_failed(
  p_notification_key TEXT,
  p_error_message    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE notification_events
  SET status = 'failed',
      error_message = p_error_message,
      updated_at = NOW()
  WHERE notification_key = p_notification_key
    AND status = 'sending';
END;
$$;
