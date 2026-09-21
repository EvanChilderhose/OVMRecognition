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
  approved_by   TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transactions_employee ON point_transactions(employee_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON point_transactions(status);

-- Log of every inbound/outbound SMS for troubleshooting and an audit trail
CREATE TABLE IF NOT EXISTS sms_log (
  id           SERIAL PRIMARY KEY,
  employee_id  INTEGER REFERENCES employees(id),
  direction    TEXT NOT NULL, -- 'inbound' or 'outbound'
  phone        TEXT,
  body         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
