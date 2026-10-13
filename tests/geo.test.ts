import { describe, expect, it } from 'vitest';
import { checkGeofence, distanceMetres, MAX_ACCURACY_ALLOWANCE_M } from '../src/server/lib/geo';

const brighouse = { lat: 53.7105, lng: -1.7781, radiusM: 250 };
const yard = { lat: 53.6532, lng: -1.7676 };

describe('geofence', () => {
  it('measures distance accurately', () => {
    // About 6.4 km from the Huddersfield yard to the Brighouse site.
    const d = distanceMetres(yard, brighouse);
    expect(d).toBeGreaterThan(6300);
    expect(d).toBeLessThan(6500);
    expect(distanceMetres(brighouse, brighouse)).toBe(0);
  });

  it('lets in a good reading inside the fence', () => {
    const r = checkGeofence({ lat: 53.7107, lng: -1.7783, accuracy: 12 }, brighouse);
    expect(r.ok).toBe(true);
  });

  it('blocks someone at the yard, and says how far away', () => {
    const r = checkGeofence({ ...yard, accuracy: 15 }, brighouse);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('outside');
      expect(r.distanceM).toBeGreaterThan(6000);
    }
  });

  it('gives the benefit of the doubt for GPS wobble near the edge', () => {
    // ~290 m from the centre: outside 250 m, but within it allowing for 60 m accuracy.
    const edge = { lat: 53.7105 + 290 / 111320, lng: -1.7781, accuracy: 60 };
    expect(checkGeofence(edge, brighouse).ok).toBe(true);
    expect(checkGeofence({ ...edge, accuracy: 5 }, brighouse).ok).toBe(false);
  });

  it('caps the allowance so a vague reading cannot sign in from far away', () => {
    const far = { lat: 53.7105 + 600 / 111320, lng: -1.7781, accuracy: 900 };
    const r = checkGeofence(far, brighouse);
    expect(r.ok).toBe(false);
    expect(MAX_ACCURACY_ALLOWANCE_M).toBe(100);
  });

  it('asks to try again when the reading is too vague to judge', () => {
    const vague = { lat: 53.7105 + 600 / 111320, lng: -1.7781, accuracy: 2000 };
    const r = checkGeofence(vague, brighouse);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('inaccurate');
  });

  it('rejects nonsense readings', () => {
    expect(checkGeofence({ lat: NaN, lng: 0, accuracy: 5 }, brighouse)).toEqual({ ok: false, reason: 'invalid', distanceM: null });
    expect(checkGeofence({ lat: 95, lng: 0, accuracy: 5 }, brighouse).ok).toBe(false);
  });
});
