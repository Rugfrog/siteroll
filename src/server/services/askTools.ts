// Read-only lookups for Ask SiteRoll. Each returns a small JSON-friendly object with figures
// already worked out by the same functions the screens, PDFs and CSVs use, so the assistant
// never has to do the sums itself. Nothing here changes any data.
import type { DB } from '../db';
import { parseFlags } from '../db';
import { clock } from '../config';
import { addDays, isValidDate, londonDate, mondayOf } from '../../shared/time';
import { fmtDate, fmtDateTime, fmtDay, fmtHours, fmtMoney, fmtPhone, fmtTime } from '../../shared/format';
import { marginPct } from '../lib/money';
import { shiftWorked } from '../lib/hours';
import { FLAG_LABELS } from './attendance';
import { complianceItems, liveBoard } from './board';
import { cardStatus, fullName, rulesFor, type AttendanceRow, type ClientRow, type SiteRow, type WorkerRow } from './rules';
import { getTimesheetView } from './timesheets';
import { invoiceStatus, marginRows, payrollRows } from './workflows';

const money = (p: number) => fmtMoney(p);
const hrs = (m: number) => fmtHours(m);
const flagText = (flags: string[]) => flags.map((f) => FLAG_LABELS[f] ?? f);

export class ToolInputError extends Error {}

/** Any date in a week → that week's Monday. No date → this week. */
export function resolveWeek(date: string | null | undefined): string {
  const today = londonDate(clock.now());
  if (!date) return mondayOf(today);
  if (!isValidDate(date)) throw new ToolInputError(`"${date}" is not a date in YYYY-MM-DD form`);
  return mondayOf(date);
}

const weekLabel = (week: string) => `week commencing ${fmtDay(week)} ${week.slice(0, 4)} (${fmtDay(week)} to ${fmtDay(addDays(week, 6))})`;

export function findSite(db: DB, name: string): SiteRow {
  const sites = db.prepare('SELECT * FROM sites ORDER BY name').all() as SiteRow[];
  const q = name.trim().toLowerCase();
  const hit = sites.find((s) => s.name.toLowerCase() === q) ?? sites.find((s) => s.name.toLowerCase().includes(q)) ?? sites.find((s) => q.split(/\s+/).every((w) => s.name.toLowerCase().includes(w)));
  if (!hit) throw new ToolInputError(`No site matches "${name}". Sites are: ${sites.map((s) => s.name).join('; ')}`);
  return hit;
}

export function findWorker(db: DB, name: string): WorkerRow {
  const workers = db.prepare('SELECT * FROM workers ORDER BY last_name, first_name').all() as WorkerRow[];
  const q = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const exact = workers.filter((w) => fullName(w).toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const parts = q.split(' ');
  const matches = workers.filter((w) => parts.every((p) => fullName(w).toLowerCase().split(' ').some((n) => n.startsWith(p))));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new ToolInputError(`"${name}" matches more than one worker: ${matches.map(fullName).join(', ')}. Ask which one.`);
  throw new ToolInputError(`No worker matches "${name}".`);
}

/* ---------------- The tools ---------------- */

export function getLiveBoard(db: DB) {
  const board = liveBoard(db, null);
  const alerts = db
    .prepare(
      `SELECT al.type, al.message, al.created_at FROM alerts al WHERE al.resolved_at IS NULL ORDER BY al.created_at DESC LIMIT 30`,
    )
    .all() as { type: string; message: string; created_at: string }[];
  return {
    asOf: fmtDateTime(board.now),
    totalOnSite: board.sites.reduce((s, x) => s + x.onSite.length, 0),
    sites: board.sites.map((s) => ({
      site: s.name,
      client: s.clientName,
      startTime: s.startTime,
      usualFinish: s.finishTime,
      onSiteNow: s.onSite.length,
      people: s.onSite.map((p) => ({ name: p.name, trade: p.trade, signedInAt: fmtTime(p.inAt), flags: [...flagText(p.flags), ...(p.card !== 'ok' && !p.flags.includes('card') ? [`card ${p.card}`] : [])] })),
      bookedButNotArrived: s.expected.map((e) => ({ name: e.name, trade: e.trade, noShowAlert: e.noShow })),
      alreadyGoneHome: s.signedOutToday,
      waitingForManualSignIn: s.pendingManual.length,
    })),
    openAlerts: alerts.map((a) => ({ type: a.type.replace('_', ' '), message: a.message, raised: fmtDateTime(a.created_at) })),
  };
}

export function listWorkers(db: DB, opts: { search?: string | null; trade?: string | null; includeLeft?: boolean | null }) {
  const today = londonDate(clock.now());
  let rows = db.prepare('SELECT * FROM workers ORDER BY last_name, first_name').all() as WorkerRow[];
  if (!opts.includeLeft) rows = rows.filter((w) => w.active);
  if (opts.trade) rows = rows.filter((w) => w.trade.toLowerCase().includes(opts.trade!.toLowerCase()));
  if (opts.search) {
    const q = opts.search.toLowerCase();
    rows = rows.filter((w) => `${fullName(w)} ${w.trade} ${w.phone}`.toLowerCase().includes(q));
  }
  return {
    count: rows.length,
    workers: rows.map((w) => ({
      name: fullName(w),
      trade: w.trade,
      mobile: fmtPhone(w.phone),
      payRate: `${money(w.pay_rate)}/h`,
      chargeRate: `${money(w.charge_rate)}/h`,
      marginPerHour: `${money(w.charge_rate - w.pay_rate)} (${marginPct(w.charge_rate, w.pay_rate)}%)`,
      card: `${w.card_scheme} ${cardStatus(w.card_expiry, today)}${w.card_expiry ? `, expires ${fmtDate(w.card_expiry)}` : ''}`,
      rightToWorkChecked: !!w.rtw_checked_on,
      stillOnBooks: !!w.active,
    })),
  };
}

export function getWorker(db: DB, name: string) {
  const w = findWorker(db, name);
  const today = londonDate(clock.now());
  const week = mondayOf(today);
  const recent = db
    .prepare('SELECT a.*, s.name AS site_name, s.client_id FROM attendance a JOIN sites s ON s.id = a.site_id WHERE a.worker_id = ? ORDER BY a.in_at DESC LIMIT 15')
    .all(w.id) as (AttendanceRow & { site_name: string; client_id: number })[];
  const rulesCache = new Map<number, ReturnType<typeof rulesFor>>();
  const rulesOf = (clientId: number) => {
    if (!rulesCache.has(clientId)) rulesCache.set(clientId, rulesFor(db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as ClientRow));
    return rulesCache.get(clientId)!;
  };
  return {
    name: fullName(w),
    trade: w.trade,
    mobile: fmtPhone(w.phone),
    stillOnBooks: !!w.active,
    payRate: `${money(w.pay_rate)}/h`,
    chargeRate: `${money(w.charge_rate)}/h`,
    card: { scheme: w.card_scheme, type: w.card_type, number: w.card_number, expiry: w.card_expiry ? fmtDate(w.card_expiry) : null, status: cardStatus(w.card_expiry, today) },
    rightToWork: w.rtw_checked_on ? `checked ${fmtDate(w.rtw_checked_on)} by ${w.rtw_checked_by || 'unknown'}` : 'not checked',
    emergencyContact: w.emergency_name ? `${w.emergency_name}, ${w.emergency_phone}` : 'none',
    tickets: (db.prepare('SELECT name, expiry FROM worker_tickets WHERE worker_id = ? ORDER BY expiry').all(w.id) as { name: string; expiry: string | null }[]).map((t) => ({
      name: t.name,
      expiry: t.expiry ? fmtDate(t.expiry) : 'no expiry',
    })),
    inductedAt: (db.prepare('SELECT s.name, i.inducted_on FROM inductions i JOIN sites s ON s.id = i.site_id WHERE i.worker_id = ?').all(w.id) as { name: string; inducted_on: string }[]).map(
      (i) => `${i.name} (${fmtDate(i.inducted_on)})`,
    ),
    bookingsThisWeek: (
      db.prepare("SELECT b.date, b.status, s.name FROM bookings b JOIN sites s ON s.id = b.site_id WHERE b.worker_id = ? AND b.date BETWEEN ? AND ? ORDER BY b.date").all(w.id, week, addDays(week, 6)) as {
        date: string;
        status: string;
        name: string;
      }[]
    ).map((b) => `${fmtDay(b.date)}: ${b.name}${b.status === 'no_show' ? ' (no-show)' : ''}`),
    recentSignIns: recent.map((a) => {
      const worked = a.out_at ? shiftWorked({ id: a.id, workerId: w.id, date: a.work_date, inAt: a.in_at, outAt: a.out_at, breakMins: a.break_mins }, rulesOf(a.client_id)) : null;
      return {
        day: fmtDay(a.work_date),
        site: a.site_name,
        in: fmtTime(a.in_at),
        out: a.out_at ? fmtTime(a.out_at) : 'still on site',
        hoursWorked: worked ? hrs(worked.workedMins) : null,
        flags: flagText(parseFlags(a.flags)),
      };
    }),
    note: 'For a whole week’s hours including overtime, use get_timesheets with the site.',
  };
}

export function getTimesheets(db: DB, opts: { week?: string | null; site?: string | null }) {
  const week = resolveWeek(opts.week);
  const sites = opts.site ? [findSite(db, opts.site)] : (db.prepare('SELECT * FROM sites ORDER BY name').all() as SiteRow[]);
  const out = [];
  for (const s of sites) {
    const has = db.prepare('SELECT 1 FROM attendance WHERE site_id = ? AND work_date BETWEEN ? AND ? LIMIT 1').get(s.id, week, addDays(week, 6));
    if (!has && !opts.site) continue;
    const v = getTimesheetView(db, s.id, week);
    const t = v.timesheet;
    out.push({
      site: v.site.name,
      client: v.site.clientName,
      status:
        t.status === 'approved'
          ? `approved by ${t.approved_by_name} on ${fmtDateTime(t.approved_at)}`
          : t.status === 'sent'
            ? `sent to the client ${fmtDateTime(t.signoff_sent_at)}, not approved yet`
            : t.status === 'queried'
              ? 'queried by the client'
              : 'not sent to the client yet',
      invoiced: !!t.invoice_id,
      workers: v.totals.workers,
      totalHours: hrs(v.totals.totalMins),
      basicHours: hrs(v.totals.normalMins),
      overtimeHours: hrs(v.totals.otMins),
      chargeToClient: money(v.totals.chargePence),
      payToWorkers: money(v.totals.payPence),
      margin: `${money(v.totals.chargePence - v.totals.payPence)} (${marginPct(v.totals.chargePence, v.totals.payPence)}%)`,
      entriesNeedingChecks: v.needsChecking,
      entriesQueried: v.queried,
      stillOnSite: v.openShifts,
      byWorker: opts.site
        ? v.workers.map((w) => ({
            name: w.name,
            trade: w.trade,
            days: v.days
              .map((d) => {
                const mins = w.shifts.filter((x) => x.date === d).reduce((a, x) => a + x.workedMins, 0);
                return mins ? `${fmtDay(d).slice(0, 3)} ${hrs(mins)}` : null;
              })
              .filter(Boolean)
              .join(', '),
            basic: hrs(w.totals.normalMins),
            overtime: hrs(w.totals.otMins),
            total: hrs(w.totals.totalMins),
            charge: money(w.totals.chargePence),
            pay: money(w.totals.payPence),
            notes: [...new Set(w.shifts.flatMap((x) => flagText(x.flags)))].join(', ') || undefined,
          }))
        : undefined,
    });
  }
  return { week: weekLabel(week), timesheets: out, ...(out.length ? {} : { note: 'No hours were recorded in this week.' }) };
}

export function getCompliance(db: DB) {
  const c = complianceItems(db);
  return {
    today: fmtDate(c.today),
    items: c.items.map((i) => ({ worker: i.name, trade: i.trade, what: i.what, status: i.status, expiry: i.expiry ? fmtDate(i.expiry) : null })),
    whatHappensAtTheGate: c.clients.map((x) => `${x.name}: expired cards are ${x.compliance_mode === 'block' ? 'blocked' : 'warned but let in'}`),
    recentlyStoppedAtTheGate: c.blocked.map((b) => `${b.first_name} ${b.last_name} at ${b.site_name}, ${fmtDateTime(b.at)}`),
  };
}

export function getInvoices(db: DB, status: 'sent' | 'paid' | 'overdue' | 'unpaid' | null) {
  const today = londonDate(clock.now());
  const rows = (
    db.prepare('SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id ORDER BY i.id DESC').all() as {
      number: string;
      client_name: string;
      week_start: string;
      issued_on: string;
      due_on: string;
      net_pence: number;
      vat_pence: number;
      gross_pence: number;
      status: string;
      paid_on: string | null;
    }[]
  ).map((i) => ({ ...i, display: invoiceStatus(i, today) }));
  const filtered = rows.filter((i) => !status || (status === 'unpaid' ? i.display !== 'paid' : i.display === status));
  const ready = db
    .prepare(
      `SELECT c.name, t.week_start, COUNT(*) AS sites FROM timesheets t JOIN sites s ON s.id = t.site_id JOIN clients c ON c.id = s.client_id
       WHERE t.status = 'approved' AND t.invoice_id IS NULL GROUP BY c.id, t.week_start`,
    )
    .all() as { name: string; week_start: string; sites: number }[];
  const sum = (list: typeof rows) => money(list.reduce((s, i) => s + i.gross_pence, 0));
  return {
    outstanding: `${sum(rows.filter((i) => i.display !== 'paid'))} across ${rows.filter((i) => i.display !== 'paid').length} invoices`,
    overdue: `${sum(rows.filter((i) => i.display === 'overdue'))} across ${rows.filter((i) => i.display === 'overdue').length} invoices`,
    invoices: filtered.map((i) => ({
      number: i.number,
      client: i.client_name,
      forWeek: fmtDay(i.week_start),
      issued: fmtDate(i.issued_on),
      due: fmtDate(i.due_on),
      net: money(i.net_pence),
      vat: money(i.vat_pence),
      total: money(i.gross_pence),
      status: i.display,
      paidOn: i.paid_on ? fmtDate(i.paid_on) : undefined,
    })),
    readyToInvoice: ready.map((r) => `${r.name}, week commencing ${fmtDay(r.week_start)} (${r.sites} site${r.sites === 1 ? '' : 's'} approved, not invoiced)`),
  };
}

export function getMargins(db: DB, weeks: number, groupBy: 'site' | 'client' | 'week', week: string | null = null) {
  const thisWeek = mondayOf(londonDate(clock.now()));
  // One particular week, or the last N weeks including this one.
  const list = week ? [resolveWeek(week)] : Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -(weeks - 1 - i) * 7));
  const rows = marginRows(db, list);
  const groups = new Map<string, { charge: number; pay: number; mins: number }>();
  for (const r of rows) {
    const key = groupBy === 'site' ? r.siteName : groupBy === 'client' ? r.clientName : `w/c ${fmtDay(r.weekStart)}`;
    const g = groups.get(key) ?? { charge: 0, pay: 0, mins: 0 };
    g.charge += r.chargePence;
    g.pay += r.payPence;
    g.mins += r.mins;
    groups.set(key, g);
  }
  const total = rows.reduce((a, r) => ({ charge: a.charge + r.chargePence, pay: a.pay + r.payPence, mins: a.mins + r.mins }), { charge: 0, pay: 0, mins: 0 });
  const fmt = (g: { charge: number; pay: number; mins: number }) => ({
    hours: hrs(g.mins),
    charged: money(g.charge),
    paid: money(g.pay),
    margin: money(g.charge - g.pay),
    marginPercent: `${marginPct(g.charge, g.pay)}%`,
  });
  return {
    period: week
      ? `${weekLabel(list[0])}${list[0] === thisWeek ? ' (so far, worked out live)' : ' (as approved, or live if not approved yet)'}`
      : `${weeks} week${weeks === 1 ? '' : 's'} from ${fmtDay(list[0])} to ${fmtDay(addDays(thisWeek, 6))} (this week so far is live; earlier weeks are as approved)`,
    groupedBy: groupBy,
    rows: [...groups].map(([name, g]) => ({ name, ...fmt(g) })),
    total: fmt(total),
  };
}

export function getBookings(db: DB, date: string | null) {
  const day = date ?? londonDate(clock.now());
  if (!isValidDate(day)) throw new ToolInputError(`"${date}" is not a date in YYYY-MM-DD form`);
  const week = mondayOf(day);
  const rows = db
    .prepare(
      `SELECT b.date, b.status, s.name AS site, w.first_name, w.last_name, w.trade FROM bookings b JOIN sites s ON s.id = b.site_id JOIN workers w ON w.id = b.worker_id
       WHERE b.date BETWEEN ? AND ? ORDER BY b.date, s.name, w.last_name`,
    )
    .all(week, addDays(week, 6)) as { date: string; status: string; site: string; first_name: string; last_name: string; trade: string }[];
  const byDay = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    const d = fmtDay(r.date);
    if (!byDay.has(d)) byDay.set(d, new Map());
    const sites = byDay.get(d)!;
    if (!sites.has(r.site)) sites.set(r.site, []);
    sites.get(r.site)!.push(`${r.first_name} ${r.last_name} (${r.trade})${r.status === 'no_show' ? ' – no-show' : ''}`);
  }
  const free = (db.prepare(
    `SELECT w.first_name, w.last_name, w.trade FROM workers w WHERE w.active = 1 AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.worker_id = w.id AND b.date = ? AND b.status = 'booked') ORDER BY w.trade, w.last_name`,
  ).all(day) as { first_name: string; last_name: string; trade: string }[]).map((w) => `${w.first_name} ${w.last_name} (${w.trade})`);
  return {
    week: weekLabel(week),
    days: [...byDay].map(([d, sites]) => ({ day: d, sites: [...sites].map(([site, people]) => ({ site, booked: people.length, people })) })),
    notBookedOn: { day: fmtDay(day), workers: free },
  };
}

export function getClientsAndSites(db: DB) {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const clients = db.prepare('SELECT * FROM clients ORDER BY name').all() as ClientRow[];
  return clients.map((c) => ({
    client: c.name,
    address: c.address,
    rules: [
      `default break ${c.break_default_mins} mins on shifts over ${c.break_after_mins / 60} hours`,
      c.ot_daily_mins ? `overtime after ${c.ot_daily_mins / 60} hours a day` : null,
      c.ot_weekly_mins ? `overtime after ${c.ot_weekly_mins / 60} hours a week` : null,
      c.ot_saturday ? 'all Saturday hours are overtime' : null,
      c.ot_sunday ? 'all Sunday hours are overtime' : null,
      `overtime rate ×${c.ot_multiplier}`,
      c.round_mins ? `times rounded to the nearest ${c.round_mins} minutes` : 'times not rounded',
      c.selfie_required ? 'selfie required at sign-in' : 'no selfie',
      c.compliance_mode === 'block' ? 'expired cards blocked at the gate' : 'expired cards warned but let in',
      `timesheet sign-off sent ${DAYS[c.signoff_day]} at ${c.signoff_time}`,
    ].filter(Boolean),
    sites: (db.prepare('SELECT * FROM sites WHERE client_id = ? ORDER BY name').all(c.id) as SiteRow[]).map((s) => ({
      site: s.name,
      address: `${s.address}, ${s.postcode}`,
      hours: `${s.start_time}–${s.finish_time}`,
      geofence: `${s.radius_m} m`,
      open: !!s.active,
    })),
    siteManagers: (
      db.prepare('SELECT m.* FROM managers m WHERE m.client_id = ? AND m.active = 1 ORDER BY m.name').all(c.id) as { id: number; name: string; phone: string; email: string }[]
    ).map((m) => ({
      name: m.name,
      mobile: m.phone ? fmtPhone(m.phone) : null,
      email: m.email || null,
      sites: (db.prepare('SELECT s.name FROM manager_sites ms JOIN sites s ON s.id = ms.site_id WHERE ms.manager_id = ?').all(m.id) as { name: string }[]).map((x) => x.name),
    })),
  }));
}

export function getPayroll(db: DB, week: string | null) {
  const w = resolveWeek(week);
  const { rows, pendingSites } = payrollRows(db, w);
  return {
    week: weekLabel(w),
    workersToPay: rows.length,
    totalGrossPay: money(rows.reduce((s, r) => s + r.grossPence, 0)),
    rows: rows.map((r) => ({ name: `${r.firstName} ${r.lastName}`, basicHours: hrs(r.normalMins), rate: money(r.payRate), overtimeHours: hrs(r.otMins), overtimeRate: money(r.otPayRate), gross: money(r.grossPence), sites: r.sites })),
    notIncludedYet: pendingSites.length ? `Not yet approved by the client, so not in payroll: ${pendingSites.join(', ')}` : undefined,
  };
}

export function getRollCalls(db: DB) {
  const rows = db
    .prepare(
      `SELECT r.*, s.name AS site_name, (SELECT COUNT(*) FROM roll_call_people p WHERE p.roll_call_id = r.id) AS total,
         (SELECT COUNT(*) FROM roll_call_people p WHERE p.roll_call_id = r.id AND p.safe_at IS NOT NULL) AS safe
       FROM roll_calls r JOIN sites s ON s.id = r.site_id ORDER BY r.started_at DESC LIMIT 10`,
    )
    .all() as { site_name: string; kind: string; started_by: string; started_at: string; finished_at: string | null; total: number; safe: number; notes: string }[];
  return rows.map((r) => ({
    site: r.site_name,
    when: fmtDateTime(r.started_at),
    type: r.kind,
    runBy: r.started_by,
    accountedFor: `${r.safe} of ${r.total}`,
    took: r.finished_at ? `${Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 60000))} min` : 'still running',
    notes: r.notes || undefined,
  }));
}

export function getMessages(db: DB, kind: string | null, limit: number) {
  const rows = db
    .prepare(`SELECT * FROM outbox ${kind ? 'WHERE kind = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...(kind ? [kind, limit] : [limit])) as { channel: string; recipient: string; recipient_name: string; subject: string; body: string; kind: string; created_at: string }[];
  return rows.map((m) => ({
    sent: fmtDateTime(m.created_at),
    by: m.channel === 'sms' ? 'text' : 'email',
    to: m.recipient_name || m.recipient,
    about: m.kind.replace('_', ' '),
    subject: m.subject || undefined,
    message: m.body.length > 400 ? `${m.body.slice(0, 400)}…` : m.body,
  }));
}
