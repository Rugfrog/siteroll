// Hours, breaks and overtime. Pure functions so they are easy to test.
import { londonDate, weekdayIndex } from '../../shared/time';

export interface ClientRules {
  /** Break taken off when the worker doesn't say (minutes). */
  breakDefaultMins: number;
  /** Only apply the default break to shifts at least this long (minutes). */
  breakAfterMins: number;
  /** Overtime after this many worked minutes in a day (null = no daily rule). */
  otDailyMins: number | null;
  /** Overtime after this many worked minutes in a week (null = no weekly rule). */
  otWeeklyMins: number | null;
  otSaturday: boolean;
  otSunday: boolean;
  /** e.g. 1.5 for time-and-a-half */
  otMultiplier: number;
  /** Round sign-in and sign-out times to the nearest N minutes (0 = exact). */
  roundMins: number;
}

export interface Shift {
  id: number;
  workerId: number;
  /** London date 'YYYY-MM-DD' */
  date: string;
  inAt: string;
  outAt: string | null;
  /** What the worker said (null = they skipped the question) */
  breakMins: number | null;
}

export interface ShiftHours {
  id: number;
  workerId: number;
  date: string;
  inAt: string;
  outAt: string | null;
  breakMins: number;
  workedMins: number;
  normalMins: number;
  otMins: number;
}

/** Round a UTC instant to the nearest N minutes (ties round up). */
export function roundInstant(iso: string, roundMins: number): number {
  const t = new Date(iso).getTime();
  if (!roundMins) return Math.floor(t / 60000) * 60000;
  const step = roundMins * 60000;
  return Math.round(t / step) * step;
}

/** Break that applies to a shift: what the worker said, otherwise the client default. */
export function effectiveBreak(grossMins: number, stated: number | null, rules: ClientRules): number {
  const b = stated ?? (grossMins >= rules.breakAfterMins ? rules.breakDefaultMins : 0);
  return Math.max(0, Math.min(b, grossMins));
}

export function shiftWorked(shift: Shift, rules: ClientRules): { grossMins: number; breakMins: number; workedMins: number } {
  if (!shift.outAt) return { grossMins: 0, breakMins: 0, workedMins: 0 };
  const start = roundInstant(shift.inAt, rules.roundMins);
  const end = roundInstant(shift.outAt, rules.roundMins);
  const grossMins = Math.max(0, Math.round((end - start) / 60000));
  const breakMins = effectiveBreak(grossMins, shift.breakMins, rules);
  return { grossMins, breakMins, workedMins: grossMins - breakMins };
}

/**
 * Split one worker's week of shifts into normal and overtime minutes.
 * Order: weekend rules first (all overtime), then the daily limit, then the weekly limit
 * applied to the remaining normal minutes in date order.
 */
export function splitWeek(shifts: Shift[], rules: ClientRules): ShiftHours[] {
  const sorted = [...shifts].sort((a, b) => (a.inAt < b.inAt ? -1 : a.inAt > b.inAt ? 1 : a.id - b.id));
  const dayWorked = new Map<string, number>();
  let weekNormal = 0;
  return sorted.map((s) => {
    const { breakMins, workedMins } = shiftWorked(s, rules);
    const wd = weekdayIndex(s.date);
    let normal = workedMins;
    let ot = 0;
    if ((wd === 5 && rules.otSaturday) || (wd === 6 && rules.otSunday)) {
      ot = normal;
      normal = 0;
    } else {
      if (rules.otDailyMins != null) {
        const before = dayWorked.get(s.date) ?? 0;
        const allowed = Math.max(0, rules.otDailyMins - before);
        const n = Math.min(normal, allowed);
        ot += normal - n;
        normal = n;
      }
      if (rules.otWeeklyMins != null) {
        const allowed = Math.max(0, rules.otWeeklyMins - weekNormal);
        const n = Math.min(normal, allowed);
        ot += normal - n;
        normal = n;
      }
    }
    dayWorked.set(s.date, (dayWorked.get(s.date) ?? 0) + workedMins);
    weekNormal += normal;
    return { id: s.id, workerId: s.workerId, date: s.date, inAt: s.inAt, outAt: s.outAt, breakMins, workedMins, normalMins: normal, otMins: ot };
  });
}

/** Group shifts per worker and split each worker's week. */
export function splitByWorker(shifts: Shift[], rules: ClientRules): Map<number, ShiftHours[]> {
  const byWorker = new Map<number, Shift[]>();
  for (const s of shifts) {
    if (!byWorker.has(s.workerId)) byWorker.set(s.workerId, []);
    byWorker.get(s.workerId)!.push(s);
  }
  const out = new Map<number, ShiftHours[]>();
  for (const [w, list] of byWorker) out.set(w, splitWeek(list, rules));
  return out;
}

/** The London "work date" of a sign-in. */
export function workDateOf(iso: string): string {
  return londonDate(iso);
}

/** Late if signed in more than `graceMins` after the site start time. */
export function isLate(inAt: string, siteStartUtc: Date, graceMins = 5): boolean {
  return new Date(inAt).getTime() > siteStartUtc.getTime() + graceMins * 60000;
}
