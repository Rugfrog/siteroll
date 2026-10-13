// No-show detection: booked, the site started more than `graceMins` ago, and not signed in anywhere today.
import { londonToUtc } from '../../shared/time';

export interface NoShowBooking {
  bookingId: number;
  workerId: number;
  siteId: number;
  date: string;
  siteStartTime: string; // 'HH:MM' London
}

export interface NoShowInput {
  now: Date;
  bookings: NoShowBooking[];
  /** Worker ids that have signed in (anywhere) on the booking date. */
  signedInWorkerIds: Set<number>;
  /** Booking ids that already have a no-show alert. */
  alertedBookingIds: Set<number>;
  graceMins?: number;
}

export function findNoShows({ now, bookings, signedInWorkerIds, alertedBookingIds, graceMins = 15 }: NoShowInput): NoShowBooking[] {
  return bookings.filter((b) => {
    if (signedInWorkerIds.has(b.workerId) || alertedBookingIds.has(b.bookingId)) return false;
    const due = londonToUtc(b.date, b.siteStartTime).getTime() + graceMins * 60000;
    return now.getTime() >= due;
  });
}
