// For people who never log in, opening a link from an email. Each link carries a long random token.
import { Router } from 'express';
import { getDb } from '../db';
import { RateLimiter } from '../lib/security';
import { approverRequest, nominateApprover } from '../services/confirmations';

const nominateLimiter = new RateLimiter(20, 15 * 60000);
const EXPIRED = "This link has expired or isn't recognised. Ask the agency to send you a new one.";

export const publicRouter = Router();

/** "Who approves the hours?" from a booking confirmation email. */
publicRouter.get('/approver/:token', (req, res) => {
  const view = approverRequest(getDb(), String(req.params.token));
  if (!view) return res.status(404).json({ error: EXPIRED });
  res.json(view);
});

publicRouter.post('/approver/:token', (req, res) => {
  if (!nominateLimiter.hit(req.ip || 'unknown')) return res.status(429).json({ error: 'Too many tries. Please wait 15 minutes.' });
  const r = nominateApprover(getDb(), String(req.params.token), req.body ?? {});
  if (!r) return res.status(404).json({ error: EXPIRED });
  res.json({ ok: true, ...r });
});
