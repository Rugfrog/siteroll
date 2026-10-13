// Payroll CSV export. The column list below is the only thing to change to match a
// different payroll package (Sage, BrightPay, Moneysoft, Xero…): reorder, rename or drop columns.
import { fmtHours, penceToDecimal } from '../../shared/format';

export interface PayrollRow {
  payrollRef: string;
  firstName: string;
  lastName: string;
  niNumber: string;
  periodEnd: string; // 'YYYY-MM-DD' (Sunday)
  normalMins: number;
  payRate: number;
  otMins: number;
  otPayRate: number;
  grossPence: number;
  sites: string;
}

export interface PayrollColumn {
  header: string;
  value: (r: PayrollRow) => string;
}

const ukDate = (d: string) => d.split('-').reverse().join('/');

export const PAYROLL_COLUMNS: PayrollColumn[] = [
  { header: 'Payroll Ref', value: (r) => r.payrollRef },
  { header: 'Surname', value: (r) => r.lastName },
  { header: 'Forename', value: (r) => r.firstName },
  { header: 'NI Number', value: (r) => r.niNumber },
  { header: 'Period End', value: (r) => ukDate(r.periodEnd) },
  { header: 'Basic Hours', value: (r) => fmtHours(r.normalMins) },
  { header: 'Basic Rate', value: (r) => penceToDecimal(r.payRate) },
  { header: 'Overtime Hours', value: (r) => fmtHours(r.otMins) },
  { header: 'Overtime Rate', value: (r) => penceToDecimal(r.otPayRate) },
  { header: 'Gross Pay', value: (r) => penceToDecimal(r.grossPence) },
  { header: 'Sites', value: (r) => r.sites },
];

export function csvEscape(v: string): string {
  // Guard against spreadsheet formula injection as well as commas and quotes.
  let s = v ?? '';
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: PayrollRow[], columns: PayrollColumn[] = PAYROLL_COLUMNS): string {
  const lines = [columns.map((c) => csvEscape(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(c.value(r))).join(','));
  return lines.join('\r\n') + '\r\n';
}
