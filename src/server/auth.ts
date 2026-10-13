// Sessions for agency staff and client site managers, and the long-lived device cookie for workers.
import type { NextFunction, Request, Response } from 'express';
import { getDb, nowIso } from './db';
import { clock, config } from './config';
import { hashToken, randomToken } from './lib/security';

/** Agency staff and client managers have separate cookies, so one browser can hold both
 *  (handy in a demo: agency dashboard in one tab, the site manager's view in another). */
export const SESSION_COOKIE = 'sr_sess';
export const MANAGER_COOKIE = 'sr_msess';
const cookieFor = (type: 'agency' | 'manager') => (type === 'agency' ? SESSION_COOKIE : MANAGER_COOKIE);
export const DEVICE_COOKIE = 'sr_dev';

export interface AuthUser {
  type: 'agency' | 'manager';
  id: number;
  name: string;
  clientId: number | null;
  /** null = every site (agency); otherwise the manager's sites */
  siteIds: number[] | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function cookieOptions(req: Request, maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: req.secure || config.https || config.publicUrl.startsWith('https://'),
    maxAge: maxAgeMs,
    path: '/',
  };
}

export function startSession(req: Request, res: Response, type: 'agency' | 'manager', userId: number) {
  const token = randomToken(32);
  const days = type === 'agency' ? 14 : 30;
  const now = clock.now();
  getDb()
    .prepare('INSERT INTO sessions (token_hash, user_type, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?,?)')
    .run(hashToken(token), type, userId, nowIso(now), new Date(now.getTime() + days * 86400000).toISOString(), String(req.get('user-agent') || '').slice(0, 300));
  res.cookie(cookieFor(type), token, cookieOptions(req, days * 86400000));
}

export function endSession(req: Request, res: Response) {
  const type = req.user?.type ?? 'agency';
  const token = req.cookies?.[cookieFor(type)];
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(cookieFor(type), { path: '/' });
}

function userFromCookie(token: unknown, type: 'agency' | 'manager'): AuthUser | undefined {
  if (typeof token !== 'string' || token.length < 20) return undefined;
  const db = getDb();
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND user_type = ? AND expires_at > ?').get(hashToken(token), type, nowIso(clock.now())) as { user_id: number } | undefined;
  if (!s) return undefined;
  if (type === 'agency') {
    const u = db.prepare('SELECT id, name FROM users WHERE id = ?').get(s.user_id) as { id: number; name: string } | undefined;
    return u ? { type: 'agency', id: u.id, name: u.name, clientId: null, siteIds: null } : undefined;
  }
  const m = db.prepare('SELECT id, name, client_id FROM managers WHERE id = ? AND active = 1').get(s.user_id) as { id: number; name: string; client_id: number } | undefined;
  if (!m) return undefined;
  const siteIds = (db.prepare('SELECT site_id FROM manager_sites WHERE manager_id = ?').all(m.id) as { site_id: number }[]).map((r) => r.site_id);
  return { type: 'manager', id: m.id, name: m.name, clientId: m.client_id, siteIds };
}

/** Which session to use: the page says which role it's acting as (header, or ?as= for event streams). */
export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const want = req.get('x-siteroll-as') ?? (typeof req.query.as === 'string' ? req.query.as : undefined);
  const order: ('agency' | 'manager')[] = want === 'manager' ? ['manager', 'agency'] : ['agency', 'manager'];
  for (const type of order) {
    const u = userFromCookie(req.cookies?.[cookieFor(type)], type);
    if (u) {
      req.user = u;
      break;
    }
  }
  next();
}

export function requireAgency(req: Request, res: Response, next: NextFunction) {
  if (req.user?.type !== 'agency') return res.status(req.user ? 403 : 401).json({ error: req.user ? 'Agency staff only' : 'Please log in' });
  next();
}

export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  next();
}

/** Can this user see this site? Agency: all. Manager: only their own sites. */
export function canSeeSite(user: AuthUser | undefined, siteId: number): boolean {
  if (!user) return false;
  return user.siteIds === null || user.siteIds.includes(siteId);
}

export function actorName(user: AuthUser): string {
  if (user.type === 'agency') return `${user.name} (agency)`;
  const c = getDb().prepare('SELECT name FROM clients WHERE id = ?').get(user.clientId) as { name: string } | undefined;
  return `${user.name} (${c?.name ?? 'client'})`;
}

/** Remembered phone → worker id */
export function deviceWorker(req: Request): number | null {
  const token = req.cookies?.[DEVICE_COOKIE];
  if (typeof token !== 'string' || token.length < 20) return null;
  const db = getDb();
  const d = db.prepare('SELECT d.id, d.worker_id FROM devices d JOIN workers w ON w.id = d.worker_id WHERE d.token_hash = ? AND w.active = 1').get(hashToken(token)) as
    | { id: number; worker_id: number }
    | undefined;
  if (!d) return null;
  db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(nowIso(clock.now()), d.id);
  return d.worker_id;
}

export function rememberDevice(req: Request, res: Response, workerId: number) {
  const token = randomToken(32);
  const now = nowIso(clock.now());
  getDb()
    .prepare('INSERT INTO devices (worker_id, token_hash, user_agent, created_at, last_seen_at) VALUES (?,?,?,?,?)')
    .run(workerId, hashToken(token), String(req.get('user-agent') || '').slice(0, 300), now, now);
  // Browsers cap cookie lifetime at about 400 days.
  res.cookie(DEVICE_COOKIE, token, cookieOptions(req, 400 * 86400000));
}
