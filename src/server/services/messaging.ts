// Every text, WhatsApp message and email goes through here. Each one is recorded in the Outbox.
// Messages to phones go by WhatsApp first (unless the agency prefers texts, or the person replied
// STOP), falling back to an ordinary text. They're only really sent when Twilio is set up, and
// emails only when Resend is; otherwise they're simulated, which is how the demo works.
import { getDb, nowIso } from '../db';
import { clock } from '../config';
import { isFictional, twilioReady, twilioSend, type PhoneChannel } from './twilio';
import { emailHtml, emailReady, isFictionalEmail, resendSend } from './email';

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
  | 'booking'
  | 'approver'
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
  /** The button text for `link` in the HTML version, e.g. "Check and approve the hours". */
  linkLabel?: string;
  /** Attach this invoice as a PDF (only when really sending; the Outbox link opens it). */
  attachInvoiceId?: number;
}

export interface Messenger {
  sms(msg: SmsMessage): void;
  email(msg: EmailMessage): void;
}

/** Swapped out in tests so nothing goes over the network. */
export const transportDeps = { send: twilioSend };
export const emailTransportDeps = { send: resendSend };

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

async function deliverEmail(id: number, msg: EmailMessage) {
  try {
    const db = getDb();
    const a = db.prepare('SELECT name, email, brand_colour FROM agency WHERE id = 1').get() as { name: string; email: string; brand_colour: string } | undefined;
    const agencyName = a?.name ?? 'SiteRoll';
    const attachments: { filename: string; content: Buffer }[] = [];
    if (msg.attachInvoiceId) {
      // Loaded here rather than at the top, so the PDF code isn't pulled into every import of this file.
      const { invoicePdf } = await import('../pdf/documents');
      const inv = db.prepare('SELECT number FROM invoices WHERE id = ?').get(msg.attachInvoiceId) as { number: string } | undefined;
      if (inv) attachments.push({ filename: `${inv.number}.pdf`, content: await invoicePdf(db, msg.attachInvoiceId) });
    }
    await emailTransportDeps.send({
      to: msg.to,
      toName: msg.toName,
      subject: msg.subject,
      text: msg.body,
      html: emailHtml(msg.body, { agencyName, colour: a?.brand_colour ?? '#0e6655', link: msg.link, linkLabel: msg.linkLabel }),
      // Replies go to the agency's office, not to SiteRoll.
      replyTo: a?.email && !isFictionalEmail(a.email) ? a.email : undefined,
      fromName: agencyName,
      attachments,
    });
    setStatus(id, 'sent');
  } catch (e) {
    setStatus(id, 'failed', (e as Error).message);
    console.error(`Email to ${msg.to} failed:`, (e as Error).message);
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
    // Made-up demo addresses (…@calder.example) are never sent for real.
    const real = emailReady() && !isFictionalEmail(msg.to);
    const id = record('email', msg, msg.subject, real ? 'sending' : 'simulated');
    if (real) void deliverEmail(id, msg);
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
