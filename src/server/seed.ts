// Demo data: Pennine Site Staffing Ltd, two main contractors, three sites, 25 workers and six weeks
// of sign-ins. Everything is generated relative to "today", so the demo always looks current.
// Deterministic (seeded random numbers), so every reset looks the same for a given day.
import type { DB } from './db';
import { clearAll, nowIso } from './db';
import { clock } from './config';
import { addDays, londonDate, londonToUtc, mondayOf, weekdayIndex } from '../shared/time';
import { hashPassword, randomToken } from './lib/security';
import { approveTimesheet, ensureTimesheet } from './services/timesheets';
import { closeMissedSignOuts } from './services/attendance';
import { createInvoice, runNoShowCheck, sendSignoffRequest } from './services/workflows';
import { SimulatedMessenger, setMessenger } from './services/messaging';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_LOGIN = { email: 'office@pennine.example', password: 'demo1234' };

interface WorkerSeed {
  first: string;
  last: string;
  trade: string;
  pay: number;
  charge: number;
  crew: 'B' | 'H' | 'M' | 'spare';
  card: { scheme: 'CSCS' | 'CPCS'; type: string; expiryDays: number };
  tickets?: { name: string; expiryDays: number | null }[];
  noRtw?: boolean;
}

const LAB = { scheme: 'CSCS' as const, type: 'Labourer (green)' };
const SKL = { scheme: 'CSCS' as const, type: 'Skilled Worker (blue)' };

export const WORKERS: WorkerSeed[] = [
  { first: 'Dave', last: 'Haigh', trade: 'Site supervisor', pay: 2800, charge: 3600, crew: 'B', card: { scheme: 'CSCS', type: 'Supervisor (gold)', expiryDays: 900 }, tickets: [{ name: 'SMSTS', expiryDays: 640 }, { name: 'First Aid at Work', expiryDays: 21 }] },
  { first: 'Callum', last: 'Ainley', trade: 'General labourer', pay: 1350, charge: 1750, crew: 'B', card: { ...LAB, expiryDays: 700 } },
  { first: 'Liam', last: 'Sutcliffe', trade: 'Bricklayer', pay: 2400, charge: 3200, crew: 'B', card: { ...SKL, expiryDays: 1200 } },
  { first: 'Tomasz', last: 'Nowak', trade: 'Bricklayer', pay: 2400, charge: 3200, crew: 'B', card: { ...SKL, expiryDays: 410 } },
  { first: 'Jordan', last: 'Booth', trade: 'Bricklayer', pay: 2350, charge: 3150, crew: 'B', card: { ...SKL, expiryDays: 980 } },
  { first: 'Ryan', last: 'Firth', trade: 'Joiner', pay: 2200, charge: 2950, crew: 'B', card: { ...SKL, expiryDays: 530 } },
  { first: 'Kieran', last: 'Lockwood', trade: 'Joiner', pay: 2200, charge: 2950, crew: 'B', card: { ...SKL, expiryDays: 300 } },
  { first: 'Aisha', last: 'Rahman', trade: 'Plasterer', pay: 2100, charge: 2850, crew: 'B', card: { ...SKL, expiryDays: 1500 } },
  { first: 'Mark', last: 'Dyson', trade: 'Groundworker', pay: 1700, charge: 2250, crew: 'B', card: { ...SKL, expiryDays: 820 }, tickets: [{ name: 'NRSWA Operative', expiryDays: 1000 }] },
  { first: 'Paul', last: 'Crowther', trade: 'Groundworker', pay: 1700, charge: 2250, crew: 'B', card: { ...SKL, expiryDays: 260 } },
  { first: 'Josh', last: 'Senior', trade: 'General labourer', pay: 1350, charge: 1750, crew: 'B', card: { ...LAB, expiryDays: 19 } },
  { first: 'Ben', last: 'Kaye', trade: 'General labourer', pay: 1400, charge: 1800, crew: 'B', card: { ...LAB, expiryDays: 640 } },
  { first: 'Hassan', last: 'Iqbal', trade: 'Plant operator', pay: 2000, charge: 2700, crew: 'B', card: { scheme: 'CPCS', type: 'Competent Operator (blue) – A59 360° excavator', expiryDays: 1100 } },
  { first: 'Adam', last: 'Barraclough', trade: 'General labourer', pay: 1300, charge: 1700, crew: 'B', card: { ...LAB, expiryDays: 450 } },
  { first: 'Sophie', last: 'Walsh', trade: 'Joiner', pay: 2200, charge: 2950, crew: 'H', card: { ...SKL, expiryDays: 760 } },
  { first: 'Gary', last: 'Armitage', trade: 'General labourer', pay: 1350, charge: 1750, crew: 'H', card: { ...LAB, expiryDays: 350 } },
  { first: 'Daniel', last: 'Okafor', trade: 'Plasterer', pay: 2100, charge: 2850, crew: 'H', card: { ...SKL, expiryDays: 1300 } },
  { first: 'Craig', last: 'Hirst', trade: 'Groundworker', pay: 1750, charge: 2300, crew: 'H', card: { ...SKL, expiryDays: 12 }, tickets: [{ name: 'Asbestos awareness', expiryDays: 200 }] },
  { first: 'Lee', last: 'Pearson', trade: 'Bricklayer', pay: 2450, charge: 3250, crew: 'M', card: { ...SKL, expiryDays: 690 } },
  { first: 'Nathan', last: 'Shaw', trade: 'Joiner', pay: 2250, charge: 3000, crew: 'M', card: { ...SKL, expiryDays: 870 } },
  { first: 'Owen', last: 'Bamforth', trade: 'General labourer', pay: 1300, charge: 1700, crew: 'M', card: { ...LAB, expiryDays: 25 } },
  { first: 'Ewan', last: 'Mellor', trade: 'Plasterer', pay: 2100, charge: 2850, crew: 'M', card: { ...SKL, expiryDays: 1000 } },
  { first: 'Kyle', last: 'Dyson', trade: 'General labourer', pay: 1300, charge: 1700, crew: 'spare', card: { ...LAB, expiryDays: -40 } },
  { first: 'Reece', last: 'Hinchliffe', trade: 'General labourer', pay: 1300, charge: 1700, crew: 'spare', card: { ...LAB, expiryDays: 580 }, noRtw: true },
  { first: 'Mohammed', last: 'Hussain', trade: 'Groundworker', pay: 1700, charge: 2250, crew: 'spare', card: { ...SKL, expiryDays: 720 } },
];

export const phoneFor = (i: number) => `07700900${String(101 + i).padStart(3, '0')}`;

/** Who is on which site in the current week (by surname) — the rest of the crew are on other work. */
const THIS_WEEK: Record<string, string[]> = {
  B: ['Haigh', 'Ainley', 'Sutcliffe', 'Nowak', 'Booth', 'Firth', 'Rahman', 'Dyson:Mark', 'Iqbal'],
  H: ['Walsh', 'Armitage', 'Okafor', 'Hirst'],
  M: ['Pearson', 'Shaw', 'Bamforth'],
};

export function seed(db: DB, opts: { today?: string } = {}) {
  const realNow = clock.now();
  const rand = rng(20261013);
  const between = (a: number, b: number) => Math.round(a + rand() * (b - a));
  const chance = (p: number) => rand() < p;
  setMessenger(new SimulatedMessenger());
  clearAll(db);

  const today = opts.today ?? londonDate(realNow);
  const thisWeek = mondayOf(today);
  const created = nowIso(realNow);

  /* ---------- Agency ---------- */
  db.prepare(
    `INSERT INTO agency (id, name, address, phone, email, brand_colour, vat_number, company_number, bank_name, bank_sort_code, bank_account, payment_terms_days, photo_retention_days, next_invoice_number, yard_lat, yard_lng)
     VALUES (1, 'Pennine Site Staffing Ltd', 'Unit 7, Lowfields Business Park, Leeds Road, Huddersfield HD2 1UH', '01632 960123', 'office@pennine.example', '#0e6655',
     'GB 123 4567 89', '09876543', 'Example Bank plc', '12-34-56', '12345678', 30, 90, 1, 53.6532, -1.7676)`,
  ).run();
  db.prepare('INSERT INTO users (name, email, phone, password_hash, created_at) VALUES (?,?,?,?,?)').run('Michelle Lockwood', DEMO_LOGIN.email, '07700900999', hashPassword(DEMO_LOGIN.password), created);

  /* ---------- Clients ---------- */
  const calder = Number(
    db
      .prepare(
        `INSERT INTO clients (name, address, billing_email, break_default_mins, break_after_mins, ot_daily_mins, ot_weekly_mins, ot_saturday, ot_sunday, ot_multiplier, round_mins, selfie_required, compliance_mode, signoff_day, signoff_time)
         VALUES ('Calder Construction Ltd', 'Calder House, Wakefield Road, Brighouse HD6 1QL', 'accounts@calder.example', 30, 360, NULL, 2400, 1, 1, 1.5, 15, 0, 'warn', 4, '14:00')`,
      )
      .run().lastInsertRowid,
  );
  const colne = Number(
    db
      .prepare(
        `INSERT INTO clients (name, address, billing_email, break_default_mins, break_after_mins, ot_daily_mins, ot_weekly_mins, ot_saturday, ot_sunday, ot_multiplier, round_mins, selfie_required, compliance_mode, signoff_day, signoff_time)
         VALUES ('Colne Valley Developments', 'Brook Mill, Manchester Road, Slaithwaite HD7 5HN', 'invoices@colnevalley.example', 30, 360, 540, NULL, 1, 1, 1.5, 15, 1, 'block', 4, '14:00')`,
      )
      .run().lastInsertRowid,
  );

  /* ---------- Sites ---------- */
  const addSite = (clientId: number, name: string, address: string, postcode: string, lat: number, lng: number, radius: number, start: string, finish: string) =>
    Number(
      db
        .prepare('INSERT INTO sites (client_id, name, address, postcode, lat, lng, radius_m, start_time, finish_time, qr_token) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(clientId, name, address, postcode, lat, lng, radius, start, finish, randomToken(12)).lastInsertRowid,
    );
  const siteB = addSite(calder, 'Woodhouse Gardens, Brighouse', '32 new homes, off Bradford Road, Brighouse', 'HD6 4DJ', 53.7105, -1.7781, 250, '07:30', '16:30');
  const siteH = addSite(calder, 'Ovenden Park School extension, Halifax', 'Ovenden Park Primary School, Ovenden Road, Halifax', 'HX3 5QG', 53.7385, -1.8655, 150, '08:00', '16:30');
  const siteM = addSite(colne, 'Mill Lane Apartments, Marsden', 'Former Bank Bottom works, Mill Lane, Marsden', 'HD7 6DH', 53.601, -1.93, 200, '07:30', '16:30');
  const sites: Record<string, { id: number; start: string; finish: string; lat: number; lng: number }> = {
    B: { id: siteB, start: '07:30', finish: '16:30', lat: 53.7105, lng: -1.7781 },
    H: { id: siteH, start: '08:00', finish: '16:30', lat: 53.7385, lng: -1.8655 },
    M: { id: siteM, start: '07:30', finish: '16:30', lat: 53.601, lng: -1.93 },
  };

  /* ---------- Managers ---------- */
  const addManager = (clientId: number, name: string, email: string, phone: string, siteIds: number[]) => {
    const id = Number(db.prepare('INSERT INTO managers (client_id, name, email, phone) VALUES (?,?,?,?)').run(clientId, name, email, phone).lastInsertRowid);
    for (const s of siteIds) db.prepare('INSERT INTO manager_sites (manager_id, site_id) VALUES (?,?)').run(id, s);
    return id;
  };
  const mgrB = addManager(calder, 'Gareth Holroyd', 'gareth.holroyd@calder.example', '07700900501', [siteB]);
  const mgrH = addManager(calder, 'Priya Mistry', 'priya.mistry@calder.example', '07700900502', [siteH]);
  const mgrM = addManager(colne, 'Sean Brierley', 'sean.brierley@colnevalley.example', '07700900503', [siteM]);
  const managerFor: Record<number, { id: number; name: string }> = {
    [siteB]: { id: mgrB, name: 'Gareth Holroyd' },
    [siteH]: { id: mgrH, name: 'Priya Mistry' },
    [siteM]: { id: mgrM, name: 'Sean Brierley' },
  };

  /* ---------- Workers ---------- */
  const firstWeek = addDays(thisWeek, -42);
  const emergencyNames = ['Karen', 'Steve', 'Joanne', 'Mick', 'Lisa', 'Tony', 'Rachel', 'Shaz', 'Debbie', 'Ian'];
  const workerIds: number[] = [];
  WORKERS.forEach((w, i) => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO workers (first_name, last_name, phone, trade, pay_rate, charge_rate, ni_number, card_scheme, card_type, card_number, card_expiry, rtw_checked_on, rtw_checked_by, emergency_name, emergency_phone, created_at)
           VALUES (?,?,?,?,?,?,'',?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          w.first,
          w.last,
          phoneFor(i),
          w.trade,
          w.pay,
          w.charge,
          w.card.scheme,
          w.card.type,
          String(between(10000000, 99999999)),
          addDays(today, w.card.expiryDays),
          w.noRtw ? null : addDays(firstWeek, -between(10, 200)),
          w.noRtw ? '' : 'Michelle Lockwood',
          `${emergencyNames[i % emergencyNames.length]} ${w.last}`,
          `07700900${String(601 + i).padStart(3, '0')}`,
          created,
        ).lastInsertRowid,
    );
    workerIds.push(id);
    for (const t of w.tickets ?? []) {
      db.prepare('INSERT INTO worker_tickets (worker_id, name, number, expiry) VALUES (?,?,?,?)').run(id, t.name, String(between(100000, 999999)), t.expiryDays == null ? null : addDays(today, t.expiryDays));
    }
    if (w.crew !== 'spare') {
      db.prepare('INSERT INTO inductions (worker_id, site_id, inducted_on, inducted_by) VALUES (?,?,?,?)').run(id, sites[w.crew].id, addDays(firstWeek, between(0, 2)), managerFor[sites[w.crew].id].name);
    }
  });
  const idBy = (key: string) => {
    const [last, first] = key.split(':');
    const i = WORKERS.findIndex((w) => w.last === last && (!first || w.first === first));
    return workerIds[i];
  };

  /* ---------- Six weeks of history ---------- */
  const insAtt = db.prepare(
    `INSERT INTO attendance (worker_id, site_id, work_date, in_at, out_at, in_lat, in_lng, in_accuracy, in_distance_m, out_lat, out_lng, out_accuracy, out_distance_m, break_mins, method, flags, status, out_method, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insBooking = db.prepare("INSERT OR IGNORE INTO bookings (worker_id, site_id, date, status, created_at) VALUES (?,?,?,?,?)");
  const jitter = () => (rand() - 0.5) * 0.0012;

  function shift(workerId: number, crew: string, date: string, inT: string, outT: string | null, breakMins: number | null, flags: string[] = [], status = 'ok', method = 'gps') {
    const s = sites[crew];
    const inAt = londonToUtc(date, inT).toISOString();
    const outAt = outT ? londonToUtc(date, outT).toISOString() : null;
    const r = insAtt.run(
      workerId,
      s.id,
      date,
      inAt,
      outAt,
      s.lat + jitter(),
      s.lng + jitter(),
      between(6, 35),
      between(5, 70),
      outAt ? s.lat + jitter() : null,
      outAt ? s.lng + jitter() : null,
      outAt ? between(6, 35) : null,
      outAt ? between(5, 70) : null,
      breakMins,
      method,
      JSON.stringify(flags),
      status,
      outAt ? 'gps' : null,
      inAt,
    );
    return Number(r.lastInsertRowid);
  }
  const hm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const pickBreak = () => {
    const r = rand();
    return r < 0.75 ? 30 : r < 0.95 ? null : 0;
  };

  const edit = (attId: number, by: string, at: Date, changes: { field: string; from: string | null; to: string | null }[], reason: string) =>
    db.prepare('INSERT INTO attendance_edits (attendance_id, edited_by, edited_at, changes, reason) VALUES (?,?,?,?,?)').run(attId, by, at.toISOString(), JSON.stringify(changes), reason);

  for (let w = -6; w <= 0; w++) {
    const week = addDays(thisWeek, w * 7);
    for (const [i, ws] of WORKERS.entries()) {
      if (ws.crew === 'spare') continue;
      const workerId = workerIds[i];
      const crew = ws.crew;
      // Adam only did last week at Brighouse.
      if (ws.last === 'Barraclough' && w !== -1) continue;
      if (w === 0 && !THIS_WEEK[crew].some((k) => idBy(k) === workerId)) continue;
      for (let d = 0; d < 5; d++) {
        const date = addDays(week, d);
        if (date >= today) break;
        const s = sites[crew];
        if (chance(0.03)) {
          insBooking.run(workerId, s.id, date, 'no_show', nowIso(londonToUtc(addDays(week, -3), '10:00')));
          continue;
        }
        insBooking.run(workerId, s.id, date, 'booked', nowIso(londonToUtc(addDays(week, -3), '10:00')));
        const flags: string[] = [];
        let inMin = toMin(s.start) + between(-12, 4);
        if (chance(0.04)) {
          inMin = toMin(s.start) + between(12, 50);
          flags.push('late');
        }
        let outMin = toMin(s.finish) + between(-3, 12);
        if (chance(0.09)) outMin += between(45, 120);
        shift(workerId, crew, date, hm(inMin), hm(outMin), pickBreak(), flags);
      }
    }
    // Saturday overtime at Brighouse in two of the weeks, including last week.
    if (w === -5 || w === -1) {
      const sat = addDays(week, 5);
      for (const k of ['Haigh', 'Sutcliffe', 'Nowak', 'Booth', 'Dyson:Mark', 'Kaye']) {
        insBooking.run(idBy(k), siteB, sat, 'booked', created);
        shift(idBy(k), 'B', sat, hm(toMin('08:00') + between(-6, 3)), hm(toMin('13:00') + between(-3, 8)), 0);
      }
    }
  }

  /* ---------- The awkward cases ---------- */
  const officer = 'Michelle Lockwood (agency)';
  const findShift = (worker: string, date: string) =>
    db.prepare('SELECT * FROM attendance WHERE worker_id = ? AND work_date = ?').get(idBy(worker), date) as { id: number; in_at: string; out_at: string; site_id: number } | undefined;

  // Missed sign-outs in past weeks, since sorted out by the agency.
  for (const [who, wk, day] of [['Lockwood', -5, 2], ['Okafor', -4, 3], ['Pearson', -2, 1]] as const) {
    const date = addDays(addDays(thisWeek, wk * 7), day);
    const a = findShift(who, date);
    if (!a) continue;
    const site = Object.values(sites).find((s) => s.id === a.site_id)!;
    const auto = londonToUtc(date, site.finish).toISOString();
    db.prepare("UPDATE attendance SET out_at = ?, out_method = 'auto', out_lat = NULL, out_lng = NULL, out_accuracy = NULL, out_distance_m = NULL, flags = ?, status = 'ok' WHERE id = ?").run(
      auto,
      JSON.stringify(['missed_signout', 'edited']),
      a.id,
    );
    edit(a.id, officer, londonToUtc(addDays(date, 1), '09:12'), [{ field: 'Status', from: 'Needs checking', to: 'Checked' }], 'Rang him. Confirmed he left at the usual time.');
  }

  // The disputed day: client said Jordan left at 14:00, not 16:30.
  {
    const date = addDays(addDays(thisWeek, -21), 3);
    const a = findShift('Booth', date);
    if (a) {
      const newOut = londonToUtc(date, '14:00').toISOString();
      db.prepare("UPDATE attendance SET out_at = ?, flags = ?, status = 'ok', query_comment = ? WHERE id = ?").run(
        newOut,
        JSON.stringify(['disputed', 'edited']),
        'Jordan left site at 2pm for a dentist appointment – he told me himself. (Gareth)',
        a.id,
      );
      edit(a.id, 'Gareth Holroyd (Calder Construction Ltd)', londonToUtc(addDays(thisWeek, -17), '15:05'), [{ field: 'Query', from: null, to: 'Left site at 2pm, not 4:30pm' }], 'Queried by site manager');
      edit(a.id, officer, londonToUtc(addDays(thisWeek, -14), '09:40'), [{ field: 'Signed out', from: '16:3x', to: '14:00' }], 'Agreed with Jordan and Gareth. Forgot to sign out when he left for the dentist.');
    }
  }

  // A manual sign-in at Halifax two weeks ago (phone GPS playing up), approved by Priya.
  {
    const date = addDays(addDays(thisWeek, -14), 1);
    const a = findShift('Walsh', date);
    if (a) {
      db.prepare("UPDATE attendance SET method = 'manual', flags = ?, status = 'ok' WHERE id = ?").run(JSON.stringify(['manual']), a.id);
      db.prepare("INSERT INTO sign_in_attempts (worker_id, site_id, action, at, lat, lng, accuracy, distance_m, reason, status, decided_by, decided_at, attendance_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        idBy('Walsh'),
        siteH,
        'in',
        a.in_at,
        53.7392,
        -1.8721,
        1400,
        460,
        'inaccurate',
        'approved',
        'Priya Mistry',
        a.in_at,
        a.id,
      );
    }
  }

  /* ---------- Approvals, sign-off requests and invoices for past weeks ---------- */
  const withClock = <T,>(when: Date, fn: () => T): T => {
    const prev = clock.now;
    clock.now = () => new Date(when);
    try {
      return fn();
    } finally {
      clock.now = prev;
    }
  };

  for (let w = -6; w <= -1; w++) {
    const week = addDays(thisWeek, w * 7);
    const friday = addDays(week, 4);
    for (const crew of ['B', 'H', 'M']) {
      const sId = sites[crew].id;
      const ts = ensureTimesheet(db, sId, week);
      withClock(londonToUtc(friday, '14:00'), () => sendSignoffRequest(db, ts.id));
      // Last week's Brighouse sheet is still waiting for Gareth, for the one-tap approval demo.
      if (w === -1 && crew === 'B') continue;
      const m = managerFor[sId];
      withClock(londonToUtc(friday, `15:${String(between(5, 55)).padStart(2, '0')}`), () =>
        approveTimesheet(db, ts.id, { managerId: m.id, name: m.name, device: 'Mozilla/5.0 (Linux; Android 13; SM-A136B) Chrome/129 Mobile · 10.0.0.x' }),
      );
    }
    // Invoices go out on the Monday after.
    const monday = addDays(week, 7);
    if (monday > today) continue;
    for (const clientId of [calder, colne]) {
      if (w === -1 && clientId === calder) continue; // waiting for Brighouse approval
      const inv = withClock(londonToUtc(monday, '09:30'), () => createInvoice(db, clientId, week));
      // Older invoices have been paid, except one from Colne Valley which is overdue.
      const overdue = clientId === colne && w === -6;
      if (w <= -4 && !overdue) {
        db.prepare("UPDATE invoices SET status = 'paid', paid_on = ? WHERE id = ?").run(addDays(monday, between(18, 27)), inv.id);
      }
    }
  }

  /* ---------- Roll call history: a drill three weeks ago ---------- */
  {
    const date = addDays(addDays(thisWeek, -21), 2);
    const started = londonToUtc(date, '11:00');
    const rc = Number(
      db
        .prepare("INSERT INTO roll_calls (site_id, kind, started_by, started_at, finished_at, notes) VALUES (?, 'drill', 'Gareth Holroyd', ?, ?, ?)")
        .run(siteB, started.toISOString(), new Date(started.getTime() + 6 * 60000).toISOString(), 'Planned fire drill. Everyone at the muster point (site entrance) within 4 minutes.').lastInsertRowid,
    );
    const onSite = db.prepare('SELECT a.worker_id, w.first_name, w.last_name, w.trade FROM attendance a JOIN workers w ON w.id = a.worker_id WHERE a.site_id = ? AND a.work_date = ?').all(siteB, date) as {
      worker_id: number;
      first_name: string;
      last_name: string;
      trade: string;
    }[];
    for (const p of onSite) {
      db.prepare('INSERT INTO roll_call_people (roll_call_id, worker_id, name, detail, safe_at) VALUES (?,?,?,?,?)').run(
        rc,
        p.worker_id,
        `${p.first_name} ${p.last_name}`,
        p.trade,
        new Date(started.getTime() + between(60, 240) * 1000).toISOString(),
      );
    }
    db.prepare('INSERT INTO roll_call_people (roll_call_id, name, detail, is_visitor, safe_at) VALUES (?,?,?,1,?)').run(rc, 'Building control inspector', 'Visitor', new Date(started.getTime() + 150000).toISOString());
  }

  /* ---------- This week: bookings for the whole week and today's sign-ins ---------- */
  const realNowMs = realNow.getTime();
  for (const crew of ['B', 'H', 'M'] as const) {
    for (const k of THIS_WEEK[crew]) {
      for (let d = 0; d < 5; d++) {
        const date = addDays(thisWeek, d);
        if (date < today) continue; // past days were booked above
        insBooking.run(idBy(k), sites[crew].id, date, 'booked', created);
      }
      // Weekend demo: make sure "today" always has bookings.
      if (weekdayIndex(today) >= 5) insBooking.run(idBy(k), sites[crew].id, today, 'booked', created);
    }
  }

  // Ryan didn't sign out on Monday: the 20:00 check will close it and flag it.
  const monday = thisWeek;
  if (monday < today) {
    const a = findShift('Firth', monday);
    if (a) db.prepare('UPDATE attendance SET out_at = NULL, out_lat = NULL, out_lng = NULL, out_accuracy = NULL, out_distance_m = NULL, out_method = NULL, break_mins = NULL WHERE id = ?').run(a.id);
    withClock(londonToUtc(monday, '20:00'), () => closeMissedSignOuts(db, { includeToday: true }));
  }

  // Today's arrivals. Callum (the demo worker) and Mark (a no-show) haven't turned up.
  const todayPlan: [string, string, number, string[]][] = [
    ['Haigh', 'B', -18, []],
    ['Sutcliffe', 'B', -9, []],
    ['Nowak', 'B', -7, []],
    ['Booth', 'B', -4, []],
    ['Firth', 'B', -2, []],
    ['Rahman', 'B', 1, []],
    ['Iqbal', 'B', -14, []],
    ['Kaye', 'B', -5, ['not_booked']],
    ['Walsh', 'H', -10, []],
    ['Okafor', 'H', -6, []],
    ['Hirst', 'H', -3, []],
    ['Armitage', 'H', 26, ['late']],
    ['Pearson', 'M', -11, []],
    ['Shaw', 'M', -8, []],
    ['Bamforth', 'M', 3, []],
  ];
  for (const [who, crew, offset, flags] of todayPlan) {
    const s = sites[crew];
    const inMin = toMin(s.start) + offset;
    const inAt = londonToUtc(today, hm(inMin));
    if (inAt.getTime() > realNowMs) continue; // not arrived yet if the demo is early in the morning
    const id = shift(idBy(who), crew, today, hm(inMin), null, null, flags);
    db.prepare('UPDATE attendance SET out_lat = NULL, out_lng = NULL, out_accuracy = NULL, out_distance_m = NULL WHERE id = ?').run(id);
  }
  // Ben signed in without a booking: tell the agency.
  db.prepare("INSERT INTO alerts (type, site_id, worker_id, date, message, created_at) VALUES ('not_booked', ?, ?, ?, ?, ?)").run(
    siteB,
    idBy('Kaye'),
    today,
    "Ben Kaye signed in at Woodhouse Gardens, Brighouse but isn't booked anywhere today.",
    londonToUtc(today, '07:25').toISOString(),
  );
  // Someone tried to sign in from the yard this morning.
  db.prepare("INSERT INTO sign_in_attempts (worker_id, site_id, action, at, lat, lng, accuracy, distance_m, reason) VALUES (?,?,?,?,?,?,?,?, 'outside')").run(
    idBy('Senior'),
    siteB,
    'in',
    londonToUtc(today, '07:21').toISOString(),
    53.6532,
    -1.7676,
    18,
    6480,
  );

  // A couple of codes already in the outbox, as if workers had set up new phones.
  db.prepare("INSERT INTO outbox (channel, recipient, recipient_name, subject, body, kind, created_at) VALUES ('sms', ?, ?, '', ?, 'code', ?)").run(
    phoneFor(WORKERS.findIndex((w) => w.last === 'Okafor')),
    'Daniel Okafor',
    'Your SiteRoll code is 482913. It expires in 10 minutes. Never share this code.',
    londonToUtc(today, '07:49').toISOString(),
  );

  // No-show alerts for anyone booked who hasn't arrived 15 minutes after the start.
  runNoShowCheck(db);

  return { today, thisWeek, sites: { siteB, siteH, siteM }, managers: { mgrB, mgrH, mgrM }, clients: { calder, colne } };
}
