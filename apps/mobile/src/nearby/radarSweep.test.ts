import { describe, expect, it } from 'vitest';

import {
  EVENT_SWEEP_DURATION_MS,
  SWEEP_DURATION_MS,
  beamGlow,
  ringSweepPulse,
  sweepDurationMs,
  wrapDeg,
} from './radarSweep';

describe('radar sweep visuals', () => {
  it('keeps one revolution in the 2.5–3s range', () => {
    expect(SWEEP_DURATION_MS).toBeGreaterThanOrEqual(2500);
    expect(SWEEP_DURATION_MS).toBeLessThanOrEqual(3000);
    expect(EVENT_SWEEP_DURATION_MS).toBeGreaterThanOrEqual(2500);
    expect(EVENT_SWEEP_DURATION_MS).toBeLessThanOrEqual(3000);
    expect(sweepDurationMs(false)).toBe(SWEEP_DURATION_MS);
    expect(sweepDurationMs(true)).toBe(EVENT_SWEEP_DURATION_MS);
  });

  it('wraps 0/360 continuously so a loop restart has no jump', () => {
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(361)).toBe(1);
    expect(wrapDeg(-10)).toBe(350);
    expect(beamGlow(0, 0)).toBe(1);
    expect(beamGlow(360, 0)).toBe(1);
    expect(beamGlow(2, 358)).toBeGreaterThan(0.8);
    expect(beamGlow(20, 5)).toBeGreaterThan(0);
    expect(beamGlow(20, 5)).toBeLessThan(beamGlow(8, 5));
    expect(beamGlow(180, 0)).toBe(0);
  });

  it('pulses rings once per revolution', () => {
    expect(ringSweepPulse(0)).toBeCloseTo(0, 5);
    expect(ringSweepPulse(180)).toBeCloseTo(1, 5);
    expect(ringSweepPulse(360)).toBeCloseTo(0, 5);
  });
});
