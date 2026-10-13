// UK formatting used by the dashboard, the worker page, PDFs and CSVs.
import { TZ } from './time';

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dmyFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function dateOnly(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** 'YYYY-MM-DD' → 'Mon 13 Oct' */
export function fmtDay(date: string): string {
  return dayFmt.format(dateOnly(date)).replace(',', '');
}

/** 'YYYY-MM-DD' → 'Monday 13 October 2026' */
export function fmtDayLong(date: string): string {
  return longDayFmt.format(dateOnly(date)).replace(',', '');
}

/** 'YYYY-MM-DD' → '13 Oct 2026' */
export function fmtDate(date: string): string {
  return dmyFmt.format(dateOnly(date));
}

/** UTC instant → '07:32' London time */
export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return '–';
  return timeFmt.format(new Date(iso));
}

/** UTC instant → 'Mon 13 Oct, 07:32' London time */
export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '–';
  return dateTimeFmt.format(new Date(iso)).replace(/,? (\d\d:\d\d)$/, ', $1').replace(/^(\w{3}),/, '$1');
}

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** pence → '£1,234.56' */
export function fmtMoney(pence: number): string {
  return gbp.format(pence / 100);
}

/** pence → '1234.56' (for CSVs) */
export function penceToDecimal(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(pence);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** minutes → '8.5' hours, up to 2 decimal places */
export function fmtHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 100) / 100;
  return h.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/** minutes → '8h 30m' */
export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** '07700900123' → '07700 900123' */
export function fmtPhone(phone: string): string {
  const p = phone.replace(/\s+/g, '');
  return /^0\d{10}$/.test(p) ? `${p.slice(0, 5)} ${p.slice(5)}` : phone;
}

/** Normalise a UK mobile to '07…' 11 digits, or null if it isn't one. */
export function normaliseMobile(input: string): string | null {
  let p = String(input || '').replace(/[\s\-().]/g, '');
  if (p.startsWith('+44')) p = '0' + p.slice(3);
  else if (p.startsWith('0044')) p = '0' + p.slice(4);
  else if (p.startsWith('44') && p.length === 12) p = '0' + p.slice(2);
  return /^07\d{9}$/.test(p) ? p : null;
}

export function fmtMiles(metres: number): string {
  const miles = metres / 1609.344;
  if (miles < 0.1) return `${Math.round(metres)} metres`;
  return `${miles.toFixed(1)} miles`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');
}
