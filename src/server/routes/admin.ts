// Agency-only API: people, clients, sites, bookings, compliance, settings, outbox and demo tools.
import { Router } from 'express';
import QRCode from 'qrcode';
import { getDb, nowIso } from '../db';
import { clock, config } from '../config';
import { asyncRoute, v, ValidationError } from '../lib/validate';
import { randomToken } from '../lib/security';
import { londonDate, mondayOf, weekDates } from '../../shared/time';
import { fmtPhone, normaliseMobile } from '../../shared/format';
import { actorName, requireAgency, startSession } from '../auth';
import { closeMissedSignOuts } from '../services/attendance';
import { complianceItems } from '../services/board';
import { deleteUpload, saveDataUrlImage } from '../services/files';
import { notify } from '../services/events';
import { send } from '../services/messaging';
import { cardStatus, fullName, type ClientRow, type SiteRow, type WorkerRow } from '../services/rules';
import { agencyRow, availableReplacements, runNoShowCheck, runSignoffSchedule, runtime, sendLoginLink, sendReplacement } from '../services/workflows';
import { DEMO_LOGIN, seed } from '../seed';
import { codeLimiterIp, codeLimiterPhone } from './worker';

export const adminRouter = Router();
adminRouter.use(requireAgency);

/* ---------------- Workers ---------------- */

function workerSummary(w: WorkerRow, today: string) {
  return {
    id: w.id,
    name: fullName(w),
    firstName: w.first_name,
    lastName: w.last_name,
    phone: w.phone,
    trade: w.trade,
    payRate: w.pay_rate,
    chargeRate: w.charge_rate,
    cardScheme: w.card_scheme,
    cardExpiry: w.card_expiry,
    card: cardStatus(w.card_expiry, today),
    rtw: !!w.rtw_checked_on,
    active: !!w.active,
  };
}

adminRouter.get('/workers', (_req, res) => {
  const db = getDb();
  const today = londonDate(clock.now());
  const rows = db.prepare('SELECT * FROM workers ORDER BY active DESC, last_name, first_name').all() as WorkerRow[];
  res.json(rows.map((w) => workerSummary(w, today)));
});

adminRouter.get('/workers/:id', (req, res) => {
  const db = getDb();
  const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(v.id(req.params.id)) as WorkerRow | undefined;
  if (!w) return res.status(404).json({ error: 'Worker not found' });
  const today = londonDate(clock.now());
  res.json({
    ...workerSummary(w, today),
    email: w.email,
    niNumber: w.ni_number,
    cardType: w.card_type,
    cardNumber: w.card_number,
    hasCardPhoto: !!w.card_photo_path,
    rtwCheckedOn: w.rtw_checked_on,
    rtwCheckedBy: w.rtw_checked_by,
    emergencyName: w.emergency_name,
    emergencyPhone: w.emergency_phone,
    notes: w.notes,
    tickets: db.prepare('SELECT * FROM worker_tickets WHERE worker_id = ? ORDER BY expiry').all(w.id),
    inductions: db.prepare('SELECT i.*, s.name AS site_name FROM inductions i JOIN sites s ON s.id = i.site_id WHERE i.worker_id = ? ORDER BY s.name').all(w.id),
    devices: db.prepare('SELECT id, user_agent, created_at, last_seen_at FROM devices WHERE worker_id = ? ORDER BY last_seen_at DESC').all(w.id),
    recent: db
      .prepare('SELECT a.id, a.work_date, a.in_at, a.out_at, a.flags, s.name AS site_name FROM attendance a JOIN sites s ON s.id = a.site_id WHERE a.worker_id = ? ORDER BY a.in_at DESC LIMIT 10')
      .all(w.id),
  });
});

function workerFields(b: Record<string, unknown>) {
  const phone = normaliseMobile(String(b.phone ?? ''));
  if (!phone) throw new ValidationError('Please enter a UK mobile number');
  return {
    first_name: v.str(b.firstName, 'First name', 60),
    last_name: v.str(b.lastName, 'Last name', 60),
    phone,
    email: v.email(b.email),
    trade: v.str(b.trade, 'Trade', 60),
    pay_rate: v.pounds(b.payRate, 'Pay rate'),
    charge_rate: v.pounds(b.chargeRate, 'Charge rate'),
    ni_number: v.str(b.niNumber, 'NI number', 13, { required: false }).toUpperCase().replace(/\s/g, ''),
    card_scheme: v.oneOf(b.cardScheme ?? 'CSCS', 'card scheme', ['CSCS', 'CPCS', 'NPORS', 'Other'] as const),
    card_type: v.str(b.cardType, 'Card type', 100, { required: false }),
    card_number: v.str(b.cardNumber, 'Card number', 30, { required: false }),
    card_expiry: v.dateOrNull(b.cardExpiry, 'Card expiry'),
    rtw_checked_on: v.dateOrNull(b.rtwCheckedOn, 'Right to work check date'),
    rtw_checked_by: v.str(b.rtwCheckedBy, 'Checked by', 80, { required: false }),
    emergency_name: v.str(b.emergencyName, 'Emergency contact', 80, { required: false }),
    emergency_phone: v.str(b.emergencyPhone, 'Emergency phone', 30, { required: false }),
    notes: v.str(b.notes, 'Notes', 2000, { required: false }),
    active: b.active === undefined ? 1 : v.bool(b.active) ? 1 : 0,
  };
}

adminRouter.post('/workers', (req, res) => {
  const f = workerFields(req.body ?? {});
  const db = getDb();
  if (db.prepare('SELECT 1 FROM workers WHERE phone = ?').get(f.phone)) throw new ValidationError('A worker with that mobile number already exists');
  const cols = Object.keys(f);
  const r = db.prepare(`INSERT INTO workers (${cols.join(',')}, created_at) VALUES (${cols.map(() => '?').join(',')}, ?)`).run(...Object.values(f), nowIso(clock.now()));
  res.json({ id: Number(r.lastInsertRowid) });
});

adminRouter.put('/workers/:id', (req, res) => {
  const id = v.id(req.params.id);
  const f = workerFields(req.body ?? {});
  const db = getDb();
  if (db.prepare('SELECT 1 FROM workers WHERE phone = ? AND id != ?').get(f.phone, id)) throw new ValidationError('Another worker has that mobile number');
  const r = db.prepare(`UPDATE workers SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), id);
  if (!r.changes) return res.status(404).json({ error: 'Worker not found' });
  res.json({ ok: true });
});

adminRouter.post('/workers/:id/card-photo', (req, res) => {
  const id = v.id(req.params.id);
  const db = getDb();
  const w = db.prepare('SELECT card_photo_path FROM workers WHERE id = ?').get(id) as { card_photo_path: string | null } | undefined;
  if (!w) return res.status(404).json({ error: 'Worker not found' });
  const path = saveDataUrlImage(req.body?.image, 'cards');
  deleteUpload(w.card_photo_path);
  db.prepare('UPDATE workers SET card_photo_path = ? WHERE id = ?').run(path, id);
  res.json({ ok: true });
});

adminRouter.post('/workers/:id/tickets', (req, res) => {
  const id = v.id(req.params.id);
  getDb()
    .prepare('INSERT INTO worker_tickets (worker_id, name, number, expiry) VALUES (?,?,?,?)')
    .run(id, v.str(req.body?.name, 'Ticket name', 100), v.str(req.body?.number, 'Number', 40, { required: false }), v.dateOrNull(req.body?.expiry, 'Expiry'));
  res.json({ ok: true });
});

adminRouter.delete('/workers/:id/tickets/:ticketId', (req, res) => {
  getDb().prepare('DELETE FROM worker_tickets WHERE id = ? AND worker_id = ?').run(v.id(req.params.ticketId), v.id(req.params.id));
  res.json({ ok: true });
});

adminRouter.post('/workers/:id/inductions', (req, res) => {
  getDb()
    .prepare('INSERT OR REPLACE INTO inductions (worker_id, site_id, inducted_on, inducted_by) VALUES (?,?,?,?)')
    .run(v.id(req.params.id), v.id(req.body?.siteId, 'site'), v.date(req.body?.date, 'Induction date'), v.str(req.body?.by, 'Inducted by', 80, { required: false }));
  res.json({ ok: true });
});

adminRouter.delete('/workers/:id/inductions/:siteId', (req, res) => {
  getDb().prepare('DELETE FROM inductions WHERE worker_id = ? AND site_id = ?').run(v.id(req.params.id), v.id(req.params.siteId));
  res.json({ ok: true });
});

adminRouter.delete('/workers/:id/devices/:deviceId', (req, res) => {
  getDb().prepare('DELETE FROM devices WHERE id = ? AND worker_id = ?').run(v.id(req.params.deviceId), v.id(req.params.id));
  res.json({ ok: true });
});

/* ---------------- Clients and managers ---------------- */

adminRouter.get('/clients', (_req, res) => {
  const db = getDb();
  const clients = db.prepare('SELECT * FROM clients ORDER BY name').all() as ClientRow[];
  res.json(
    clients.map((c) => ({
      ...c,
      sites: db.prepare('SELECT * FROM sites WHERE client_id = ? ORDER BY name').all(c.id),
      managers: (db.prepare('SELECT * FROM managers WHERE client_id = ? ORDER BY name').all(c.id) as { id: number }[]).map((m) => ({
        ...m,
        siteIds: (db.prepare('SELECT site_id FROM manager_sites WHERE manager_id = ?').all(m.id) as { site_id: number }[]).map((r) => r.site_id),
      })),
    })),
  );
});

function clientFields(b: Record<string, unknown>) {
  return {
    name: v.str(b.name, 'Client name', 120),
    address: v.str(b.address, 'Address', 300, { required: false }),
    billing_email: v.email(b.billing_email, 'Billing email'),
    break_default_mins: v.int(b.break_default_mins, 'Default break', 0, 120),
    break_after_mins: v.int(b.break_after_mins, 'Break applies after', 0, 720),
    ot_daily_mins: v.intOrNull(b.ot_daily_mins, 'Daily overtime threshold', 60, 1440),
    ot_weekly_mins: v.intOrNull(b.ot_weekly_mins, 'Weekly overtime threshold', 60, 10080),
    ot_saturday: v.bool(b.ot_saturday) ? 1 : 0,
    ot_sunday: v.bool(b.ot_sunday) ? 1 : 0,
    ot_multiplier: v.num(b.ot_multiplier, 'Overtime multiplier', 1, 3),
    round_mins: v.oneOf(String(b.round_mins ?? 0), 'rounding', ['0', '5', '10', '15'] as const) && Number(b.round_mins ?? 0),
    selfie_required: v.bool(b.selfie_required) ? 1 : 0,
    compliance_mode: v.oneOf(b.compliance_mode, 'compliance mode', ['warn', 'block'] as const),
    signoff_day: v.int(b.signoff_day, 'Sign-off day', 0, 6),
    signoff_time: v.time(b.signoff_time, 'Sign-off time'),
  };
}

adminRouter.post('/clients', (req, res) => {
  const f = clientFields(req.body ?? {});
  const cols = Object.keys(f);
  const r = getDb().prepare(`INSERT INTO clients (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(f));
  res.json({ id: Number(r.lastInsertRowid) });
});

adminRouter.put('/clients/:id', (req, res) => {
  const f = clientFields(req.body ?? {});
  const r = getDb().prepare(`UPDATE clients SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), v.id(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Client not found' });
  res.json({ ok: true });
});

function saveManager(id: number | null, b: Record<string, unknown>) {
  const db = getDb();
  const clientId = v.id(b.clientId, 'client');
  const name = v.str(b.name, 'Name', 80);
  const email = v.email(b.email);
  const phoneRaw = v.str(b.phone, 'Mobile', 20, { required: false });
  const phone = phoneRaw ? normaliseMobile(phoneRaw) : '';
  if (phone === null) throw new ValidationError('Please enter a UK mobile number');
  if (!email && !phone) throw new ValidationError('Enter an email or mobile number so we can send their login link');
  const siteIds = Array.isArray(b.siteIds) ? b.siteIds.map((s) => v.id(s, 'site')) : [];
  const ownSites = new Set((db.prepare('SELECT id FROM sites WHERE client_id = ?').all(clientId) as { id: number }[]).map((r) => r.id));
  if (siteIds.some((s) => !ownSites.has(s))) throw new ValidationError("A manager can only see their own company's sites");
  db.transaction(() => {
    if (id) db.prepare('UPDATE managers SET client_id = ?, name = ?, email = ?, phone = ?, active = ? WHERE id = ?').run(clientId, name, email, phone, b.active === false ? 0 : 1, id);
    else id = Number(db.prepare('INSERT INTO managers (client_id, name, email, phone) VALUES (?,?,?,?)').run(clientId, name, email, phone).lastInsertRowid);
    db.prepare('DELETE FROM manager_sites WHERE manager_id = ?').run(id);
    for (const s of siteIds) db.prepare('INSERT INTO manager_sites (manager_id, site_id) VALUES (?,?)').run(id, s);
    if (b.active === false) db.prepare("DELETE FROM sessions WHERE user_type = 'manager' AND user_id = ?").run(id);
  })();
  return id!;
}

adminRouter.post('/managers', (req, res) => res.json({ id: saveManager(null, req.body ?? {}) }));
adminRouter.put('/managers/:id', (req, res) => res.json({ id: saveManager(v.id(req.params.id), req.body ?? {}) }));
adminRouter.post('/managers/:id/send-link', (req, res) => {
  if (!sendLoginLink(getDb(), v.id(req.params.id))) return res.status(404).json({ error: 'Manager not found' });
  res.json({ ok: true });
});

/* ---------------- Sites ---------------- */

function siteFields(b: Record<string, unknown>) {
  return {
    client_id: v.id(b.client_id, 'client'),
    name: v.str(b.name, 'Site name', 120),
    address: v.str(b.address, 'Address', 300, { required: false }),
    postcode: v.str(b.postcode, 'Postcode', 10, { required: false }).toUpperCase(),
    lat: v.num(b.lat, 'Latitude', 49, 61),
    lng: v.num(b.lng, 'Longitude', -9, 2.5),
    radius_m: v.int(b.radius_m, 'Geofence radius', 50, 1000),
    start_time: v.time(b.start_time, 'Start time'),
    finish_time: v.time(b.finish_time, 'Finish time'),
    active: b.active === undefined ? 1 : v.bool(b.active) ? 1 : 0,
  };
}

adminRouter.get('/sites/:id', (req, res) => {
  const s = getDb().prepare('SELECT s.*, c.name AS client_name FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.id = ?').get(v.id(req.params.id));
  if (!s) return res.status(404).json({ error: 'Site not found' });
  res.json(s);
});

adminRouter.post('/sites', (req, res) => {
  const f = siteFields(req.body ?? {});
  const cols = Object.keys(f);
  const r = getDb()
    .prepare(`INSERT INTO sites (${cols.join(',')}, qr_token) VALUES (${cols.map(() => '?').join(',')}, ?)`)
    .run(...Object.values(f), randomToken(12));
  res.json({ id: Number(r.lastInsertRowid) });
});

adminRouter.put('/sites/:id', (req, res) => {
  const f = siteFields(req.body ?? {});
  const r = getDb().prepare(`UPDATE sites SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(f), v.id(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Site not found' });
  res.json({ ok: true });
});

/** Postcode → map position, using the free postcodes.io service (no key needed). */
adminRouter.get('/geocode', asyncRoute(async (req, res) => {
  const pc = String(req.query.postcode ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) return res.status(400).json({ error: 'That doesn’t look like a UK postcode' });
  try {
    const r = await fetch(`https://api.postcodes.io/postcodes/${pc}`, { signal: AbortSignal.timeout(5000) });
    if (r.status === 404) return res.status(404).json({ error: 'Postcode not found' });
    const j = (await r.json()) as { result?: { latitude: number; longitude: number; postcode: string } };
    if (!j.result) return res.status(404).json({ error: 'Postcode not found' });
    res.json({ lat: j.result.latitude, lng: j.result.longitude, postcode: j.result.postcode });
  } catch {
    res.status(502).json({ error: 'Postcode lookup is unavailable right now. Drag the pin instead.' });
  }
}));

/** New QR code (e.g. if a poster has been photographed and shared off site). Old posters stop working. */
adminRouter.post('/sites/:id/new-code', (req, res) => {
  getDb().prepare('UPDATE sites SET qr_token = ? WHERE id = ?').run(randomToken(12), v.id(req.params.id));
  res.json({ ok: true });
});

export function signInUrl(token: string) {
  return `${runtime.baseUrl}/s/${token}`;
}

adminRouter.get('/sites/:id/poster', asyncRoute(async (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT s.*, c.name AS client_name FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.id = ?').get(v.id(req.params.id)) as
    | (SiteRow & { client_name: string })
    | undefined;
  if (!s) return res.status(404).json({ error: 'Site not found' });
  const url = signInUrl(s.qr_token);
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
  const a = agencyRow(db);
  res.json({ siteName: s.name, clientName: s.client_name, address: `${s.address}, ${s.postcode}`, url, svg, agency: { name: a.name, phone: a.phone, colour: a.brand_colour, hasLogo: !!a.logo_path } });
}));

/* ---------------- Bookings ---------------- */

adminRouter.get('/bookings', (req, res) => {
  const db = getDb();
  const week = mondayOf(v.date(req.query.week ?? londonDate(clock.now()), 'week'));
  const days = weekDates(week);
  const bookings = db
    .prepare(
      `SELECT b.id, b.worker_id AS workerId, b.site_id AS siteId, b.date, b.status, w.first_name, w.last_name, w.trade
       FROM bookings b JOIN workers w ON w.id = b.worker_id WHERE b.date BETWEEN ? AND ? AND b.status != 'cancelled' ORDER BY w.last_name`,
    )
    .all(week, days[6]) as { id: number; workerId: number; siteId: number; date: string; status: string; first_name: string; last_name: string; trade: string }[];
  const sites = db.prepare('SELECT s.id, s.name, c.name AS clientName FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.active = 1 ORDER BY c.name, s.name').all();
  const today = londonDate(clock.now());
  const workers = (db.prepare('SELECT * FROM workers WHERE active = 1 ORDER BY last_name').all() as WorkerRow[]).map((w) => ({
    id: w.id,
    name: fullName(w),
    trade: w.trade,
    card: cardStatus(w.card_expiry, today),
    inductedSiteIds: (db.prepare('SELECT site_id FROM inductions WHERE worker_id = ?').all(w.id) as { site_id: number }[]).map((r) => r.site_id),
  }));
  res.json({
    week,
    days,
    sites,
    workers,
    bookings: bookings.map((b) => ({ id: b.id, workerId: b.workerId, siteId: b.siteId, date: b.date, status: b.status, name: `${b.first_name} ${b.last_name}`, trade: b.trade })),
  });
});

/** Book a worker on a site for one or more days. Replaces any other booking that worker has on those days. */
adminRouter.post('/bookings', (req, res) => {
  const db = getDb();
  const workerId = v.id(req.body?.workerId, 'worker');
  const siteId = v.id(req.body?.siteId, 'site');
  const dates: string[] = (Array.isArray(req.body?.dates) ? req.body.dates : []).map((d: unknown) => v.date(d));
  if (!dates.length || dates.length > 31) throw new ValidationError('Choose between 1 and 31 days');
  if (!db.prepare('SELECT 1 FROM workers WHERE id = ? AND active = 1').get(workerId)) throw new ValidationError('Worker not found');
  if (!db.prepare('SELECT 1 FROM sites WHERE id = ? AND active = 1').get(siteId)) throw new ValidationError('Site not found');
  const now = nowIso(clock.now());
  db.transaction(() => {
    for (const d of dates) {
      db.prepare('DELETE FROM bookings WHERE worker_id = ? AND date = ?').run(workerId, d);
      db.prepare("INSERT INTO bookings (worker_id, site_id, date, status, created_at) VALUES (?,?,?,'booked',?)").run(workerId, siteId, d, now);
    }
  })();
  notify({ type: 'attendance', siteId });
  res.json({ ok: true });
});

adminRouter.delete('/bookings/:id', (req, res) => {
  getDb().prepare('DELETE FROM bookings WHERE id = ?').run(v.id(req.params.id));
  notify({ type: 'attendance' });
  res.json({ ok: true });
});

/* ---------------- No-show actions ---------------- */

adminRouter.post('/alerts/:id/resolve', (req, res) => {
  getDb()
    .prepare('UPDATE alerts SET resolved_at = ?, resolved_by = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL')
    .run(nowIso(clock.now()), actorName(req.user!), v.str(req.body?.resolution, 'Note', 200, { required: false }) || 'Dealt with', v.id(req.params.id));
  notify({ type: 'alert' });
  res.json({ ok: true });
});

adminRouter.post('/alerts/:id/text-worker', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT al.*, s.name AS site_name FROM alerts al LEFT JOIN sites s ON s.id = al.site_id WHERE al.id = ?').get(v.id(req.params.id)) as
    | { worker_id: number | null; site_name: string | null }
    | undefined;
  if (!a?.worker_id) return res.status(404).json({ error: 'Alert not found' });
  const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(a.worker_id) as WorkerRow;
  const agency = agencyRow(db);
  const body =
    v.str(req.body?.message, 'Message', 480, { required: false }) ||
    `Hi ${w.first_name}, you're booked at ${a.site_name} today but haven't signed in. Are you on your way? Please call ${agency.name} on ${agency.phone}.`;
  send.sms({ to: w.phone, toName: fullName(w), kind: 'no_show', body });
  res.json({ ok: true });
});

adminRouter.get('/alerts/:id/replacements', (req, res) => {
  const r = availableReplacements(getDb(), v.id(req.params.id));
  if (!r) return res.status(404).json({ error: 'Alert not found' });
  res.json(r);
});

adminRouter.post('/alerts/:id/replace', (req, res) => {
  const r = sendReplacement(getDb(), v.id(req.params.id), v.id(req.body?.workerId, 'worker'), actorName(req.user!));
  if (!r.ok) return res.status(400).json({ error: r.message });
  res.json({ ok: true });
});

/* ---------------- Compliance ---------------- */

adminRouter.get('/compliance', (_req, res) => {
  res.json(complianceItems(getDb()));
});

/* ---------------- Agency settings ---------------- */

adminRouter.get('/agency', (_req, res) => {
  const a = agencyRow(getDb());
  const users = getDb().prepare('SELECT id, name, email, phone FROM users ORDER BY name').all();
  res.json({ ...a, hasLogo: !!a.logo_path, users });
});

adminRouter.put('/agency', (req, res) => {
  const b = req.body ?? {};
  const f = {
    name: v.str(b.name, 'Agency name', 120),
    address: v.str(b.address, 'Address', 300, { required: false }),
    phone: v.str(b.phone, 'Phone', 30, { required: false }),
    email: v.email(b.email),
    brand_colour: v.colour(b.brand_colour),
    vat_number: v.str(b.vat_number, 'VAT number', 30, { required: false }),
    company_number: v.str(b.company_number, 'Company number', 20, { required: false }),
    bank_name: v.str(b.bank_name, 'Bank', 80, { required: false }),
    bank_sort_code: v.str(b.bank_sort_code, 'Sort code', 10, { required: false }),
    bank_account: v.str(b.bank_account, 'Account number', 12, { required: false }),
    payment_terms_days: v.int(b.payment_terms_days, 'Payment terms', 0, 120),
    photo_retention_days: v.int(b.photo_retention_days, 'Photo retention', 7, 730),
  };
  getDb().prepare(`UPDATE agency SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = 1`).run(...Object.values(f));
  res.json({ ok: true });
});

adminRouter.post('/agency/logo', (req, res) => {
  const db = getDb();
  const old = agencyRow(db).logo_path;
  if (req.body?.image === null) {
    db.prepare('UPDATE agency SET logo_path = NULL WHERE id = 1').run();
  } else {
    db.prepare('UPDATE agency SET logo_path = ? WHERE id = 1').run(saveDataUrlImage(req.body?.image, 'branding'));
  }
  deleteUpload(old);
  res.json({ ok: true });
});

/* ---------------- Outbox ---------------- */

adminRouter.get('/outbox', (req, res) => {
  const kind = typeof req.query.kind === 'string' && /^[a-z_]+$/.test(req.query.kind) ? req.query.kind : null;
  const rows = getDb()
    .prepare(`SELECT * FROM outbox ${kind ? 'WHERE kind = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT 300`)
    .all(...(kind ? [kind] : []));
  res.json(rows);
});

/* ---------------- Demo tools ---------------- */

adminRouter.post('/demo/reset', (req, res) => {
  if (!config.demoMode) return res.status(403).json({ error: 'Demo mode is off' });
  seed(getDb());
  codeLimiterIp.reset();
  codeLimiterPhone.reset();
  // The reset wipes all sessions; keep the person who pressed it logged in.
  const u = getDb().prepare('SELECT id FROM users WHERE email = ?').get(DEMO_LOGIN.email) as { id: number } | undefined;
  if (u) startSession(req, res, 'agency', u.id);
  notify({ type: 'reset' });
  res.json({ ok: true });
});

adminRouter.post('/demo/run/:job', (req, res) => {
  if (!config.demoMode) return res.status(403).json({ error: 'Demo mode is off' });
  const db = getDb();
  const job = v.oneOf(req.params.job, 'job', ['no-shows', 'missed-sign-outs', 'sign-off'] as const);
  let n = 0;
  if (job === 'no-shows') n = runNoShowCheck(db);
  if (job === 'missed-sign-outs') n = closeMissedSignOuts(db, { includeToday: true });
  if (job === 'sign-off') n = runSignoffSchedule(db);
  res.json({ ok: true, count: n });
});

export { fmtPhone };
