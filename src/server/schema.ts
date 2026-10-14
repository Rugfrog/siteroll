// Database schema. Money in pence (INTEGER). Instants as UTC ISO strings. Work dates as 'YYYY-MM-DD' (London).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS agency (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  brand_colour TEXT NOT NULL DEFAULT '#0f766e',
  logo_path TEXT,
  vat_number TEXT NOT NULL DEFAULT '',
  company_number TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_sort_code TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  photo_retention_days INTEGER NOT NULL DEFAULT 90,
  next_invoice_number INTEGER NOT NULL DEFAULT 1,
  message_channel TEXT NOT NULL DEFAULT 'whatsapp',  -- whatsapp (falls back to text) | sms
  yard_lat REAL,
  yard_lng REAL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  billing_email TEXT NOT NULL DEFAULT '',
  break_default_mins INTEGER NOT NULL DEFAULT 30,
  break_after_mins INTEGER NOT NULL DEFAULT 360,
  ot_daily_mins INTEGER,
  ot_weekly_mins INTEGER,
  ot_saturday INTEGER NOT NULL DEFAULT 0,
  ot_sunday INTEGER NOT NULL DEFAULT 0,
  ot_multiplier REAL NOT NULL DEFAULT 1.5,
  round_mins INTEGER NOT NULL DEFAULT 0,
  selfie_required INTEGER NOT NULL DEFAULT 0,
  compliance_mode TEXT NOT NULL DEFAULT 'warn' CHECK (compliance_mode IN ('warn','block')),
  signoff_day INTEGER NOT NULL DEFAULT 4,      -- 0 = Monday … 6 = Sunday
  signoff_time TEXT NOT NULL DEFAULT '14:00',
  bookings_email TEXT NOT NULL DEFAULT '',     -- booking confirmations go here
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 200,
  start_time TEXT NOT NULL DEFAULT '07:30',
  finish_time TEXT NOT NULL DEFAULT '16:30',
  qr_token TEXT NOT NULL UNIQUE,
  signin_mode TEXT NOT NULL DEFAULT 'signin',  -- signin (QR/NFC on site) | timesheet (hours come from the booking)
  active INTEGER NOT NULL DEFAULT 1
);

-- The client's people who approve the hours (site manager, project manager, director…)
CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS manager_sites (
  manager_id INTEGER NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (manager_id, site_id)
);

CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  trade TEXT NOT NULL,
  pay_rate INTEGER NOT NULL,
  charge_rate INTEGER NOT NULL,
  ni_number TEXT NOT NULL DEFAULT '',
  card_scheme TEXT NOT NULL DEFAULT 'CSCS',
  card_type TEXT NOT NULL DEFAULT '',
  card_number TEXT NOT NULL DEFAULT '',
  card_expiry TEXT,
  card_photo_path TEXT,
  rtw_checked_on TEXT,
  rtw_checked_by TEXT NOT NULL DEFAULT '',
  emergency_name TEXT NOT NULL DEFAULT '',
  emergency_phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_tickets (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  expiry TEXT
);

CREATE TABLE IF NOT EXISTS inductions (
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  inducted_on TEXT NOT NULL,
  inducted_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (worker_id, site_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_codes_phone ON verification_codes(phone, created_at);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  work_date TEXT NOT NULL,
  in_at TEXT NOT NULL,
  out_at TEXT,
  in_lat REAL, in_lng REAL, in_accuracy REAL, in_distance_m INTEGER,
  out_lat REAL, out_lng REAL, out_accuracy REAL, out_distance_m INTEGER,
  break_mins INTEGER,
  selfie_path TEXT,
  method TEXT NOT NULL DEFAULT 'gps',        -- gps | manual | agency
  flags TEXT NOT NULL DEFAULT '[]',          -- JSON array
  status TEXT NOT NULL DEFAULT 'ok',         -- ok | needs_checking | queried
  query_comment TEXT,
  out_method TEXT,                           -- gps | auto | agency
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_site_date ON attendance(site_id, work_date);
CREATE INDEX IF NOT EXISTS idx_att_worker_date ON attendance(worker_id, work_date);
CREATE INDEX IF NOT EXISTS idx_att_open ON attendance(out_at) WHERE out_at IS NULL;

CREATE TABLE IF NOT EXISTS attendance_edits (
  id INTEGER PRIMARY KEY,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  edited_by TEXT NOT NULL,
  edited_at TEXT NOT NULL,
  changes TEXT NOT NULL,   -- JSON: [{field, from, to}]
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  action TEXT NOT NULL,              -- in | out
  at TEXT NOT NULL,
  lat REAL, lng REAL, accuracy REAL, distance_m INTEGER,
  reason TEXT NOT NULL,              -- outside | inaccurate | no_location | card_expired
  status TEXT NOT NULL DEFAULT 'blocked',  -- blocked | requested | approved | rejected
  decided_by TEXT,
  decided_at TEXT,
  attendance_id INTEGER
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',   -- booked | no_show | cancelled
  replaces_booking_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (worker_id, date)
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, site_id);

-- A week's bookings confirmed to the client by email, with a link asking who approves the hours
CREATE TABLE IF NOT EXISTS booking_confirmations (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  sent_to TEXT NOT NULL,
  sent_by TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  answered_at TEXT,
  approver_id INTEGER          -- the person the client named
);
CREATE INDEX IF NOT EXISTS idx_confirmations_site ON booking_confirmations(site_id, week_start);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,       -- no_show | compliance | missed_signout | manual_request | query | not_booked | out_of_area
  site_id INTEGER,
  worker_id INTEGER,
  booking_id INTEGER,
  attendance_id INTEGER,
  attempt_id INTEGER,
  date TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(resolved_at, type);

CREATE TABLE IF NOT EXISTS roll_calls (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  kind TEXT NOT NULL DEFAULT 'drill',   -- drill | incident
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS roll_call_people (
  id INTEGER PRIMARY KEY,
  roll_call_id INTEGER NOT NULL REFERENCES roll_calls(id) ON DELETE CASCADE,
  worker_id INTEGER,
  name TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  is_visitor INTEGER NOT NULL DEFAULT 0,
  safe_at TEXT,
  safe_by TEXT,              -- 'phone' when the worker tapped "I'm safe", otherwise who ticked them
  help_at TEXT,              -- the worker tapped "I need help"
  alert_token_hash TEXT      -- personal link in the fire alarm text
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timesheets (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  week_start TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open | sent | queried | approved
  signoff_sent_at TEXT,
  approved_by_manager_id INTEGER,
  approved_by_name TEXT,
  approved_at TEXT,
  approved_device TEXT,
  invoice_id INTEGER,
  UNIQUE (site_id, week_start)
);

CREATE TABLE IF NOT EXISTS timesheet_lines (
  id INTEGER PRIMARY KEY,
  timesheet_id INTEGER NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL,
  worker_name TEXT NOT NULL,
  trade TEXT NOT NULL,
  normal_mins INTEGER NOT NULL,
  ot_mins INTEGER NOT NULL,
  pay_rate INTEGER NOT NULL,
  ot_pay_rate INTEGER NOT NULL,
  charge_rate INTEGER NOT NULL,
  ot_charge_rate INTEGER NOT NULL,
  pay_pence INTEGER NOT NULL,
  charge_pence INTEGER NOT NULL,
  days TEXT NOT NULL   -- JSON snapshot of each shift
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  week_start TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  net_pence INTEGER NOT NULL,
  vat_pence INTEGER NOT NULL,
  gross_pence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',  -- sent | paid   (overdue is worked out from due_on)
  paid_on TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL,
  description TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  rate_pence INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,     -- sms | email
  recipient TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  kind TEXT NOT NULL,        -- code | no_show | signoff | invoice | magic_link | replacement | missed_signout | compliance | fire | offer | chat | booking | approver | other
  link TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'simulated',  -- simulated | sending | sent | failed
  error TEXT
);

-- Messages people send to SiteRoll's WhatsApp (or text) number
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  channel TEXT NOT NULL,     -- whatsapp | sms
  body TEXT NOT NULL,
  handled_as TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_phone ON inbox(phone, created_at);

-- A short conversation in progress, e.g. "Reply YES to approve"
CREATE TABLE IF NOT EXISTS chat_state (
  phone TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- People who replied STOP: send them ordinary texts instead of WhatsApp
CREATE TABLE IF NOT EXISTS wa_optouts (
  phone TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- No-show cover offered to free workers by WhatsApp: first to reply YES gets it
CREATE TABLE IF NOT EXISTS job_offers (
  id INTEGER PRIMARY KEY,
  alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | won | filled | declined
  sent_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_offers_worker ON job_offers(worker_id, status);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_type TEXT NOT NULL,   -- agency | manager
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY,
  manager_id INTEGER NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,     -- login | signoff
  timesheet_id INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  name TEXT PRIMARY KEY,
  last_key TEXT NOT NULL
);
`;
