// Weekly timesheets per site, built from sign-ins (or, on timesheet-only sites, from the bookings).
// While a week is open the figures are worked out live; on approval they are snapshotted into
// timesheet_lines and locked.
import type { DB } from '../db';
import { nowIso, parseFlags } from '../db';
import { clock } from '../config';
import { addDays, londonDate, londonTime, londonToUtc, mondayOf, weekDates } from '../../shared/time';
import { splitWeek, type Shift } from '../lib/hours';
import { workerTotals, type WorkerTotals } from '../lib/money';
import { rulesFor, fullName, type AttendanceRow, type ClientRow, type SiteRow, type WorkerRow } from './rules';

export interface TimesheetRow {
  id: number;
  site_id: number;
  week_start: string;
  status: 'open' | 'sent' | 'queried' | 'approved';
  signoff_sent_at: string | null;
  approved_by_manager_id: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  approved_device: string | null;
  invoice_id: number | null;
}

export interface ShiftView {
  id: number;
  date: string;
  inAt: string;
  outAt: string | null;
  estimatedOut: boolean;
  breakMins: number;
  breakStated: number | null;
  workedMins: number;
  normalMins: number;
  otMins: number;
  flags: string[];
  status: string;
  method: string;
  queryComment: string | null;
  hasSelfie: boolean;
}

export interface WorkerWeek {
  workerId: number;
  name: string;
  trade: string;
  shifts: ShiftView[];
  totals: WorkerTotals;
}

export interface WeekTotals {
  workers: number;
  normalMins: number;
  otMins: number;
  totalMins: number;
  payPence: number;
  chargePence: number;
}

export interface TimesheetView {
  timesheet: TimesheetRow;
  site: { id: number; name: string; clientId: number; clientName: string };
  weekStart: string;
  days: string[];
  locked: boolean;
  workers: WorkerWeek[];
  totals: WeekTotals;
  needsChecking: number;
  queried: number;
  openShifts: number;
}

export function ensureTimesheet(db: DB, siteId: number, weekStart: string): TimesheetRow {
  db.prepare('INSERT OR IGNORE INTO timesheets (site_id, week_start) VALUES (?, ?)').run(siteId, weekStart);
  return db.prepare('SELECT * FROM timesheets WHERE site_id = ? AND week_start = ?').get(siteId, weekStart) as TimesheetRow;
}

export function isWeekLocked(db: DB, siteId: number, workDate: string): boolean {
  const row = db.prepare("SELECT status FROM timesheets WHERE site_id = ? AND week_start = ?").get(siteId, mondayOf(workDate)) as { status: string } | undefined;
  return row?.status === 'approved';
}

function sumTotals(list: WorkerTotals[]): WeekTotals {
  return {
    workers: list.filter((t) => t.totalMins > 0).length,
    normalMins: list.reduce((s, t) => s + t.normalMins, 0),
    otMins: list.reduce((s, t) => s + t.otMins, 0),
    totalMins: list.reduce((s, t) => s + t.totalMins, 0),
    payPence: list.reduce((s, t) => s + t.payPence, 0),
    chargePence: list.reduce((s, t) => s + t.chargePence, 0),
  };
}

/** Work out a site's week from its sign-ins (ignores any snapshot). */
export function computeWeek(db: DB, siteId: number, weekStart: string): { workers: WorkerWeek[]; totals: WeekTotals; site: SiteRow; client: ClientRow } {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) as SiteRow;
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(site.client_id) as ClientRow;
  const rules = rulesFor(client);
  const rows = db
    .prepare('SELECT * FROM attendance WHERE site_id = ? AND work_date >= ? AND work_date <= ? ORDER BY in_at')
    .all(siteId, weekStart, addDays(weekStart, 6)) as AttendanceRow[];
  const byWorker = new Map<number, AttendanceRow[]>();
  for (const r of rows) {
    if (!byWorker.has(r.worker_id)) byWorker.set(r.worker_id, []);
    byWorker.get(r.worker_id)!.push(r);
  }
  const workers: WorkerWeek[] = [];
  for (const [workerId, list] of byWorker) {
    const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId) as WorkerRow;
    // A shift still in progress counts to the site's usual finish time, marked as estimated.
    const shifts: Shift[] = list.map((r) => ({
      id: r.id,
      workerId,
      date: r.work_date,
      inAt: r.in_at,
      outAt: r.out_at ?? estimatedOut(r, site),
      breakMins: r.break_mins,
    }));
    const split = splitWeek(shifts, rules);
    const byId = new Map(list.map((r) => [r.id, r]));
    const views: ShiftView[] = split.map((s) => {
      const r = byId.get(s.id)!;
      return {
        id: s.id,
        date: s.date,
        inAt: s.inAt,
        outAt: s.outAt,
        estimatedOut: !r.out_at,
        breakMins: s.breakMins,
        breakStated: r.break_mins,
        workedMins: s.workedMins,
        normalMins: s.normalMins,
        otMins: s.otMins,
        flags: parseFlags(r.flags),
        status: r.status,
        method: r.method,
        queryComment: r.query_comment,
        hasSelfie: !!r.selfie_path,
      };
    });
    workers.push({
      workerId,
      name: fullName(w),
      trade: w.trade,
      shifts: views,
      totals: workerTotals(workerId, split, { payRate: w.pay_rate, chargeRate: w.charge_rate }, rules.otMultiplier),
    });
  }
  workers.sort((a, b) => a.name.localeCompare(b.name));
  return { workers, totals: sumTotals(workers.map((w) => w.totals)), site, client };
}

function estimatedOut(r: AttendanceRow, site: SiteRow): string {
  const finish = londonToUtc(r.work_date, site.finish_time);
  const inAt = new Date(r.in_at);
  // If they arrived after the usual finish, assume a short shift rather than a negative one.
  return (finish > inAt ? finish : inAt).toISOString();
}

interface LineRow {
  worker_id: number;
  worker_name: string;
  trade: string;
  normal_mins: number;
  ot_mins: number;
  pay_rate: number;
  ot_pay_rate: number;
  charge_rate: number;
  ot_charge_rate: number;
  pay_pence: number;
  charge_pence: number;
  days: string;
}

/**
 * Timesheet-only sites have no sign-in on site. Once a booked day has started, it counts from the
 * site's start time to its usual finish, with the client's normal break. Days nobody has touched
 * follow the bookings (cancelled or no-show days come off again); anything the agency has edited,
 * or the client has queried, is left alone. Safe to run as often as you like.
 */
export function syncBookedHours(db: DB, siteId: number, weekStart: string): number {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) as SiteRow | undefined;
  if (!site || site.signin_mode !== 'timesheet') return 0;
  const ts = db.prepare('SELECT status FROM timesheets WHERE site_id = ? AND week_start = ?').get(siteId, weekStart) as { status: string } | undefined;
  if (ts?.status === 'approved') return 0;
  const now = clock.now();
  const today = londonDate(now);
  const started = (date: string) => date < today || (date === today && londonTime(now) >= site.start_time);
  const weekEnd = addDays(weekStart, 6);
  let changed = 0;
  db.transaction(() => {
    const bookings = db
      .prepare("SELECT worker_id, date FROM bookings WHERE site_id = ? AND status = 'booked' AND date BETWEEN ? AND ?")
      .all(siteId, weekStart, weekEnd) as { worker_id: number; date: string }[];
    const insert = db.prepare(
      "INSERT INTO attendance (worker_id, site_id, work_date, in_at, out_at, method, out_method, flags, status, created_at) VALUES (?,?,?,?,?,'booking','booking',?,'ok',?)",
    );
    for (const b of bookings) {
      if (!started(b.date)) continue;
      // Already has hours that day (here or anywhere else): leave it.
      if (db.prepare('SELECT 1 FROM attendance WHERE worker_id = ? AND work_date = ?').get(b.worker_id, b.date)) continue;
      const inAt = londonToUtc(b.date, site.start_time);
      let outAt = londonToUtc(b.date, site.finish_time);
      if (outAt <= inAt) outAt = new Date(outAt.getTime() + 86400000); // a night shift past midnight
      insert.run(b.worker_id, siteId, b.date, inAt.toISOString(), outAt.toISOString(), JSON.stringify(['booked_hours']), nowIso(now));
      changed++;
    }
    const removed = db
      .prepare(
        `DELETE FROM attendance WHERE site_id = ? AND method = 'booking' AND work_date BETWEEN ? AND ?
           AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.worker_id = attendance.worker_id AND b.date = attendance.work_date
                             AND b.site_id = attendance.site_id AND b.status = 'booked')
           AND NOT EXISTS (SELECT 1 FROM attendance_edits e WHERE e.attendance_id = attendance.id)`,
      )
      .run(siteId, weekStart, weekEnd);
    changed += removed.changes;
  })();
  return changed;
}

/** Keep every timesheet-only site's hours up to date for this week and last (run by the background jobs). */
export function syncAllBookedHours(db: DB): number {
  const thisWeek = mondayOf(londonDate(clock.now()));
  const sites = db.prepare("SELECT id FROM sites WHERE active = 1 AND signin_mode = 'timesheet'").all() as { id: number }[];
  let n = 0;
  for (const s of sites) for (const week of [addDays(thisWeek, -7), thisWeek]) n += syncBookedHours(db, s.id, week);
  return n;
}

/** The timesheet as shown everywhere (dashboard, client approval page, PDF). */
export function getTimesheetView(db: DB, siteId: number, weekStart: string): TimesheetView {
  const ts = ensureTimesheet(db, siteId, weekStart);
  if (ts.status !== 'approved') syncBookedHours(db, siteId, weekStart);
  const siteInfo = db
    .prepare('SELECT s.id, s.name, s.client_id AS clientId, c.name AS clientName FROM sites s JOIN clients c ON c.id = s.client_id WHERE s.id = ?')
    .get(siteId) as TimesheetView['site'];
  let workers: WorkerWeek[];
  let totals: WeekTotals;
  if (ts.status === 'approved') {
    const lines = db.prepare('SELECT * FROM timesheet_lines WHERE timesheet_id = ? ORDER BY worker_name').all(ts.id) as LineRow[];
    workers = lines.map((l) => ({
      workerId: l.worker_id,
      name: l.worker_name,
      trade: l.trade,
      shifts: JSON.parse(l.days) as ShiftView[],
      totals: {
        workerId: l.worker_id,
        normalMins: l.normal_mins,
        otMins: l.ot_mins,
        totalMins: l.normal_mins + l.ot_mins,
        payRate: l.pay_rate,
        otPayRate: l.ot_pay_rate,
        chargeRate: l.charge_rate,
        otChargeRate: l.ot_charge_rate,
        payPence: l.pay_pence,
        chargePence: l.charge_pence,
      },
    }));
    totals = sumTotals(workers.map((w) => w.totals));
  } else {
    ({ workers, totals } = computeWeek(db, siteId, weekStart));
  }
  const all = workers.flatMap((w) => w.shifts);
  return {
    timesheet: ts,
    site: siteInfo,
    weekStart,
    days: weekDates(weekStart),
    locked: ts.status === 'approved',
    workers,
    totals,
    needsChecking: all.filter((s) => s.status === 'needs_checking').length,
    queried: all.filter((s) => s.status === 'queried').length,
    openShifts: all.filter((s) => s.estimatedOut).length,
  };
}

export class TimesheetError extends Error {}

/** Client approval: snapshot the figures and lock the week. */
export function approveTimesheet(db: DB, timesheetId: number, by: { managerId: number | null; name: string; device: string }): TimesheetView {
  const ts = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(timesheetId) as TimesheetRow | undefined;
  if (!ts) throw new TimesheetError('Timesheet not found');
  if (ts.status === 'approved') throw new TimesheetError('This timesheet has already been approved');
  const view = getTimesheetView(db, ts.site_id, ts.week_start);
  if (view.queried > 0) throw new TimesheetError('Some entries are queried. The agency needs to sort these out before the week can be approved.');
  if (view.totals.totalMins === 0) throw new TimesheetError('There are no hours to approve for this week');
  const insert = db.prepare(
    `INSERT INTO timesheet_lines (timesheet_id, worker_id, worker_name, trade, normal_mins, ot_mins, pay_rate, ot_pay_rate, charge_rate, ot_charge_rate, pay_pence, charge_pence, days)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM timesheet_lines WHERE timesheet_id = ?').run(ts.id);
    for (const w of view.workers) {
      const t = w.totals;
      insert.run(ts.id, w.workerId, w.name, w.trade, t.normalMins, t.otMins, t.payRate, t.otPayRate, t.chargeRate, t.otChargeRate, t.payPence, t.chargePence, JSON.stringify(w.shifts));
    }
    db.prepare(
      "UPDATE timesheets SET status = 'approved', approved_by_manager_id = ?, approved_by_name = ?, approved_at = ?, approved_device = ? WHERE id = ?",
    ).run(by.managerId, by.name, nowIso(clock.now()), by.device.slice(0, 300), ts.id);
  })();
  return getTimesheetView(db, ts.site_id, ts.week_start);
}

/** Headline for the sign-off message: "14 workers, 562.5 hours". */
export function weekHeadline(view: TimesheetView): { workers: number; hours: number } {
  return { workers: view.totals.workers, hours: Math.round((view.totals.totalMins / 60) * 100) / 100 };
}

export interface WorkerHoursWeek {
  weekStart: string;
  /** Finished shifts only: a shift still in progress isn't counted until they sign out. */
  totalMins: number;
  onSiteNow: boolean;
  shifts: { date: string; site: string; inAt: string; outAt: string | null; open: boolean; mins: number; fromBooking: boolean; queried: boolean }[];
  sites: { name: string; clientName: string; status: TimesheetRow['status']; approvedAt: string | null; mins: number }[];
}

/** A worker's own hours for this week and last, exactly as they appear on the sites' timesheets. */
export function workerHours(db: DB, workerId: number): { weeks: WorkerHoursWeek[] } {
  const thisWeek = mondayOf(londonDate(clock.now()));
  const weeks = [thisWeek, addDays(thisWeek, -7)].map((weekStart): WorkerHoursWeek => {
    const weekEnd = addDays(weekStart, 6);
    const siteIds = (
      db
        .prepare(
          `SELECT site_id FROM attendance WHERE worker_id = ? AND work_date BETWEEN ? AND ?
           UNION SELECT b.site_id FROM bookings b JOIN sites s ON s.id = b.site_id
             WHERE b.worker_id = ? AND b.date BETWEEN ? AND ? AND b.status = 'booked' AND s.signin_mode = 'timesheet'`,
        )
        .all(workerId, weekStart, weekEnd, workerId, weekStart, weekEnd) as { site_id: number }[]
    ).map((r) => r.site_id);
    const week: WorkerHoursWeek = { weekStart, totalMins: 0, onSiteNow: false, shifts: [], sites: [] };
    for (const siteId of siteIds) {
      const view = getTimesheetView(db, siteId, weekStart);
      const mine = view.workers.find((w) => w.workerId === workerId);
      if (!mine) continue;
      let mins = 0;
      for (const s of mine.shifts) {
        if (s.estimatedOut) week.onSiteNow = true;
        else mins += s.workedMins;
        week.shifts.push({ date: s.date, site: view.site.name, inAt: s.inAt, outAt: s.estimatedOut ? null : s.outAt, open: s.estimatedOut, mins: s.estimatedOut ? 0 : s.workedMins, fromBooking: s.method === 'booking', queried: s.status === 'queried' });
      }
      week.totalMins += mins;
      week.sites.push({ name: view.site.name, clientName: view.site.clientName, status: view.timesheet.status, approvedAt: view.timesheet.approved_at, mins });
    }
    week.shifts.sort((a, b) => a.inAt.localeCompare(b.inAt));
    return week;
  });
  return { weeks };
}
