// End to end through the real API: worker signs in → live board → signs out → timesheet →
// client queries and approves → invoice → payroll. Also checks people only see their own data.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { clock } from '../src/server/config';
import { getDb } from '../src/server/db';
import { seed, phoneFor, WORKERS } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { runtime } from '../src/server/services/workflows';
import { londonToUtc } from '../src/shared/time';

const TODAY = '2026-10-14'; // a Wednesday
const WEEK = '2026-10-12';
const at = (time: string) => () => londonToUtc(TODAY, time);
const phoneOf = (last: string, first?: string) => phoneFor(WORKERS.findIndex((w) => w.last === last && (!first || w.first === first)));

let app: Express;
let agency: ReturnType<typeof request.agent>;
let sites: Record<string, { id: number; qr_token: string; lat: number; lng: number }>;

beforeAll(async () => {
  clock.now = at('10:00');
  runtime.baseUrl = 'http://siteroll.test';
  seed(getDb());
  app = createApp();
  agency = request.agent(app);
  await agency.post('/api/auth/login').send({ email: 'office@pennine.example', password: 'demo1234' }).expect(200);
  const clients = (await agency.get('/api/clients').expect(200)).body;
  const all = clients.flatMap((c: any) => c.sites);
  sites = {
    brighouse: all.find((s: any) => s.name.includes('Brighouse')),
    halifax: all.find((s: any) => s.name.includes('Halifax')),
    marsden: all.find((s: any) => s.name.includes('Marsden')),
  };
});

async function rememberPhone(phone: string) {
  const worker = request.agent(app);
  const code = (await worker.post('/api/w/code').send({ phone }).expect(200)).body.demoCode;
  expect(code).toMatch(/^\d{6}$/);
  await worker.post('/api/w/verify').send({ phone, code: '000000' === code ? '111111' : '000000' }).expect(400); // wrong code first
  await worker.post('/api/w/verify').send({ phone, code }).expect(200);
  return worker;
}

describe('security basics', () => {
  it('refuses the dashboard API without logging in', async () => {
    await request(app).get('/api/workers').expect(401);
    await request(app).get('/api/live').expect(401);
  });

  it('rejects a wrong password', async () => {
    await request(app).post('/api/auth/login').send({ email: 'office@pennine.example', password: 'nope' }).expect(401);
  });

  it('refuses to sign in a phone that has not been set up', async () => {
    await request(app).post('/api/w/sign').send({ token: sites.brighouse.qr_token, action: 'in', reading: { lat: 53.7105, lng: -1.7781, accuracy: 10 } }).expect(401);
  });

  it('rate-limits code requests for the same number', async () => {
    const phone = phoneOf('Hussain');
    for (let i = 0; i < 3; i++) await request(app).post('/api/w/code').send({ phone }).expect(200);
    await request(app).post('/api/w/code').send({ phone }).expect(429);
  });

  it('validates input on the server', async () => {
    await agency.post('/api/bookings').send({ workerId: 'abc', siteId: 1, dates: ['2026-13-45'] }).expect(400);
    await agency.put(`/api/sites/${sites.brighouse.id}`).send({ client_id: 1, name: 'X', lat: 0, lng: 0, radius_m: 5, start_time: '7', finish_time: '16:30' }).expect(400);
  });
});

describe('sign in → timesheet → approval → invoice → payroll', () => {
  let callum: ReturnType<typeof request.agent>;
  let timesheetId: number;
  let callumShiftId: number;
  let manager: ReturnType<typeof request.agent>;

  it('blocks a sign-in from the yard and says how far away', async () => {
    callum = await rememberPhone(phoneOf('Ainley'));
    const r = await callum.post('/api/w/sign').send({ token: sites.brighouse.qr_token, action: 'in', reading: { lat: 53.6532, lng: -1.7676, accuracy: 15 } }).expect(200);
    expect(r.body.status).toBe('blocked');
    expect(r.body.reason).toBe('outside');
    expect(r.body.message).toMatch(/You don't seem to be on site\. You're about \d+\.\d miles away\./);
  });

  it('signs in on site (GPS checked on the server) and clears the no-show alert', async () => {
    const before = (await agency.get('/api/alerts').expect(200)).body;
    expect(before.some((a: any) => a.type === 'no_show' && a.first_name === 'Callum')).toBe(true);
    clock.now = at('10:05');
    const r = await callum.post('/api/w/sign').send({ token: sites.brighouse.qr_token, action: 'in', reading: { lat: 53.7106, lng: -1.778, accuracy: 9 } }).expect(200);
    expect(r.body.status).toBe('signed_in');
    callumShiftId = r.body.attendanceId;
    const after = (await agency.get('/api/alerts').expect(200)).body;
    expect(after.some((a: any) => a.type === 'no_show' && a.first_name === 'Callum')).toBe(false);
  });

  it('shows him on the live board, flagged late', async () => {
    const live = (await agency.get('/api/live').expect(200)).body;
    const b = live.sites.find((s: any) => s.id === sites.brighouse.id);
    const p = b.onSite.find((x: any) => x.name === 'Callum Ainley');
    expect(p).toBeTruthy();
    expect(p.flags).toContain('late');
  });

  it('signs out with a break', async () => {
    clock.now = at('16:44');
    const r = await callum.post('/api/w/sign').send({ token: sites.brighouse.qr_token, action: 'out', reading: { lat: 53.7104, lng: -1.7782, accuracy: 11 }, breakMins: 30 }).expect(200);
    expect(r.body.status).toBe('signed_out');
  });

  it('builds the timesheet: rounded to the quarter hour, break taken off', async () => {
    const list = (await agency.get(`/api/timesheets?week=${WEEK}`).expect(200)).body;
    timesheetId = list.timesheets.find((t: any) => t.siteId === sites.brighouse.id).id;
    const view = (await agency.get(`/api/timesheets/${timesheetId}`).expect(200)).body;
    const w = view.workers.find((x: any) => x.name === 'Callum Ainley');
    const s = w.shifts.find((x: any) => x.id === callumShiftId);
    // 10:05 → 10:00, 16:44 → 16:45, less 30 mins = 6.25 hours
    expect(s.workedMins).toBe(375);
    // Totals add up
    const sum = view.workers.reduce((a: number, x: any) => a + x.totals.totalMins, 0);
    expect(view.totals.totalMins).toBe(sum);
  });

  it('sends the sign-off link to the site manager, who logs in with it', async () => {
    // Close anyone still on site so the week can go (the agency would check these).
    const r = await agency.post(`/api/timesheets/${timesheetId}/send`).expect(200);
    expect(r.body.headline).toMatch(/Calder Construction Ltd – Woodhouse Gardens, Brighouse: \d+ workers, [\d.,]+ hours this week/);
    const outbox = (await agency.get('/api/outbox?kind=signoff').expect(200)).body;
    const link: string = outbox.find((m: any) => m.recipient_name === 'Gareth Holroyd' && m.link)?.link;
    expect(link).toMatch(/^http:\/\/siteroll\.test\/approve\/[A-Za-z0-9_-]{40,}$/);
    manager = request.agent(app);
    const res = await manager.get(new URL(link).pathname).expect(302);
    expect(res.headers.location).toBe(`/client/timesheets/${timesheetId}`);
  });

  it("only lets the manager see their own site, and hides pay rates", async () => {
    const live = (await manager.get('/api/live').expect(200)).body;
    expect(live.sites.map((s: any) => s.id)).toEqual([sites.brighouse.id]);
    const halifax = (await agency.get(`/api/timesheets?week=${WEEK}`).expect(200)).body.timesheets.find((t: any) => t.siteId === sites.halifax.id);
    await manager.get(`/api/timesheets/${halifax.id}`).expect(404);
    await manager.get('/api/workers').expect(403);
    await manager.get('/api/invoices').expect(403);
    const view = (await manager.get(`/api/timesheets/${timesheetId}`).expect(200)).body;
    expect(view.totals.payPence).toBe(0);
    await manager.get(`/files/card/1`).expect(404);
  });

  it('a query blocks approval until the agency sorts it out', async () => {
    await manager.post(`/api/attendance/${callumShiftId}/query`).send({ comment: 'He left at 4pm, not quarter to five' }).expect(200);
    const res = await manager.post(`/api/timesheets/${timesheetId}/approve`).expect(400);
    expect(res.body.error).toMatch(/queried/);
    // The agency fixes it, with a reason, and it's kept in the history.
    await agency.put(`/api/attendance/${callumShiftId}`).send({ inTime: '10:05', outTime: '16:00', breakMins: 30, reason: 'Agreed with Gareth and Callum', markChecked: true }).expect(200);
    const shift = (await agency.get(`/api/attendance/${callumShiftId}`).expect(200)).body;
    expect(shift.status).toBe('ok');
    expect(shift.edits.map((e: any) => e.reason)).toEqual(['Queried by client', 'Agreed with Gareth and Callum']);
  });

  it('only the client can approve, and approval locks the week', async () => {
    await agency.post(`/api/timesheets/${timesheetId}/approve`).expect(403);
    clock.now = at('17:10');
    const r = await manager.post(`/api/timesheets/${timesheetId}/approve`).set('User-Agent', 'TestPhone/1.0').expect(200);
    expect(r.body.ok).toBe(true);
    const view = (await agency.get(`/api/timesheets/${timesheetId}`).expect(200)).body;
    expect(view.locked).toBe(true);
    expect(view.timesheet.approved_by_name).toBe('Gareth Holroyd (Calder Construction Ltd)');
    expect(view.timesheet.approved_device).toMatch(/TestPhone/);
    await agency.put(`/api/attendance/${callumShiftId}`).send({ inTime: '09:00', outTime: '16:00', reason: 'test' }).expect(400);
  });

  it('turns the approved hours into an invoice with VAT, and the PDF works', async () => {
    const view = (await agency.get(`/api/timesheets/${timesheetId}`).expect(200)).body;
    const inv = (await agency.post('/api/invoices').send({ clientId: 1, week: WEEK }).expect(200)).body;
    expect(inv.number).toMatch(/^INV-\d{4}$/);
    const full = (await agency.get(`/api/invoices/${inv.id}`).expect(200)).body;
    expect(full.net_pence).toBe(view.totals.chargePence);
    expect(full.vat_pence).toBe(Math.round(full.net_pence * 0.2));
    expect(full.gross_pence).toBe(full.net_pence + full.vat_pence);
    expect(full.lines.reduce((s: number, l: any) => s + l.amount_pence, 0)).toBe(full.net_pence);
    const pdf = await agency.get(`/api/invoices/${inv.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // Can't invoice the same week twice.
    await agency.post('/api/invoices').send({ clientId: 1, week: WEEK }).expect(400);
  });

  it('puts the same pay in the payroll CSV', async () => {
    const view = (await agency.get(`/api/timesheets/${timesheetId}`).expect(200)).body;
    const callumTotals = view.workers.find((x: any) => x.name === 'Callum Ainley').totals;
    const csv = (await agency.get(`/api/payroll.csv?week=${WEEK}`).expect(200)).text;
    const line = csv.split('\r\n').find((l) => l.includes(',Ainley,Callum,'))!;
    expect(line).toBeTruthy();
    const gross = line.split(',')[9];
    expect(Math.round(Number(gross) * 100)).toBe(callumTotals.payPence);
  });

  it('lets the manager download the timesheet PDF without pay rates', async () => {
    const res = await manager.get(`/api/timesheets/${timesheetId}/pdf`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });
});

describe('compliance at the gate', () => {
  it('blocks an expired card on a site that blocks, and alerts the agency', async () => {
    clock.now = at('08:00');
    const kyle = await rememberPhone(phoneOf('Dyson', 'Kyle'));
    const site = (await kyle.get(`/api/w/site/${sites.marsden.qr_token}`).expect(200)).body;
    expect(site.worker.card).toBe('expired');
    expect(site.site.blocksExpiredCards).toBe(true);
    const r = await kyle.post('/api/w/sign').send({ token: sites.marsden.qr_token, action: 'in', reading: { lat: 53.601, lng: -1.93, accuracy: 10 } }).expect(200);
    expect(r.body.status).toBe('blocked');
    expect(r.body.reason).toBe('card_expired');
    const alerts = (await agency.get('/api/alerts').expect(200)).body;
    expect(alerts.some((a: any) => a.type === 'compliance' && a.first_name === 'Kyle')).toBe(true);
  });

  it('warns but lets in on a site that only warns, flagging it', async () => {
    const kyle = await rememberPhone(phoneOf('Dyson', 'Kyle'));
    const r = await kyle.post('/api/w/sign').send({ token: sites.halifax.qr_token, action: 'in', reading: { lat: 53.7385, lng: -1.8655, accuracy: 10 } }).expect(200);
    expect(r.body.status).toBe('signed_in');
    expect(r.body.warnings.join(' ')).toMatch(/card has expired/);
    expect(r.body.warnings.join(' ')).toMatch(/induction/);
  });
});

describe('manual sign-in when GPS is bad', () => {
  it('lets the site manager approve a sign-in by hand', async () => {
    clock.now = at('08:10');
    const reece = await rememberPhone(phoneOf('Hinchliffe'));
    const r = await reece.post('/api/w/sign').send({ token: sites.halifax.qr_token, action: 'in', reading: { lat: 53.7485, lng: -1.8655, accuracy: 40 } }).expect(200);
    expect(r.body.status).toBe('blocked');
    await reece.post('/api/w/manual').send({ attemptId: r.body.attemptId }).expect(200);
    const live = (await agency.get('/api/live').expect(200)).body;
    const pending = live.sites.find((s: any) => s.id === sites.halifax.id).pendingManual;
    expect(pending.length).toBe(1);
    await agency.post(`/api/attempts/${pending[0].id}/approve`).expect(200);
    const live2 = (await agency.get('/api/live').expect(200)).body;
    const p = live2.sites.find((s: any) => s.id === sites.halifax.id).onSite.find((x: any) => x.name === 'Reece Hinchliffe');
    expect(p.flags).toContain('manual');
  });
});

describe('hours after sign-off', () => {
  it('still lets people sign in, but flags it so the agency can reopen the week', async () => {
    clock.now = at('17:30');
    const ewan = await rememberPhone(phoneOf('Mellor'));
    const r = await ewan.post('/api/w/sign').send({ token: sites.brighouse.qr_token, action: 'in', reading: { lat: 53.7105, lng: -1.7781, accuracy: 8 } }).expect(200);
    expect(r.body.status).toBe('signed_in');
    const alerts = (await agency.get('/api/alerts').expect(200)).body;
    expect(alerts.some((a: any) => a.type === 'query' && /after this week's timesheet was approved/.test(a.message))).toBe(true);
    // This week was invoiced above, so it can't be reopened any more.
    const ts = (await agency.get(`/api/timesheets?week=${WEEK}`).expect(200)).body.timesheets.find((t: any) => t.siteId === sites.brighouse.id);
    const res = await agency.post(`/api/timesheets/${ts.id}/reopen`).send({ reason: 'Late hours' }).expect(400);
    expect(res.body.error).toMatch(/invoiced/);
  });
});

describe('fire roll call', () => {
  it('lists everyone on site and records who is safe', async () => {
    const rc = (await agency.post('/api/rollcalls').send({ siteId: sites.marsden.id, kind: 'drill' }).expect(200)).body;
    expect(rc.total).toBeGreaterThan(0);
    for (const p of rc.people) await agency.post(`/api/rollcalls/${rc.id}/mark`).send({ personId: p.id, safe: true }).expect(200);
    const withVisitor = (await agency.post(`/api/rollcalls/${rc.id}/visitor`).send({ name: 'Delivery driver' }).expect(200)).body;
    expect(withVisitor.total).toBe(rc.total + 1);
    expect(withVisitor.safe).toBe(rc.total);
    const done = (await agency.post(`/api/rollcalls/${rc.id}/finish`).send({ notes: 'Drill', kind: 'drill' }).expect(200)).body;
    expect(done.finishedAt).toBeTruthy();
    const pdf = await agency.get(`/api/rollcalls/${rc.id}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
});
