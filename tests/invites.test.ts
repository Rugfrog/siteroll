// Invite-only demo: with AGENCY_PASSWORD set, the demo login is private and people get in with
// signed invite links. Workers' and clients' own links keep working without logging in.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { clock, config } from '../src/server/config';
import { getDb } from '../src/server/db';
import { seed } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { runtime } from '../src/server/services/workflows';
import { londonToUtc } from '../src/shared/time';

const PRIVATE = 'four random words here';
let app: Express;
let owner: ReturnType<typeof request.agent>;

beforeAll(async () => {
  clock.now = () => londonToUtc('2026-10-14', '10:00');
  runtime.baseUrl = 'http://siteroll.test';
  config.agencyPassword = PRIVATE;
  seed(getDb());
  app = createApp();
  owner = request.agent(app);
});

afterAll(() => {
  config.agencyPassword = '';
});

const inviteToken = (url: string) => url.split('/invite/')[1];

describe('invite-only demo', () => {
  it('stops showing the demo login', async () => {
    const me = (await request(app).get('/api/auth/me').expect(200)).body;
    expect(me.demoLogin).toBeNull();
    expect(me.inviteOnly).toBe(true);
  });

  it('refuses the public demo password, and accepts the private one', async () => {
    await request(app).post('/api/auth/login').send({ email: 'office@pennine.example', password: 'demo1234' }).expect(401);
    await owner.post('/api/auth/login').send({ email: 'office@pennine.example', password: PRIVATE }).expect(200);
  });

  it('lets the owner make an invite link that logs someone straight in', async () => {
    const { url, expires } = (await owner.post('/api/invites').send({ name: 'Oliver', days: 7 }).expect(200)).body;
    expect(url).toMatch(/^http:\/\/siteroll\.test\/invite\/.+\..+/);
    expect(new Date(expires).getTime()).toBeGreaterThan(clock.now().getTime());
    const guest = request.agent(app);
    await guest.get('/api/workers').expect(401);
    const res = await guest.get(`/invite/${inviteToken(url)}`).expect(302);
    expect(res.headers.location).toBe('/');
    await guest.get('/api/workers').expect(200);
  });

  it('rejects a link that has been tampered with', async () => {
    const { url } = (await owner.post('/api/invites').send({ name: 'Oliver', days: 7 }).expect(200)).body;
    const [payload, sig] = inviteToken(url).split('.');
    const forged = `${Buffer.from(JSON.stringify({ n: 'Oliver', e: 4102444800 })).toString('base64url')}.${sig}`;
    const guest = request.agent(app);
    for (const t of [forged, `${payload}.${sig.slice(0, -2)}xx`, 'nonsense']) {
      const res = await guest.get(`/invite/${t}`).expect(302);
      expect(res.headers.location).toBe('/login?invite=expired');
    }
    await guest.get('/api/workers').expect(401);
  });

  it('stops a link working once it expires', async () => {
    const { url } = (await owner.post('/api/invites').send({ name: 'Short one', days: 1 }).expect(200)).body;
    const was = clock.now;
    clock.now = () => londonToUtc('2026-10-16', '10:00');
    try {
      const res = await request(app).get(`/invite/${inviteToken(url)}`).expect(302);
      expect(res.headers.location).toBe('/login?invite=expired');
    } finally {
      clock.now = was;
    }
  });

  it('cancels every link when the private password changes', async () => {
    const { url } = (await owner.post('/api/invites').send({ name: 'Oliver', days: 30 }).expect(200)).body;
    config.agencyPassword = 'a brand new password';
    try {
      const res = await request(app).get(`/invite/${inviteToken(url)}`).expect(302);
      expect(res.headers.location).toBe('/login?invite=expired');
    } finally {
      config.agencyPassword = PRIVATE;
    }
  });

  it("keeps workers' sign-in pages working without a login", async () => {
    const site = getDb().prepare("SELECT qr_token FROM sites WHERE name LIKE '%Brighouse%'").get() as { qr_token: string };
    await request(app).get(`/api/w/site/${site.qr_token}`).expect(200);
  });

  it("won't make invite links when the demo is open to anyone", async () => {
    config.agencyPassword = '';
    try {
      // Still logged in from before (the session doesn't depend on the password).
      await owner.post('/api/invites').send({ name: 'Oliver', days: 7 }).expect(400);
    } finally {
      config.agencyPassword = PRIVATE;
    }
  });
});
