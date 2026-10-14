// Every text, WhatsApp message and email goes through here. Each one is recorded in the Outbox.
// Messages to phones go by WhatsApp first (unless the agency prefers texts, or the person replied
// STOP), falling back to an ordinary text. They're only really sent when Twilio is set up;
// otherwise they're simulated, which is how the demo works.
import { getDb, nowIso } from '../db';
import { clock } from '../config';
import { isFictional, twilioReady, twilioSend, type PhoneChannel } from './twilio';

export type MessageKind =
  | 'code'
  | 'no_show'
  | 'signoff'
  | 'invoice'
  | 'magic_link'
  | 'replacement'
  | 'missed_signout'
  | 'compliance'
  | 'manual_request'
  | 'query'
  | 'fire'
  | 'offer'
  | 'chat'
  | 'test'
  | 'other';

export interface SmsMessage {
  to: string;
  toName?: string;
  body: string;
  kind: MessageKind;
  link?: string;
  /** Force a channel, e.g. to reply on the one the person used. */
  channel?: PhoneChannel;
}

export interface EmailMessage extends SmsMessage {
  subject: string;
}

export interface Messenger {
  sms(msg: SmsMessage): void;
  email(msg: EmailMessage): void;
}

/** Swapped out in tests so nothing goes over the network. */
export const transportDeps = { send: twilioSend };

/** Which channel to use for this phone: WhatsApp unless the agency prefers texts or they opted out. */
export function phoneChannel(to: string): PhoneChannel {
  const db = getDb();
  const a = db.prepare('SELECT message_channel FROM agency WHERE id = 1').get() as { message_channel?: string } | undefined;
  if (a?.message_channel === 'sms') return 'sms';
  if (db.prepare('SELECT 1 FROM wa_optouts WHERE phone = ?').get(to)) return 'sms';
  return 'whatsapp';
}

function record(channel: string, msg: SmsMessage, subject: string, status: string): number {
  const r = getDb()
    .prepare('INSERT INTO outbox (channel, recipient, recipient_name, subject, body, kind, link, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(channel, msg.to, msg.toName ?? '', subject, msg.body, msg.kind, msg.link ?? null, nowIso(clock.now()), status);
  return Number(r.lastInsertRowid);
}

function setStatus(id: number, status: string, error: string | null = null, channel?: string) {
  getDb()
    .prepare('UPDATE outbox SET status = ?, error = ?, channel = COALESCE(?, channel) WHERE id = ?')
    .run(status, error, channel ?? null, id);
}

async function deliver(id: number, channel: PhoneChannel, msg: SmsMessage) {
  try {
    if (!twilioReady(channel)) throw new Error(`No Twilio ${channel === 'whatsapp' ? 'WhatsApp sender' : 'phone number'} set up`);
    await transportDeps.send(channel, msg.to, msg.body);
    setStatus(id, 'sent');
  } catch (e) {
    // WhatsApp didn't go (for example they haven't messaged us in the last 24 hours): try a text.
    if (channel === 'whatsapp' && twilioReady('sms')) {
      try {
        await transportDeps.send('sms', msg.to, msg.body);
        setStatus(id, 'sent', `WhatsApp failed (${(e as Error).message}), sent as a text`, 'sms');
        return;
      } catch (e2) {
        setStatus(id, 'failed', (e2 as Error).message);
        return;
      }
    }
    setStatus(id, 'failed', (e as Error).message);
    console.error(`Message to ${msg.to} failed:`, (e as Error).message);
  }
}

export class OutboxMessenger implements Messenger {
  sms(msg: SmsMessage) {
    const channel = msg.channel ?? phoneChannel(msg.to);
    // Made-up demo numbers are never sent for real.
    const real = !isFictional(msg.to) && (twilioReady(channel) || (channel === 'whatsapp' && twilioReady('sms')));
    const id = record(channel, msg, '', real ? 'sending' : 'simulated');
    if (real) void deliver(id, channel, msg);
  }
  email(msg: EmailMessage) {
    // Email isn't connected to a provider yet: recorded in the Outbox only.
    record('email', msg, msg.subject, 'simulated');
  }
}

let messenger: Messenger = new OutboxMessenger();

export function setMessenger(m: Messenger) {
  messenger = m;
}

export const send = {
  /** A message to someone's phone: WhatsApp first, or a text. */
  sms: (m: SmsMessage) => messenger.sms(m),
  email: (m: EmailMessage) => messenger.email(m),
};
