// Booking confirmations ("who approves the hours?"), timesheet-only sites, workers' own hours and
// real email through Resend.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { clock, config } from '../src/server/config';
import { getDb } from '../src/server/db';
import { phoneFor, seed, SHEPLEY_CREW, WORKERS } from '../src/server/seed';
import { createApp } from '../src/server/app';
import { runNoShowCheck, runtime } from '../src/server/services/workflows';
import { emailTransportDeps, send } from '../src/server/services/messaging';
import { emailHtml, fromAddress, isFictionalEmail, type OutgoingEmail } from '../src/server/services/email';
import { londonToUtc } from '../src/shared/time';

const TODAY = '2026-10-14'; // a Wednesday
const WEEK = '2026-10-12';
const LAST_WEEK = '2026-10-05';
const at = (time: string) => () => londonToUtc(TODAY, time);

let app: Express;
let agency: ReturnType<typeof request.agent>;
let shepley: { id: number; qr_token: string };
let shepleyClient: any;

beforeAll(async () => {
  clock.now = at('10:00');
  runtime.baseUrl = 'http://siteroll.test';
  seed(getDb());
  app = createApp();
  agency = request.agent(app);
  await agency.post('/api/auth/login').send({ email: 'office@pennine.example', password: 'demo1234' }).expect(200);
  const clients = (await agency.get('/api/clients').expect(200)).body;
  shepleyClient = clients.find((c: any) => c.name === 'Shepley Homes Ltd');
  shepley = shepleyClient.sites[0];
});

async function rememberPhone(phone: string) {
  const worker = request.agent(app);
  const code = (await worker.post('/api/w/code').send({ phone }).expect(200)).body.demoCode;
  await worker.post('/api/w/verify').send({ phone, code }).expect(200);
  return worker;
}

const outbox = async (kind: string) => (await agency.get(`/api/outbox?kind=${kind}`).expect(200)).body as any[];
const tokenFrom = (link: string) => link.split('/').pop()!;
const timesheetFor = async (siteId: number, week: string) =>
  (await agency.get(`/api/timesheets?week=${week}`).expect(200)).body.timesheets.find((t: any) => t.siteId === siteId);

describe('timesheet-only sites', () => {
  it('turn each booked day into a normal day, from start to usual finish less the break', async () => {
    expect(shepley).toBeTruthy();
    // Last week: 2 people × 5 days × (08:00–16:30, less a 30-minute break) = 80 hours.
    expect((await timesheetFor(shepley.id, LAST_WEEK)).totals.totalMins).toBe(80 * 60);
    // This week so far: Monday, Tuesday and today (it's past the 08:00 start) = 48 hours.
    const ts = await timesheetFor(shepley.id, WEEK);
    expect(ts.totals.totalMins).toBe(48 * 60);
    const view = (await agency.get(`/api/timesheets/${ts.id}`).expect(200)).body;
    const shift = view.workers[0].shifts[0];
    expect(shift.method).toBe('booking');
    expect(shift.flags).toContain('booked_hours');
  });

  it("don't count today until the site's start time", async () => {
    clock.now = at('07:30');
    try {
      // Re-run the sync with the clock before 08:00 on a fresh week view: today's rows already exist, so check the rule directly.
      const { syncBookedHours } = await import('../src/server/services/timesheets');
      const db = getDb();
      db.prepare("DELETE FROM attendance WHERE site_id = ? AND work_date = ? AND method = 'booking'").run(shepley.id, TODAY);
      syncBookedHours(db, shepley.id, WEEK);
      expect((db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE site_id = ? AND work_date = ?').get(shepley.id, TODAY) as { n: number }).n).toBe(0);
    } finally {
      clock.now = at('10:00');
    }
    expect((await timesheetFor(shepley.id, WEEK)).totals.totalMins).toBe(48 * 60);
  });

  it('take a cancelled day off again, but keep a day the agency has edited', async () => {
    const bookings = (await agency.get(`/api/bookings?week=${WEEK}`).expect(200)).body.bookings as any[];
    const ian = bookings.find((b) => b.name === 'Ian Garside' && b.date === '2026-10-13');
    await agency.delete(`/api/bookings/${ian.id}`).expect(200);
    expect((await timesheetFor(shepley.id, WEEK)).totals.totalMins).toBe(40 * 60);

    // The agency corrects Stuart's Monday (he left early), then the booking is removed: the edit stays.
    const ts = await timesheetFor(shepley.id, WEEK);
    const view = (await agency.get(`/api/timesheets/${ts.id}`).expect(200)).body;
    const monday = view.workers.find((w: any) => w.name === 'Stuart Beever').shifts.find((s: any) => s.date === WEEK);
    await agency.put(`/api/attendance/${monday.id}`).send({ inTime: '08:00', outTime: '15:00', breakMins: 30, reason: 'Left early for a funeral' }).expect(200);
    const stuartMon = bookings.find((b) => b.name === 'Stuart Beever' && b.date === WEEK);
    await agency.delete(`/api/bookings/${stuartMon.id}`).expect(200);
    const after = (await agency.get(`/api/timesheets/${ts.id}`).expect(200)).body;
    const kept = after.workers.find((w: any) => w.name === 'Stuart Beever').shifts.find((s: any) => s.date === WEEK);
    expect(kept.workedMins).toBe(6.5 * 60);
  });

  it('never raise no-show alerts, because nobody signs in there', async () => {
    runNoShowCheck(getDb());
    const alerts = (await agency.get('/api/alerts').expect(200)).body as any[];
    expect(alerts.some((a) => a.type === 'no_show' && a.site_id === shepley.id)).toBe(false);
  });

  it('turn away a sign-in politely, and the live board shows who is booked instead', async () => {
    const stuart = await rememberPhone(phoneFor(WORKERS.length));
    const site = (await stuart.get(`/api/w/site/${shepley.qr_token}`).expect(200)).body;
    expect(site.site.signinMode).toBe('timesheet');
    const r = await stuart.post('/api/w/sign').send({ token: shepley.qr_token, action: 'in', reading: { lat: 53.5869, lng: -1.7123, accuracy: 10 } }).expect(400);
    expect(r.body.message).toMatch(/don't need to sign in/);
    const board = (await agency.get('/api/live').expect(200)).body.sites.find((s: any) => s.id === shepley.id);
    expect(board.mode).toBe('timesheet');
    expect(board.bookedToday.map((b: any) => b.name).sort()).toEqual(SHEPLEY_CREW.map((c) => `${c.first} ${c.last}`).sort());
    expect(board.expected).toEqual([]);
  });

  it('can be switched on and off from the site settings', async () => {
    const site = (await agency.get(`/api/sites/${shepley.id}`).expect(200)).body;
    await agency.put(`/api/sites/${shepley.id}`).send({ ...site, signin_mode: 'nonsense' }).expect(400);
    await agency.put(`/api/sites/${shepley.id}`).send({ ...site, signin_mode: 'timesheet' }).expect(200);
  });
});

describe("a worker's own hours", () => {
  it('needs a remembered phone', async () => {
    await request(app).get('/api/w/hours').expect(401);
  });

  it('shows this week and last, with each site approval status', async () => {
    const ian = await rememberPhone(phoneFor(WORKERS.length + 1));
    const { weeks } = (await ian.get('/api/w/hours').expect(200)).body;
    expect(weeks[0].weekStart).toBe(WEEK);
    expect(weeks[1].weekStart).toBe(LAST_WEEK);
    expect(weeks[1].totalMins).toBe(5 * 8 * 60);
    expect(weeks[1].shifts.every((s: any) => s.fromBooking)).toBe(true);
    // Tuesday was cancelled above, so this week is Monday and today.
    expect(weeks[0].totalMins).toBe(2 * 8 * 60);
    expect(weeks[0].sites[0].status).toBe('open');
  });

  it("only ever shows the worker's own hours", async () => {
    const callum = await rememberPhone(phoneFor(WORKERS.findIndex((w) => w.last === 'Ainley')));
    const { weeks } = (await callum.get('/api/w/hours').expect(200)).body;
    const names = new Set(weeks.flatMap((w: any) => w.sites.map((s: any) => s.name)));
    expect([...names]).toEqual(['Woodhouse Gardens, Brighouse']);
    // Last week's Brighouse sheet is waiting for Gareth.
    expect(weeks[1].sites[0].status).toBe('sent');
    expect(weeks[1].totalMins).toBeGreaterThan(0);
  });
});

describe('booking confirmation: who approves the hours?', () => {
  let token: string;

  it("won't send a sign-off request when nobody approves the hours yet", async () => {
    const ts = await timesheetFor(shepley.id, LAST_WEEK);
    const r = await agency.post(`/api/timesheets/${ts.id}/send`).expect(400);
    expect(r.body.error).toMatch(/Nobody approves the hours/);
  });

  it('emails the client who is booked, and asks who approves the hours', async () => {
    const week = (await agency.get(`/api/bookings?week=${WEEK}`).expect(200)).body;
    const site = week.sites.find((s: any) => s.id === shepley.id);
    expect(site.approvers).toEqual([]);
    expect(site.confirmation).toBeNull();
    expect(site.bookingsEmail).toBe('jo.ramsden@shepley.example');
    await agency.post('/api/bookings/confirm').send({ siteId: shepley.id, week: WEEK, email: 'not an email' }).expect(400);
    await agency.post('/api/bookings/confirm').send({ siteId: shepley.id, week: WEEK, email: 'jo.ramsden@shepley.example', name: 'Jo Ramsden' }).expect(200);
    const [mail] = await outbox('booking');
    expect(mail.recipient).toBe('jo.ramsden@shepley.example');
    expect(mail.subject).toMatch(/Booking confirmed: Penistone Road Barns/);
    expect(mail.body).toMatch(/Stuart Beever \(Joiner\)/);
    expect(mail.body).toMatch(/Who should that be\?/);
    expect(mail.link).toMatch(/^http:\/\/siteroll\.test\/who-approves\//);
    token = tokenFrom(mail.link);
    const after = (await agency.get(`/api/bookings?week=${WEEK}`).expect(200)).body.sites.find((s: any) => s.id === shepley.id);
    expect(after.confirmation.sentTo).toBe('jo.ramsden@shepley.example');
  });

  it('lets the client name someone from the link, without logging in', async () => {
    await request(app).get('/api/public/approver/not-a-real-token-at-all-really').expect(404);
    const page = (await request(app).get(`/api/public/approver/${token}`).expect(200)).body;
    expect(page.siteName).toBe('Penistone Road Barns, Shepley');
    expect(page.approvers).toEqual([]);
    await request(app).post(`/api/public/approver/${token}`).send({ name: 'Jo Ramsden', email: 'nope' }).expect(400);
    await request(app).post(`/api/public/approver/${token}`).send({ name: 'Jo Ramsden', email: 'Jo.Ramsden@Shepley.example', role: 'Project manager', phone: '' }).expect(200);

    const client = (await agency.get('/api/clients').expect(200)).body.find((c: any) => c.id === shepleyClient.id);
    const jo = client.managers.find((m: any) => m.name === 'Jo Ramsden');
    expect(jo.email).toBe('jo.ramsden@shepley.example');
    expect(jo.role).toBe('Project manager');
    expect(jo.siteIds).toEqual([shepley.id]);

    const mails = await outbox('approver');
    const welcome = mails.find((m) => m.recipient === 'jo.ramsden@shepley.example');
    expect(welcome.body).toMatch(/no password or account/i);
    expect(welcome.link).toMatch(/\/m\//);
    expect(mails.some((m) => m.recipient === 'office@pennine.example' && /approves the hours/.test(m.subject))).toBe(true);
  });

  it('then sends the weekly hours to that person, explaining they come from the booking', async () => {
    const ts = await timesheetFor(shepley.id, LAST_WEEK);
    const r = (await agency.post(`/api/timesheets/${ts.id}/send`).expect(200)).body;
    expect(r.sent).toBe(1);
    const mail = (await outbox('signoff')).find((m) => m.recipient === 'jo.ramsden@shepley.example');
    expect(mail.body).toMatch(/no sign-in on this site/);
  });

  it('can replace or add to the people who already approve a site', async () => {
    const clients = (await agency.get('/api/clients').expect(200)).body;
    const calder = clients.find((c: any) => c.name === 'Calder Construction Ltd');
    const halifax = calder.sites.find((s: any) => s.name.includes('Halifax'));
    const brighouse = calder.sites.find((s: any) => s.name.includes('Brighouse'));

    await agency.post('/api/bookings/confirm').send({ siteId: brighouse.id, week: WEEK, email: 'bookings@calder.example' }).expect(200);
    const asWell = tokenFrom((await outbox('booking'))[0].link);
    expect((await outbox('booking'))[0].body).toMatch(/Gareth Holroyd \(Site manager\)/);
    await request(app).post(`/api/public/approver/${asWell}`).send({ name: 'Dawn Pickles', email: 'dawn.pickles@calder.example', role: 'Contracts manager', replace: false }).expect(200);

    await agency.post('/api/bookings/confirm').send({ siteId: halifax.id, week: WEEK, email: 'bookings@calder.example' }).expect(200);
    const instead = tokenFrom((await outbox('booking'))[0].link);
    await request(app).post(`/api/public/approver/${instead}`).send({ name: 'Tom Hirst', email: 'tom.hirst@calder.example', role: 'Site manager', replace: true }).expect(200);

    const after = (await agency.get('/api/clients').expect(200)).body.find((c: any) => c.id === calder.id);
    const sitesOf = (name: string) => after.managers.find((m: any) => m.name === name).siteIds;
    expect(sitesOf('Gareth Holroyd')).toContain(brighouse.id);
    expect(sitesOf('Dawn Pickles')).toEqual([brighouse.id]);
    expect(sitesOf('Tom Hirst')).toEqual([halifax.id]);
    // Priya no longer gets Halifax's hours, but she hasn't been removed.
    expect(sitesOf('Priya Mistry')).toEqual([]);
  });
});

describe('real email (Resend)', () => {
  const saved = { ...config.email };
  const realSend = emailTransportDeps.send;
  const sent: OutgoingEmail[] = [];

  beforeAll(() => {
    config.email.resendKey = 're_test_key';
    config.email.from = 'timesheets@pennine-staffing.co.uk';
    emailTransportDeps.send = async (m) => {
      sent.push(m);
      return 'email_123';
    };
  });
  afterAll(() => {
    Object.assign(config.email, saved);
    emailTransportDeps.send = realSend;
  });

  const settle = async (subject: string) => {
    for (let i = 0; i < 100; i++) {
      const row = getDb().prepare('SELECT * FROM outbox WHERE subject = ? ORDER BY id DESC LIMIT 1').get(subject) as { status: string; error: string | null } | undefined;
      if (row && row.status !== 'sending') return row;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Email never finished sending');
  };

  it('knows which addresses are made up', () => {
    expect(isFictionalEmail('gareth.holroyd@calder.example')).toBe(true);
    expect(isFictionalEmail('someone@example.com')).toBe(true);
    expect(isFictionalEmail('x@site.test')).toBe(true);
    expect(isFictionalEmail('jo@shepleyhomes.co.uk')).toBe(false);
  });

  it('sends real addresses through Resend, with the link as a button and replies to the office', async () => {
    send.email({ to: 'jo@shepleyhomes.co.uk', toName: 'Jo Ramsden', kind: 'test', subject: 'Real one', body: 'Hi Jo,\n\nhttps://siteroll.test/m/abc\n\n<Thanks>', link: 'https://siteroll.test/m/abc', linkLabel: 'Open SiteRoll' });
    expect((await settle('Real one')).status).toBe('sent');
    const m = sent.find((x) => x.subject === 'Real one')!;
    expect(m.to).toBe('jo@shepleyhomes.co.uk');
    expect(m.fromName).toBe('Pennine Site Staffing Ltd');
    expect(m.html).toContain('>Open SiteRoll</a>');
    expect(m.html).toContain('&lt;Thanks&gt;');
    expect(m.text).toContain('https://siteroll.test/m/abc');
  });

  it("only simulates the demo's made-up addresses", async () => {
    const before = sent.length;
    send.email({ to: 'gareth.holroyd@calder.example', kind: 'test', subject: 'Made up', body: 'Hi' });
    expect((await settle('Made up')).status).toBe('simulated');
    expect(sent.length).toBe(before);
  });

  it('records a failure in the Outbox', async () => {
    emailTransportDeps.send = async () => {
      throw new Error('The pennine-staffing.co.uk domain is not verified');
    };
    send.email({ to: 'jo@shepleyhomes.co.uk', kind: 'test', subject: 'Will fail', body: 'Hi' });
    const row = await settle('Will fail');
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/not verified/);
    emailTransportDeps.send = async (m) => {
      sent.push(m);
      return 'email_124';
    };
  });

  it('attaches the invoice PDF when an invoice goes to a real address', async () => {
    const db = getDb();
    const calder = db.prepare("SELECT id FROM clients WHERE name = 'Calder Construction Ltd'").get() as { id: number };
    db.prepare("UPDATE clients SET billing_email = 'accounts@calderconstruction.co.uk' WHERE id = ?").run(calder.id);
    const r = (await agency.post('/api/invoices').send({ clientId: calder.id, week: LAST_WEEK }).expect(200)).body;
    const row = await settle(`Invoice ${r.number} from Pennine Site Staffing Ltd`);
    expect(row.status).toBe('sent');
    const m = sent.find((x) => x.subject.startsWith(`Invoice ${r.number}`))!;
    expect(m.attachments?.[0].filename).toBe(`${r.number}.pdf`);
    expect(m.attachments?.[0].content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('puts a name on the sender unless EMAIL_FROM has one', () => {
    expect(fromAddress('Pennine Site Staffing Ltd')).toBe('Pennine Site Staffing Ltd <timesheets@pennine-staffing.co.uk>');
    config.email.from = 'SiteRoll <hello@pennine-staffing.co.uk>';
    expect(fromAddress('Pennine Site Staffing Ltd')).toBe('SiteRoll <hello@pennine-staffing.co.uk>');
    config.email.from = 'timesheets@pennine-staffing.co.uk';
  });

  it('builds readable HTML with dark text on a light brand colour', () => {
    const html = emailHtml('Hello\n\nhttps://x.test/a', { agencyName: 'Yellow Ltd', colour: '#ffd400', link: 'https://x.test/a', linkLabel: 'Go' });
    expect(html).toContain('color:#111111');
    expect(html).toContain('>Go</a>');
  });
});
