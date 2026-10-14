// SiteRoll's WhatsApp (and text) number: what happens when someone messages it.
//   Workers:       SAFE / HELP during a fire roll call; YES / NO to a job offer
//   Site managers: APPROVE (then YES) for the week's hours; ON SITE for who's there
//   Agency staff:  anything else goes to Ask SiteRoll (Claude)
//   Anyone:        STOP for ordinary texts instead of WhatsApp, START to switch back
// One phone can be more than one of these (handy for a demo), so the most specific reply wins.
import type { DB } from '../db';
import { nowIso } from '../db';
import { clock } from '../config';
import { fmtDay, fmtHours, fmtTime } from '../../shared/format';
import { londonDate } from '../../shared/time';
import { send, type MessageKind } from './messaging';
import type { PhoneChannel } from './twilio';
import { alarmForWorker, AlarmError, markFromPhone } from './firealarm';
import { approveTimesheet, getTimesheetView, TimesheetError, type TimesheetRow } from './timesheets';
import { liveBoard } from './board';
import { agencyRow, arrivalNote, availableReplacements, createMagicLink, sendReplacement } from './workflows';
import { askDeps, runAsk, type AskTurn } from './ask';
import { notify } from './events';
import { fullName, type SiteRow, type WorkerRow } from './rules';

export interface Incoming {
  phone: string; // UK mobile, 07…
  channel: PhoneChannel;
  body: string;
}

interface Manager {
  id: number;
  client_id: number;
  name: string;
  phone: string;
}
interface Staff {
  id: number;
  name: string;
}

const YES = /^(Y|YES|YEAH|YEP|YUP|OK|OKAY|AYE|SURE|GO ON|YES PLEASE|ILL TAKE IT|ILL DO IT)$/;
const NO = /^(N|NO|NAH|NOPE|NO THANKS|CANT|CAN NOT|CANNOT)$/;
const SAFE = /^(SAFE|IM SAFE|I AM SAFE|SAFE NOW|IM SAFE NOW|OK SAFE|ALL GOOD|IM OUT|IM OUT SAFE|AT MUSTER POINT|AT THE MUSTER POINT)$/;
const HELP = /^(HELP|I NEED HELP|NEED HELP|SOS)$/;

/** WhatsApp formatting: *bold*, no Markdown headings, sensible length. */
export function toWhatsApp(text: string): string[] {
  const t = text
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/^#+\s*/gm, '')
    .trim();
  if (t.length <= 1500) return [t];
  const parts: string[] = [];
  let cur = '';
  for (const para of t.split(/\n\n/)) {
    if ((cur + '\n\n' + para).length > 1500 && cur) {
      parts.push(cur);
      cur = para;
    } else cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) parts.push(cur);
  return parts.slice(0, 3).map((p) => p.slice(0, 1550));
}

function getState(db: DB, phone: string): { kind: string; data: any } | null {
  const row = db.prepare('SELECT * FROM chat_state WHERE phone = ? AND expires_at > ?').get(phone, nowIso(clock.now())) as { kind: string; data: string } | undefined;
  return row ? { kind: row.kind, data: JSON.parse(row.data) } : null;
}
function setState(db: DB, phone: string, kind: string, data: unknown, minutes = 30) {
  db.prepare('INSERT OR REPLACE INTO chat_state (phone, kind, data, expires_at) VALUES (?,?,?,?)').run(
    phone,
    kind,
    JSON.stringify(data),
    new Date(clock.now().getTime() + minutes * 60000).toISOString(),
  );
}
const clearState = (db: DB, phone: string) => db.prepare('DELETE FROM chat_state WHERE phone = ?').run(phone);

/** Handle one incoming message. Returns what it was handled as (for the log). */
export async function handleIncoming(db: DB, msg: Incoming): Promise<string> {
  const phone = msg.phone;
  const text = msg.body.trim().slice(0, 1000);
  const cmd = text.toUpperCase().replace(/[’']/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const inboxId = Number(db.prepare('INSERT INTO inbox (phone, channel, body, created_at) VALUES (?,?,?,?)').run(phone, msg.channel, text, nowIso(clock.now())).lastInsertRowid);
  notify({ type: 'alert' });

  const worker = db.prepare('SELECT * FROM workers WHERE phone = ? AND active = 1').get(phone) as WorkerRow | undefined;
  const manager = db.prepare('SELECT * FROM managers WHERE phone = ? AND active = 1').get(phone) as Manager | undefined;
  const staff = db.prepare('SELECT id, name FROM users WHERE phone = ?').get(phone) as Staff | undefined;
  const name = staff?.name ?? manager?.name ?? (worker ? fullName(worker) : '');
  const first = name.split(' ')[0] || 'there';
  const agency = agencyRow(db);
  const reply = (body: string, kind: MessageKind = 'chat') => {
    for (const part of toWhatsApp(body)) send.sms({ to: phone, toName: name, body: part, kind, channel: msg.channel });
  };
  const done = (as: string) => {
    db.prepare('UPDATE inbox SET handled_as = ? WHERE id = ?').run(as, inboxId);
    return as;
  };

  // STOP / START: WhatsApp or ordinary texts.
  if (/^(STOP|UNSUBSCRIBE|STOP WHATSAPP)$/.test(cmd)) {
    db.prepare('INSERT OR IGNORE INTO wa_optouts (phone, created_at) VALUES (?,?)').run(phone, nowIso(clock.now()));
    reply("Done. We'll send you ordinary texts instead of WhatsApp messages. Reply START to switch back.");
    return done('stop');
  }
  if (/^(START|UNSTOP)$/.test(cmd)) {
    db.prepare('DELETE FROM wa_optouts WHERE phone = ?').run(phone);
    reply(`You're back on WhatsApp messages from ${agency.name}.`);
    return done('start');
  }

  if (!worker && !manager && !staff) {
    reply(`This number isn't registered with ${agency.name}. If you work with us, call the office on ${agency.phone}.`);
    return done('unknown');
  }

  // 1. Fire roll call: SAFE / HELP.
  if (worker) {
    const alarm = alarmForWorker(db, worker.id);
    if (alarm && (SAFE.test(cmd) || HELP.test(cmd))) {
      try {
        const a = markFromPhone(db, alarm, HELP.test(cmd) ? 'help' : 'safe');
        reply(
          a.status === 'safe'
            ? `✅ Thanks ${first}, you're marked safe at ${fmtTime(a.safeAt)}. Stay at the muster point until the site manager says it's clear.`
            : "🆘 We've told the site manager you need help. Stay where you are if it's safe to. If you're in danger, call 999.",
        );
      } catch (e) {
        if (!(e instanceof AlarmError)) throw e;
        reply(e.message);
      }
      return done('fire');
    }
    if (alarm && alarm.status === 'pending' && !YES.test(cmd) && !NO.test(cmd)) {
      reply(`🔥 There's a fire roll call at ${alarm.site}. Reply SAFE when you're at the muster point, or HELP if you need help.`);
      return done('fire');
    }
  }

  // 2. A job offer: YES / NO.
  if (worker && (YES.test(cmd) || NO.test(cmd))) {
    const offer = db
      .prepare("SELECT * FROM job_offers WHERE worker_id = ? AND status IN ('open','filled') AND date = ? ORDER BY sent_at DESC LIMIT 1")
      .get(worker.id, londonDate(clock.now())) as { id: number; alert_id: number; status: string; site_id: number } | undefined;
    if (offer) {
      if (NO.test(cmd)) {
        db.prepare("UPDATE job_offers SET status = 'declined', responded_at = ? WHERE id = ? AND status = 'open'").run(nowIso(clock.now()), offer.id);
        reply(`No problem ${first}, thanks for letting us know.`);
        return done('offer-no');
      }
      if (offer.status === 'filled') {
        reply(`Sorry ${first}, that one's been taken. Thanks for coming back so quickly. We'll be in touch next time.`);
        return done('offer-late');
      }
      const r = sendReplacement(db, offer.alert_id, worker.id, `${fullName(worker)} (replied YES on WhatsApp)`, { tellReplacement: false });
      if (!r.ok) {
        db.prepare("UPDATE job_offers SET status = 'filled', responded_at = ? WHERE id = ?").run(nowIso(clock.now()), offer.id);
        reply(`Sorry ${first}, that one's been taken. Thanks for coming back so quickly.`);
        return done('offer-late');
      }
      const now = nowIso(clock.now());
      db.prepare("UPDATE job_offers SET status = 'won', responded_at = ? WHERE id = ?").run(now, offer.id);
      db.prepare("UPDATE job_offers SET status = 'filled' WHERE alert_id = ? AND status = 'open' AND id != ?").run(offer.alert_id, offer.id);
      const s = r.site!;
      reply(`👍 It's yours, ${first}. Get to *${s.name}* today: ${s.address}, ${s.postcode}. ${arrivalNote(s)} Thanks, ${agency.name}`);
      return done('offer-yes');
    }
  }

  // 3. Site manager: approve the week, or see who's on site.
  if (manager) {
    const state = getState(db, phone);
    if (state?.kind === 'approve' && YES.test(cmd)) {
      clearState(db, phone);
      const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(manager.client_id) as { name: string };
      try {
        const v = approveTimesheet(db, state.data.timesheetId, {
          managerId: manager.id,
          name: `${manager.name} (${client.name})`,
          device: `WhatsApp reply from ${phone}`,
        });
        notify({ type: 'timesheet', siteId: v.site.id });
        reply(`✅ Approved: ${v.site.name}, ${v.totals.workers} workers, ${fmtHours(v.totals.totalMins)} hours for the week of ${fmtDay(v.weekStart)}. Thanks ${first}. It's now locked.`);
      } catch (e) {
        if (!(e instanceof TimesheetError)) throw e;
        reply(e.message);
      }
      return done('approve');
    }
    if (/^(APPROVE|APPROVE ALL|APPROVED)$/.test(cmd)) {
      const pending = db
        .prepare(
          `SELECT t.* FROM timesheets t JOIN manager_sites ms ON ms.site_id = t.site_id
           WHERE ms.manager_id = ? AND t.status IN ('sent','queried') ORDER BY t.week_start, t.id`,
        )
        .all(manager.id) as TimesheetRow[];
      if (!pending.length) {
        reply('Nothing is waiting for you to approve right now.');
        return done('approve-none');
      }
      const ts = pending[0];
      const v = getTimesheetView(db, ts.site_id, ts.week_start);
      if (v.queried) {
        reply(`${v.site.name} (week of ${fmtDay(ts.week_start)}) has ${v.queried} queried ${v.queried === 1 ? 'entry' : 'entries'}. ${agency.name} will sort ${v.queried === 1 ? 'it' : 'them'} out and send it back to you.`);
        return done('approve-queried');
      }
      setState(db, phone, 'approve', { timesheetId: ts.id });
      const link = createMagicLink(db, manager.id, 'signoff', ts.id);
      reply(
        `Approve ${v.site.name}: ${v.totals.workers} workers, ${fmtHours(v.totals.totalMins)} hours for the week of ${fmtDay(ts.week_start)}?\n\nReply *YES* to approve them all, or check them first: ${link}`,
      );
      return done('approve-ask');
    }
    if (/^(ON SITE|WHOS ON SITE|WHO IS ON SITE|WHO|ONSITE|ROLL)$/.test(cmd) || (!staff && !worker)) {
      const siteIds = (db.prepare('SELECT site_id FROM manager_sites WHERE manager_id = ?').all(manager.id) as { site_id: number }[]).map((r) => r.site_id);
      const board = liveBoard(db, siteIds);
      const lines = board.sites.map((s) => {
        const missing = s.expected.map((e) => e.name);
        return `*${s.name}*: ${s.onSite.length} on site.${missing.length ? ` Not here yet: ${missing.join(', ')}.` : ''}`;
      });
      reply(
        /^(ON SITE|WHOS ON SITE|WHO IS ON SITE|WHO|ONSITE|ROLL)$/.test(cmd)
          ? lines.join('\n') || 'None of your sites are open today.'
          : `Hi ${first}. Reply *ON SITE* to see who's on your sites, or *APPROVE* to approve this week's hours.\n\n${lines.join('\n')}`,
      );
      return done('manager');
    }
  }

  // 4. Agency staff: Ask SiteRoll.
  if (staff) {
    if (!askDeps.configured()) {
      reply('Ask SiteRoll needs a Claude API key to answer questions. Add ANTHROPIC_API_KEY in the settings.');
      return done('ask-off');
    }
    const history = recentTurns(db, phone, inboxId);
    let answer = '';
    let error = '';
    await runAsk(
      db,
      text,
      history,
      (e) => {
        if (e.type === 'answer') answer = e.text;
        if (e.type === 'error') error = e.message;
      },
      askDeps.toolRunner,
    ).catch((e) => {
      console.error('Ask SiteRoll on WhatsApp failed:', e);
      error = 'Something went wrong. Please try again.';
    });
    reply(answer || error || "Sorry, I couldn't answer that.");
    return done('ask');
  }

  // 5. A worker with nothing pending.
  if (worker) {
    reply(
      `Hi ${first} 👋 This is ${agency.name}'s SiteRoll number. To sign in on site, scan the board with your phone camera. If there's a fire roll call, reply SAFE or HELP here. Anything else, call the office on ${agency.phone}.`,
    );
    return done('worker-help');
  }
  return done('nothing');
}

/** The last few messages with this person, so follow-up questions make sense. */
function recentTurns(db: DB, phone: string, excludeInboxId: number): AskTurn[] {
  const ins = db.prepare("SELECT body AS text, created_at FROM inbox WHERE phone = ? AND handled_as = 'ask' AND id != ? ORDER BY id DESC LIMIT 4").all(phone, excludeInboxId) as {
    text: string;
    created_at: string;
  }[];
  const outs = db.prepare("SELECT body AS text, created_at FROM outbox WHERE recipient = ? AND kind = 'chat' ORDER BY id DESC LIMIT 4").all(phone) as { text: string; created_at: string }[];
  const merged = [...ins.map((m) => ({ role: 'user' as const, ...m })), ...outs.map((m) => ({ role: 'assistant' as const, ...m }))].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  // Must alternate user/assistant, starting with the user.
  const turns: AskTurn[] = [];
  for (const m of merged) {
    if (turns.length && turns[turns.length - 1].role === m.role) turns[turns.length - 1].text += `\n${m.text}`;
    else turns.push({ role: m.role, text: m.text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns.slice(-8);
}

/* ---------------- Job offers: first to reply YES gets it ---------------- */

/** Offer a no-show's place to free workers of the same trade (or the ones given). Returns how many were asked. */
export function offerJob(db: DB, alertId: number, workerIds?: number[]): number {
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ? AND type = 'no_show' AND resolved_at IS NULL").get(alertId) as
    | { id: number; site_id: number; date: string; worker_id: number }
    | undefined;
  if (!alert) return 0;
  const options = availableReplacements(db, alertId);
  if (!options) return 0;
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(alert.site_id) as SiteRow;
  const agency = agencyRow(db);
  const chosen = options.workers.filter((w) => w.card !== 'expired' && (workerIds ? workerIds.includes(w.id) : w.sameTrade));
  const now = nowIso(clock.now());
  for (const w of chosen) {
    const already = db.prepare("SELECT 1 FROM job_offers WHERE alert_id = ? AND worker_id = ?").get(alertId, w.id);
    if (already) continue;
    db.prepare('INSERT INTO job_offers (alert_id, worker_id, site_id, date, status, sent_at) VALUES (?,?,?,?,?,?)').run(alertId, w.id, site.id, alert.date, 'open', now);
    const wr = db.prepare('SELECT * FROM workers WHERE id = ?').get(w.id) as WorkerRow;
    send.sms({
      to: wr.phone,
      toName: w.name,
      kind: 'offer',
      body: `Hi ${wr.first_name}, work today: ${options.trade.toLowerCase()} needed at ${site.name} (${site.postcode}), start as soon as you can. Reply *YES* to take it. First to reply gets it. ${agency.name}`,
    });
  }
  if (chosen.length) notify({ type: 'alert', siteId: site.id });
  return chosen.length;
}
