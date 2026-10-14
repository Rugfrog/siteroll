// The live "on site now" picture and the compliance list. Used by the dashboard routes and by
// Ask SiteRoll, so both always give the same answer.
import type { DB } from '../db';
import { nowIso, parseFlags } from '../db';
import { clock } from '../config';
import { addDays, londonDate } from '../../shared/time';
import { cardStatus, fullName, type WorkerRow } from './rules';

/** siteIds = null means every site (agency); otherwise only these sites (a client manager). */
export function liveBoard(db: DB, siteIds: number[] | null) {
  const today = londonDate(clock.now());
  const rows = db
    .prepare('SELECT s.*, c.name AS client_name FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.active = 1 ORDER BY c.name, s.name')
    .all() as { id: number; name: string; client_name: string; client_id: number; start_time: string; finish_time: string; address: string; postcode: string }[];
  const sites = rows
    .filter((s) => siteIds === null || siteIds.includes(s.id))
    .map((s) => {
      const onSite = db
        .prepare(
          `SELECT a.id AS attendanceId, a.worker_id AS workerId, a.in_at AS inAt, a.flags, a.method, a.selfie_path, w.first_name, w.last_name, w.trade, w.card_expiry
           FROM attendance a JOIN workers w ON w.id = a.worker_id
           WHERE a.site_id = ? AND a.out_at IS NULL ORDER BY a.in_at`,
        )
        .all(s.id) as { attendanceId: number; workerId: number; inAt: string; flags: string; method: string; selfie_path: string | null; first_name: string; last_name: string; trade: string; card_expiry: string | null }[];
      const signedOut = (db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE site_id = ? AND work_date = ? AND out_at IS NOT NULL').get(s.id, today) as { n: number }).n;
      const expected = db
        .prepare(
          `SELECT b.id AS bookingId, b.worker_id AS workerId, w.first_name, w.last_name, w.trade,
             (SELECT 1 FROM alerts al WHERE al.booking_id = b.id AND al.type = 'no_show' AND al.resolved_at IS NULL) AS noShow
           FROM bookings b JOIN workers w ON w.id = b.worker_id
           WHERE b.site_id = ? AND b.date = ? AND b.status = 'booked'
             AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.worker_id = b.worker_id AND a.work_date = b.date)
           ORDER BY w.last_name`,
        )
        .all(s.id, today) as { bookingId: number; workerId: number; first_name: string; last_name: string; trade: string; noShow: number | null }[];
      const pending = db
        .prepare(
          `SELECT t.id, t.action, t.at, t.distance_m AS distanceM, t.accuracy, w.first_name, w.last_name, w.trade
           FROM sign_in_attempts t JOIN workers w ON w.id = t.worker_id WHERE t.site_id = ? AND t.status = 'requested' ORDER BY t.at`,
        )
        .all(s.id);
      return {
        id: s.id,
        name: s.name,
        clientName: s.client_name,
        address: `${s.address}, ${s.postcode}`,
        startTime: s.start_time,
        finishTime: s.finish_time,
        onSite: onSite.map((p) => ({
          attendanceId: p.attendanceId,
          workerId: p.workerId,
          name: `${p.first_name} ${p.last_name}`,
          trade: p.trade,
          inAt: p.inAt,
          flags: parseFlags(p.flags),
          method: p.method,
          hasSelfie: !!p.selfie_path,
          card: cardStatus(p.card_expiry, today),
        })),
        expected: expected.map((e) => ({ bookingId: e.bookingId, workerId: e.workerId, name: `${e.first_name} ${e.last_name}`, trade: e.trade, noShow: !!e.noShow })),
        signedOutToday: signedOut,
        pendingManual: pending,
      };
    });
  return { now: nowIso(clock.now()), today, sites };
}

export interface ComplianceItem {
  workerId: number;
  name: string;
  trade: string;
  what: string;
  expiry: string | null;
  status: 'expired' | 'expiring' | 'missing';
}

/** Cards, tickets, right to work and emergency contacts that need sorting (expired, missing, or expiring in 30 days). */
export function complianceItems(db: DB) {
  const today = londonDate(clock.now());
  const in30 = addDays(today, 30);
  const items: ComplianceItem[] = [];
  const workers = db.prepare('SELECT * FROM workers WHERE active = 1 ORDER BY last_name').all() as WorkerRow[];
  for (const w of workers) {
    const cs = cardStatus(w.card_expiry, today);
    if (cs !== 'ok') items.push({ workerId: w.id, name: fullName(w), trade: w.trade, what: `${w.card_scheme} card`, expiry: w.card_expiry, status: cs });
    if (!w.rtw_checked_on) items.push({ workerId: w.id, name: fullName(w), trade: w.trade, what: 'Right to work check', expiry: null, status: 'missing' });
    if (!w.emergency_phone) items.push({ workerId: w.id, name: fullName(w), trade: w.trade, what: 'Emergency contact', expiry: null, status: 'missing' });
    const tickets = db.prepare('SELECT * FROM worker_tickets WHERE worker_id = ? AND expiry IS NOT NULL AND expiry <= ?').all(w.id, in30) as { name: string; expiry: string }[];
    for (const t of tickets) items.push({ workerId: w.id, name: fullName(w), trade: w.trade, what: t.name, expiry: t.expiry, status: t.expiry < today ? 'expired' : 'expiring' });
  }
  const order = { expired: 0, missing: 1, expiring: 2 };
  items.sort((a, b) => order[a.status] - order[b.status] || (a.expiry ?? '').localeCompare(b.expiry ?? ''));
  const blocked = db
    .prepare(
      `SELECT t.id, t.at, w.first_name, w.last_name, s.name AS site_name FROM sign_in_attempts t JOIN workers w ON w.id = t.worker_id JOIN sites s ON s.id = t.site_id
       WHERE t.reason = 'card_expired' ORDER BY t.at DESC LIMIT 20`,
    )
    .all() as { id: number; at: string; first_name: string; last_name: string; site_name: string }[];
  const clients = db.prepare('SELECT id, name, compliance_mode FROM clients ORDER BY name').all() as { id: number; name: string; compliance_mode: string }[];
  return { today, items, blocked, clients };
}
