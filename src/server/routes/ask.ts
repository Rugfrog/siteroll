// Ask SiteRoll endpoint. Agency staff only. Streams progress steps then the answer as
// newline-delimited JSON, so the screen can show "Checking timesheets…" while Claude works.
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';
import { clock } from '../config';
import { RateLimiter } from '../lib/security';
import { asyncRoute, ValidationError } from '../lib/validate';
import { londonDate } from '../../shared/time';
import { requireAgency } from '../auth';
import { ASK_MODEL, askConfigured, runAsk, type AskEvent, type AskTurn, type ToolRunnerFn } from '../services/ask';

export const askRouter = Router();
askRouter.use('/ask', requireAgency);

const perPerson = new RateLimiter(20, 10 * 60000);
// A ceiling on questions per day, so a public demo link can't run up a big bill.
const DAILY_LIMIT = Number(process.env.ASK_DAILY_LIMIT || 300);
const daily = { date: '', count: 0 };

/** Tests swap in a fake Claude. */
export const askDeps: { toolRunner?: ToolRunnerFn; configured: () => boolean } = { configured: askConfigured };

askRouter.get('/ask/status', (_req, res) => {
  res.json({ enabled: askDeps.configured(), model: ASK_MODEL });
});

function parseBody(body: unknown): { question: string; history: AskTurn[] } {
  const b = (body ?? {}) as { question?: unknown; history?: unknown };
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question) throw new ValidationError('Type a question first');
  if (question.length > 1000) throw new ValidationError('Please keep questions under 1,000 characters');
  const history: AskTurn[] = [];
  if (Array.isArray(b.history)) {
    for (const t of b.history.slice(-12)) {
      const turn = t as { role?: unknown; text?: unknown };
      if ((turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string' && turn.text.trim()) {
        history.push({ role: turn.role, text: turn.text.slice(0, 4000) });
      }
    }
  }
  return { question, history };
}

askRouter.post('/ask', asyncRoute(async (req, res) => {
  const { question, history } = parseBody(req.body);
  if (!askDeps.configured()) {
    return res.status(503).json({ error: 'Ask SiteRoll needs a Claude API key. Add ANTHROPIC_API_KEY to the settings and restart.' });
  }
  if (!perPerson.hit(`${req.user!.id}:${req.ip}`)) return res.status(429).json({ error: "That's a lot of questions. Give it a few minutes." });
  const today = londonDate(clock.now());
  if (daily.date !== today) Object.assign(daily, { date: today, count: 0 });
  if (daily.count >= DAILY_LIMIT) return res.status(429).json({ error: "Ask SiteRoll has answered today's limit of questions. It'll be back tomorrow." });
  daily.count++;

  res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const emit = (e: AskEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(e)}\n`);
  };
  try {
    await runAsk(getDb(), question, history, emit, askDeps.toolRunner);
  } catch (err) {
    let message = 'Something went wrong asking Claude. Please try again.';
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) message = "The Claude API key isn't working. Check ANTHROPIC_API_KEY.";
    else if (err instanceof Anthropic.RateLimitError) message = 'Claude is busy right now. Try again in a minute.';
    else if (err instanceof Anthropic.APIConnectionError) message = "Couldn't reach Claude. Check the internet connection and try again.";
    else console.error('Ask SiteRoll failed:', err);
    emit({ type: 'error', message });
  } finally {
    res.end();
  }
}));
