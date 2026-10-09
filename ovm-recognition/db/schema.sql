-- Ottawa Valley Meats Employee Recognition — database schema
-- Mirrors the four tabs of the original spreadsheet: Database, Point Transactions,
-- Rewards, Recognition Rules.

CREATE TABLE IF NOT EXISTS employees (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  phone            TEXT UNIQUE,           -- E.164 format e.g. +16135551234, used to match inbound texts
  department       TEXT,
  start_date       DATE,
  birthday         DATE,                  -- year is ignored for matching; store any year
  status           TEXT DEFAULT 'Active', -- Active / Inactive
  current_points   INTEGER DEFAULT 0,
  lifetime_points  INTEGER DEFAULT 0,
  shifts_completed INTEGER DEFAULT 0,
  orders_picked    INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recognition_rules (
  id            SERIAL PRIMARY KEY,
  event         TEXT NOT NULL UNIQUE,   -- e.g. "Birthday", "5 Year Anniversary", "Safety Champ"
  points        INTEGER NOT NULL,
  dollar_value  NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS rewards (
  id                       SERIAL PRIMARY KEY,
  reward                   TEXT NOT NULL,
  point_cost               INTEGER NOT NULL,
  dollar_value             NUMERIC(10,2),
  description              TEXT,
  active                   BOOLEAN DEFAULT true,
  fulfillment_instructions TEXT
);

CREATE TABLE IF NOT EXISTS point_transactions (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER REFERENCES employees(id),
  type          TEXT NOT NULL,        -- 'award' or 'redemption'
  reason        TEXT NOT NULL,        -- recognition rule name, or reward name
  points        INTEGER NOT NULL,     -- positive for awards, negative for redemptions
  status        TEXT DEFAULT 'pending', -- pending / approved / denied / fulfilled (redemptions), or 'approved' immediately for auto awards
  nominated_by  TEXT,                 -- who put forward a manual award
  approved_by   TEXT,                 -- who approved or denied it
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

-- Columns added after the first release (no-ops on a fresh database)
ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS nominated_by TEXT;
-- Reward pictures: an uploaded photo (stored here, since Render's disk is wiped on each
-- deploy) or one of the built-in icons. image_version changes on each upload so phones
-- don't keep showing an old cached photo.
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS image BYTEA;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS image_mime TEXT;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS image_version INTEGER DEFAULT 0;
-- Secret code in each employee's personal profile link (/me/<token>). Created when the
-- employee is added, or the first time a link is needed (see lib/profile.js).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS profile_token TEXT UNIQUE;
-- Which month a monthly award is for, as 'YYYY-MM' (e.g. Employee of the Month)
ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS period TEXT;
-- Whether employees see this rule in the "Earn points" list on their profile
ALTER TABLE recognition_rules ADD COLUMN IF NOT EXISTS show_on_profile BOOLEAN DEFAULT true;
-- A short line shown under the rule on employee profiles (e.g. who's eligible)
ALTER TABLE recognition_rules ADD COLUMN IF NOT EXISTS note TEXT;
-- When the employee was sent the welcome text (empty = not yet)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ;

-- Shifts worked per employee per month, from the monthly import. An employee's
-- shifts_completed is the total of these, so re-importing a month never double-counts.
CREATE TABLE IF NOT EXISTS monthly_shifts (
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  period       TEXT NOT NULL,   -- 'YYYY-MM'
  shifts       INTEGER NOT NULL,
  imported_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (employee_id, period)
);

-- Text wording edited in the dashboard. Texts without a row here use the
-- default wording in lib/messages.js.
CREATE TABLE IF NOT EXISTS message_templates (
  key         TEXT PRIMARY KEY,
  body        TEXT,
  enabled     BOOLEAN DEFAULT true,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_employee ON point_transactions(employee_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON point_transactions(status);

-- Employee of the Month, one pick per month. employee_id is empty when it went to
-- someone outside the rewards program ("Other") — then no points or text are given.
CREATE TABLE IF NOT EXISTS employee_of_month (
  period       TEXT PRIMARY KEY,                    -- 'YYYY-MM'
  employee_id  INTEGER REFERENCES employees(id),
  other_name   TEXT,
  awarded_by   TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- One-off setup steps that have already run, so they never repeat
-- (e.g. adding a new recognition rule once, even if it's later renamed)
CREATE TABLE IF NOT EXISTS app_setup_done (
  key      TEXT PRIMARY KEY,
  done_at  TIMESTAMPTZ DEFAULT now()
);

-- Reminders texted to managers, one per kind per month, so a restart never double-sends
CREATE TABLE IF NOT EXISTS admin_reminders (
  kind     TEXT NOT NULL,   -- e.g. 'month_end'
  period   TEXT NOT NULL,   -- 'YYYY-MM'
  sent_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (kind, period)
);

-- Log of every inbound/outbound SMS for troubleshooting and an audit trail
CREATE TABLE IF NOT EXISTS sms_log (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER REFERENCES employees(id),
  direction    TEXT NOT NULL, -- 'inbound' or 'outbound'
  phone        TEXT,
  body         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
