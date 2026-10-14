// Booking confirmations, and the "who approves the hours?" link in them. The client names whoever
// should approve (site manager, project manager, director…) and that person gets the hours each
// week by email, with a link that logs them straight in: no passwords or accounts to set up.
import type { DB } from '../db';
import { nowIso } from '../db';
import { clock } from '../config';
import { weekDates } from '../../shared/time';
import { fmtDate, fmtDay, normaliseMobile } from '../../shared/format';
import { hashToken, randomToken } from '../lib/security';
import { v, ValidationError } from '../lib/validate';
import { send } from './messaging';
import { notify } from './events';
import { agencyRow, createMagicLink, runtime } from './workflows';
import type { ClientRow, SiteRow } from './rules';

export const ROLES = ['Site manager', 'Project manager', 'Contracts manager', 'Director', 'Other'] as const;
const LINK_DAYS = 30;

export interface Approver {
  id: number;
  name: string;
  role: string;
  email: string;
  phone: string;
}

/** The people who get this site's hours to approve. */
export function siteApprovers(db: DB, siteId: number): Approver[] {
  return db
    .prepare('SELECT m.id, m.name, m.role, m.email, m.phone FROM managers m JOIN manager_sites ms ON ms.manager_id = m.id WHERE ms.site_id = ? AND m.active = 1 ORDER BY m.name')
    .all(siteId) as Approver[];
}

export const withRole = (p: { name: string; role: string }) => (p.role ? `${p.name} (${p.role})` : p.name);
const joinNames = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/** "Mon 12 Oct: Callum Ainley (General labourer), Mark Dyson (Groundworker)", one line per day. */
export function bookingLines(db: DB, siteId: number, weekStart: string): string[] {
  const lines: string[] = [];
  for (const date of weekDates(weekStart)) {
    const people = db
      .prepare(
        `SELECT w.first_name, w.last_name, w.trade FROM bookings b JOIN workers w ON w.id = b.worker_id
         WHERE b.site_id = ? AND b.date = ? AND b.status = 'booked' ORDER BY w.last_name, w.first_name`,
      )
      .all(siteId, date) as { first_name: string; last_name: string; trade: string }[];
    if (people.length) lines.push(`${fmtDay(date)}: ${people.map((p) => `${p.first_name} ${p.last_name} (${p.trade})`).join(', ')}`);
  }
  return lines;
}

function loadSite(db: DB, siteId: number) {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) as SiteRow | undefined;
  if (!site) throw new ValidationError('Site not found');
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(site.client_id) as ClientRow;
  return { site, client };
}

/** Email the client who's booked on a site that week, and ask who approves the hours. */
export function confirmBookings(db: DB, input: { siteId: number; weekStart: string; email: string; name: string; by: string }): { sentTo: string } {
  const { site, client } = loadSite(db, input.siteId);
  const lines = bookingLines(db, site.id, input.weekStart);
  if (!lines.length) throw new ValidationError('Nobody is booked on this site that week yet');
  const token = randomToken(32);
  const now = clock.now();
  db.prepare('INSERT INTO booking_confirmations (site_id, week_start, sent_to, sent_by, sent_at, token_hash, expires_at) VALUES (?,?,?,?,?,?,?)').run(
    site.id,
    input.weekStart,
    input.email,
    input.by,
    nowIso(now),
    hashToken(token),
    new Date(now.getTime() + LINK_DAYS * 86400000).toISOString(),
  );
  // Remember who handles this client's bookings, for next time.
  if (!client.bookings_email) db.prepare('UPDATE clients SET bookings_email = ? WHERE id = ?').run(input.email, client.id);
  const agency = agencyRow(db);
  const link = `${runtime.baseUrl}/who-approves/${token}`;
  const approvers = siteApprovers(db, site.id);
  const ask = approvers.length
    ? `Each week we send the hours to ${joinNames(approvers.map(withRole))} to check and approve. If that should be someone else, tell us here:`
    : `Each week we'll send the hours to one person at ${client.name} to check and approve, by email. There's no password or account to set up. Who should that be? It can be you, the site manager, the project manager or a director:`;
  send.email({
    to: input.email,
    toName: input.name || client.name,
    kind: 'booking',
    subject: `Booking confirmed: ${site.name}, w/c ${fmtDay(input.weekStart)}`,
    body: `${input.name ? `Hi ${input.name.split(' ')[0]},` : 'Hello,'}\n\nHere's who ${agency.name} has booked at ${site.name} for the week commencing ${fmtDate(input.weekStart)}:\n\n${lines.join('\n')}\n\n${ask}\n\n${link}\n\nAny questions, call us on ${agency.phone}.\n\n${agency.name}`,
    link,
    linkLabel: approvers.length ? 'Change who approves the hours' : 'Tell us who approves the hours',
  });
  notify({ type: 'bookings', siteId: site.id });
  return { sentTo: input.email };
}

interface ConfirmationRow {
  id: number;
  site_id: number;
  week_start: string;
  sent_to: string;
  expires_at: string;
  answered_at: string | null;
  approver_id: number | null;
}

function confirmationByToken(db: DB, token: string): ConfirmationRow | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const row = db.prepare('SELECT * FROM booking_confirmations WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), nowIso(clock.now())) as
    | ConfirmationRow
    | undefined;
  return row ?? null;
}

/** What the "who approves the hours?" page shows. null if the link has expired or isn't real. */
export function approverRequest(db: DB, token: string) {
  const c = confirmationByToken(db, token);
  if (!c) return null;
  const { site, client } = loadSite(db, c.site_id);
  const a = agencyRow(db);
  const answered = c.approver_id ? (db.prepare('SELECT name, role FROM managers WHERE id = ?').get(c.approver_id) as { name: string; role: string } | undefined) : undefined;
  return {
    siteName: site.name,
    siteAddress: [site.address, site.postcode].filter(Boolean).join(', '),
    clientName: client.name,
    weekStart: c.week_start,
    bookings: bookingLines(db, site.id, c.week_start),
    approvers: siteApprovers(db, site.id).map((m) => ({ name: m.name, role: m.role })),
    answered: answered ?? null,
    roles: ROLES,
    agency: { name: a.name, phone: a.phone },
  };
}

/** The client names who approves the hours. They're set up straight away and told how it works. */
export function nominateApprover(db: DB, token: string, body: Record<string, unknown>): { name: string; role: string } | null {
  const c = confirmationByToken(db, token);
  if (!c) return null;
  const { site, client } = loadSite(db, c.site_id);
  const name = v.str(body.name, 'Name', 80);
  const email = v.email(body.email, 'Email', { required: true }).toLowerCase();
  const phoneRaw = v.str(body.phone, 'Mobile', 20, { required: false });
  const phone = phoneRaw ? normaliseMobile(phoneRaw) : '';
  if (phone === null) throw new ValidationError('Please enter a UK mobile number, or leave it blank');
  const role = v.oneOf(body.role ?? 'Site manager', 'role', ROLES);
  const replace = body.replace !== false;
  const previous = siteApprovers(db, site.id).filter((m) => m.email.toLowerCase() !== email);
  let approverId = 0;
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM managers WHERE client_id = ? AND lower(email) = ?').get(client.id, email) as { id: number } | undefined;
    if (existing) {
      approverId = existing.id;
      db.prepare("UPDATE managers SET name = ?, role = ?, phone = CASE WHEN ? != '' THEN ? ELSE phone END, active = 1 WHERE id = ?").run(name, role, phone, phone, approverId);
    } else {
      approverId = Number(db.prepare('INSERT INTO managers (client_id, name, email, phone, role) VALUES (?,?,?,?,?)').run(client.id, name, email, phone, role).lastInsertRowid);
    }
    // "Instead of": the others stop getting this site's hours (they keep any other sites).
    if (replace) db.prepare('DELETE FROM manager_sites WHERE site_id = ? AND manager_id != ?').run(site.id, approverId);
    db.prepare('INSERT OR IGNORE INTO manager_sites (manager_id, site_id) VALUES (?,?)').run(approverId, site.id);
    db.prepare('UPDATE booking_confirmations SET answered_at = ?, approver_id = ? WHERE id = ?').run(nowIso(clock.now()), approverId, c.id);
  })();

  const agency = agencyRow(db);
  const login = createMagicLink(db, approverId, 'login');
  send.email({
    to: email,
    toName: name,
    kind: 'approver',
    subject: `You approve the hours for ${site.name}`,
    body: `Hi ${name.split(' ')[0]},\n\n${client.name} has asked ${agency.name} to send you the hours our workers do at ${site.name}.\n\nEach week we'll email you a link. Tap it, check the hours, and approve them in one tap, or query anything that looks wrong. There's no password or account to set up.\n\nYou can have a look now:\n\n${login}\n\nAny questions, call us on ${agency.phone}.\n\n${agency.name}`,
    link: login,
    linkLabel: 'Open SiteRoll',
  });
  if (agency.email) {
    const swapped = replace && previous.length ? `\n\nThey replace ${joinNames(previous.map(withRole))} for this site.` : '';
    send.email({
      to: agency.email,
      toName: agency.name,
      kind: 'approver',
      subject: `${client.name}: ${name} approves the hours at ${site.name}`,
      body: `${client.name} has named ${withRole({ name, role })}, ${email}, as the person who approves the hours at ${site.name}.${swapped}\n\nYou can change this in Clients & sites.`,
    });
  }
  notify({ type: 'clients', siteId: site.id });
  return { name, role };
}
