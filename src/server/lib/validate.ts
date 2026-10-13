// Small server-side validators. Every request body goes through these before touching the database.
import { isValidDate, isValidTime } from '../../shared/time';

export class ValidationError extends Error {
  status = 400;
}

const fail = (msg: string): never => {
  throw new ValidationError(msg);
};

export const v = {
  id(x: unknown, name = 'id'): number {
    const n = typeof x === 'string' ? Number(x) : x;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) fail(`Invalid ${name}`);
    return n as number;
  },
  int(x: unknown, name: string, min: number, max: number): number {
    const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) fail(`${name} must be a whole number between ${min} and ${max}`);
    return n as number;
  },
  intOrNull(x: unknown, name: string, min: number, max: number): number | null {
    return x === null || x === undefined || x === '' ? null : v.int(x, name, min, max);
  },
  num(x: unknown, name: string, min: number, max: number): number {
    const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) fail(`${name} must be between ${min} and ${max}`);
    return n as number;
  },
  str(x: unknown, name: string, max = 200, { required = true } = {}): string {
    if (x === undefined || x === null) x = '';
    if (typeof x !== 'string') fail(`${name} must be text`);
    const s = (x as string).trim();
    if (required && !s) fail(`${name} is required`);
    if (s.length > max) fail(`${name} is too long (${max} characters maximum)`);
    return s;
  },
  bool(x: unknown): boolean {
    return x === true || x === 1 || x === '1' || x === 'true';
  },
  oneOf<T extends string>(x: unknown, name: string, options: readonly T[]): T {
    if (!options.includes(x as T)) fail(`Invalid ${name}`);
    return x as T;
  },
  date(x: unknown, name = 'date'): string {
    if (!isValidDate(x)) fail(`${name} must be a date (YYYY-MM-DD)`);
    return x as string;
  },
  dateOrNull(x: unknown, name = 'date'): string | null {
    return x === null || x === undefined || x === '' ? null : v.date(x, name);
  },
  time(x: unknown, name = 'time'): string {
    if (!isValidTime(x)) fail(`${name} must be a time (HH:MM)`);
    return x as string;
  },
  /** £ amount as a string or number → pence */
  pounds(x: unknown, name: string): number {
    const n = typeof x === 'string' ? Number(x.replace(/[£,\s]/g, '')) : x;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10000) fail(`${name} must be an amount in pounds`);
    return Math.round((n as number) * 100);
  },
  colour(x: unknown): string {
    if (typeof x !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(x)) fail('Colour must look like #0e6655');
    return x as string;
  },
  email(x: unknown, name = 'Email', { required = false } = {}): string {
    const s = v.str(x, name, 200, { required });
    if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail(`${name} doesn't look like an email address`);
    return s;
  },
};
