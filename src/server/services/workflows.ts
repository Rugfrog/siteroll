// Business workflows that span several tables: sign-off requests, no-shows and replacements,
// invoices, payroll and margins.
import type { DB } from '../db';
import { nowIso } from '../db';
import { clock } from '../config';
import { addDays, londonDate, londonTime, mondayOf, weekdayIndex } from '../../shared/time';
import { fmtDate, fmtDay, fmtHours, fmtMoney, fmtTime } from '../../shared/format';
import { findNoShows } from '../lib/noshow';
import { invoiceTotals, marginPct, type InvoiceLineInput } from '../lib/money';
import type { PayrollRow } from '../lib/payroll';
import { hashToken, randomToken } from '../lib/security';
import { addAlert } from './attendance';
import { send } from './messaging';
import { notify } from './events';
import { cardStatus, fullName, type ClientRow, type SiteRow, type WorkerRow } from './rules';
import { ensureTimesheet, getTimesheetView, weekHeadline, TimesheetError, type TimesheetRow } from './timesheets';

export const runtime = { baseUrl: 'http://localhost:3000' };

export function agencyRow(db: DB) {
  return db.prepare('SELECT * FROM agency WHERE id = 1').get() as {
    name: string;
    address: string;
    phone: string;
    email: string;
    brand_colour: string;
    logo_path: string | null;
    vat_number: string;
    company_number: string;
    bank_name: string;
    bank_sort_code: string;
    bank_account: string;
    payment_terms_days: number;
    photo_retention_days: number;
    next_invoice_number: number;
    yard_lat: number | null;
    yard_lng: number | null;
  };
}

/* ---------------- Magic links for client site managers ---------------- */

export function createMagicLink(db: DB, managerId: number, purpose: 'login' | 'signoff', timesheetId: number | null = null): string {
  const token = randomToken(32);
  const now = clock.now();
  const days = purpose === 'signoff' ? 14 : 7;
  db.prepare('INSERT INTO magic_links (token_hash, manager_id, purpose, timesheet_id, created_at, expires_at) VALUES (?,?,?,?,?,?)').run(
    hashToken(token),
    managerId,
    purpose,
    timesheetId,
    nowIso(now),
    new Date(now.getTime() + days * 86400000).toISOString(),
  );
  return `${runtime.baseUrl}/${purpose === 'signoff' ? 'approve' : 'm'}/${token}`;
}

export function sendLoginLink(db: DB, managerId: number): boolean {
  const m = db.prepare('SELECT * FROM managers WHERE id = ? AND active = 1').get(managerId) as { id: number; name: string; email: string; phone: string } | undefined;
  if (!m) return false;
  const link = createMagicLink(db, m.id, 'login');
  const agency = agencyRow(db);
  if (m.email) send.email({ to: m.email, toName: m.name, kind: 'magic_link', subject: `Your SiteRoll login link`, body: `Hi ${m.name.split(' ')[0]},\n\nTap the link below to open SiteRoll. It works for 7 days and logs you in on this device. No password needed.\n\n${link}\n\n${agency.name}`, link });
  if (m.phone) send.sms({ to: m.phone, toName: m.name, kind: 'magic_link', body: `${agency.name}: your SiteRoll login link ${link}`, link });
  return true;
}

/* ---------------- Friday sign-off ---------------- */

export function sendSignoffRequest(db: DB, timesheetId: number): { sent: number; headline: string } {
  const ts = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(timesheetId) as TimesheetRow | undefined;
  if (!ts) throw new TimesheetError('Timesheet not found');
  if (ts.status === 'approved') throw new TimesheetError('Already approved');
  const view = getTimesheetView(db, ts.site_id, ts.week_start);
  if (view.totals.totalMins === 0) throw new TimesheetError('There are no hours on this timesheet yet');
  const { workers, hours } = weekHeadline(view);
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(ts.site_id) as SiteRow;
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(site.client_id) as ClientRow;
  const managers = db
    .prepare('SELECT m.* FROM managers m JOIN manager_sites ms ON ms.manager_id = m.id WHERE ms.site_id = ? AND m.active = 1')
    .all(site.id) as { id: number; name: string; email: string; phone: string }[];
  const headline = `${client.name} – ${site.name}: ${workers} worker${workers === 1 ? '' : 's'}, ${hours.toLocaleString('en-GB')} hours this week (w/c ${fmtDay(ts.week_start)}). Review and approve.`;
  for (const m of managers) {
    const link = createMagicLink(db, m.id, 'signoff', ts.id);
    if (m.phone) send.sms({ to: m.phone, toName: m.name, kind: 'signoff', body: `${headline}\n\nReply APPROVE to approve them, or check them first: ${link}`, link });
    if (m.email)
      send.email({
        to: m.email,
        toName: m.name,
        kind: 'signoff',
        subject: `Timesheet to approve: ${site.name}, w/c ${fmtDay(ts.week_start)}`,
        body: `Hi ${m.name.split(' ')[0]},\n\n${headline}\n\n${link}\n\nYou can approve everything in one tap, or query any entry and we'll look into it.\n\n${agencyRow(db).name}`,
        link,
      });
  }
  db.prepare("UPDATE timesheets SET status = CASE WHEN status = 'queried' THEN 'sent' ELSE 'sent' END, signoff_sent_at = ? WHERE id = ?").run(nowIso(clock.now()), ts.id);
  notify({ type: 'timesheet', siteId: site.id });
  return { sent: managers.length, headline };
}

/** Runs every minute: at each client's sign-off day and time, send this week's links once. */
export function runSignoffSchedule(db: DB): number {
  const now = clock.now();
  const today = londonDate(now);
  const nowTime = londonTime(now);
  const week = mondayOf(today);
  const clients = db.prepare('SELECT * FROM clients WHERE active = 1').all() as ClientRow[];
  let n = 0;
  for (const c of clients) {
    if (weekdayIndex(today) !== c.signoff_day || nowTime < c.signoff_time) continue;
    const sites = db.prepare('SELECT * FROM sites WHERE client_id = ? AND active = 1').all(c.id) as SiteRow[];
    for (const s of sites) {
      const ts = ensureTimesheet(db, s.id, week);
      if (ts.status !== 'open' || ts.signoff_sent_at) continue;
      try {
        sendSignoffRequest(db, ts.id);
        n++;
      } catch {
        /* nothing to approve this week */
      }
    }
  }
  return n;
}

/* ---------------- No-shows ---------------- */

export function runNoShowCheck(db: DB): number {
  const now = clock.now();
  const today = londonDate(now);
  const bookings = db
    .prepare("SELECT b.id AS bookingId, b.worker_id AS workerId, b.site_id AS siteId, b.date, s.start_time AS siteStartTime FROM bookings b JOIN sites s ON s.id = b.site_id WHERE b.date = ? AND b.status = 'booked'")
    .all(today) as { bookingId: number; workerId: number; siteId: number; date: string; siteStartTime: string }[];
  const signedIn = new Set((db.prepare('SELECT DISTINCT worker_id FROM attendance WHERE work_date = ?').all(today) as { worker_id: number }[]).map((r) => r.worker_id));
  const alerted = new Set((db.prepare("SELECT booking_id FROM alerts WHERE type = 'no_show' AND date = ?").all(today) as { booking_id: number }[]).map((r) => r.booking_id));
  const due = findNoShows({ now, bookings, signedInWorkerIds: signedIn, alertedBookingIds: alerted });
  // Texts go to agency staff mobiles (the office number is usually a landline).
  const staff = (db.prepare("SELECT name, phone FROM users WHERE phone LIKE '07%'").all() as { name: string; phone: string }[]).slice(0, 5);
  for (const b of due) {
    const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(b.workerId) as WorkerRow;
    const s = db.prepare('SELECT * FROM sites WHERE id = ?').get(b.siteId) as SiteRow;
    const msg = `${fullName(w)} (${w.trade}) hasn't signed in at ${s.name}. Site started at ${s.start_time}.`;
    addAlert(db, { type: 'no_show', siteId: s.id, workerId: w.id, bookingId: b.bookingId, date: today, message: msg });
    for (const u of staff) send.sms({ to: u.phone, toName: u.name, kind: 'no_show', body: `SiteRoll no-show: ${msg} Open SiteRoll to text them or send a replacement.`, link: `${runtime.baseUrl}/live` });
  }
  return due.length;
}

/** Workers of the same trade who are free today and allowed on site. */
export function availableReplacements(db: DB, alertId: number) {
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ? AND type = 'no_show'").get(alertId) as { worker_id: number; site_id: number; date: string } | undefined;
  if (!alert) return null;
  const missing = db.prepare('SELECT * FROM workers WHERE id = ?').get(alert.worker_id) as WorkerRow;
  const candidates = db
    .prepare(
      `SELECT w.* FROM workers w WHERE w.active = 1 AND w.id != ?
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.worker_id = w.id AND b.date = ? AND b.status = 'booked')
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.worker_id = w.id AND a.work_date = ?)
       ORDER BY (w.trade = ?) DESC, w.last_name`,
    )
    .all(missing.id, alert.date, alert.date, missing.trade) as WorkerRow[];
  return {
    trade: missing.trade,
    workers: candidates.map((w) => ({
      id: w.id,
      name: fullName(w),
      trade: w.trade,
      sameTrade: w.trade === missing.trade,
      card: cardStatus(w.card_expiry, alert.date),
      inducted: !!db.prepare('SELECT 1 FROM inductions WHERE worker_id = ? AND site_id = ?').get(w.id, alert.site_id),
    })),
  };
}

export function sendReplacement(
  db: DB,
  alertId: number,
  replacementId: number,
  by: string,
  opts: { tellReplacement?: boolean } = {},
): { ok: boolean; message?: string; site?: SiteRow } {
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ? AND type = 'no_show'").get(alertId) as
    | { id: number; worker_id: number; site_id: number; booking_id: number; date: string; resolved_at: string | null }
    | undefined;
  if (!alert) return { ok: false, message: 'Alert not found' };
  const options = availableReplacements(db, alertId);
  if (!options?.workers.some((w) => w.id === replacementId)) return { ok: false, message: 'That worker is not available today' };
  const missing = db.prepare('SELECT * FROM workers WHERE id = ?').get(alert.worker_id) as WorkerRow;
  const rep = db.prepare('SELECT * FROM workers WHERE id = ?').get(replacementId) as WorkerRow;
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(alert.site_id) as SiteRow;
  const now = nowIso(clock.now());
  db.transaction(() => {
    db.prepare("UPDATE bookings SET status = 'no_show' WHERE id = ?").run(alert.booking_id);
    db.prepare("INSERT INTO bookings (worker_id, site_id, date, status, replaces_booking_id, created_at) VALUES (?,?,?,'booked',?,?)").run(rep.id, site.id, alert.date, alert.booking_id, now);
    db.prepare('UPDATE alerts SET resolved_at = ?, resolved_by = ?, resolution = ? WHERE id = ?').run(now, by, `Replaced by ${fullName(rep)}`, alert.id);
  })();
  // (When they've just said YES on WhatsApp, the bot tells them where to go in its reply instead.)
  if (opts.tellReplacement !== false) {
    send.sms({
      to: rep.phone,
      toName: fullName(rep),
      kind: 'replacement',
      body: `Hi ${rep.first_name}, can you get to ${site.name} today (${site.address}, ${site.postcode})? Report to the site cabin and scan the SiteRoll board to sign in. Thanks, ${agencyRow(db).name}`,
    });
  }
  const managers = db
    .prepare('SELECT m.* FROM managers m JOIN manager_sites ms ON ms.manager_id = m.id WHERE ms.site_id = ? AND m.active = 1')
    .all(site.id) as { name: string; phone: string; email: string }[];
  for (const m of managers) {
    const body = `${agencyRow(db).name}: ${fullName(missing)} hasn't turned up at ${site.name} today. ${fullName(rep)} (${rep.trade}) is on the way as a replacement. Sorry for the trouble.`;
    if (m.phone) send.sms({ to: m.phone, toName: m.name, kind: 'replacement', body });
  }
  notify({ type: 'alert', siteId: site.id });
  return { ok: true, site };
}

/* ---------------- Invoices ---------------- */

export function createInvoice(db: DB, clientId: number, weekStart: string): { id: number; number: string } {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as ClientRow | undefined;
  if (!client) throw new TimesheetError('Client not found');
  const timesheets = db
    .prepare(
      `SELECT t.*, s.name AS site_name FROM timesheets t JOIN sites s ON s.id = t.site_id
       WHERE s.client_id = ? AND t.week_start = ? AND t.status = 'approved' AND t.invoice_id IS NULL ORDER BY s.name`,
    )
    .all(clientId, weekStart) as (TimesheetRow & { site_name: string })[];
  if (!timesheets.length) throw new TimesheetError('There are no approved, uninvoiced timesheets for this client and week');
  const inputs: (InvoiceLineInput & { site: string })[] = [];
  for (const ts of timesheets) {
    const lines = db.prepare('SELECT * FROM timesheet_lines WHERE timesheet_id = ? ORDER BY worker_name').all(ts.id) as {
      worker_name: string;
      trade: string;
      normal_mins: number;
      ot_mins: number;
      charge_rate: number;
      ot_charge_rate: number;
    }[];
    for (const l of lines) {
      inputs.push({ site: ts.site_name, description: `${l.worker_name} – ${l.trade}`, minutes: l.normal_mins, ratePence: l.charge_rate });
      inputs.push({ site: ts.site_name, description: `${l.worker_name} – ${l.trade} (overtime)`, minutes: l.ot_mins, ratePence: l.ot_charge_rate });
    }
  }
  const totals = invoiceTotals(inputs);
  const agency = agencyRow(db);
  const number = `INV-${String(agency.next_invoice_number).padStart(4, '0')}`;
  const today = londonDate(clock.now());
  const sites = inputs.filter((l) => l.minutes > 0);
  let id = 0;
  db.transaction(() => {
    const r = db
      .prepare('INSERT INTO invoices (number, client_id, week_start, issued_on, due_on, net_pence, vat_pence, gross_pence, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(number, clientId, weekStart, today, addDays(today, agency.payment_terms_days), totals.netPence, totals.vatPence, totals.grossPence, 'sent', nowIso(clock.now()));
    id = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO invoice_lines (invoice_id, site_name, description, minutes, rate_pence, amount_pence) VALUES (?,?,?,?,?,?)');
    totals.lines.forEach((l, i) => ins.run(id, sites[i].site, l.description, l.minutes, l.ratePence, l.amountPence));
    for (const ts of timesheets) db.prepare('UPDATE timesheets SET invoice_id = ? WHERE id = ?').run(id, ts.id);
    db.prepare('UPDATE agency SET next_invoice_number = next_invoice_number + 1 WHERE id = 1').run();
  })();
  if (client.billing_email) {
    send.email({
      to: client.billing_email,
      toName: `${client.name} accounts`,
      kind: 'invoice',
      subject: `Invoice ${number} from ${agency.name}`,
      body: `Please find attached invoice ${number} for labour supplied in the week commencing ${fmtDate(weekStart)}.\n\nTotal due: ${fmtMoney(totals.grossPence)} (including VAT of ${fmtMoney(totals.vatPence)})\nDue by: ${fmtDate(addDays(today, agency.payment_terms_days))}\n\nBank: ${agency.bank_name}, sort code ${agency.bank_sort_code}, account ${agency.bank_account}. Please quote ${number}.\n\n${agency.name}`,
      link: `${runtime.baseUrl}/api/invoices/${id}/pdf`,
    });
  }
  return { id, number };
}

export function invoiceStatus(inv: { status: string; due_on: string }, today = londonDate(clock.now())): 'paid' | 'overdue' | 'sent' {
  if (inv.status === 'paid') return 'paid';
  return inv.due_on < today ? 'overdue' : 'sent';
}

/* ---------------- Payroll ---------------- */

export function payrollRows(db: DB, weekStart: string): { rows: PayrollRow[]; pendingSites: string[] } {
  const lines = db
    .prepare(
      `SELECT l.*, s.name AS site_name FROM timesheet_lines l JOIN timesheets t ON t.id = l.timesheet_id JOIN sites s ON s.id = t.site_id
       WHERE t.week_start = ? AND t.status = 'approved' ORDER BY l.worker_name`,
    )
    .all(weekStart) as { worker_id: number; normal_mins: number; ot_mins: number; pay_rate: number; ot_pay_rate: number; pay_pence: number; site_name: string }[];
  const byWorker = new Map<number, PayrollRow>();
  for (const l of lines) {
    const w = db.prepare('SELECT * FROM workers WHERE id = ?').get(l.worker_id) as WorkerRow;
    const row = byWorker.get(l.worker_id) ?? {
      payrollRef: `SR${String(w.id).padStart(4, '0')}`,
      firstName: w.first_name,
      lastName: w.last_name,
      niNumber: w.ni_number,
      periodEnd: addDays(weekStart, 6),
      normalMins: 0,
      payRate: l.pay_rate,
      otMins: 0,
      otPayRate: l.ot_pay_rate,
      grossPence: 0,
      sites: '',
    };
    row.normalMins += l.normal_mins;
    row.otMins += l.ot_mins;
    row.grossPence += l.pay_pence;
    row.sites = [...new Set([...row.sites.split('; ').filter(Boolean), l.site_name])].join('; ');
    byWorker.set(l.worker_id, row);
  }
  const pendingSites = (
    db
      .prepare(
        `SELECT DISTINCT s.name FROM attendance a JOIN sites s ON s.id = a.site_id
         LEFT JOIN timesheets t ON t.site_id = a.site_id AND t.week_start = ?
         WHERE a.work_date BETWEEN ? AND ? AND (t.status IS NULL OR t.status != 'approved')`,
      )
      .all(weekStart, weekStart, addDays(weekStart, 6)) as { name: string }[]
  ).map((r) => r.name);
  const rows = [...byWorker.values()].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  return { rows, pendingSites };
}

/* ---------------- Margins ---------------- */

export interface MarginRow {
  weekStart: string;
  siteId: number;
  siteName: string;
  clientId: number;
  clientName: string;
  status: string;
  mins: number;
  chargePence: number;
  payPence: number;
  marginPence: number;
  marginPct: number;
}

export function marginRows(db: DB, weeks: string[], siteIds: number[] | null = null): MarginRow[] {
  const sites = db.prepare('SELECT s.*, c.name AS client_name FROM sites s JOIN clients c ON c.id = s.client_id ORDER BY c.name, s.name').all() as (SiteRow & { client_name: string })[];
  const out: MarginRow[] = [];
  for (const week of weeks) {
    for (const s of sites) {
      if (siteIds && !siteIds.includes(s.id)) continue;
      const has = db.prepare('SELECT 1 FROM attendance WHERE site_id = ? AND work_date BETWEEN ? AND ? LIMIT 1').get(s.id, week, addDays(week, 6));
      if (!has) continue;
      const v = getTimesheetView(db, s.id, week);
      out.push({
        weekStart: week,
        siteId: s.id,
        siteName: s.name,
        clientId: s.client_id,
        clientName: s.client_name,
        status: v.timesheet.status,
        mins: v.totals.totalMins,
        chargePence: v.totals.chargePence,
        payPence: v.totals.payPence,
        marginPence: v.totals.chargePence - v.totals.payPence,
        marginPct: marginPct(v.totals.chargePence, v.totals.payPence),
      });
    }
  }
  return out;
}

export { fmtHours, fmtTime };
