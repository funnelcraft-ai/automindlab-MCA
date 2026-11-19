-- Missed Call Agent schema (PostgreSQL 14+). Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS tenants (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  industry          TEXT NOT NULL DEFAULT 'HVAC',
  timezone          TEXT NOT NULL DEFAULT 'America/New_York',
  active            BOOLEAN NOT NULL DEFAULT TRUE,

  -- Telephony
  twilio_number     TEXT UNIQUE,              -- E.164, the number callers reach (or missed calls forward to)
  mode              TEXT NOT NULL DEFAULT 'forward' CHECK (mode IN ('forward','ring_first')),
  ring_number       TEXT,                     -- ring_first: phone to ring before AI picks up
  ring_timeout_sec  INTEGER NOT NULL DEFAULT 18,
  transfer_number   TEXT,                     -- live transfer target for emergencies (optional)
  messaging_service_sid TEXT,                 -- per-tenant A2P messaging service (optional)

  -- Agent knowledge
  agent_name        TEXT NOT NULL DEFAULT 'Ava',
  voice_id          TEXT,                     -- optional per-tenant Retell voice override
  services          TEXT NOT NULL DEFAULT 'AC repair, furnace repair, heat pumps, maintenance tune-ups, new system installs',
  service_area      TEXT NOT NULL DEFAULT '',
  business_hours    JSONB NOT NULL DEFAULT '{"mon":["08:00","17:00"],"tue":["08:00","17:00"],"wed":["08:00","17:00"],"thu":["08:00","17:00"],"fri":["08:00","17:00"],"sat":null,"sun":null}',
  emergency_policy  TEXT NOT NULL DEFAULT 'No heat in freezing weather, no AC in extreme heat, gas smell, carbon monoxide alarm, water leaking from the unit, or vulnerable people at home are emergencies.',
  pricing_notes     TEXT NOT NULL DEFAULT 'Do not quote repair prices. A technician gives a quote on site.',
  extra_instructions TEXT NOT NULL DEFAULT '',
  avg_job_value     INTEGER NOT NULL DEFAULT 350,

  -- Booking
  booking_provider  TEXT NOT NULL DEFAULT 'none' CHECK (booking_provider IN ('none','google','calcom','link')),
  booking_link      TEXT,                     -- cal.id / Calendly / any booking page
  slot_minutes      INTEGER NOT NULL DEFAULT 120,  -- appointment window length
  min_lead_minutes  INTEGER NOT NULL DEFAULT 120,  -- earliest bookable time from now
  booking_days_ahead INTEGER NOT NULL DEFAULT 7,
  google_calendar_id TEXT DEFAULT 'primary',
  google_tokens_enc TEXT,
  calcom_base_url   TEXT DEFAULT 'https://api.cal.com',
  calcom_api_key_enc TEXT,
  calcom_event_type_id TEXT,

  -- SMS + notifications
  sms_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  sms_ai_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  textback_template TEXT NOT NULL DEFAULT 'Hi, this is {business} - sorry we missed your call! How can we help? Reply here to get scheduled{link_part}. Reply STOP to opt out.',
  notify_phones     TEXT NOT NULL DEFAULT '',  -- comma-separated E.164 numbers for owner alerts
  notify_emails     TEXT NOT NULL DEFAULT '',  -- comma-separated emails

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','client')),
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone           TEXT NOT NULL,
  name            TEXT,
  email           TEXT,
  address         TEXT,
  issue           TEXT,
  urgency         TEXT,                       -- emergency | urgent | routine
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','booked','won','lost','spam')),
  source          TEXT NOT NULL DEFAULT 'voice',
  appointment_start TIMESTAMPTZ,
  appointment_ref TEXT,
  human_takeover  BOOLEAN NOT NULL DEFAULT FALSE,  -- stops AI SMS replies
  notes           TEXT NOT NULL DEFAULT '',
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS calls (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id         INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  twilio_call_sid TEXT UNIQUE NOT NULL,
  retell_call_id  TEXT UNIQUE,
  from_number     TEXT,
  to_number       TEXT,
  -- path: ringing -> answered (human) | ai | abandoned | ai_failed
  path            TEXT NOT NULL DEFAULT 'ringing',
  outcome         TEXT,                       -- booked | callback_requested | info_only | spam | hung_up_early | transferred
  transcript      TEXT,
  summary         TEXT,
  recording_url   TEXT,
  analysis        JSONB,
  disconnection_reason TEXT,
  duration_sec    INTEGER,
  textback_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id     INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  author      TEXT NOT NULL DEFAULT 'system',  -- caller | ai | human | system
  body        TEXT NOT NULL,
  twilio_sid  TEXT UNIQUE,
  status      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opt_outs (
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id    INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calls_tenant_started ON calls (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_activity ON leads (tenant_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages (lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events (tenant_id, created_at DESC);

-- ---------- v2: in-app settings, onboarding, invites, session security ----------
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value_enc  TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_phone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS go_live_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS test_call_ok BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
