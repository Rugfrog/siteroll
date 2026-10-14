// Ask SiteRoll: the read-only tools give the same figures as the screens, the endpoint is
// agency-only and fails cleanly, and the whole flow works end to end with a scripted fake Claude.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { clock } from '../src/server/config';
import { getDb } from '../src/server/db';
import { seed } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { askDeps } from '../src/server/routes/ask';
import * as T from '../src/server/services/askTools';
import { getTimesheetView } from '../src/server/services/timesheets';
import { fmtHours, fmtMoney } from '../src/shared/format';
import { londonToUtc } from '../src/shared/time';

const TODAY = '2026-10-14';
const LAST_WEEK = '2026-10-05';
let app: Express;

beforeAll(async () => {
  clock.now = () => londonToUtc(TODAY, '10:00');
  seed(getDb());
  app = createApp();
});

async function agency() {
  const a = request.agent(app);
  await a.post('/api/auth/login').send({ email: 'office@pennine.example', password: 'demo1234' }).expect(200);
  return a;
}

describe('Ask SiteRoll tools', () => {
  it('give the same timesheet figures as the timesheet screen', () => {
    const db = getDb();
    const site = T.findSite(db, 'brighouse');
    const view = getTimesheetView(db, site.id, LAST_WEEK);
    const r = T.getTimesheets(db, { week: '2026-10-08', site: 'Brighouse' }); // any day in the week
    expect(r.week).toContain('Mon 5 Oct');
    expect(r.timesheets[0].totalHours).toBe(fmtHours(view.totals.totalMins));
    expect(r.timesheets[0].chargeToClient).toBe(fmtMoney(view.totals.chargePence));
    expect(r.timesheets[0].byWorker?.length).toBe(14);
  });

  it('find people by partial name, and ask when a name is ambiguous', () => {
    const db = getDb();
    expect(T.getWorker(db, 'jordan').name).toBe('Jordan Booth');
    expect(T.getWorker(db, 'Kyle D').card.status).toBe('expired');
    expect(() => T.getWorker(db, 'Dyson')).toThrow(/more than one worker: Mark Dyson, Kyle Dyson|more than one worker: Kyle Dyson, Mark Dyson/);
    expect(() => T.getWorker(db, 'Nobody Atall')).toThrow(T.ToolInputError);
  });

  it('report compliance, invoices, the live board and margins', () => {
    const db = getDb();
    expect(T.getCompliance(db).items.some((i) => i.worker === 'Kyle Dyson' && i.status === 'expired')).toBe(true);
    const inv = T.getInvoices(db, 'overdue');
    expect(inv.invoices.every((i) => i.status === 'overdue')).toBe(true);
    expect(T.getLiveBoard(db).sites).toHaveLength(3);
    const m = T.getMargins(db, 6, 'client');
    expect(m.rows.map((r) => r.name).sort()).toEqual(['Calder Construction Ltd', 'Colne Valley Developments']);
    // Just last week, which must match that week's timesheets.
    const last = T.getMargins(db, 6, 'site', '2026-10-07');
    expect(last.period).toContain('Mon 5 Oct');
    const brighouse = getTimesheetView(db, T.findSite(db, 'Brighouse').id, LAST_WEEK);
    expect(last.rows.find((r) => r.name.includes('Brighouse'))!.margin).toBe(fmtMoney(brighouse.totals.chargePence - brighouse.totals.payPence));
  });

  it('reject bad dates instead of guessing', () => {
    expect(() => T.resolveWeek('last tuesday')).toThrow(T.ToolInputError);
  });
});

describe('Ask SiteRoll endpoint', () => {
  it('is agency only', async () => {
    await request(app).post('/api/ask').send({ question: 'hi' }).expect(401);
  });

  it('says when no Claude API key is set', async () => {
    askDeps.configured = () => false;
    const a = await agency();
    expect((await a.get('/api/ask/status').expect(200)).body.enabled).toBe(false);
    const res = await a.post('/api/ask').send({ question: "Who's on site?" }).expect(503);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('rejects an empty question cleanly', async () => {
    askDeps.configured = () => true;
    const a = await agency();
    await a.post('/api/ask').send({ question: '   ' }).expect(400);
  });

  it('streams progress steps and the answer, with Claude calling a real tool', async () => {
    askDeps.configured = () => true;
    let seenParams: any;
    askDeps.toolRunner = async (params: any) => {
      seenParams = params;
      // Pretend Claude decided to look up last week's Brighouse timesheet.
      const tool = params.tools.find((t: any) => t.name === 'get_timesheets');
      const out = JSON.parse(await tool.run({ week: LAST_WEEK, site: 'Brighouse' }));
      return {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: `Brighouse did ${out.timesheets[0].totalHours} hours last week.` }],
      } as any;
    };
    const a = await agency();
    const res = await a.post('/api/ask').send({ question: 'How many hours at Brighouse last week?', history: [{ role: 'assistant', text: 'ignored: must start with the user' }] }).expect(200);
    const events = res.text.trim().split('\n').map((l) => JSON.parse(l));
    expect(events[0]).toEqual({ type: 'step', text: 'Checking timesheets for w/c Mon 5 Oct at Brighouse' });
    expect(events.at(-1)).toEqual({ type: 'answer', text: 'Brighouse did 615.75 hours last week.' });
    // Request shape: current model, today's date in the question (not the system prompt), fallbacks on.
    expect(seenParams.model).toBe('claude-opus-5-5');
    expect(seenParams.messages).toHaveLength(1);
    expect(seenParams.messages[0].content).toMatch(/^\[Today is Wednesday 14 October 2026/);
    expect(JSON.stringify(seenParams.system)).not.toMatch(/2026/);
    expect(seenParams.fallbacks).toBe('default');
    expect(seenParams.betas).toContain('server-side-fallback-2026-07-01');
  });

  it('turns a refusal into a polite answer', async () => {
    askDeps.toolRunner = async () => ({ stop_reason: 'refusal', content: [] }) as any;
    const a = await agency();
    const res = await a.post('/api/ask').send({ question: 'Something odd' }).expect(200);
    expect(JSON.parse(res.text.trim())).toEqual({ type: 'answer', text: "Sorry, I can't help with that one." });
  });
});

describe('async routes', () => {
  it('return 400 for a bad id instead of crashing the server', async () => {
    const a = await agency();
    await a.get('/api/rollcalls/not-a-number/pdf').expect(400);
    await a.get('/api/invoices/abc/pdf').expect(400);
  });
});
