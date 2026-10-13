// Geofence check. Runs on the server: the browser only supplies the raw reading.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Reading extends LatLng {
  /** Reported accuracy radius in metres (95% confidence from the browser). */
  accuracy: number;
}

export interface Fence extends LatLng {
  radiusM: number;
}

/** We give the benefit of the doubt for GPS wobble, but never more than this. */
export const MAX_ACCURACY_ALLOWANCE_M = 100;
/** Readings worse than this are too vague to judge either way. */
export const UNUSABLE_ACCURACY_M = 1000;

const EARTH_RADIUS_M = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type FenceResult =
  | { ok: true; distanceM: number }
  | { ok: false; reason: 'outside'; distanceM: number }
  | { ok: false; reason: 'inaccurate'; distanceM: number }
  | { ok: false; reason: 'invalid'; distanceM: null };

export function isValidReading(r: unknown): r is Reading {
  const x = r as Reading;
  return (
    !!x &&
    typeof x.lat === 'number' &&
    typeof x.lng === 'number' &&
    typeof x.accuracy === 'number' &&
    Number.isFinite(x.lat) &&
    Number.isFinite(x.lng) &&
    Number.isFinite(x.accuracy) &&
    Math.abs(x.lat) <= 90 &&
    Math.abs(x.lng) <= 180 &&
    x.accuracy >= 0
  );
}

/**
 * Inside if the reading's distance from the site centre, less an allowance for the reported
 * accuracy (capped), is within the site's radius.
 */
export function checkGeofence(reading: Reading, fence: Fence): FenceResult {
  if (!isValidReading(reading)) return { ok: false, reason: 'invalid', distanceM: null };
  const distanceM = Math.round(distanceMetres(reading, fence));
  const allowance = Math.min(reading.accuracy, MAX_ACCURACY_ALLOWANCE_M);
  if (distanceM - allowance <= fence.radiusM) return { ok: true, distanceM };
  // A very vague reading that is not clearly far away: ask them to try again rather than block.
  if (reading.accuracy >= UNUSABLE_ACCURACY_M && distanceM - reading.accuracy <= fence.radiusM) {
    return { ok: false, reason: 'inaccurate', distanceM };
  }
  return { ok: false, reason: 'outside', distanceM };
}
