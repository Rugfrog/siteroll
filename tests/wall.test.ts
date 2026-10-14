// Office TV wall: agency only, and it has everything the big screen needs.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { clock } from '../src/server/config';
import { getDb } from '../src/server/db';
import { seed } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { londonToUtc } from '../src/shared/time';

let app: Express;

beforeAll(() => {
  clock.now = () => londonToUtc('2026-10-14', '10:00');
  seed(getDb());
  app = createApp();
});

describe('Office TV wall', () => {
  it('is for agency staff only', async () => {
    await request(app).get('/api/wall').expect(401);
  });

  it('returns sites with map positions and headcounts, today’s shifts for the money meter, and a live feed', async () => {
    const a = request.agent(app);
    await a.post('/api/auth/login').send({ email: 'office@pennine.example', password: 'demo1234' }).expect(200);
    const d = (await a.get('/api/wall').expect(200)).body;
    expect(d.sites).toHaveLength(3);
    for (const s of d.sites) {
      expect(typeof s.lat).toBe('number');
      expect(typeof s.lng).toBe('number');
    }
    expect(d.sites.find((s: any) => s.town === 'Brighouse').onSite).toBe(8);
    expect(d.shifts.length).toBeGreaterThanOrEqual(15);
    expect(d.shifts[0]).toHaveProperty('charge');
    // Newest first; today's no-shows are in it.
    expect(d.feed.length).toBeGreaterThan(0);
    expect(d.feed.some((f: any) => f.kind === 'noshow' && /Mark Dyson/.test(f.text))).toBe(true);
    for (let i = 1; i < d.feed.length; i++) expect(d.feed[i - 1].at >= d.feed[i].at).toBe(true);
  });
});
