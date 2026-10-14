import type { ClientRules } from '../lib/hours';

export interface ClientRow {
  id: number;
  name: string;
  address: string;
  billing_email: string;
  break_default_mins: number;
  break_after_mins: number;
  ot_daily_mins: number | null;
  ot_weekly_mins: number | null;
  ot_saturday: number;
  ot_sunday: number;
  ot_multiplier: number;
  round_mins: number;
  selfie_required: number;
  compliance_mode: 'warn' | 'block';
  signoff_day: number;
  signoff_time: string;
  bookings_email: string;
  active: number;
}

export interface SiteRow {
  id: number;
  client_id: number;
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  radius_m: number;
  start_time: string;
  finish_time: string;
  qr_token: string;
  /** signin: workers sign in on site. timesheet: no sign-in; each booked day counts as a normal day. */
  signin_mode: 'signin' | 'timesheet';
  active: number;
}

export interface WorkerRow {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  trade: string;
  pay_rate: number;
  charge_rate: number;
  ni_number: string;
  card_scheme: string;
  card_type: string;
  card_number: string;
  card_expiry: string | null;
  card_photo_path: string | null;
  rtw_checked_on: string | null;
  rtw_checked_by: string;
  emergency_name: string;
  emergency_phone: string;
  notes: string;
  active: number;
  created_at: string;
}

export interface AttendanceRow {
  id: number;
  worker_id: number;
  site_id: number;
  work_date: string;
  in_at: string;
  out_at: string | null;
  in_lat: number | null;
  in_lng: number | null;
  in_accuracy: number | null;
  in_distance_m: number | null;
  out_lat: number | null;
  out_lng: number | null;
  out_accuracy: number | null;
  out_distance_m: number | null;
  break_mins: number | null;
  selfie_path: string | null;
  method: string;
  flags: string;
  status: string;
  query_comment: string | null;
  out_method: string | null;
  created_at: string;
}

export function rulesFor(c: ClientRow): ClientRules {
  return {
    breakDefaultMins: c.break_default_mins,
    breakAfterMins: c.break_after_mins,
    otDailyMins: c.ot_daily_mins,
    otWeeklyMins: c.ot_weekly_mins,
    otSaturday: !!c.ot_saturday,
    otSunday: !!c.ot_sunday,
    otMultiplier: c.ot_multiplier,
    roundMins: c.round_mins,
  };
}

export const fullName = (w: { first_name: string; last_name: string }) => `${w.first_name} ${w.last_name}`;

/** Card status on a given date: missing, expired, expiring (within 30 days) or ok. */
export function cardStatus(expiry: string | null, today: string): 'missing' | 'expired' | 'expiring' | 'ok' {
  if (!expiry) return 'missing';
  if (expiry < today) return 'expired';
  const [y, m, d] = today.split('-').map(Number);
  const in30 = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10);
  return expiry <= in30 ? 'expiring' : 'ok';
}
