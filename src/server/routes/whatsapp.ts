// WhatsApp: Twilio's webhook for incoming messages, the settings, and (demo only) a simulator that
// lets you message SiteRoll as any worker, site manager or member of staff.
import express, { Router } from 'express';
import { getDb } from '../db';
import { config } from '../config';
import { RateLimiter } from '../lib/security';
import { asyncRoute, v, ValidationError } from '../lib/validate';
import { fmtPhone, normaliseMobile } from '../../shared/format';
import { requireAgency } from '../auth';
import { notify } from '../services/events';
import { send } from '../services/messaging';
import { isFictional, twilioReady, validTwilioSignature } from '../services/twilio';
import { handleIncoming, offerJob } from '../services/whatsappBot';
import { agencyRow, runtime } from '../services/workflows';
import { applyDemoPhone } from '../seed';

export const whatsappRouter = Router();
const perPhone = new RateLimiter(30, 10 * 60000);

/* ---------------- Twilio webhook (WhatsApp and texts) ---------------- */

whatsappRouter.post(
  '/twilio',
  express.urlencoded({ extended: false, limit: '64kb' }),
  asyncRoute(async (req, res) => {
    const params = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, val]) => [k, String(val)]));
    // Twilio signs the exact public address it called.
    const url = `${config.publicUrl || runtime.baseUrl}${req.originalUrl}`;
    if (!validTwilioSignature(url, params, req.get('X-Twilio-Signature'))) return res.status(403).type('text/plain').send('Invalid signature');
    // Answer Twilio at once; replies are sent separately (an AI answer can take longer than Twilio waits).
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    const raw = params.From ?? '';
    const channel = raw.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
    const phone = normaliseMobile(raw.replace(/^whatsapp:/, ''));
    if (!phone || !perPhone.hit(phone)) return;
    await handleIncoming(getDb(), { phone, channel, body: params.Body ?? '' }).catch((e) => console.error('Incoming message failed:', e));
  }),
);

/* ---------------- Settings and status (agency staff) ---------------- */

whatsappRouter.get('/status', requireAgency, (_req, res) => {
  const db = getDb();
  const a = agencyRow(db);
  const demoPhone = (db.prepare("SELECT value FROM app_settings WHERE key = 'demo_phone'").get() as { value: string } | undefined)?.value ?? null;
  res.json({
    channel: (a as { message_channel?: string }).message_channel ?? 'whatsapp',
    whatsapp: twilioReady('whatsapp'),
    sms: twilioReady('sms'),
    whatsappFrom: config.twilio.whatsappFrom.replace(/^whatsapp:/, '') || null,
    smsFrom: config.twilio.smsFrom || null,
    sandbox: /14155238886/.test(config.twilio.whatsappFrom),
    webhookUrl: `${runtime.baseUrl}/api/whatsapp/twilio`,
    demoMode: config.demoMode,
    demoPhone: demoPhone ? fmtPhone(demoPhone) : null,
  });
});

whatsappRouter.put('/settings', requireAgency, (req, res) => {
  const channel = v.oneOf(req.body?.channel, 'channel', ['whatsapp', 'sms'] as const);
  getDb().prepare('UPDATE agency SET message_channel = ? WHERE id = 1').run(channel);
  res.json({ ok: true });
});

whatsappRouter.post('/test', requireAgency, (req, res) => {
  const phone = normaliseMobile(String(req.body?.phone ?? ''));
  if (!phone) throw new ValidationError('Enter a UK mobile number');
  send.sms({ to: phone, toName: 'Test', kind: 'test', body: `✅ Test from SiteRoll for ${agencyRow(getDb()).name}. If you can read this, messages are working.` });
  res.json({ ok: true, simulated: isFictional(phone) || !(twilioReady('whatsapp') || twilioReady('sms')) });
});

/** Offer a no-show's place by WhatsApp to free workers of the same trade. */
whatsappRouter.post('/offer/:alertId', requireAgency, (req, res) => {
  const ids = Array.isArray(req.body?.workerIds) ? req.body.workerIds.map((x: unknown) => v.id(x, 'worker')) : undefined;
  const n = offerJob(getDb(), v.id(req.params.alertId, 'alert'), ids);
  if (!n) return res.status(400).json({ error: 'Nobody free to offer it to, or the no-show has already been covered' });
  res.json({ ok: true, offered: n });
});

/* ---------------- Conversations and the demo simulator ---------------- */

/** Everyone SiteRoll can message, for the conversation list. */
whatsappRouter.get('/people', requireAgency, (_req, res) => {
  const db = getDb();
  const staff = db.prepare("SELECT name, phone FROM users WHERE phone != '' ORDER BY name").all() as { name: string; phone: string }[];
  const managers = db.prepare("SELECT m.name, m.phone, c.name AS client FROM managers m JOIN clients c ON c.id = m.client_id WHERE m.active = 1 AND m.phone != '' ORDER BY m.name").all() as {
    name: string;
    phone: string;
    client: string;
  }[];
  const workers = db.prepare('SELECT first_name, last_name, phone, trade FROM workers WHERE active = 1 ORDER BY first_name, last_name').all() as {
    first_name: string;
    last_name: string;
    phone: string;
    trade: string;
  }[];
  const last = (phone: string) =>
    db
      .prepare(
        `SELECT body, at FROM (SELECT body, created_at AS at FROM outbox WHERE recipient = ? AND channel IN ('whatsapp','sms')
         UNION ALL SELECT body, created_at AS at FROM inbox WHERE phone = ?) ORDER BY at DESC LIMIT 1`,
      )
      .get(phone, phone) as { body: string; at: string } | undefined;
  const person = (name: string, phone: string, role: string, detail: string) => ({ name, phone, role, detail, real: !isFictional(phone), last: last(phone) ?? null });
  res.json([
    ...staff.map((s) => person(s.name, s.phone, 'staff', 'Agency office')),
    ...managers.map((m) => person(m.name, m.phone, 'manager', `Site manager, ${m.client}`)),
    ...workers.map((w) => person(`${w.first_name} ${w.last_name}`, w.phone, 'worker', w.trade)),
  ]);
});

whatsappRouter.get('/conversation', requireAgency, (req, res) => {
  const phone = normaliseMobile(String(req.query.phone ?? ''));
  if (!phone) throw new ValidationError('Choose someone');
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT 'out' AS dir, id, channel, body, created_at AS at, status, error, kind FROM outbox WHERE recipient = ? AND channel IN ('whatsapp','sms')
         UNION ALL
         SELECT 'in' AS dir, id, channel, body, created_at AS at, 'received' AS status, NULL AS error, handled_as AS kind FROM inbox WHERE phone = ?
       ) ORDER BY at DESC, (dir = 'out') DESC, id DESC LIMIT 80`,
    )
    .all(phone, phone) as { dir: string; at: string }[];
  res.json(rows.reverse());
});

/** Demo only: message SiteRoll as this person. (Never in a live system: it would let staff act as a site manager.) */
whatsappRouter.post(
  '/simulate',
  requireAgency,
  asyncRoute(async (req, res) => {
    if (!config.demoMode) return res.status(403).json({ error: 'The simulator is only available in demo mode' });
    const phone = normaliseMobile(String(req.body?.phone ?? ''));
    const body = v.str(req.body?.body, 'Message', 1000);
    if (!phone) throw new ValidationError('Choose someone to message as');
    const handledAs = await handleIncoming(getDb(), { phone, channel: 'whatsapp', body });
    notify({ type: 'alert' });
    res.json({ ok: true, handledAs });
  }),
);

/** Demo only: put your own mobile on Callum (worker), Gareth (site manager) and the office login, so your WhatsApp plays every part. */
whatsappRouter.post('/demo-phone', requireAgency, (req, res) => {
  if (!config.demoMode) return res.status(403).json({ error: 'Only in demo mode' });
  const db = getDb();
  if (req.body?.phone === null || req.body?.phone === '') {
    db.prepare("DELETE FROM app_settings WHERE key = 'demo_phone'").run();
  } else {
    const phone = normaliseMobile(String(req.body?.phone ?? ''));
    if (!phone) throw new ValidationError('Enter your UK mobile number');
    if (isFictional(phone)) throw new ValidationError('That is one of the made-up demo numbers. Use your real mobile.');
    const clash = db.prepare("SELECT first_name, last_name FROM workers WHERE phone = ? AND NOT (first_name = 'Callum' AND last_name = 'Ainley')").get(phone) as
      | { first_name: string; last_name: string }
      | undefined;
    if (clash) throw new ValidationError(`That number already belongs to ${clash.first_name} ${clash.last_name}`);
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_phone', ?)").run(phone);
  }
  applyDemoPhone(db);
  res.json({ ok: true });
});
