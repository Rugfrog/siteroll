import { describe, expect, it } from 'vitest';
import { effectiveBreak, isLate, roundInstant, shiftWorked, splitWeek, type ClientRules, type Shift } from '../src/server/lib/hours';
import { workerTotals } from '../src/server/lib/money';
import { londonToUtc } from '../src/shared/time';

const base: ClientRules = {
  breakDefaultMins: 30,
  breakAfterMins: 360,
  otDailyMins: null,
  otWeeklyMins: null,
  otSaturday: false,
  otSunday: false,
  otMultiplier: 1.5,
  roundMins: 0,
};

let n = 0;
function shift(date: string, inT: string, outT: string | null, breakMins: number | null = null): Shift {
  return { id: ++n, workerId: 1, date, inAt: londonToUtc(date, inT).toISOString(), outAt: outT ? londonToUtc(date, outT).toISOString() : null, breakMins };
}

describe('breaks', () => {
  it('uses what the worker said', () => {
    expect(shiftWorked(shift('2026-10-12', '07:30', '16:30', 60), base).workedMins).toBe(480);
    expect(shiftWorked(shift('2026-10-12', '07:30', '16:30', 0), base).workedMins).toBe(540);
  });

  it("uses the client's default when they skip the question", () => {
    expect(shiftWorked(shift('2026-10-12', '07:30', '16:30', null), base)).toEqual({ grossMins: 540, breakMins: 30, workedMins: 510 });
  });

  it('only applies the default break to long enough shifts', () => {
    expect(shiftWorked(shift('2026-10-12', '08:00', '12:00', null), base).breakMins).toBe(0);
    expect(effectiveBreak(359, null, base)).toBe(0);
    expect(effectiveBreak(360, null, base)).toBe(30);
  });

  it('never takes off more break than the shift', () => {
    expect(effectiveBreak(20, 60, base)).toBe(20);
  });

  it('counts nothing for a shift still in progress', () => {
    expect(shiftWorked(shift('2026-10-12', '07:30', null), base).workedMins).toBe(0);
  });
});

describe('rounding', () => {
  it('rounds to the nearest quarter hour when the client wants it', () => {
    const r = { ...base, roundMins: 15 };
    // 07:23 → 07:30, 16:37 → 16:30, 30 min break: 8.5 hours
    expect(shiftWorked(shift('2026-10-12', '07:23', '16:37', 30), r).workedMins).toBe(510);
    // 07:22 → 07:15
    expect(new Date(roundInstant(londonToUtc('2026-10-12', '07:22').toISOString(), 15)).toISOString()).toBe(londonToUtc('2026-10-12', '07:15').toISOString());
  });
});

describe('overtime', () => {
  it('has no overtime without rules', () => {
    const week = ['12', '13', '14', '15', '16'].map((d) => shift(`2026-10-${d}`, '07:30', '18:00', 30));
    const s = splitWeek(week, base);
    expect(s.reduce((a, x) => a + x.otMins, 0)).toBe(0);
  });

  it('applies a daily threshold (over 8 hours a day)', () => {
    const r = { ...base, otDailyMins: 480 };
    const [d] = splitWeek([shift('2026-10-12', '07:00', '17:30', 30)], r);
    expect(d.workedMins).toBe(600);
    expect(d.normalMins).toBe(480);
    expect(d.otMins).toBe(120);
  });

  it('applies the daily threshold across two shifts on the same day', () => {
    const r = { ...base, otDailyMins: 480 };
    const s = splitWeek([shift('2026-10-12', '06:00', '11:00', 0), shift('2026-10-12', '12:00', '17:00', 0)], r);
    expect(s.map((x) => [x.normalMins, x.otMins])).toEqual([
      [300, 0],
      [180, 120],
    ]);
  });

  it('applies a weekly threshold (over 40 hours a week), in date order', () => {
    const r = { ...base, otWeeklyMins: 2400 };
    // 5 × 8.5 hours = 42.5 hours → 2.5 hours overtime on Friday
    const week = ['16', '12', '14', '13', '15'].map((d) => shift(`2026-10-${d}`, '07:30', '16:30', 30));
    const s = splitWeek(week, r);
    expect(s.map((x) => x.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(s.reduce((a, x) => a + x.normalMins, 0)).toBe(2400);
    expect(s[4].otMins).toBe(150);
    expect(s[3].otMins).toBe(0);
  });

  it('makes all Saturday hours overtime, without counting them towards the weekly limit', () => {
    const r = { ...base, otWeeklyMins: 2400, otSaturday: true };
    const week = [...['12', '13', '14', '15'].map((d) => shift(`2026-10-${d}`, '07:30', '16:30', 30)), shift('2026-10-17', '08:00', '13:00', 0)];
    const s = splitWeek(week, r);
    const sat = s.find((x) => x.date === '2026-10-17')!;
    expect(sat.normalMins).toBe(0);
    expect(sat.otMins).toBe(300);
    expect(s.reduce((a, x) => a + x.normalMins, 0)).toBe(2040);
  });

  it('combines daily and weekly rules without double counting', () => {
    const r = { ...base, otDailyMins: 540, otWeeklyMins: 2400 };
    // Five 10-hour days: daily O/T 1h each (5h); normal 9h × 5 = 45h → 5h more weekly O/T
    const week = ['12', '13', '14', '15', '16'].map((d) => shift(`2026-10-${d}`, '07:00', '17:00', 0));
    const s = splitWeek(week, r);
    expect(s.reduce((a, x) => a + x.otMins, 0)).toBe(600);
    expect(s.reduce((a, x) => a + x.normalMins, 0)).toBe(2400);
    expect(s.reduce((a, x) => a + x.workedMins, 0)).toBe(3000);
  });

  it('works across the clocks going back', () => {
    // Sat 24 Oct to Sun 25 Oct 2026, overnight: 22:00 BST to 06:00 GMT is 9 hours, not 8.
    const s: Shift = { id: 99, workerId: 1, date: '2026-10-24', inAt: londonToUtc('2026-10-24', '22:00').toISOString(), outAt: londonToUtc('2026-10-25', '06:00').toISOString(), breakMins: 0 };
    expect(shiftWorked(s, base).workedMins).toBe(540);
  });
});

describe('timesheet totals', () => {
  it('adds up hours and money for a worker', () => {
    const r = { ...base, otWeeklyMins: 2400, otSaturday: true };
    const week = [...['12', '13', '14', '15', '16'].map((d) => shift(`2026-10-${d}`, '07:30', '16:30', 30)), shift('2026-10-17', '08:00', '13:00', 0)];
    const split = splitWeek(week, r);
    const t = workerTotals(1, split, { payRate: 1350, chargeRate: 1750 }, 1.5);
    expect(t.normalMins).toBe(2400);
    expect(t.otMins).toBe(150 + 300);
    expect(t.totalMins).toBe(2850);
    // 40h × £13.50 = £540; 7.5h × £20.25 = £151.875 → £151.88
    expect(t.otPayRate).toBe(2025);
    expect(t.payPence).toBe(54000 + 15188);
    // 40h × £17.50 = £700; 7.5h × £26.25 = £196.875 → £196.88
    expect(t.chargePence).toBe(70000 + 19688);
  });
});

describe('lateness', () => {
  it('is late more than 5 minutes after the start', () => {
    const start = londonToUtc('2026-10-12', '07:30');
    expect(isLate(londonToUtc('2026-10-12', '07:35').toISOString(), start)).toBe(false);
    expect(isLate(londonToUtc('2026-10-12', '07:36').toISOString(), start)).toBe(true);
  });
});
