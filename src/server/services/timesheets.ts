// Weekly timesheets per site, built from sign-ins. While a week is open the figures are worked
// out live; on approval they are snapshotted into timesheet_lines and locked.
import type { DB } from '../db';
import { nowIso, parseFlags } from '../db';
import { clock } from '../config';
import { addDays, londonToUtc, mondayOf, weekDates } from '../../shared/time';
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

/** The timesheet as shown everywhere (dashboard, client approval page, PDF). */
export function getTimesheetView(db: DB, siteId: number, weekStart: string): TimesheetView {
  const ts = ensureTimesheet(db, siteId, weekStart);
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
