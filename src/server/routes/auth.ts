import { Router } from 'express';
import { getDb, nowIso } from '../db';
import { clock, config } from '../config';
import { RateLimiter, hashToken, verifyPassword } from '../lib/security';
import { normaliseMobile } from '../../shared/format';
import { endSession, startSession } from '../auth';
import { agencyRow, sendLoginLink } from '../services/workflows';
import { DEMO_LOGIN } from '../seed';

const loginLimiter = new RateLimiter(10, 15 * 60000);
const linkLimiter = new RateLimiter(5, 15 * 60000);

export const authRouter = Router();

authRouter.get('/me', (req, res) => {
  const db = getDb();
  const a = agencyRow(db);
  res.json({
    user: req.user ?? null,
    agency: a ? { name: a.name, colour: a.brand_colour, hasLogo: !!a.logo_path, phone: a.phone } : null,
    demoMode: config.demoMode,
    // Invite-only: the demo login has a private password, so don't show it.
    demoLogin: config.demoMode && !config.inviteOnly ? DEMO_LOGIN : null,
    inviteOnly: config.inviteOnly,
  });
});

authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 200);
  const password = String(req.body?.password ?? '').slice(0, 200);
  // Only failed attempts count towards the limit.
  const key = `${req.ip}:${email}`;
  if (!loginLimiter.allowed(key)) return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes.' });
  const u = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as { id: number; password_hash: string } | undefined;
  if (!u || !verifyPassword(password, u.password_hash)) {
    loginLimiter.hit(key);
    return res.status(401).json({ error: "That email and password don't match" });
  }
  startSession(req, res, 'agency', u.id);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

/** Site manager asks for a login link by email or mobile. Always says "sent" so it can't be used to find out who's registered. */
authRouter.post('/manager-link', (req, res) => {
  const raw = String(req.body?.contact ?? '').trim().slice(0, 200);
  if (!linkLimiter.hit(`${req.ip}`)) return res.status(429).json({ error: 'Too many requests. Please wait 15 minutes.' });
  const db = getDb();
  const phone = normaliseMobile(raw);
  const m = db.prepare('SELECT id FROM managers WHERE active = 1 AND (lower(email) = lower(?) OR phone = ?)').get(raw, phone ?? '---') as { id: number } | undefined;
  if (m) sendLoginLink(db, m.id);
  res.json({ ok: true });
});

/** Consume a magic link (login or sign-off). Links can be reused until they expire, so a manager can open it twice. */
export function consumeMagicLink(token: string): { managerId: number; purpose: string; timesheetId: number | null } | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const row = getDb().prepare('SELECT * FROM magic_links WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), nowIso(clock.now())) as
    | { manager_id: number; purpose: string; timesheet_id: number | null }
    | undefined;
  return row ? { managerId: row.manager_id, purpose: row.purpose, timesheetId: row.timesheet_id } : null;
}
