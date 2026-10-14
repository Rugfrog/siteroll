// WhatsApp: the bot's conversations, Twilio's webhook signature, and how messages are delivered.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import type { Express } from 'express';
import { clock, config } from '../src/server/config';
import { getDb } from '../src/server/db';
import { seed, phoneFor, WORKERS } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { runtime } from '../src/server/services/workflows';
import { askDeps } from '../src/server/services/ask';
import { send, transportDeps } from '../src/server/services/messaging';
import { londonToUtc } from '../src/shared/time';

const TODAY = '2026-10-14';
const phoneOf = (last: string) => phoneFor(WORKERS.findIndex((w) => w.last === last));
const GARETH = '07700900501';
const MICHELLE = '07700900999';
let app: Express;
let agency: ReturnType<typeof request.agent>;
const sent: { channel: string; to: string; body: string }[] = [];

beforeAll(async () => {
  clock.now = () => londonToUtc(TODAY, '10:00');
  runtime.baseUrl = 'https://siteroll.test';
  transportDeps.send = async (channel, to, body) => {
    sent.push({ channel, to, body });
    return 'SM123';
  };
  seed(getDb());
  app = createApp();
  agency = request.agent(app);
  await agency.post('/api/auth/login').send({ email: 'office@pennine.example', password: 'demo1234' }).expect(200);
});

const outbox = async () => (await agency.get('/api/outbox').expect(200)).body as any[];

/** Message SiteRoll as this phone (the demo simulator), then return the replies it sent back to them. */
async function say(phone: string, body: string) {
  const before = Math.max(0, ...(await outbox()).map((m) => m.id));
  await agency.post('/api/whatsapp/simulate').send({ phone, body }).expect(200);
  return (await outbox())
    .filter((m) => m.id > before && m.recipient === phone)
    .sort((a, b) => a.id - b.id)
    .map((m) => m.body as string)
    .join('\n');
}

describe('WhatsApp bot', () => {
  it('replies to an unknown number politely', async () => {
    expect(await say('07700900888', 'hello')).toMatch(/isn't registered with Pennine Site Staffing Ltd/);
  });

  it('lets a worker reply SAFE during a fire roll call', async () => {
    const rc = (await agency.post('/api/rollcalls').send({ siteId: 3 }).expect(200)).body; // Marsden
    const reply = await say(phoneOf('Pearson'), "I'm safe!");
    expect(reply).toMatch(/you're marked safe at 10:00/);
    const after = (await agency.get(`/api/rollcalls/${rc.id}`).expect(200)).body;
    expect(after.people.find((p: any) => p.name === 'Lee Pearson').safeBy).toBe('phone');
    await agency.post(`/api/rollcalls/${rc.id}/finish`).send({}).expect(200);
  });

  it('fills a no-show: offers go out, first YES is booked, later YESes are told it is taken', async () => {
    const alerts = (await agency.get('/api/alerts').expect(200)).body;
    const mark = alerts.find((a: any) => a.type === 'no_show' && a.first_name === 'Mark');
    const r = (await agency.post(`/api/whatsapp/offer/${mark.id}`).send({}).expect(200)).body;
    expect(r.offered).toBe(2); // the two free groundworkers
    const offers = (await agency.get('/api/outbox?kind=offer').expect(200)).body;
    expect(offers.map((o: any) => o.recipient_name).sort()).toEqual(['Mohammed Hussain', 'Paul Crowther']);
    expect(offers[0].channel).toBe('whatsapp');
    expect((await agency.get('/api/alerts').expect(200)).body.find((a: any) => a.id === mark.id).offers_open).toBe(2);

    expect(await say(phoneOf('Hussain'), 'Yes please')).toMatch(/It's yours, Mohammed/);
    const after = (await agency.get('/api/alerts').expect(200)).body;
    expect(after.some((a: any) => a.id === mark.id)).toBe(false); // covered
    const live = (await agency.get('/api/live').expect(200)).body;
    const brighouse = live.sites.find((s: any) => s.name.includes('Brighouse'));
    expect(brighouse.expected.some((e: any) => e.name === 'Mohammed Hussain')).toBe(true);
    expect(await say(phoneOf('Crowther'), 'yes')).toMatch(/been taken/);
  });

  it('lets a site manager approve the week by replying APPROVE then YES', async () => {
    const ask = await say(GARETH, 'approve');
    expect(ask).toMatch(/Approve Woodhouse Gardens, Brighouse: 14 workers, 615\.75 hours for the week of Mon 5 Oct\?/);
    expect(ask).toMatch(/https:\/\/siteroll\.test\/approve\//);
    expect(await say(GARETH, 'YES')).toMatch(/Approved: Woodhouse Gardens, Brighouse, 14 workers, 615\.75 hours/);
    const list = (await agency.get('/api/timesheets?week=2026-10-05').expect(200)).body.timesheets;
    const ts = list.find((t: any) => t.siteName.includes('Brighouse'));
    expect(ts.status).toBe('approved');
    const view = (await agency.get(`/api/timesheets/${ts.id}`).expect(200)).body;
    expect(view.timesheet.approved_device).toMatch(/WhatsApp/);
    expect(await say(GARETH, 'approve')).toMatch(/Nothing is waiting/);
  });

  it('tells a site manager who is on site', async () => {
    expect(await say(GARETH, 'on site')).toMatch(/\*Woodhouse Gardens, Brighouse\*: \d+ on site/);
  });

  it('answers agency staff with Ask SiteRoll, in WhatsApp formatting', async () => {
    askDeps.configured = () => true;
    askDeps.toolRunner = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'There are **15** people on site.' }] }) as any;
    expect(await say(MICHELLE, "Who's on site?")).toBe('There are *15* people on site.');
  });

  it('switches someone to ordinary texts when they reply STOP', async () => {
    const p = phoneOf('Kaye');
    expect(await say(p, 'STOP')).toMatch(/ordinary texts/);
    send.sms({ to: p, body: 'After STOP', kind: 'other' });
    const last = (await outbox()).find((m) => m.recipient === p && m.body === 'After STOP');
    expect(last.channel).toBe('sms');
    expect(await say(p, 'START')).toMatch(/back on WhatsApp/);
  });

  it('keeps the simulator to demo mode', async () => {
    config.demoMode = false;
    await agency.post('/api/whatsapp/simulate').send({ phone: GARETH, body: 'approve' }).expect(403);
    config.demoMode = true;
  });
});

describe('Twilio webhook', () => {
  const sign = (url: string, params: Record<string, string>, token: string) =>
    createHmac('sha1', token)
      .update(url + Object.keys(params).sort().map((k) => k + params[k]).join(''))
      .digest('base64');

  it('accepts a correctly signed message and rejects a forged one', async () => {
    config.twilio.authToken = 'test-auth-token';
    const params = { From: 'whatsapp:+447700900888', Body: 'hello', MessageSid: 'SM1' };
    const url = 'https://siteroll.test/api/whatsapp/twilio';
    const ok = await request(app).post('/api/whatsapp/twilio').set('X-Twilio-Signature', sign(url, params, 'test-auth-token')).type('form').send(params).expect(200);
    expect(ok.text).toContain('<Response></Response>');
    await request(app).post('/api/whatsapp/twilio').set('X-Twilio-Signature', sign(url, params, 'wrong-token')).type('form').send(params).expect(403);
    await request(app).post('/api/whatsapp/twilio').type('form').send(params).expect(403);
  });
});

describe('delivery', () => {
  it('sends real numbers by WhatsApp, never the made-up demo numbers, and falls back to a text', async () => {
    Object.assign(config.twilio, { accountSid: 'AC123', authToken: 'test-auth-token', whatsappFrom: 'whatsapp:+14155238886', smsFrom: '' });
    sent.length = 0;
    send.sms({ to: '07123456789', toName: 'Real person', body: 'Hello', kind: 'test' });
    send.sms({ to: '07700900105', toName: 'Made-up person', body: 'Hello', kind: 'test' });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual([{ channel: 'whatsapp', to: '07123456789', body: 'Hello' }]);
    const out = (await agency.get('/api/outbox?kind=test').expect(200)).body;
    expect(out.find((m: any) => m.recipient === '07123456789').status).toBe('sent');
    expect(out.find((m: any) => m.recipient === '07700900105').status).toBe('simulated');

    // WhatsApp fails (e.g. outside the 24-hour window): a text goes instead.
    config.twilio.smsFrom = '+447000000000';
    transportDeps.send = async (channel, to, body) => {
      if (channel === 'whatsapp') throw new Error('Outside the 24-hour window');
      sent.push({ channel, to, body });
      return 'SM2';
    };
    send.sms({ to: '07123456780', body: 'Fallback', kind: 'test' });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.at(-1)).toEqual({ channel: 'sms', to: '07123456780', body: 'Fallback' });
    const fb = (await agency.get('/api/outbox?kind=test').expect(200)).body.find((m: any) => m.recipient === '07123456780');
    expect(fb).toMatchObject({ channel: 'sms', status: 'sent' });
  });
});
