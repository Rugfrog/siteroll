import { describe, expect, it } from 'vitest';
import { addDays, londonDate, londonTime, londonToUtc, mondayOf, weekdayIndex } from '../src/shared/time';
import { fmtDateTime, fmtDay, fmtHours, fmtMoney, normaliseMobile, penceToDecimal } from '../src/shared/format';

describe('UK time', () => {
  it('converts London wall-clock time to UTC in summer (BST) and winter (GMT)', () => {
    expect(londonToUtc('2026-07-01', '07:30').toISOString()).toBe('2026-07-01T06:30:00.000Z');
    expect(londonToUtc('2026-12-01', '07:30').toISOString()).toBe('2026-12-01T07:30:00.000Z');
  });

  it('handles the clocks going back (25 Oct 2026): the repeated hour resolves to BST', () => {
    expect(londonToUtc('2026-10-25', '01:30').toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(londonToUtc('2026-10-25', '07:30').toISOString()).toBe('2026-10-25T07:30:00.000Z');
    expect(londonToUtc('2026-10-24', '07:30').toISOString()).toBe('2026-10-24T06:30:00.000Z');
  });

  it('handles the clocks going forward (29 Mar 2026): the missing hour moves forward', () => {
    expect(londonToUtc('2026-03-29', '01:30').toISOString()).toBe('2026-03-29T01:30:00.000Z'); // shown as 02:30 BST
    expect(londonToUtc('2026-03-29', '07:30').toISOString()).toBe('2026-03-29T06:30:00.000Z');
  });

  it('gives the London date and time of a UTC instant', () => {
    expect(londonDate('2026-10-12T23:30:00Z')).toBe('2026-10-13'); // BST: already Tuesday
    expect(londonTime('2026-10-13T06:32:00Z')).toBe('07:32');
    expect(londonTime('2026-11-13T07:32:00Z')).toBe('07:32');
  });

  it('works out weeks (Monday start)', () => {
    expect(mondayOf('2026-10-13')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(weekdayIndex('2026-10-17')).toBe(5);
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });
});

describe('UK formatting', () => {
  it('formats dates, times and money the British way', () => {
    expect(fmtDay('2025-10-13')).toBe('Mon 13 Oct');
    expect(fmtDateTime('2026-10-13T06:32:00Z')).toBe('Tue 13 Oct, 07:32');
    expect(fmtMoney(123456)).toBe('£1,234.56');
    expect(penceToDecimal(5)).toBe('0.05');
    expect(penceToDecimal(-1250)).toBe('-12.50');
    expect(fmtHours(510)).toBe('8.5');
    expect(fmtHours(33750)).toBe('562.5');
  });

  it('normalises UK mobile numbers', () => {
    expect(normaliseMobile('07700 900123')).toBe('07700900123');
    expect(normaliseMobile('+44 7700 900123')).toBe('07700900123');
    expect(normaliseMobile('01484 123456')).toBeNull();
    expect(normaliseMobile('hello')).toBeNull();
  });
});
