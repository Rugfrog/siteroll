// Time helpers. Everything is stored in UTC and shown in Europe/London.
// Dates without a time ("work dates") are plain 'YYYY-MM-DD' strings in London local time.

export const TZ = 'Europe/London';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function londonParts(d: Date | string | number): LondonParts {
  const date = d instanceof Date ? d : new Date(d);
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** London calendar date, 'YYYY-MM-DD'. */
export function londonDate(d: Date | string | number = new Date()): string {
  const p = londonParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** London clock time, 'HH:MM'. */
export function londonTime(d: Date | string | number): string {
  const p = londonParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes that London is ahead of UTC at this instant (0 in winter, 60 in summer). */
export function londonOffsetMinutes(d: Date | number): number {
  const date = d instanceof Date ? d : new Date(d);
  const p = londonParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Convert a London wall-clock date and time to a UTC Date.
 * Handles the clocks changing: a time in the "missing" spring hour is moved forward,
 * and an ambiguous autumn time resolves to the first (BST) occurrence.
 */
export function londonToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Use the offset in force an hour earlier: that picks BST for the ambiguous autumn hour,
  // and pushes a time in the missing spring hour forward by an hour.
  const offset = londonOffsetMinutes(guess - 60 * 60000);
  return new Date(guess - offset * 60000);
}

export function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(date: string): number {
  const { y, m, d } = parseDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing this date. */
export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** 'HH:MM' → minutes after midnight */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
