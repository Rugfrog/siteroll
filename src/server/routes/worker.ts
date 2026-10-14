// Worker-facing API: no passwords. A phone is remembered after a one-time text code.
import { Router } from 'express';
import { getDb, nowIso } from '../db';
import { clock, config } from '../config';
import { RateLimiter, hashToken, safeEqual, sixDigitCode } from '../lib/security';
import { v } from '../lib/validate';
import { normaliseMobile } from '../../shared/format';
import { londonDate } from '../../shared/time';
import { DEVICE_COOKIE, deviceWorker, rememberDevice } from '../auth';
import { openShiftFor, requestManual, signIn, signOut } from '../services/attendance';
import { send } from '../services/messaging';
import { agencyRow } from '../services/workflows';
import { cardStatus, type ClientRow, type SiteRow, type WorkerRow } from '../services/rules';
import { alarmForToken, alarmForWorker, AlarmError, markFromPhone, type AlarmInfo } from '../services/firealarm';
import { hasSubscription, saveSubscription, vapidKeys } from '../services/push';
import { workerHours } from '../services/timesheets';

export const codeLimiterPhone = new RateLimiter(3, 15 * 60000);
export const codeLimiterIp = new RateLimiter(10, 15 * 60000);
export const signLimiter = new RateLimiter(30, 10 * 60000);

const CODE_TTL_MS = 10 * 60000;

function siteByToken(token: string) {
  const db = getDb();
  const site = db.prepare('SELECT * FROM sites WHERE qr_token = ? AND active = 1').get(token) as SiteRow | undefined;
  if (!site) return null;
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(site.client_id) as ClientRow;
  return { site, client };
}

/** "Pretend I'm at…" places, demo mode only. */
function demoPlaces() {
  const db = getDb();
  const sites = db.prepare('SELECT id, name, lat, lng FROM sites WHERE active = 1 ORDER BY name').all() as { id: number; name: string; lat: number; lng: number }[];
  const a = agencyRow(db);
  return [
    ...sites.map((s) => ({ key: `site-${s.id}`, label: s.name, lat: s.lat + 0.0002, lng: s.lng - 0.0002, accuracy: 12 })),
    { key: 'yard', label: 'The yard (Huddersfield)', lat: a.yard_lat ?? 53.6532, lng: a.yard_lng ?? -1.7676, accuracy: 15 },
    { key: 'home', label: 'At home in bed (Holmfirth)', lat: 53.5704, lng: -1.7876, accuracy: 20 },
  ];
}

export const workerRouter = Router();

workerRouter.get('/site/:token', (req, res) => {
  const found = siteByToken(String(req.params.token));
  if (!found) return res.status(404).json({ error: "This sign-in code isn't recognised. The site may have closed." });
  const { site, client } = found;
  const db = getDb();
  const agency = agencyRow(db);
  const workerId = deviceWorker(req);
  let worker = null;
  if (workerId) {
    const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as WorkerRow;
    const open = openShiftFor(db, w.id);
    const openSite = open ? (db.prepare('SELECT name FROM sites WHERE id = ?').get(open.site_id) as { name: string }) : null;
    const today = londonDate(clock.now());
    worker = {
      firstName: w.first_name,
      lastName: w.last_name,
      signedIn: open ? { here: open.site_id === site.id, siteName: openSite!.name, since: open.in_at } : null,
      card: cardStatus(w.card_expiry, today),
      inducted: !!db.prepare('SELECT 1 FROM inductions WHERE worker_id = ? AND site_id = ?').get(w.id, site.id),
      alertsOn: hasSubscription(db, w.id),
    };
  }
  res.json({
    site: {
      name: site.name,
      address: site.address,
      postcode: site.postcode,
      clientName: client.name,
      selfieRequired: !!client.selfie_required,
      breakDefault: client.break_default_mins,
      blocksExpiredCards: client.compliance_mode === 'block',
      signinMode: site.signin_mode,
    },
    agency: { name: agency.name, phone: agency.phone, colour: agency.brand_colour, hasLogo: !!agency.logo_path },
    worker,
    demoMode: config.demoMode,
    demoPlaces: config.demoMode ? demoPlaces() : [],
    demoHint: config.demoMode ? { phone: '07700 900102', name: 'Callum Ainley' } : null,
  });
});

workerRouter.post('/code', (req, res) => {
  const phone = normaliseMobile(String(req.body?.phone ?? ''));
  if (!phone) return res.status(400).json({ error: 'Please enter a UK mobile number, like 07700 900123' });
  const ip = req.ip || 'unknown';
  if (!codeLimiterIp.hit(ip) || !codeLimiterPhone.hit(phone)) {
    return res.status(429).json({ error: 'Too many codes asked for. Please wait 15 minutes and try again, or call the agency.' });
  }
  const db = getDb();
  const w = db.prepare('SELECT * FROM workers WHERE phone = ? AND active = 1').get(phone) as WorkerRow | undefined;
  const agency = agencyRow(db);
  if (!w) return res.status(404).json({ error: `That number isn't registered with ${agency.name}. Check it, or call the office on ${agency.phone}.` });
  const code = sixDigitCode();
  const now = clock.now();
  db.prepare('UPDATE verification_codes SET used_at = ? WHERE phone = ? AND used_at IS NULL').run(nowIso(now), phone);
  db.prepare('INSERT INTO verification_codes (phone, code_hash, created_at, expires_at, ip) VALUES (?,?,?,?,?)').run(
    phone,
    hashToken(`${phone}:${code}`),
    nowIso(now),
    new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    ip,
  );
  send.sms({ to: phone, toName: `${w.first_name} ${w.last_name}`, kind: 'code', body: `Your SiteRoll code is ${code}. It expires in 10 minutes. Never share this code.` });
  res.json({ ok: true, demoCode: config.demoMode ? code : undefined });
});

workerRouter.post('/verify', (req, res) => {
  const phone = normaliseMobile(String(req.body?.phone ?? ''));
  const code = String(req.body?.code ?? '').replace(/\s/g, '');
  if (!phone || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Please enter the 6-digit code from the text' });
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM verification_codes WHERE phone = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1')
    .get(phone, nowIso(clock.now())) as { id: number; code_hash: string; attempts: number } | undefined;
  if (!row) return res.status(400).json({ error: 'That code has expired. Ask for a new one.' });
  if (row.attempts >= 5) return res.status(429).json({ error: 'Too many wrong codes. Ask for a new one.' });
  if (!safeEqual(row.code_hash, hashToken(`${phone}:${code}`))) {
    db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return res.status(400).json({ error: "That code isn't right. Check the text and try again." });
  }
  db.prepare('UPDATE verification_codes SET used_at = ? WHERE id = ?').run(nowIso(clock.now()), row.id);
  const w = db.prepare('SELECT id, first_name FROM workers WHERE phone = ? AND active = 1').get(phone) as { id: number; first_name: string };
  rememberDevice(req, res, w.id);
  res.json({ ok: true, firstName: w.first_name });
});

workerRouter.post('/sign', (req, res) => {
  const workerId = deviceWorker(req);
  if (!workerId) return res.status(401).json({ error: 'This phone needs to be set up first', code: 'not_registered' });
  if (!signLimiter.hit(`w${workerId}`)) return res.status(429).json({ error: 'Too many tries. Please wait a few minutes.' });
  const found = siteByToken(String(req.body?.token ?? ''));
  if (!found) return res.status(404).json({ error: 'Site not found' });
  const action = v.oneOf(req.body?.action, 'action', ['in', 'out'] as const);
  const r = req.body?.reading;
  const reading = r && typeof r === 'object' ? { lat: Number(r.lat), lng: Number(r.lng), accuracy: Number(r.accuracy) } : null;
  const capturedAt = typeof req.body?.capturedAt === 'string' ? req.body.capturedAt : null;
  const db = getDb();
  const input = { workerId, siteId: found.site.id, reading, capturedAt };
  const result =
    action === 'in'
      ? signIn(db, { ...input, selfie: typeof req.body?.selfie === 'string' ? req.body.selfie : null })
      : signOut(db, { ...input, breakMins: req.body?.breakMins === null || req.body?.breakMins === undefined ? null : Number(req.body.breakMins) });
  res.status(result.status === 'error' ? 400 : 200).json(result);
});

/** The worker's own hours this week and last, as the sites' timesheets have them. */
workerRouter.get('/hours', (req, res) => {
  const workerId = deviceWorker(req);
  if (!workerId) return res.status(401).json({ error: 'This phone needs to be set up first' });
  res.json(workerHours(getDb(), workerId));
});

workerRouter.post('/manual', (req, res) => {
  const workerId = deviceWorker(req);
  if (!workerId) return res.status(401).json({ error: 'This phone needs to be set up first' });
  const ok = requestManual(getDb(), workerId, v.id(req.body?.attemptId, 'attempt'));
  if (!ok) return res.status(400).json({ error: 'That request has already been sent' });
  res.json({ ok: true });
});

workerRouter.post('/forget', (req, res) => {
  const token = req.cookies?.[DEVICE_COOKIE];
  if (token) getDb().prepare('DELETE FROM devices WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(DEVICE_COOKIE, { path: '/' });
  res.json({ ok: true });
});

/* ---------------- Fire alarm ---------------- */

const alarmView = (a: AlarmInfo | null) =>
  a && {
    site: a.site,
    name: a.name,
    startedAt: a.startedAt,
    finished: a.finished,
    status: a.status,
    safeAt: a.safeAt,
    helpAt: a.helpAt,
    total: a.total,
    safe: a.safe,
  };

const statusOf = (x: unknown) => v.oneOf(x, 'status', ['safe', 'help'] as const);

/** Polled by an open sign-in page: is there a roll call I'm in right now? */
workerRouter.get('/alarm', (req, res) => {
  const workerId = deviceWorker(req);
  if (!workerId) return res.json({ alarm: null });
  res.json({ alarm: alarmView(alarmForWorker(getDb(), workerId)) });
});

workerRouter.post('/alarm', (req, res) => {
  const workerId = deviceWorker(req);
  const a = workerId ? alarmForWorker(getDb(), workerId) : null;
  if (!a) return res.status(404).json({ error: 'There is no roll call running for you' });
  try {
    res.json({ alarm: alarmView(markFromPhone(getDb(), a, statusOf(req.body?.status))) });
  } catch (e) {
    if (e instanceof AlarmError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

/** The personal link in the fire alarm text. Works on any phone, no setup needed. */
function agencyBits() {
  const a = agencyRow(getDb());
  return { name: a.name, phone: a.phone, colour: a.brand_colour, hasLogo: !!a.logo_path };
}

workerRouter.get('/safe/:token', (req, res) => {
  const a = alarmForToken(getDb(), String(req.params.token));
  if (!a) return res.status(404).json({ error: 'This link has expired or is not recognised.' });
  res.json({ alarm: alarmView(a), agency: agencyBits() });
});

workerRouter.post('/safe/:token', (req, res) => {
  const a = alarmForToken(getDb(), String(req.params.token));
  if (!a) return res.status(404).json({ error: 'This link has expired or is not recognised.' });
  try {
    res.json({ alarm: alarmView(markFromPhone(getDb(), a, statusOf(req.body?.status))) });
  } catch (e) {
    if (e instanceof AlarmError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

/* ---------------- Fire alerts on this phone (web push) ---------------- */

workerRouter.get('/push', (req, res) => {
  const workerId = deviceWorker(req);
  res.json({ publicKey: vapidKeys(getDb()).publicKey, subscribed: workerId ? hasSubscription(getDb(), workerId) : false });
});

workerRouter.post('/push', (req, res) => {
  const workerId = deviceWorker(req);
  if (!workerId) return res.status(401).json({ error: 'This phone needs to be set up first' });
  if (!saveSubscription(getDb(), workerId, req.body?.subscription)) return res.status(400).json({ error: 'That subscription looks wrong' });
  res.json({ ok: true });
});
