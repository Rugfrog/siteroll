import { describe, expect, it } from 'vitest';
import { findNoShows } from '../src/server/lib/noshow';
import { londonToUtc } from '../src/shared/time';

const bookings = [
  { bookingId: 1, workerId: 10, siteId: 1, date: '2026-10-13', siteStartTime: '07:30' },
  { bookingId: 2, workerId: 11, siteId: 1, date: '2026-10-13', siteStartTime: '07:30' },
  { bookingId: 3, workerId: 12, siteId: 2, date: '2026-10-13', siteStartTime: '08:00' },
];

describe('no-show alerts', () => {
  it('waits until 15 minutes after the start time', () => {
    const r = findNoShows({ now: londonToUtc('2026-10-13', '07:44'), bookings, signedInWorkerIds: new Set(), alertedBookingIds: new Set() });
    expect(r).toHaveLength(0);
    const r2 = findNoShows({ now: londonToUtc('2026-10-13', '07:45'), bookings, signedInWorkerIds: new Set(), alertedBookingIds: new Set() });
    expect(r2.map((b) => b.bookingId)).toEqual([1, 2]);
  });

  it("uses each site's own start time", () => {
    const r = findNoShows({ now: londonToUtc('2026-10-13', '08:15'), bookings, signedInWorkerIds: new Set(), alertedBookingIds: new Set() });
    expect(r.map((b) => b.bookingId)).toEqual([1, 2, 3]);
  });

  it('ignores people who have signed in, and alerts only once', () => {
    const r = findNoShows({ now: londonToUtc('2026-10-13', '09:00'), bookings, signedInWorkerIds: new Set([10]), alertedBookingIds: new Set([3]) });
    expect(r.map((b) => b.bookingId)).toEqual([2]);
  });
});
