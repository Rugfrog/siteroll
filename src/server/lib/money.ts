// Money is always integer pence. Every total (screen, PDF, CSV) comes from these functions,
// so they always agree.
import type { ShiftHours } from './hours';

export const VAT_RATE = 0.2;

/** Pay for some minutes at an hourly rate, rounded to the nearest penny. */
export function amountFor(minutes: number, ratePerHourPence: number): number {
  return Math.round((minutes * ratePerHourPence) / 60);
}

export function overtimeRate(ratePence: number, multiplier: number): number {
  return Math.round(ratePence * multiplier);
}

export function vatOn(netPence: number): number {
  return Math.round(netPence * VAT_RATE);
}

export interface Rates {
  payRate: number;
  chargeRate: number;
}

export interface WorkerTotals {
  workerId: number;
  normalMins: number;
  otMins: number;
  totalMins: number;
  payRate: number;
  otPayRate: number;
  chargeRate: number;
  otChargeRate: number;
  payPence: number;
  chargePence: number;
}

/**
 * One worker's totals for one site and week. Amounts are worked out on the week's totals
 * (not per shift) so the invoice line, the payroll CSV and the screen use identical sums.
 */
export function workerTotals(workerId: number, shifts: ShiftHours[], rates: Rates, otMultiplier: number): WorkerTotals {
  const normalMins = shifts.reduce((s, x) => s + x.normalMins, 0);
  const otMins = shifts.reduce((s, x) => s + x.otMins, 0);
  const otPayRate = overtimeRate(rates.payRate, otMultiplier);
  const otChargeRate = overtimeRate(rates.chargeRate, otMultiplier);
  return {
    workerId,
    normalMins,
    otMins,
    totalMins: normalMins + otMins,
    payRate: rates.payRate,
    otPayRate,
    chargeRate: rates.chargeRate,
    otChargeRate,
    payPence: amountFor(normalMins, rates.payRate) + amountFor(otMins, otPayRate),
    chargePence: amountFor(normalMins, rates.chargeRate) + amountFor(otMins, otChargeRate),
  };
}

export interface InvoiceLineInput {
  description: string;
  minutes: number;
  ratePence: number;
}

export interface InvoiceLine extends InvoiceLineInput {
  amountPence: number;
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  netPence: number;
  vatPence: number;
  grossPence: number;
}

/** VAT is charged on the invoice total, rounded once. */
export function invoiceTotals(inputs: InvoiceLineInput[]): InvoiceTotals {
  const lines = inputs.filter((l) => l.minutes > 0).map((l) => ({ ...l, amountPence: amountFor(l.minutes, l.ratePence) }));
  const netPence = lines.reduce((s, l) => s + l.amountPence, 0);
  const vatPence = vatOn(netPence);
  return { lines, netPence, vatPence, grossPence: netPence + vatPence };
}

export function marginPct(chargePence: number, payPence: number): number {
  if (!chargePence) return 0;
  return Math.round(((chargePence - payPence) / chargePence) * 1000) / 10;
}
