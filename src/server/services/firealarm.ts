// Fire alarm to every phone: when a roll call starts, everyone signed in on that site gets a text
// (and a push notification if they've turned fire alerts on) with a personal "I'm safe" link.
// Their sign-in page also turns into a full-screen alarm if it's open.
import type { DB } from '../db';
import { nowIso } from '../db';
import { clock } from '../config';
import { hashToken, randomToken } from '../lib/security';
import { fmtTime } from '../../shared/format';
import { notify } from './events';
import { send } from './messaging';
import { pushToWorker } from './push';
import { agencyRow, runtime } from './workflows';

export type AlarmStatus = 'pending' | 'safe' | 'help';

export interface AlarmInfo {
  personId: number;
  rollCallId: number;
  siteId: number;
  site: string;
  name: string;
  startedAt: string;
  finished: boolean;
  status: AlarmStatus;
  safeAt: string | null;
  helpAt: string | null;
  total: number;
  safe: number;
}

interface PersonRow {
  id: number;
  roll_call_id: number;
  worker_id: number | null;
  name: string;
  safe_at: string | null;
  help_at: string | null;
  site_id: number;
  site_name: string;
  started_at: string;
  finished_at: string | null;
}

const PERSON_SQL = `SELECT p.id, p.roll_call_id, p.worker_id, p.name, p.safe_at, p.help_at, r.site_id, s.name AS site_name, r.started_at, r.finished_at
  FROM roll_call_people p JOIN roll_calls r ON r.id = p.roll_call_id JOIN sites s ON s.id = r.site_id`;

function info(db: DB, p: PersonRow): AlarmInfo {
  const counts = db.prepare('SELECT COUNT(*) AS total, COUNT(safe_at) AS safe FROM roll_call_people WHERE roll_call_id = ?').get(p.roll_call_id) as { total: number; safe: number };
  return {
    personId: p.id,
    rollCallId: p.roll_call_id,
    siteId: p.site_id,
    site: p.site_name,
    name: p.name,
    startedAt: p.started_at,
    finished: !!p.finished_at,
    status: p.safe_at ? 'safe' : p.help_at ? 'help' : 'pending',
    safeAt: p.safe_at,
    helpAt: p.help_at,
    total: counts.total,
    safe: counts.safe,
  };
}

/** Text (and push) everyone in a new roll call. Returns how many people were alerted. */
export function raiseAlarm(db: DB, rollCallId: number): number {
  const people = db
    .prepare(
      `SELECT p.id, p.worker_id, w.first_name, w.last_name, w.phone, s.name AS site_name
       FROM roll_call_people p JOIN workers w ON w.id = p.worker_id JOIN roll_calls r ON r.id = p.roll_call_id JOIN sites s ON s.id = r.site_id
       WHERE p.roll_call_id = ? AND p.worker_id IS NOT NULL`,
    )
    .all(rollCallId) as { id: number; worker_id: number; first_name: string; last_name: string; phone: string; site_name: string }[];
  for (const p of people) {
    const token = randomToken(24);
    db.prepare('UPDATE roll_call_people SET alert_token_hash = ? WHERE id = ?').run(hashToken(token), p.id);
    const path = `/safe/${token}`;
    send.sms({
      to: p.phone,
      toName: `${p.first_name} ${p.last_name}`,
      kind: 'fire',
      body: `FIRE ALARM at ${p.site_name}. Leave by the nearest safe exit and go to the muster point now. When you're there, tap to say you're safe: ${runtime.baseUrl}${path}`,
      link: `${runtime.baseUrl}${path}`,
    });
    // Fire and forget: a slow push service must never hold up the roll call.
    void pushToWorker(db, p.worker_id, {
      title: `🔥 FIRE ALARM – ${p.site_name}`,
      body: "Go to the muster point now. Tap here to say you're safe.",
      url: path,
      tag: `rollcall-${rollCallId}`,
    });
  }
  return people.length;
}

/** The roll call this worker is in right now, if any. */
export function alarmForWorker(db: DB, workerId: number): AlarmInfo | null {
  const p = db.prepare(`${PERSON_SQL} WHERE p.worker_id = ? AND r.finished_at IS NULL ORDER BY r.started_at DESC LIMIT 1`).get(workerId) as PersonRow | undefined;
  return p ? info(db, p) : null;
}

/** From the personal link in the text. Works even after the roll call has finished (to say so). */
export function alarmForToken(db: DB, token: string): AlarmInfo | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const p = db.prepare(`${PERSON_SQL} WHERE p.alert_token_hash = ?`).get(hashToken(token)) as PersonRow | undefined;
  return p ? info(db, p) : null;
}

export class AlarmError extends Error {}

/** The worker tapped "I'm safe" or "I need help" on their phone. */
export function markFromPhone(db: DB, a: AlarmInfo, status: 'safe' | 'help'): AlarmInfo {
  if (a.finished) throw new AlarmError('This roll call has finished. Follow the site manager’s instructions.');
  const now = nowIso(clock.now());
  if (status === 'safe') {
    db.prepare("UPDATE roll_call_people SET safe_at = COALESCE(safe_at, ?), safe_by = COALESCE(safe_by, 'phone') WHERE id = ?").run(now, a.personId);
  } else {
    db.prepare('UPDATE roll_call_people SET help_at = ?, safe_at = NULL, safe_by = NULL WHERE id = ?').run(now, a.personId);
    // Tell the people who can do something about it, straight away.
    const managers = db.prepare('SELECT m.name, m.phone FROM managers m JOIN manager_sites ms ON ms.manager_id = m.id WHERE ms.site_id = ? AND m.active = 1').all(a.siteId) as { name: string; phone: string }[];
    const staff = db.prepare("SELECT name, phone FROM users WHERE phone LIKE '07%'").all() as { name: string; phone: string }[];
    for (const m of [...managers, ...staff]) {
      if (m.phone)
        send.sms({ to: m.phone, toName: m.name, kind: 'fire', body: `HELP NEEDED: ${a.name} tapped "I need help" during the fire roll call at ${a.site} (${fmtTime(now)}). Agency: ${agencyRow(db)?.name ?? ''}.` });
    }
  }
  notify({ type: 'rollcall', siteId: a.siteId });
  const p = db.prepare(`${PERSON_SQL} WHERE p.id = ?`).get(a.personId) as PersonRow;
  return info(db, p);
}
