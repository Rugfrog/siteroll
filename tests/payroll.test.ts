import { describe, expect, it } from 'vitest';
import { csvEscape, toCsv, PAYROLL_COLUMNS, type PayrollRow } from '../src/server/lib/payroll';

const row: PayrollRow = {
  payrollRef: 'SR0001',
  firstName: 'Dave',
  lastName: 'Haigh',
  niNumber: '',
  periodEnd: '2026-10-11',
  normalMins: 2400,
  payRate: 2800,
  otMins: 150,
  otPayRate: 4200,
  grossPence: 112000 + 10500,
  sites: 'Woodhouse Gardens, Brighouse',
};

describe('payroll CSV', () => {
  it('has a header and one row per worker in UK formats', () => {
    const csv = toCsv([row]);
    const [head, line] = csv.trim().split('\r\n');
    expect(head).toBe('Payroll Ref,Surname,Forename,NI Number,Period End,Basic Hours,Basic Rate,Overtime Hours,Overtime Rate,Gross Pay,Sites');
    expect(line).toBe('SR0001,Haigh,Dave,,11/10/2026,40,28.00,2.5,42.00,1225.00,"Woodhouse Gardens, Brighouse"');
  });

  it('escapes quotes and blocks spreadsheet formulas', () => {
    expect(csvEscape('O"Brien')).toBe('"O""Brien"');
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape('-12.50')).toBe('-12.50');
  });

  it('lets you change the columns easily', () => {
    const cols = PAYROLL_COLUMNS.filter((c) => ['Surname', 'Gross Pay'].includes(c.header));
    expect(toCsv([row], cols)).toBe('Surname,Gross Pay\r\nHaigh,1225.00\r\n');
  });
});
