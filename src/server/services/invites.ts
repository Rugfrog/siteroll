// Invite links for a demo that's invite-only (AGENCY_PASSWORD is set). Each link is signed rather
// than stored, so links keep working when the free hosting plan restarts and forgets its disk.
// Changing AGENCY_PASSWORD cancels every link at once.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { clock, config } from '../config';

const signingKey = () => createHmac('sha256', 'siteroll-invite-links').update(config.agencyPassword).digest();
const sign = (payload: string) => createHmac('sha256', signingKey()).update(payload).digest('base64url').slice(0, 32);

/** A token for /invite/<token>, valid for this many days. */
export function createInvite(name: string, days: number): { token: string; expires: Date } {
  const expires = new Date(clock.now().getTime() + days * 86400000);
  const payload = Buffer.from(JSON.stringify({ n: name.slice(0, 60), e: Math.floor(expires.getTime() / 1000) })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, expires };
}

/** Who the invite is for, if it's genuine and hasn't expired. */
export function readInvite(token: string): { name: string; expires: Date } | null {
  if (!config.inviteOnly || typeof token !== 'string' || token.length > 400) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { n, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { n: unknown; e: unknown };
    if (typeof n !== 'string' || typeof e !== 'number' || e * 1000 < clock.now().getTime()) return null;
    return { name: n, expires: new Date(e * 1000) };
  } catch {
    return null;
  }
}
