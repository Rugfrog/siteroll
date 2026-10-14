// Office TV wall: everything the big screen needs in one call. The money meter itself ticks in the
// browser from today's shifts (a live estimate before overtime and rounding).
import { Router } from 'express';
import { getDb, nowIso, parseFlags } from '../db';
import { clock } from '../config';
import { londonDate, londonToUtc, mondayOf } from '../../shared/time';
import { fmtMiles } from '../../shared/format';
import { requireAgency } from '../auth';
import { FLAG_LABELS } from '../services/attendance';
import { liveBoard } from '../services/board';
import { agencyRow, invoiceStatus } from '../services/workflows';
import { cardStatus, type WorkerRow } from '../services/rules';

export const wallRouter = Router();
wallRouter.use('/wall', requireAgency);

interface FeedItem {
  at: string;
  kind: 'in' | 'out' | 'blocked' | 'noshow' | 'fire' | 'manual';
  text: string;
  detail?: string;
}

wallRouter.get('/wall', (_req, res) => {
  const db = getDb();
  const now = clock.now();
  const today = londonDate(now);
  const board = liveBoard(db, null);
  const siteRows = db.prepare('SELECT id, lat, lng FROM sites WHERE active = 1').all() as { id: number; lat: number; lng: number }[];
  const pos = new Map(siteRows.map((s) => [s.id, s]));

  // Today's shifts, with what's needed to work out hours and money as the clock ticks.
  const shifts = db
    .prepare(
      `SELECT a.in_at, a.out_at, a.break_mins, w.charge_rate, w.pay_rate, c.break_default_mins, c.break_after_mins
       FROM attendance a JOIN workers w ON w.id = a.worker_id JOIN sites s ON s.id = a.site_id JOIN clients c ON c.id = s.client_id
       WHERE a.work_date = ?`,
    )
    .all(today) as { in_at: string; out_at: string | null; break_mins: number | null; charge_rate: number; pay_rate: number; break_default_mins: number; break_after_mins: number }[];

  const feed: FeedItem[] = [];
  const ins = db
    .prepare(
      `SELECT a.in_at, a.out_at, a.method, a.flags, w.first_name, w.last_name, s.name AS site FROM attendance a
       JOIN workers w ON w.id = a.worker_id JOIN sites s ON s.id = a.site_id WHERE a.work_date = ?`,
    )
    .all(today) as { in_at: string; out_at: string | null; method: string; flags: string; first_name: string; last_name: string; site: string }[];
  for (const a of ins) {
    const flags = parseFlags(a.flags).filter((f) => ['late', 'not_booked', 'card', 'manual'].includes(f));
    feed.push({ at: a.in_at, kind: a.method === 'manual' ? 'manual' : 'in', text: `${a.first_name} ${a.last_name} signed in`, detail: [a.site, ...flags.map((f) => FLAG_LABELS[f])].join(' · ') });
    if (a.out_at) feed.push({ at: a.out_at, kind: 'out', text: `${a.first_name} ${a.last_name} signed out`, detail: a.site });
  }
  const blocked = db
    .prepare(
      `SELECT t.at, t.reason, t.distance_m, w.first_name, w.last_name, s.name AS site, s.radius_m FROM sign_in_attempts t
       JOIN workers w ON w.id = t.worker_id JOIN sites s ON s.id = t.site_id WHERE t.at >= ?`,
    )
    .all(londonToUtc(today, '00:00').toISOString()) as { at: string; reason: string; distance_m: number | null; first_name: string; last_name: string; site: string; radius_m: number }[];
  for (const b of blocked) {
    feed.push({
      at: b.at,
      kind: 'blocked',
      text: b.reason === 'card_expired' ? `${b.first_name} ${b.last_name} stopped: card expired` : `${b.first_name} ${b.last_name} blocked: not on site`,
      detail: b.reason === 'outside' && b.distance_m != null ? `${b.site} · ${fmtMiles(Math.max(0, b.distance_m - b.radius_m))} away` : b.site,
    });
  }
  const noShows = db
    .prepare(`SELECT al.created_at, w.first_name, w.last_name, s.name AS site FROM alerts al JOIN workers w ON w.id = al.worker_id JOIN sites s ON s.id = al.site_id WHERE al.type = 'no_show' AND al.date = ?`)
    .all(today) as { created_at: string; first_name: string; last_name: string; site: string }[];
  for (const n of noShows) feed.push({ at: n.created_at, kind: 'noshow', text: `No-show: ${n.first_name} ${n.last_name}`, detail: n.site });
  const fires = db.prepare('SELECT r.started_at, r.kind, s.name AS site FROM roll_calls r JOIN sites s ON s.id = r.site_id WHERE r.started_at >= ?').all(londonToUtc(today, '00:00').toISOString()) as {
    started_at: string;
    kind: string;
    site: string;
  }[];
  for (const f of fires) feed.push({ at: f.started_at, kind: 'fire', text: f.kind === 'incident' ? 'Fire roll call (incident)' : 'Fire roll call started', detail: f.site });
  feed.sort((a, b) => (a.at < b.at ? 1 : -1));

  const workers = db.prepare('SELECT card_expiry FROM workers WHERE active = 1').all() as Pick<WorkerRow, 'card_expiry'>[];
  const invoices = db.prepare("SELECT status, due_on, gross_pence FROM invoices WHERE status != 'paid'").all() as { status: string; due_on: string; gross_pence: number }[];
  const a = agencyRow(db);
  res.json({
    now: nowIso(now),
    agency: { name: a.name, colour: a.brand_colour, hasLogo: !!a.logo_path },
    sites: board.sites.map((s) => ({
      id: s.id,
      name: s.name,
      town: s.name.includes(',') ? s.name.split(',').pop()!.trim() : s.name,
      client: s.clientName,
      lat: pos.get(s.id)?.lat,
      lng: pos.get(s.id)?.lng,
      onSite: s.onSite.length,
      expected: s.expected.length,
      noShows: s.expected.filter((e) => e.noShow).length,
    })),
    shifts: shifts.map((s) => ({
      inAt: s.in_at,
      outAt: s.out_at,
      breakMins: s.break_mins,
      breakDefault: s.break_default_mins,
      breakAfter: s.break_after_mins,
      charge: s.charge_rate,
      pay: s.pay_rate,
    })),
    feed: feed.slice(0, 30),
    stats: {
      compliance: workers.filter((w) => cardStatus(w.card_expiry, today) !== 'ok').length,
      awaitingApproval: (db.prepare("SELECT COUNT(*) AS n FROM timesheets WHERE status IN ('sent','queried')").get() as { n: number }).n,
      overduePence: invoices.filter((i) => invoiceStatus(i, today) === 'overdue').reduce((s, i) => s + i.gross_pence, 0),
      thisWeek: mondayOf(today),
    },
  });
});
