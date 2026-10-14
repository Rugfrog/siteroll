// Real email through Resend (resend.com), using its REST API directly (no SDK needed). Without a
// key, emails are only recorded in the Outbox, which is how the demo works.
import { config } from '../config';

export class EmailError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export const emailReady = () => !!(config.email.resendKey && config.email.from);

/** Reserved example domains (and the demo's made-up addresses) are never sent for real. */
export function isFictionalEmail(address: string): boolean {
  const domain = address.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return true;
  return /^example\.(com|org|net)$/.test(domain) || /(^|\.)(example|test|invalid|localhost)$/.test(domain);
}

export interface OutgoingEmail {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  fromName?: string;
  attachments?: { filename: string; content: Buffer }[];
}

const cleanName = (s: string) => s.replace(/[<>"\r\n]/g, '').trim();

/** "Agency name <address>", unless EMAIL_FROM already includes a name. */
export function fromAddress(fromName?: string): string {
  const from = config.email.from.trim();
  if (from.includes('<') || !fromName) return from;
  return `${cleanName(fromName)} <${from}>`;
}

/** Send one email. Resolves with Resend's id; throws EmailError. */
export async function resendSend(m: OutgoingEmail): Promise<string> {
  const to = m.toName ? `${cleanName(m.toName)} <${m.to}>` : m.to;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress(m.fromName),
      to: [to],
      subject: m.subject,
      text: m.text,
      html: m.html,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) } : {}),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new EmailError(data.message || `Resend said ${res.status}`, res.status);
  return data.id ?? '';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** White or near-black text, whichever reads better on the agency's colour. */
function inkOn(colour: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

/** A plain, readable HTML version of a text email: the agency's name in its colour, the text, and the link as a button. */
export function emailHtml(body: string, opts: { agencyName: string; colour: string; link?: string; linkLabel?: string }): string {
  const colour = /^#[0-9a-f]{6}$/i.test(opts.colour) ? opts.colour : '#0e6655';
  const ink = inkOn(colour);
  const blocks = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (opts.link && p === opts.link) {
        return (
          `<p style="margin:22px 0 8px"><a href="${esc(opts.link)}" style="display:inline-block;background:${colour};color:${ink};text-decoration:none;font-weight:700;padding:13px 22px;border-radius:8px">${esc(opts.linkLabel || 'Open')}</a></p>` +
          `<p style="margin:0 0 18px;font-size:13px;color:#6b7280;word-break:break-all">Or copy this link: ${esc(opts.link)}</p>`
        );
      }
      return `<p style="margin:0 0 16px">${esc(p).replace(/\n/g, '<br>')}</p>`;
    });
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f3f4f6">' +
    `<div style="max-width:560px;margin:0 auto;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#15171c">` +
    `<div style="background:${colour};color:${ink};font-weight:700;padding:14px 20px;border-radius:12px 12px 0 0">${esc(opts.agencyName)}</div>` +
    `<div style="background:#ffffff;padding:22px 20px 6px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 12px 12px">${blocks.join('')}</div>` +
    `<p style="margin:14px 4px 0;font-size:12px;color:#9ca3af">Sent by SiteRoll for ${esc(opts.agencyName)}.</p>` +
    '</div></body></html>'
  );
}
