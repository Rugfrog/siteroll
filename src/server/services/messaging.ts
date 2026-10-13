// Texts and emails go through this interface. The demo uses SimulatedMessenger, which writes
// everything to the Outbox table. To go live, write e.g. a TwilioMessenger with the same two
// methods and pass it to setMessenger() at start-up.
import { getDb, nowIso } from '../db';
import { clock } from '../config';

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
  | 'other';

export interface SmsMessage {
  to: string;
  toName?: string;
  body: string;
  kind: MessageKind;
  link?: string;
}

export interface EmailMessage extends SmsMessage {
  subject: string;
}

export interface Messenger {
  sms(msg: SmsMessage): void;
  email(msg: EmailMessage): void;
}

export class SimulatedMessenger implements Messenger {
  sms(msg: SmsMessage) {
    this.store('sms', msg, '');
  }
  email(msg: EmailMessage) {
    this.store('email', msg, msg.subject);
  }
  private store(channel: 'sms' | 'email', msg: SmsMessage, subject: string) {
    getDb()
      .prepare('INSERT INTO outbox (channel, recipient, recipient_name, subject, body, kind, link, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(channel, msg.to, msg.toName ?? '', subject, msg.body, msg.kind, msg.link ?? null, nowIso(clock.now()));
  }
}

let messenger: Messenger = new SimulatedMessenger();

export function setMessenger(m: Messenger) {
  messenger = m;
}

export const send = {
  sms: (m: SmsMessage) => messenger.sms(m),
  email: (m: EmailMessage) => messenger.email(m),
};
