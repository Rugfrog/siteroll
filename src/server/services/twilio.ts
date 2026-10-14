// Twilio: sends WhatsApp messages and ordinary texts, and checks that incoming webhooks really
// came from Twilio. Uses Twilio's REST API directly (no SDK needed).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export type PhoneChannel = 'whatsapp' | 'sms';

export class TwilioError extends Error {
  constructor(message: string, public code?: number, public status?: number) {
    super(message);
  }
}

export const twilioReady = (channel: PhoneChannel) => {
  const t = config.twilio;
  return !!(t.accountSid && t.authToken && (channel === 'whatsapp' ? t.whatsappFrom : t.smsFrom));
};

/** '07700 900123' → '+447700900123' */
export function toE164(ukMobile: string): string {
  const p = ukMobile.replace(/\s+/g, '');
  return p.startsWith('0') ? `+44${p.slice(1)}` : p.startsWith('+') ? p : `+${p}`;
}

/** Ofcom's drama range (07700 900000–900999) is never a real phone: always simulate those. */
export const isFictional = (ukMobile: string) => /^07700900\d{3}$/.test(ukMobile.replace(/\s+/g, ''));

/** Send one message. Resolves with Twilio's message id; throws TwilioError. */
export async function twilioSend(channel: PhoneChannel, toUk: string, body: string): Promise<string> {
  const t = config.twilio;
  const from = channel === 'whatsapp' ? (t.whatsappFrom.startsWith('whatsapp:') ? t.whatsappFrom : `whatsapp:${t.whatsappFrom}`) : t.smsFrom;
  const to = channel === 'whatsapp' ? `whatsapp:${toE164(toUk)}` : toE164(toUk);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body.slice(0, 1600) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok) throw new TwilioError(data.message || `Twilio said ${res.status}`, data.code, res.status);
  return data.sid ?? '';
}

/**
 * Twilio signs each webhook: base64(HMAC-SHA1(auth token, full URL + each POST parameter's name and
 * value, sorted by name)). See https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature || !config.twilio.authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', config.twilio.authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
