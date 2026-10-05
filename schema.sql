-- ============================================================
-- SMS Outreach App — PostgreSQL schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ---------------------------------------------------------
-- Users & team access
-- ---------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------
CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT NOT NULL UNIQUE,          -- E.164 format, e.g. +447911123456
  consent_status  TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('opted_in', 'opted_out', 'unknown')),
  consent_source  TEXT,                          -- how/where consent was captured
  opted_out       BOOLEAN NOT NULL DEFAULT false,
  opted_out_at    TIMESTAMPTZ,
  tags            TEXT[] NOT NULL DEFAULT '{}',     -- workflow labels e.g. 'Needs follow up', 'Awaiting deletion'
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_opted_out ON contacts(opted_out);

-- ---------------------------------------------------------
-- Contact groups — e.g. "Miami 1", so imports land in a named list
-- ---------------------------------------------------------
CREATE TABLE contact_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contact_group_members (
  group_id    UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, contact_id)
);

CREATE INDEX idx_group_members_contact ON contact_group_members(contact_id);

-- ---------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------
CREATE TABLE campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'paused')),
  scheduled_at      TIMESTAMPTZ,
  ai_enabled        BOOLEAN NOT NULL DEFAULT false,
  ai_system_prompt  TEXT,          -- qualification criteria, tone, business context for the AI agent
  ai_calendar_id    TEXT,          -- calendar to book appointments against
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Scheduler: pace sends + only deliver inside a convenience window
  min_delay_seconds INT NOT NULL DEFAULT 10,  -- floor between messages (globally enforced)
  send_start_hour   INT,                       -- e.g. 10 = 10:00; NULL = no window (24/7)
  send_end_hour     INT,                       -- exclusive end, e.g. 19 = up to 19:00
  timezone          TEXT NOT NULL DEFAULT 'LOCAL', -- IANA name for the window; 'LOCAL' = app machine tz
  daily_cap         INT NOT NULL DEFAULT 2,    -- max outbound msgs per contact per day; 0 = unlimited
  daily_budget      INT NOT NULL DEFAULT 0,    -- max outbound msgs per campaign per day; 0 = unlimited
  telnyx_profile_id TEXT                       -- Telnyx messaging profile for sends; NULL = default number
);

-- Singleton row tracking the last real send, so the campaign pump never blasts
CREATE TABLE send_pace (
  single       BOOLEAN PRIMARY KEY DEFAULT true,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT send_pace_single CHECK (single)
);
INSERT INTO send_pace (single, last_sent_at) VALUES (true, now());

-- Brute-force guard: every /api/auth attempt is logged here so login/register/
-- forgot/reset can be rate-limited per IP and per email.
CREATE TABLE auth_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip           TEXT NOT NULL DEFAULT '',
  email        TEXT,
  action       TEXT NOT NULL,           -- 'login' | 'register' | 'forgot' | 'reset'
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_attempts_ip_idx   ON auth_attempts (ip, action, attempted_at);
CREATE INDEX IF NOT EXISTS auth_attempts_em_idx   ON auth_attempts (lower(email), action, attempted_at);

-- Pump health singleton: the pump updates last_tick on every run, so a stalled
-- queued queue or a failure-rate spike can trigger an email alert (see lib/health.ts).
CREATE TABLE pump_health (
  single              BOOLEAN PRIMARY KEY DEFAULT true CHECK (single),
  last_tick           TIMESTAMPTZ,
  last_sent           TIMESTAMPTZ,
  last_stall_alert    TIMESTAMPTZ,
  last_failure_alert  TIMESTAMPTZ
);
INSERT INTO pump_health (single, last_tick) VALUES (true, now()) ON CONFLICT DO NOTHING;

-- Reply scenarios: the ONLY approved responses an AI-enabled campaign can send.
-- The AI may classify an inbound reply into one of these — it never writes copy
-- or books appointments on its own. Empty keywords = catch-all fallback.
CREATE TABLE campaign_scenarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  keywords       TEXT NOT NULL DEFAULT '',   -- comma-separated, case-insensitive substring match
  reply_template TEXT NOT NULL DEFAULT '',   -- supports {name} / {{name}}
  action         TEXT NOT NULL DEFAULT 'reply' CHECK (action IN ('reply', 'book', 'opt_out', 'none')),
  priority       INT NOT NULL DEFAULT 100,   -- lower = evaluated first
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scenarios_campaign ON campaign_scenarios(campaign_id);

-- A/B variants — contacts are assigned manually, no auto-split
CREATE TABLE campaign_variants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,   -- 'A', 'B', etc.
  message_template  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, label)
);

-- Junction table: which contacts are in which campaign, and which variant they got
CREATE TABLE campaign_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  variant_id   UUID REFERENCES campaign_variants(id), -- nullable until manually assigned
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX idx_campaign_contacts_campaign ON campaign_contacts(campaign_id);
CREATE INDEX idx_campaign_contacts_variant ON campaign_contacts(variant_id);

-- Follow-ups: timed messages after the initial send if no reply received
CREATE TABLE campaign_follow_ups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  position         INT NOT NULL DEFAULT 1,
  delay_days       INT NOT NULL DEFAULT 1 CHECK (delay_days >= 0),
  delay_hours      INT NOT NULL DEFAULT 0 CHECK (delay_hours >= 0 AND delay_hours < 24),
  message_template TEXT NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_followups_campaign ON campaign_follow_ups(campaign_id);
CREATE INDEX idx_followups_position ON campaign_follow_ups(campaign_id, position);

-- ---------------------------------------------------------
-- Messages — the raw SMS log (source of truth for delivery/reply stats)
-- ---------------------------------------------------------
CREATE TABLE messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         UUID NOT NULL REFERENCES contacts(id),
  campaign_id        UUID REFERENCES campaigns(id),
  variant_id         UUID REFERENCES campaign_variants(id),
  follow_up_id       UUID REFERENCES campaign_follow_ups(id),   -- set for follow-up messages
  direction          TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  body               TEXT NOT NULL,
  telnyx_message_id  TEXT,
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'received')),
  error_detail       TEXT,
  send_at            TIMESTAMPTZ,   -- when a queued outbound message is allowed to go out
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_campaign ON messages(campaign_id);
CREATE INDEX idx_messages_contact ON messages(contact_id);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_followup ON messages(follow_up_id);
CREATE INDEX idx_messages_contact_sent ON messages(contact_id, sent_at);

-- ---------------------------------------------------------
-- AI conversation engine
-- ---------------------------------------------------------
CREATE TABLE conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES contacts(id),
  campaign_id   UUID REFERENCES campaigns(id),
  status        TEXT NOT NULL DEFAULT 'ai_active' CHECK (status IN ('ai_active', 'human_takeover', 'closed')),
  qualified     BOOLEAN NOT NULL DEFAULT false,
  qualified_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_campaign ON conversations(campaign_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

-- LLM-facing message history; links back to the actual SMS row where applicable
CREATE TABLE conversation_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id       UUID REFERENCES messages(id),
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_messages_conversation ON conversation_messages(conversation_id);

-- ---------------------------------------------------------
-- Appointments booked by the AI agent
-- ---------------------------------------------------------
CREATE TABLE appointments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         UUID NOT NULL REFERENCES contacts(id),
  conversation_id    UUID REFERENCES conversations(id),
  scheduled_at       TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_conversation ON appointments(conversation_id);

-- ============================================================
-- Dashboard views — one query per metric, kept simple on purpose
-- ============================================================

-- Per-campaign summary: delivery rate, reply rate, opt-out rate, qualified rate, booked count
CREATE VIEW campaign_stats AS
SELECT
  c.id                                                            AS campaign_id,
  c.name                                                          AS campaign_name,
  COUNT(DISTINCT m.id) FILTER (WHERE m.direction = 'outbound')                          AS total_sent,
  COUNT(DISTINCT m.id) FILTER (WHERE m.direction = 'outbound' AND m.status = 'delivered') AS total_delivered,
  COUNT(DISTINCT m.contact_id) FILTER (WHERE m.direction = 'inbound')                   AS total_replied,
  COUNT(DISTINCT cc.contact_id) FILTER (WHERE ct.opted_out)                             AS total_opted_out,
  COUNT(DISTINCT conv.id) FILTER (WHERE conv.qualified)                                 AS total_qualified,
  COUNT(DISTINCT a.id)                                                                  AS total_booked
FROM campaigns c
LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.id
LEFT JOIN contacts ct ON ct.id = cc.contact_id
LEFT JOIN messages m ON m.campaign_id = c.id
LEFT JOIN conversations conv ON conv.campaign_id = c.id
LEFT JOIN appointments a ON a.conversation_id = conv.id
GROUP BY c.id, c.name;

-- Per-variant breakdown, for when you're comparing A vs B manually
CREATE VIEW variant_stats AS
SELECT
  v.id                                                               AS variant_id,
  v.campaign_id,
  v.label,
  COUNT(DISTINCT m.id) FILTER (WHERE m.direction = 'outbound')                            AS total_sent,
  COUNT(DISTINCT m.id) FILTER (WHERE m.direction = 'outbound' AND m.status = 'delivered')  AS total_delivered,
  COUNT(DISTINCT m.contact_id) FILTER (WHERE m.direction = 'inbound')                     AS total_replied
FROM campaign_variants v
LEFT JOIN messages m ON m.variant_id = v.id
GROUP BY v.id, v.campaign_id, v.label;
