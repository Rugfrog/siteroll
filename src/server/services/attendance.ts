// Signing in and out, with the checks at the gate: location, card, induction, booking and selfie.
import type { DB } from '../db';
import { nowIso, parseFlags } from '../db';
import { clock, config } from '../config';
import { checkGeofence, isValidReading, type Reading } from '../lib/geo';
import { isLate } from '../lib/hours';
import { londonDate, londonToUtc } from '../../shared/time';
import { fmtDay, fmtMiles, fmtTime } from '../../shared/format';
import { cardStatus, fullName, type AttendanceRow, type ClientRow, type SiteRow, type WorkerRow } from './rules';
import { saveDataUrlImage } from './files';
import { notify } from './events';
import { send } from './messaging';
import { isWeekLocked } from './timesheets';

export type Flag = 'late' | 'not_booked' | 'card' | 'no_induction' | 'missed_signout' | 'manual' | 'offline' | 'edited' | 'disputed' | 'moved_site' | 'after_approval' | 'booked_hours';

export const FLAG_LABELS: Record<string, string> = {
  late: 'Late',
  not_booked: 'Not booked',
  card: 'Card issue',
  no_induction: 'No induction',
  missed_signout: 'Missed sign-out',
  manual: 'Manual sign-in',
  offline: 'Sent without signal',
  edited: 'Edited',
  disputed: 'Disputed',
  moved_site: 'Moved site',
  after_approval: 'After sign-off',
  booked_hours: 'From booking',
};

export interface SignInput {
  workerId: number;
  siteId: number;
  reading: Reading | null;
  selfie?: string | null;
  capturedAt?: string | null;
  breakMins?: number | null;
}

export type SignResult =
  | { status: 'signed_in'; attendanceId: number; at: string; warnings: string[] }
  | { status: 'signed_out'; attendanceId: number; at: string; workedText: string }
  | { status: 'already_in'; attendanceId: number; at: string }
  | { status: 'not_signed_in' }
  | { status: 'blocked'; reason: 'outside' | 'inaccurate' | 'no_location' | 'card_expired'; message: string; attemptId: number; distanceM: number | null }
  | { status: 'need_selfie' }
  | { status: 'error'; message: string };

function load(db: DB, workerId: number, siteId: number) {
  const worker = db.prepare('SELECT * FROM workers WHERE id = ? AND active = 1').get(workerId) as WorkerRow | undefined;
  const site = db.prepare('SELECT * FROM sites WHERE id = ? AND active = 1').get(siteId) as SiteRow | undefined;
  const client = site ? (db.prepare('SELECT * FROM clients WHERE id = ?').get(site.client_id) as ClientRow) : undefined;
  return { worker, site, client };
}

/** Accept a time captured on the phone while it had no signal, if it's recent and not in the future. */
export function resolveEventTime(capturedAt: string | null | undefined, now: Date): { at: Date; offline: boolean } {
  if (capturedAt) {
    const t = new Date(capturedAt);
    const age = now.getTime() - t.getTime();
    if (!Number.isNaN(t.getTime()) && age > 2 * 60000 && age < 12 * 3600000) return { at: t, offline: true };
  }
  return { at: now, offline: false };
}

function recordAttempt(db: DB, workerId: number, siteId: number, action: 'in' | 'out', at: Date, reading: Reading | null, distanceM: number | null, reason: string): number {
  const r = db
    .prepare('INSERT INTO sign_in_attempts (worker_id, site_id, action, at, lat, lng, accuracy, distance_m, reason) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(workerId, siteId, action, nowIso(at), reading?.lat ?? null, reading?.lng ?? null, reading?.accuracy ?? null, distanceM, reason);
  return Number(r.lastInsertRowid);
}

export function addAlert(
  db: DB,
  a: { type: string; message: string; siteId?: number | null; workerId?: number | null; bookingId?: number | null; attendanceId?: number | null; attemptId?: number | null; date?: string | null },
) {
  db.prepare('INSERT INTO alerts (type, site_id, worker_id, booking_id, attendance_id, attempt_id, date, message, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
    a.type,
    a.siteId ?? null,
    a.workerId ?? null,
    a.bookingId ?? null,
    a.attendanceId ?? null,
    a.attemptId ?? null,
    a.date ?? null,
    a.message,
    nowIso(clock.now()),
  );
  notify({ type: 'alert', siteId: a.siteId });
}

function locationBlock(db: DB, input: SignInput, site: SiteRow, action: 'in' | 'out', at: Date): SignResult | { ok: true; distanceM: number } {
  if (!input.reading || !isValidReading(input.reading)) {
    const attemptId = recordAttempt(db, input.workerId, site.id, action, at, null, null, 'no_location');
    return { status: 'blocked', reason: 'no_location', attemptId, distanceM: null, message: "We couldn't get your location. Turn on location for your browser and try again." };
  }
  const fence = checkGeofence(input.reading, { lat: site.lat, lng: site.lng, radiusM: site.radius_m });
  if (fence.ok) return { ok: true, distanceM: fence.distanceM };
  const attemptId = recordAttempt(db, input.workerId, site.id, action, at, input.reading, fence.distanceM, fence.reason);
  if (fence.reason === 'inaccurate') {
    return { status: 'blocked', reason: 'inaccurate', attemptId, distanceM: fence.distanceM, message: "Your phone's location isn't accurate enough right now. Step outside or away from buildings and try again." };
  }
  const away = Math.max(0, (fence.distanceM ?? 0) - site.radius_m);
  return {
    status: 'blocked',
    reason: 'outside',
    attemptId,
    distanceM: fence.distanceM,
    message: `You don't seem to be on site. You're about ${fmtMiles(away)} away.`,
  };
}

export function openShiftFor(db: DB, workerId: number): AttendanceRow | undefined {
  return db.prepare('SELECT * FROM attendance WHERE worker_id = ? AND out_at IS NULL ORDER BY in_at DESC LIMIT 1').get(workerId) as AttendanceRow | undefined;
}

export function signIn(db: DB, input: SignInput): SignResult {
  const { worker, site, client } = load(db, input.workerId, input.siteId);
  if (!worker || !site || !client) return { status: 'error', message: 'Site or worker not found' };
  if (site.signin_mode === 'timesheet') {
    return { status: 'error', message: "You don't need to sign in on this site. Your hours come from your booking, and the site checks them each week." };
  }
  const now = clock.now();
  const { at, offline } = resolveEventTime(input.capturedAt, now);
  const workDate = londonDate(at);

  const open = openShiftFor(db, worker.id);
  if (open && open.site_id === site.id && open.work_date === workDate) return { status: 'already_in', attendanceId: open.id, at: open.in_at };

  const loc = locationBlock(db, input, site, 'in', at);
  if ('status' in loc) return loc;

  const flags: Flag[] = [];
  const warnings: string[] = [];
  if (offline) flags.push('offline');

  // Card check
  const card = cardStatus(worker.card_expiry, workDate);
  if (card === 'expired' || card === 'missing') {
    const what = card === 'expired' ? `${worker.card_scheme} card expired` : `no ${worker.card_scheme} card on file`;
    if (client.compliance_mode === 'block') {
      const attemptId = recordAttempt(db, worker.id, site.id, 'in', at, input.reading, loc.distanceM, 'card_expired');
      addAlert(db, { type: 'compliance', siteId: site.id, workerId: worker.id, attemptId, date: workDate, message: `${fullName(worker)} was stopped signing in at ${site.name}: ${what}.` });
      return {
        status: 'blocked',
        reason: 'card_expired',
        attemptId,
        distanceM: loc.distanceM,
        message: card === 'expired' ? `Your ${worker.card_scheme} card has expired, so you can't sign in on this site. Please call the agency.` : `We don't have your ${worker.card_scheme} card on file, so you can't sign in on this site. Please call the agency.`,
      };
    }
    flags.push('card');
    warnings.push(card === 'expired' ? `Your ${worker.card_scheme} card has expired. Please renew it and send a photo to the agency.` : `We don't have your ${worker.card_scheme} card on file. Please send a photo to the agency.`);
    addAlert(db, { type: 'compliance', siteId: site.id, workerId: worker.id, date: workDate, message: `${fullName(worker)} signed in at ${site.name} with ${what}.` });
  }

  // Induction
  const inducted = db.prepare('SELECT 1 FROM inductions WHERE worker_id = ? AND site_id = ?').get(worker.id, site.id);
  if (!inducted) {
    flags.push('no_induction');
    warnings.push('You have not had a site induction here. Report to the site manager before starting work.');
  }

  // Selfie (after the cheap checks, so we don't ask for a photo and then block)
  let selfiePath: string | null = null;
  if (client.selfie_required) {
    if (!input.selfie) return { status: 'need_selfie' };
    try {
      selfiePath = saveDataUrlImage(input.selfie, 'selfies');
    } catch (e) {
      return { status: 'error', message: (e as Error).message };
    }
  }

  // Booking
  const booking = db.prepare("SELECT b.*, s.name AS site_name FROM bookings b JOIN sites s ON s.id = b.site_id WHERE b.worker_id = ? AND b.date = ? AND b.status = 'booked'").get(worker.id, workDate) as
    | { id: number; site_id: number; site_name: string }
    | undefined;
  if (!booking || booking.site_id !== site.id) {
    flags.push('not_booked');
    addAlert(db, {
      type: 'not_booked',
      siteId: site.id,
      workerId: worker.id,
      date: workDate,
      message: booking
        ? `${fullName(worker)} signed in at ${site.name} but is booked at ${booking.site_name} today.`
        : `${fullName(worker)} signed in at ${site.name} but isn't booked anywhere today.`,
    });
  }

  if (isLate(at.toISOString(), londonToUtc(workDate, site.start_time))) flags.push('late');

  // Never stop someone working because the paperwork is done: flag it so the agency can reopen the week.
  if (isWeekLocked(db, site.id, workDate)) {
    flags.push('after_approval');
    addAlert(db, {
      type: 'query',
      siteId: site.id,
      workerId: worker.id,
      date: workDate,
      message: `${fullName(worker)} signed in at ${site.name} after this week's timesheet was approved. Reopen the timesheet to add these hours.`,
    });
  }

  // If they're still signed in somewhere else, close that first.
  if (open) {
    const f = [...new Set([...parseFlags(open.flags), 'moved_site'])];
    db.prepare("UPDATE attendance SET out_at = ?, out_method = 'auto', flags = ?, status = 'needs_checking' WHERE id = ?").run(nowIso(at), JSON.stringify(f), open.id);
  }

  const r = db
    .prepare(
      `INSERT INTO attendance (worker_id, site_id, work_date, in_at, in_lat, in_lng, in_accuracy, in_distance_m, selfie_path, method, flags, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'gps',?,?,?)`,
    )
    .run(worker.id, site.id, workDate, nowIso(at), input.reading!.lat, input.reading!.lng, input.reading!.accuracy, loc.distanceM, selfiePath, JSON.stringify(flags), 'ok', nowIso(now));
  const attendanceId = Number(r.lastInsertRowid);

  // They've turned up, so close any no-show alert.
  db.prepare("UPDATE alerts SET resolved_at = ?, resolved_by = 'System', resolution = ? WHERE type = 'no_show' AND worker_id = ? AND date = ? AND resolved_at IS NULL").run(
    nowIso(now),
    `Arrived ${fmtTime(at)}`,
    worker.id,
    workDate,
  );

  notify({ type: 'attendance', siteId: site.id });
  return { status: 'signed_in', attendanceId, at: nowIso(at), warnings };
}

export function signOut(db: DB, input: SignInput): SignResult {
  const { worker, site } = load(db, input.workerId, input.siteId);
  if (!worker || !site) return { status: 'error', message: 'Site or worker not found' };
  const now = clock.now();
  const { at, offline } = resolveEventTime(input.capturedAt, now);
  const open = openShiftFor(db, worker.id);
  if (!open) return { status: 'not_signed_in' };
  const shiftSite = db.prepare('SELECT * FROM sites WHERE id = ?').get(open.site_id) as SiteRow;

  const loc = locationBlock(db, input, shiftSite, 'out', at);
  if ('status' in loc) return loc;

  const breakMins = input.breakMins === undefined ? null : input.breakMins;
  if (breakMins !== null && ![0, 15, 30, 45, 60].includes(breakMins)) return { status: 'error', message: 'Please choose a break length' };
  const flags = parseFlags(open.flags);
  if (offline && !flags.includes('offline')) flags.push('offline');
  db.prepare("UPDATE attendance SET out_at = ?, out_lat = ?, out_lng = ?, out_accuracy = ?, out_distance_m = ?, break_mins = ?, out_method = 'gps', flags = ? WHERE id = ?").run(
    nowIso(at),
    input.reading!.lat,
    input.reading!.lng,
    input.reading!.accuracy,
    loc.distanceM,
    breakMins,
    JSON.stringify(flags),
    open.id,
  );
  notify({ type: 'attendance', siteId: shiftSite.id });
  const mins = Math.max(0, Math.round((at.getTime() - new Date(open.in_at).getTime()) / 60000));
  return { status: 'signed_out', attendanceId: open.id, at: nowIso(at), workedText: `${Math.floor(mins / 60)}h ${mins % 60}m on site` };
}

/** Worker asks the site manager to sign them in or out by hand (GPS not working). */
export function requestManual(db: DB, workerId: number, attemptId: number): boolean {
  const att = db.prepare("SELECT * FROM sign_in_attempts WHERE id = ? AND worker_id = ? AND status = 'blocked' AND reason != 'card_expired'").get(attemptId, workerId) as
    | { id: number; site_id: number; action: string; at: string }
    | undefined;
  if (!att) return false;
  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as WorkerRow;
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(att.site_id) as SiteRow;
  db.prepare("UPDATE sign_in_attempts SET status = 'requested' WHERE id = ?").run(att.id);
  const verb = att.action === 'in' ? 'sign in' : 'sign out';
  addAlert(db, {
    type: 'manual_request',
    siteId: site.id,
    workerId,
    attemptId: att.id,
    date: londonDate(att.at),
    message: `${fullName(worker)} asked to ${verb} by hand at ${site.name} (${fmtTime(att.at)}). Their phone's location didn't match the site.`,
  });
  const managers = db
    .prepare('SELECT m.* FROM managers m JOIN manager_sites ms ON ms.manager_id = m.id WHERE ms.site_id = ? AND m.active = 1')
    .all(site.id) as { name: string; phone: string }[];
  for (const m of managers) {
    if (m.phone) send.sms({ to: m.phone, toName: m.name, kind: 'manual_request', body: `SiteRoll: ${fullName(worker)} is asking you to ${verb} them by hand at ${site.name}. Open SiteRoll to approve or reject.` });
  }
  return true;
}

/** Approve a manual sign-in/out request (site manager or agency). */
export function decideManual(db: DB, attemptId: number, approve: boolean, by: string): { ok: boolean; message?: string } {
  const att = db.prepare("SELECT * FROM sign_in_attempts WHERE id = ? AND status IN ('requested','blocked')").get(attemptId) as
    | { id: number; worker_id: number; site_id: number; action: string; at: string; lat: number | null; lng: number | null; accuracy: number | null; distance_m: number | null; reason: string }
    | undefined;
  if (!att) return { ok: false, message: 'Request not found or already dealt with' };
  if (att.reason === 'card_expired') return { ok: false, message: 'Card problems must be sorted by the agency' };
  const now = nowIso(clock.now());
  if (!approve) {
    db.prepare("UPDATE sign_in_attempts SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?").run(by, now, att.id);
    db.prepare("UPDATE alerts SET resolved_at = ?, resolved_by = ?, resolution = 'Rejected' WHERE attempt_id = ? AND resolved_at IS NULL").run(now, by, att.id);
    notify({ type: 'alert', siteId: att.site_id });
    return { ok: true };
  }
  const workDate = londonDate(att.at);
  if (isWeekLocked(db, att.site_id, workDate)) return { ok: false, message: 'That week has already been approved' };
  let attendanceId: number;
  if (att.action === 'in') {
    const open = openShiftFor(db, att.worker_id);
    if (open) return { ok: false, message: 'They are already signed in' };
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(att.site_id) as SiteRow;
    const flags: Flag[] = ['manual'];
    if (isLate(att.at, londonToUtc(workDate, site.start_time))) flags.push('late');
    const r = db
      .prepare(
        `INSERT INTO attendance (worker_id, site_id, work_date, in_at, in_lat, in_lng, in_accuracy, in_distance_m, method, flags, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,'manual',?,'needs_checking',?)`,
      )
      .run(att.worker_id, att.site_id, workDate, att.at, att.lat, att.lng, att.accuracy, att.distance_m, JSON.stringify(flags), now);
    attendanceId = Number(r.lastInsertRowid);
    db.prepare("UPDATE alerts SET resolved_at = ?, resolved_by = 'System', resolution = ? WHERE type = 'no_show' AND worker_id = ? AND date = ? AND resolved_at IS NULL").run(
      now,
      `Signed in by hand ${fmtTime(att.at)}`,
      att.worker_id,
      workDate,
    );
  } else {
    const open = openShiftFor(db, att.worker_id);
    if (!open) return { ok: false, message: 'They are not signed in' };
    const flags = [...new Set([...parseFlags(open.flags), 'manual'])];
    db.prepare("UPDATE attendance SET out_at = ?, out_method = 'manual', flags = ?, status = 'needs_checking' WHERE id = ?").run(att.at, JSON.stringify(flags), open.id);
    attendanceId = open.id;
  }
  db.prepare("UPDATE sign_in_attempts SET status = 'approved', decided_by = ?, decided_at = ?, attendance_id = ? WHERE id = ?").run(by, now, attendanceId, att.id);
  db.prepare("UPDATE alerts SET resolved_at = ?, resolved_by = ?, resolution = 'Approved' WHERE attempt_id = ? AND resolved_at IS NULL").run(now, by, att.id);
  notify({ type: 'attendance', siteId: att.site_id });
  return { ok: true };
}

/**
 * Anyone still signed in at 20:00 on the day they signed in is closed at the site's usual finish
 * time, flagged "Needs checking", and texted to confirm.
 */
export function closeMissedSignOuts(db: DB, opts: { includeToday?: boolean } = {}): number {
  const now = clock.now();
  const today = londonDate(now);
  const open = db.prepare('SELECT * FROM attendance WHERE out_at IS NULL').all() as AttendanceRow[];
  const agency = db.prepare('SELECT name, phone FROM agency WHERE id = 1').get() as { name: string; phone: string } | undefined;
  let n = 0;
  for (const a of open) {
    // In demo mode today's sign-ins are left alone so the live board stays busy all evening;
    // the Outbox screen has a button to run this check by hand.
    const pastDay = a.work_date < today;
    const tonight = a.work_date === today && (opts.includeToday || (!config.demoMode && now >= londonToUtc(a.work_date, '20:00')));
    if (!pastDay && !tonight) continue;
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(a.site_id) as SiteRow;
    const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(a.worker_id) as WorkerRow;
    const finish = londonToUtc(a.work_date, site.finish_time);
    const out = finish > new Date(a.in_at) ? finish : new Date(a.in_at);
    const flags = [...new Set([...parseFlags(a.flags), 'missed_signout'])];
    db.prepare("UPDATE attendance SET out_at = ?, out_method = 'auto', flags = ?, status = 'needs_checking' WHERE id = ?").run(nowIso(out), JSON.stringify(flags), a.id);
    addAlert(db, {
      type: 'missed_signout',
      siteId: site.id,
      workerId: worker.id,
      attendanceId: a.id,
      date: a.work_date,
      message: `${fullName(worker)} didn't sign out at ${site.name}. Put down as finishing at ${site.finish_time}. Needs checking.`,
    });
    send.sms({
      to: worker.phone,
      toName: fullName(worker),
      kind: 'missed_signout',
      body: `Hi ${worker.first_name}, you didn't sign out at ${site.name} on ${fmtDay(a.work_date)}. We've put you down as finishing at ${site.finish_time}. If that's wrong, call ${agency?.name ?? 'the agency'} on ${agency?.phone || 'the office number'}.`,
    });
    n++;
  }
  if (n) notify({ type: 'attendance' });
  return n;
}
