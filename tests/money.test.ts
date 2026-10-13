import { describe, expect, it } from 'vitest';
import { amountFor, invoiceTotals, marginPct, overtimeRate, vatOn } from '../src/server/lib/money';

describe('money', () => {
  it('pays to the nearest penny', () => {
    expect(amountFor(60, 1350)).toBe(1350);
    expect(amountFor(510, 1350)).toBe(11475); // 8.5h × £13.50
    expect(amountFor(1, 1350)).toBe(23); // 22.5p rounds up
    expect(amountFor(0, 9999)).toBe(0);
  });

  it('works out overtime rates', () => {
    expect(overtimeRate(1350, 1.5)).toBe(2025);
    expect(overtimeRate(1335, 1.5)).toBe(2003); // £20.025 → £20.03
  });

  it('charges VAT at 20% on the invoice total, rounded once', () => {
    expect(vatOn(100000)).toBe(20000);
    expect(vatOn(12345)).toBe(2469);
    const t = invoiceTotals([
      { description: 'A', minutes: 2400, ratePence: 1750 },
      { description: 'A overtime', minutes: 150, ratePence: 2625 },
      { description: 'B', minutes: 0, ratePence: 3200 },
    ]);
    expect(t.lines).toHaveLength(2); // zero-hour lines are left off
    expect(t.netPence).toBe(70000 + 6563);
    expect(t.vatPence).toBe(Math.round(76563 * 0.2));
    expect(t.grossPence).toBe(t.netPence + t.vatPence);
    expect(t.lines.reduce((s, l) => s + l.amountPence, 0)).toBe(t.netPence);
  });

  it('works out margin %', () => {
    expect(marginPct(10000, 7500)).toBe(25);
    expect(marginPct(0, 0)).toBe(0);
  });
});
