// Timesheets (agency + client managers), edits with history, approval, invoices, payroll and margins.
import { Router, type Request } from 'express';
import { getDb, nowIso, parseFlags } from '../db';
import { clock } from '../config';
import { asyncRoute, v, ValidationError } from '../lib/validate';
import { toCsv } from '../lib/payroll';
import { addDays, londonDate, londonTime, londonToUtc, mondayOf } from '../../shared/time';
import { fmtDay, fmtTime } from '../../shared/format';
import { actorName, canSeeSite, requireAgency, requireStaff } from '../auth';
import { addAlert } from '../services/attendance';
import { notify } from '../services/events';
import { send } from '../services/messaging';
import { cardStatus, fullName, type AttendanceRow, type SiteRow, type WorkerRow } from '../services/rules';
import { approveTimesheet, getTimesheetView, isWeekLocked, TimesheetError, type TimesheetRow } from '../services/timesheets';
import { agencyRow, createInvoice, invoiceStatus, marginRows, payrollRows, sendSignoffRequest } from '../services/workflows';
import { invoicePdf, timesheetPdf } from '../pdf/documents';

export const moneyRouter = Router();
moneyRouter.use(requireStaff);

const weekParam = (x: unknown) => mondayOf(v.date(x ?? londonDate(clock.now()), 'week'));

/* ---------------- Timesheets ---------------- */

moneyRouter.get('/timesheets', (req, res) => {
  const db = getDb();
  const week = weekParam(req.query.week);
  const sites = (db.prepare('SELECT s.*, c.name AS client_name FROM sites s JOIN clients c ON c.id = s.client_id ORDER BY c.name, s.name').all() as (SiteRow & { client_name: string })[]).filter((s) =>
    canSeeSite(req.user, s.id),
  );
  const list = sites
    .map((s) => {
      const hasHours = db.prepare('SELECT 1 FROM attendance WHERE site_id = ? AND work_date BETWEEN ? AND ? LIMIT 1').get(s.id, week, addDays(week, 6));
      if (!hasHours && !s.active) return null;
      const view = getTimesheetView(db, s.id, week);
      return {
        id: view.timesheet.id,
        siteId: s.id,
        siteName: s.name,
        clientId: s.client_id,
        clientName: s.client_name,
        status: view.timesheet.status,
        signoffSentAt: view.timesheet.signoff_sent_at,
        approvedBy: view.timesheet.approved_by_name,
        approvedAt: view.timesheet.approved_at,
        invoiceId: view.timesheet.invoice_id,
        totals: view.totals,
        needsChecking: view.needsChecking,
        queried: view.queried,
        openShifts: view.openShifts,
      };
    })
    .filter(Boolean);
  res.json({ week, timesheets: list });
});

/** Timesheets sent to the client and not yet approved, any week (newest first). */
moneyRouter.get('/timesheets-pending', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.*, s.name AS site_name, c.name AS client_name FROM timesheets t JOIN sites s ON s.id = t.site_id JOIN clients c ON c.id = s.client_id
       WHERE t.status IN ('sent','queried') ORDER BY t.week_start DESC`,
    )
    .all() as (TimesheetRow & { site_name: string; client_name: string })[];
  res.json(
    rows
      .filter((t) => canSeeSite(req.user, t.site_id))
      .map((t) => {
        const v = getTimesheetView(db, t.site_id, t.week_start);
        return { id: t.id, siteName: t.site_name, clientName: t.client_name, weekStart: t.week_start, status: t.status, sentAt: t.signoff_sent_at, workers: v.totals.workers, mins: v.totals.totalMins, queried: v.queried };
      }),
  );
});

function loadTimesheet(req: Request, id: number) {
  const ts = getDb().prepare('SELECT * FROM timesheets WHERE id = ?').get(id) as TimesheetRow | undefined;
  if (!ts || !canSeeSite(req.user, ts.site_id)) return null;
  return ts;
}

moneyRouter.get('/timesheets/:id', (req, res) => {
  const ts = loadTimesheet(req, v.id(req.params.id));
  if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
  const view = getTimesheetView(getDb(), ts.site_id, ts.week_start);
  // Client managers don't see pay rates or margins.
  if (req.user!.type === 'manager') {
    for (const w of view.workers) Object.assign(w.totals, { payRate: 0, otPayRate: 0, payPence: 0 });
    view.totals.payPence = 0;
  }
  res.json(view);
});

moneyRouter.get('/timesheets/:id/pdf', asyncRoute(async (req, res) => {
  const ts = loadTimesheet(req, v.id(req.params.id));
  if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
  const pdf = await timesheetPdf(getDb(), ts.site_id, ts.week_start, { showRates: req.user!.type === 'agency' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="timesheet-${ts.site_id}-${ts.week_start}.pdf"` });
  res.send(pdf);
}));

moneyRouter.post('/timesheets/:id/send', requireAgency, (req, res) => {
  const ts = loadTimesheet(req, v.id(req.params.id));
  if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
  const r = sendSignoffRequest(getDb(), ts.id);
  res.json({ ok: true, ...r });
});

moneyRouter.post('/timesheets/:id/approve', (req, res) => {
  const ts = loadTimesheet(req, v.id(req.params.id));
  if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
  if (req.user!.type !== 'manager') return res.status(403).json({ error: 'Only the client can approve a timesheet' });
  const device = `${String(req.get('user-agent') || 'Unknown device').slice(0, 200)} · ${req.ip}`;
  const view = approveTimesheet(getDb(), ts.id, { managerId: req.user!.id, name: actorName(req.user!), device });
  notify({ type: 'timesheet', siteId: ts.site_id });
  res.json({ ok: true, approvedAt: view.timesheet.approved_at });
});

/** Agency reopens an approved (not yet invoiced) week, e.g. for hours worked after sign-off. The client approves again. */
moneyRouter.post('/timesheets/:id/reopen', requireAgency, (req, res) => {
  const db = getDb();
  const ts = loadTimesheet(req, v.id(req.params.id));
  if (!ts) return res.status(404).json({ error: 'Timesheet not found' });
  if (ts.status !== 'approved') return res.status(400).json({ error: 'Only an approved timesheet can be reopened' });
  if (ts.invoice_id) return res.status(400).json({ error: 'This week has been invoiced. Raise a credit note or a new invoice instead.' });
  const reason = v.str(req.body?.reason, 'Reason', 300);
  db.transaction(() => {
    db.prepare('DELETE FROM timesheet_lines WHERE timesheet_id = ?').run(ts.id);
    db.prepare(
      "UPDATE timesheets SET status = 'open', signoff_sent_at = NULL, approved_by_manager_id = NULL, approved_by_name = NULL, approved_at = NULL, approved_device = NULL WHERE id = ?",
    ).run(ts.id);
    db.prepare("UPDATE alerts SET resolved_at = ?, resolved_by = ?, resolution = 'Timesheet reopened' WHERE site_id = ? AND type = 'query' AND resolved_at IS NULL AND date BETWEEN ? AND ?").run(
      nowIso(clock.now()),
      actorName(req.user!),
      ts.site_id,
      ts.week_start,
      addDays(ts.week_start, 6),
    );
  })();
  const site = db.prepare('SELECT name FROM sites WHERE id = ?').get(ts.site_id) as { name: string };
  const managers = db.prepare('SELECT m.* FROM managers m JOIN manager_sites ms ON ms.manager_id = m.id WHERE ms.site_id = ? AND m.active = 1').all(ts.site_id) as { name: string; email: string }[];
  for (const m of managers) {
    if (m.email)
      send.email({
        to: m.email,
        toName: m.name,
        kind: 'signoff',
        subject: `Timesheet reopened: ${site.name}, w/c ${fmtDay(ts.week_start)}`,
        body: `We've reopened the timesheet you approved for ${site.name} (week commencing ${fmtDay(ts.week_start)}).\n\nReason: ${reason}\n\nWe'll send it back to you to approve again shortly.`,
      });
  }
  notify({ type: 'timesheet', siteId: ts.site_id });
  res.json({ ok: true });
});

/* ---------------- Individual shifts ---------------- */

function loadShift(req: Request, id: number) {
  const a = getDb().prepare('SELECT * FROM attendance WHERE id = ?').get(id) as AttendanceRow | undefined;
  if (!a || !canSeeSite(req.user, a.site_id)) return null;
  return a;
}

/** Client manager queries an entry. It goes back to the agency. */
moneyRouter.post('/attendance/:id/query', (req, res) => {
  const db = getDb();
  const a = loadShift(req, v.id(req.params.id));
  if (!a) return res.status(404).json({ error: 'Entry not found' });
  if (isWeekLocked(db, a.site_id, a.work_date)) return res.status(400).json({ error: 'This week has been approved and is locked' });
  const comment = v.str(req.body?.comment, 'Comment', 500);
  const by = actorName(req.user!);
  const flags = [...new Set([...parseFlags(a.flags), 'disputed'])];
  db.prepare("UPDATE attendance SET status = 'queried', query_comment = ?, flags = ? WHERE id = ?").run(comment, JSON.stringify(flags), a.id);
  db.prepare('INSERT INTO attendance_edits (attendance_id, edited_by, edited_at, changes, reason) VALUES (?,?,?,?,?)').run(
    a.id,
    by,
    nowIso(clock.now()),
    JSON.stringify([{ field: 'Query', from: null, to: comment }]),
    'Queried by client',
  );
  db.prepare("UPDATE timesheets SET status = 'queried' WHERE site_id = ? AND week_start = ? AND status != 'approved'").run(a.site_id, mondayOf(a.work_date));
  const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(a.worker_id) as WorkerRow;
  const site = db.prepare('SELECT name FROM sites WHERE id = ?').get(a.site_id) as { name: string };
  addAlert(db, { type: 'query', siteId: a.site_id, workerId: a.worker_id, attendanceId: a.id, date: a.work_date, message: `${by} queried ${fullName(w)} on ${fmtDay(a.work_date)} at ${site.name}: "${comment}"` });
  const agency = agencyRow(db);
  if (agency.email) send.email({ to: agency.email, toName: agency.name, kind: 'query', subject: `Timesheet query: ${site.name}`, body: `${by} has queried ${fullName(w)} on ${fmtDay(a.work_date)}:\n\n"${comment}"\n\nOpen SiteRoll to sort it out and send the timesheet back.` });
  notify({ type: 'timesheet', siteId: a.site_id });
  res.json({ ok: true });
});

moneyRouter.get('/attendance/:id', (req, res) => {
  const db = getDb();
  const a = loadShift(req, v.id(req.params.id));
  if (!a) return res.status(404).json({ error: 'Entry not found' });
  const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(a.worker_id) as WorkerRow;
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(a.site_id) as SiteRow;
  const edits = (db.prepare('SELECT * FROM attendance_edits WHERE attendance_id = ? ORDER BY edited_at').all(a.id) as { changes: string }[]).map((e) => ({ ...e, changes: JSON.parse(e.changes) }));
  const isAgency = req.user!.type === 'agency';
  res.json({
    id: a.id,
    workerName: fullName(w),
    trade: w.trade,
    siteName: site.name,
    date: a.work_date,
    inAt: a.in_at,
    outAt: a.out_at,
    breakMins: a.break_mins,
    method: a.method,
    outMethod: a.out_method,
    flags: parseFlags(a.flags),
    status: a.status,
    queryComment: a.query_comment,
    hasSelfie: !!a.selfie_path,
    inDistanceM: isAgency ? a.in_distance_m : null,
    inAccuracy: isAgency ? a.in_accuracy : null,
    outDistanceM: isAgency ? a.out_distance_m : null,
    locked: isWeekLocked(db, a.site_id, a.work_date),
    edits,
  });
});

/** Agency fixes an entry. A reason is required and every change is kept. */
moneyRouter.put('/attendance/:id', requireAgency, (req, res) => {
  const db = getDb();
  const a = loadShift(req, v.id(req.params.id));
  if (!a) return res.status(404).json({ error: 'Entry not found' });
  if (isWeekLocked(db, a.site_id, a.work_date)) return res.status(400).json({ error: 'This week has been approved and is locked' });
  const reason = v.str(req.body?.reason, 'Reason for the change', 500);
  const inTime = v.time(req.body?.inTime, 'Signed in');
  const outTime = req.body?.outTime ? v.time(req.body.outTime, 'Signed out') : null;
  const breakMins = v.intOrNull(req.body?.breakMins, 'Break', 0, 240);
  const resolve = v.bool(req.body?.markChecked);
  const newIn = londonToUtc(a.work_date, inTime).toISOString();
  let newOut: string | null = outTime ? londonToUtc(a.work_date, outTime).toISOString() : null;
  if (newOut && newOut <= newIn) newOut = new Date(new Date(newOut).getTime() + 86400000).toISOString(); // night shift past midnight
  const changes: { field: string; from: string | null; to: string | null }[] = [];
  if (londonTime(a.in_at) !== inTime) changes.push({ field: 'Signed in', from: fmtTime(a.in_at), to: inTime });
  if ((a.out_at ? fmtTime(a.out_at) : null) !== outTime) changes.push({ field: 'Signed out', from: a.out_at ? fmtTime(a.out_at) : null, to: outTime });
  if (a.break_mins !== breakMins) changes.push({ field: 'Break', from: a.break_mins == null ? 'Default' : `${a.break_mins} mins`, to: breakMins == null ? 'Default' : `${breakMins} mins` });
  const newStatus = resolve ? 'ok' : a.status;
  if (newStatus !== a.status) changes.push({ field: 'Status', from: a.status === 'queried' ? 'Queried' : 'Needs checking', to: 'Checked' });
  if (!changes.length) throw new ValidationError('Nothing has changed');
  const flags = parseFlags(a.flags);
  if (changes.some((c) => c.field !== 'Status') && !flags.includes('edited')) flags.push('edited');
  db.transaction(() => {
    db.prepare('UPDATE attendance SET in_at = ?, out_at = ?, break_mins = ?, status = ?, flags = ?, out_method = COALESCE(out_method, ?) WHERE id = ?').run(
      newIn,
      newOut,
      breakMins,
      newStatus,
      JSON.stringify(flags),
      newOut ? 'agency' : null,
      a.id,
    );
    db.prepare('INSERT INTO attendance_edits (attendance_id, edited_by, edited_at, changes, reason) VALUES (?,?,?,?,?)').run(a.id, actorName(req.user!), nowIso(clock.now()), JSON.stringify(changes), reason);
    if (resolve) {
      db.prepare("UPDATE alerts SET resolved_at = ?, resolved_by = ?, resolution = 'Checked' WHERE attendance_id = ? AND resolved_at IS NULL").run(nowIso(clock.now()), actorName(req.user!), a.id);
      // Once nothing is queried any more, the week can go back to the client.
      const week = mondayOf(a.work_date);
      const left = db.prepare("SELECT COUNT(*) AS n FROM attendance WHERE site_id = ? AND work_date BETWEEN ? AND ? AND status = 'queried'").get(a.site_id, week, addDays(week, 6)) as { n: number };
      if (!left.n) db.prepare("UPDATE timesheets SET status = CASE WHEN signoff_sent_at IS NULL THEN 'open' ELSE 'sent' END WHERE site_id = ? AND week_start = ? AND status = 'queried'").run(a.site_id, week);
    }
  })();
  notify({ type: 'timesheet', siteId: a.site_id });
  res.json({ ok: true });
});

/** Agency adds a shift by hand (e.g. a worker without a phone). */
moneyRouter.post('/attendance', requireAgency, (req, res) => {
  const db = getDb();
  const workerId = v.id(req.body?.workerId, 'worker');
  const siteId = v.id(req.body?.siteId, 'site');
  const date = v.date(req.body?.date);
  const inTime = v.time(req.body?.inTime, 'Signed in');
  const outTime = v.time(req.body?.outTime, 'Signed out');
  const breakMins = v.intOrNull(req.body?.breakMins, 'Break', 0, 240);
  const reason = v.str(req.body?.reason, 'Reason', 500);
  if (isWeekLocked(db, siteId, date)) throw new ValidationError('This week has been approved and is locked');
  if (outTime <= inTime) throw new ValidationError('Signed out must be after signed in');
  const now = nowIso(clock.now());
  const r = db
    .prepare("INSERT INTO attendance (worker_id, site_id, work_date, in_at, out_at, break_mins, method, out_method, flags, status, created_at) VALUES (?,?,?,?,?,?,'agency','agency',?,'ok',?)")
    .run(workerId, siteId, date, londonToUtc(date, inTime).toISOString(), londonToUtc(date, outTime).toISOString(), breakMins, JSON.stringify(['manual', 'edited']), now);
  db.prepare('INSERT INTO attendance_edits (attendance_id, edited_by, edited_at, changes, reason) VALUES (?,?,?,?,?)').run(
    r.lastInsertRowid,
    actorName(req.user!),
    now,
    JSON.stringify([{ field: 'Shift added', from: null, to: `${inTime}–${outTime}` }]),
    reason,
  );
  notify({ type: 'timesheet', siteId });
  res.json({ id: Number(r.lastInsertRowid) });
});

/* ---------------- Invoices ---------------- */

moneyRouter.get('/invoices', requireAgency, (_req, res) => {
  const db = getDb();
  const today = londonDate(clock.now());
  const rows = db.prepare('SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.id DESC').all() as { status: string; due_on: string }[];
  // Approved timesheets not yet invoiced, grouped by client and week.
  const ready = db
    .prepare(
      `SELECT c.id AS clientId, c.name AS clientName, t.week_start AS weekStart, COUNT(*) AS sites, SUM(l.charge) AS chargePence
       FROM timesheets t JOIN sites s ON s.id = t.site_id JOIN clients c ON c.id = s.client_id
       JOIN (SELECT timesheet_id, SUM(charge_pence) AS charge FROM timesheet_lines GROUP BY timesheet_id) l ON l.timesheet_id = t.id
       WHERE t.status = 'approved' AND t.invoice_id IS NULL GROUP BY c.id, t.week_start ORDER BY t.week_start`,
    )
    .all();
  res.json({ invoices: rows.map((r) => ({ ...r, displayStatus: invoiceStatus(r, today) })), ready });
});

moneyRouter.post('/invoices', requireAgency, (req, res) => {
  const r = createInvoice(getDb(), v.id(req.body?.clientId, 'client'), weekParam(req.body?.week));
  res.json(r);
});

moneyRouter.get('/invoices/:id', requireAgency, (req, res) => {
  const db = getDb();
  const inv = db.prepare('SELECT i.*, c.name AS client_name, c.address AS client_address FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?').get(v.id(req.params.id)) as
    | { status: string; due_on: string }
    | undefined;
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(v.id(req.params.id));
  res.json({ ...inv, displayStatus: invoiceStatus(inv), lines });
});

moneyRouter.post('/invoices/:id/status', requireAgency, (req, res) => {
  const status = v.oneOf(req.body?.status, 'status', ['paid', 'sent'] as const);
  getDb()
    .prepare('UPDATE invoices SET status = ?, paid_on = ? WHERE id = ?')
    .run(status, status === 'paid' ? londonDate(clock.now()) : null, v.id(req.params.id));
  res.json({ ok: true });
});

moneyRouter.get('/invoices/:id/pdf', requireAgency, asyncRoute(async (req, res) => {
  const db = getDb();
  const inv = db.prepare('SELECT number FROM invoices WHERE id = ?').get(v.id(req.params.id)) as { number: string } | undefined;
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const pdf = await invoicePdf(db, v.id(req.params.id));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.inline ? 'inline' : 'attachment'}; filename="${inv.number}.pdf"` });
  res.send(pdf);
}));

/* ---------------- Payroll ---------------- */

moneyRouter.get('/payroll', requireAgency, (req, res) => {
  const week = weekParam(req.query.week);
  const { rows, pendingSites } = payrollRows(getDb(), week);
  res.json({ week, rows, pendingSites, totalGross: rows.reduce((s, r) => s + r.grossPence, 0) });
});

moneyRouter.get('/payroll.csv', requireAgency, (req, res) => {
  const week = weekParam(req.query.week);
  const { rows } = payrollRows(getDb(), week);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="payroll-week-ending-${addDays(week, 6)}.csv"` });
  res.send(toCsv(rows));
});

/* ---------------- Margins ---------------- */

moneyRouter.get('/margins', requireAgency, (req, res) => {
  const weeks = v.int(req.query.weeks ?? 6, 'weeks', 1, 26);
  const thisWeek = mondayOf(londonDate(clock.now()));
  const list = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -(weeks - 1 - i) * 7));
  res.json({ weeks: list, rows: marginRows(getDb(), list) });
});

/* ---------------- Dashboard ---------------- */

moneyRouter.get('/dashboard', requireAgency, (_req, res) => {
  const db = getDb();
  const now = clock.now();
  const today = londonDate(now);
  const thisWeek = mondayOf(today);
  const onSiteBySite = db
    .prepare(
      `SELECT s.id, s.name, c.name AS client_name, COUNT(a.id) AS n,
         (SELECT COUNT(*) FROM bookings b WHERE b.site_id = s.id AND b.date = ? AND b.status = 'booked') AS booked
       FROM sites s JOIN clients c ON c.id = s.client_id LEFT JOIN attendance a ON a.site_id = s.id AND a.out_at IS NULL
       WHERE s.active = 1 GROUP BY s.id ORDER BY c.name, s.name`,
    )
    .all(today);
  const alerts = db
    .prepare(
      `SELECT al.*, w.first_name, w.last_name, s.name AS site_name FROM alerts al LEFT JOIN workers w ON w.id = al.worker_id LEFT JOIN sites s ON s.id = al.site_id
       WHERE al.resolved_at IS NULL ORDER BY al.created_at DESC`,
    )
    .all();
  // Still signed in after their site's finish time (today) or from an earlier day.
  const afterHours = (
    db
      .prepare('SELECT a.id, a.in_at, a.work_date, s.name AS site_name, s.finish_time, w.first_name, w.last_name FROM attendance a JOIN sites s ON s.id = a.site_id JOIN workers w ON w.id = a.worker_id WHERE a.out_at IS NULL')
      .all() as { work_date: string; finish_time: string; first_name: string; last_name: string; site_name: string; in_at: string; id: number }[]
  ).filter((a) => a.work_date < today || now > londonToUtc(a.work_date, a.finish_time));
  const compliance = (db.prepare('SELECT * FROM workers WHERE active = 1').all() as WorkerRow[])
    .map((w) => ({ id: w.id, name: fullName(w), scheme: w.card_scheme, expiry: w.card_expiry, status: cardStatus(w.card_expiry, today) }))
    .filter((w) => w.status !== 'ok');
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(thisWeek, -(5 - i) * 7));
  const margins = marginRows(db, weeks);
  const chart = weeks.map((wk) => {
    const rows = margins.filter((m) => m.weekStart === wk);
    const charge = rows.reduce((s, r) => s + r.chargePence, 0);
    const pay = rows.reduce((s, r) => s + r.payPence, 0);
    return { weekStart: wk, mins: rows.reduce((s, r) => s + r.mins, 0), chargePence: charge, payPence: pay, marginPence: charge - pay };
  });
  const thisWeekRows = marginRows(db, [thisWeek]);
  const awaiting = db
    .prepare("SELECT t.id, t.week_start, t.status, s.name AS site_name FROM timesheets t JOIN sites s ON s.id = t.site_id WHERE t.status IN ('sent','queried') ORDER BY t.week_start")
    .all();
  const invoices = db.prepare("SELECT * FROM invoices WHERE status != 'paid'").all() as { due_on: string; gross_pence: number; status: string }[];
  const overdue = invoices.filter((i) => invoiceStatus(i, today) === 'overdue');
  const paidThisWeek = db.prepare("SELECT COALESCE(SUM(gross_pence),0) AS p, COUNT(*) AS n FROM invoices WHERE status = 'paid' AND paid_on >= ?").get(thisWeek) as { p: number; n: number };
  const paid30 = db.prepare("SELECT COALESCE(SUM(gross_pence),0) AS p FROM invoices WHERE status = 'paid' AND paid_on >= ?").get(addDays(today, -30)) as { p: number };
  res.json({
    now: nowIso(now),
    today,
    thisWeek,
    onSite: onSiteBySite,
    alerts,
    afterHours,
    compliance,
    week: {
      mins: thisWeekRows.reduce((s, r) => s + r.mins, 0),
      chargePence: thisWeekRows.reduce((s, r) => s + r.chargePence, 0),
      payPence: thisWeekRows.reduce((s, r) => s + r.payPence, 0),
    },
    awaiting,
    overdue: { count: overdue.length, pence: overdue.reduce((s, i) => s + i.gross_pence, 0) },
    outstanding: { count: invoices.length, pence: invoices.reduce((s, i) => s + i.gross_pence, 0) },
    moneyIn: { thisWeekPence: paidThisWeek.p, thisWeekCount: paidThisWeek.n, last30Pence: paid30.p },
    chart,
  });
});

export { TimesheetError, agencyRow };
