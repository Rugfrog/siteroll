// Fire alarm to every phone: texts with a personal "I'm safe" link, the open sign-in page,
// push notifications, "I need help", and what happens when the roll call finishes.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { clock } from '../src/server/config';
import { getDb } from '../src/server/db';
import { seed, phoneFor, WORKERS } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { runtime } from '../src/server/services/workflows';
import { pushDeps } from '../src/server/services/push';
import { londonToUtc } from '../src/shared/time';

const TODAY = '2026-10-14';
const phoneOf = (last: string) => phoneFor(WORKERS.findIndex((w) => w.last === last));
let app: Express;
let agency: ReturnType<typeof request.agent>;
let sites: Record<string, number>;
const pushed: { endpoint: string; payload: any }[] = [];

beforeAll(async () => {
  clock.now = () => londonToUtc(TODAY, '10:00');
  runtime.baseUrl = 'https://siteroll.test';
  pushDeps.send = async (sub, payload) => {
    pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    return { statusCode: 201, body: '', headers: {} };
  };
  seed(getDb());
  app = createApp();
  agency = request.agent(app);
  await agency.post('/api/auth/login').send({ email: 'office@pennine.example', password: 'demo1234' }).expect(200);
  const clients = (await agency.get('/api/clients').expect(200)).body;
  const all = clients.flatMap((c: any) => c.sites);
  sites = Object.fromEntries(['Brighouse', 'Halifax', 'Marsden'].map((n) => [n, all.find((s: any) => s.name.includes(n)).id]));
});

async function phone(last: string) {
  const w = request.agent(app);
  const p = phoneOf(last);
  const code = (await w.post('/api/w/code').send({ phone: p }).expect(200)).body.demoCode;
  await w.post('/api/w/verify').send({ phone: p, code }).expect(200);
  return w;
}

const fireTexts = async () => (await agency.get('/api/outbox?kind=fire').expect(200)).body as any[];

describe('fire alarm to every phone', () => {
  let rcId: number;
  let leeLink: string;
  let nathan: ReturnType<typeof request.agent>;

  it('texts everyone on site a personal "I\'m safe" link when the roll call starts', async () => {
    nathan = await phone('Shaw'); // set up once: codes are rate-limited per number
    expect((await nathan.get('/api/w/alarm').expect(200)).body.alarm).toBeNull();
    const rc = (await agency.post('/api/rollcalls').send({ siteId: sites.Marsden }).expect(200)).body;
    rcId = rc.id;
    expect(rc.total).toBe(3);
    expect(rc.alerted).toBe(3);
    const texts = await fireTexts();
    expect(texts).toHaveLength(3);
    expect(texts[0].body).toMatch(/FIRE ALARM at Mill Lane Apartments, Marsden\. Leave by the nearest safe exit/);
    expect(texts[0].body).toMatch(/reply SAFE/);
    leeLink = texts.find((t) => t.recipient_name === 'Lee Pearson').link;
    expect(leeLink).toMatch(/^https:\/\/siteroll\.test\/safe\/[A-Za-z0-9_-]{30,}$/);
  });

  it('lets a worker say they are safe from the link, with no setup', async () => {
    const path = new URL(leeLink).pathname; // /safe/<token>
    const token = path.split('/')[2];
    const page = await request(app).get(path).expect(200);
    expect(page.headers['content-type']).toMatch(/html/);
    const before = (await request(app).get(`/api/w/safe/${token}`).expect(200)).body;
    expect(before.alarm).toMatchObject({ site: 'Mill Lane Apartments, Marsden', name: 'Lee Pearson', status: 'pending', total: 3, safe: 0 });
    const after = (await request(app).post(`/api/w/safe/${token}`).send({ status: 'safe' }).expect(200)).body;
    expect(after.alarm).toMatchObject({ status: 'safe', safe: 1 });
    const rc = (await agency.get(`/api/rollcalls/${rcId}`).expect(200)).body;
    expect(rc.safeByPhone).toBe(1);
    expect(rc.people.find((p: any) => p.name === 'Lee Pearson').safeBy).toBe('phone');
  });

  it('turns an open sign-in page into the alarm, and "I need help" texts the site manager', async () => {
    const alarm = (await nathan.get('/api/w/alarm').expect(200)).body.alarm;
    expect(alarm).toMatchObject({ status: 'pending', site: 'Mill Lane Apartments, Marsden' });
    const help = (await nathan.post('/api/w/alarm').send({ status: 'help' }).expect(200)).body.alarm;
    expect(help.status).toBe('help');
    const texts = await fireTexts();
    expect(texts.some((t) => t.recipient_name === 'Sean Brierley' && /HELP NEEDED: Nathan Shaw/.test(t.body))).toBe(true);
    const rc = (await agency.get(`/api/rollcalls/${rcId}`).expect(200)).body;
    expect(rc.needHelp).toBe(1);
    // Then they're fine after all.
    expect((await nathan.post('/api/w/alarm').send({ status: 'safe' }).expect(200)).body.alarm.status).toBe('safe');
  });

  it('rejects nonsense', async () => {
    await request(app).get('/api/w/safe/not-a-real-token-at-all-xyz').expect(404);
    await nathan.post('/api/w/alarm').send({ status: 'dancing' }).expect(400);
  });

  it('stops once the roll call has finished', async () => {
    await agency.post(`/api/rollcalls/${rcId}/finish`).send({ notes: 'Drill' }).expect(200);
    nathan = await phone('Shaw'); // set up once: codes are rate-limited per number
    expect((await nathan.get('/api/w/alarm').expect(200)).body.alarm).toBeNull();
    const token = new URL(leeLink).pathname.split('/')[2];
    const after = (await request(app).get(`/api/w/safe/${token}`).expect(200)).body.alarm;
    expect(after.finished).toBe(true);
    await request(app).post(`/api/w/safe/${token}`).send({ status: 'safe' }).expect(400);
  });
});

describe('fire alerts on a locked phone (web push)', () => {
  it('sends a notification to phones that turned alerts on', async () => {
    const daniel = await phone('Okafor');
    const keys = (await daniel.get('/api/w/push').expect(200)).body;
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(keys.subscribed).toBe(false);
    await daniel
      .post('/api/w/push')
      .send({ subscription: { endpoint: 'https://push.example/abc123', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } } })
      .expect(200);
    expect((await daniel.get('/api/w/push').expect(200)).body.subscribed).toBe(true);
    await daniel.post('/api/w/push').send({ subscription: { endpoint: 'http://not-https.example' } }).expect(400);

    await agency.post('/api/rollcalls').send({ siteId: sites.Halifax }).expect(200);
    await new Promise((r) => setTimeout(r, 50)); // pushes are sent in the background
    expect(pushed).toHaveLength(1);
    expect(pushed[0].endpoint).toBe('https://push.example/abc123');
    expect(pushed[0].payload.title).toBe('🔥 FIRE ALARM – Ovenden Park School extension, Halifax');
    expect(pushed[0].payload.url).toMatch(/^\/safe\/[A-Za-z0-9_-]{30,}$/);
  });
});
