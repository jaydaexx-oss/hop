import { describe, expect, it } from 'vitest';

import {
  CONCENTRIC_RING_RATIOS,
  EVENT_SWEEP_DURATION_MS,
  RING_CYCLE_MS,
  SWEEP_DURATION_MS,
  advanceRingProgress,
  advanceSweepDeg,
  beamGlow,
  ringBreathe,
  ringPassGlow,
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

  it('advances clockwise without a 360° discontinuity', () => {
    expect(advanceSweepDeg(0, 280, SWEEP_DURATION_MS)).toBeCloseTo(36, 5);
    expect(advanceSweepDeg(350, 78, SWEEP_DURATION_MS)).toBeCloseTo(0, 0);
    expect(advanceSweepDeg(359, 16, SWEEP_DURATION_MS)).toBeGreaterThan(0);
    expect(advanceSweepDeg(359, 16, SWEEP_DURATION_MS)).toBeLessThan(10);
    expect(advanceSweepDeg(180, -1, SWEEP_DURATION_MS)).toBe(180);
  });

  it('breathes rings center → outer then restarts without a resize spike', () => {
    expect(CONCENTRIC_RING_RATIOS).toHaveLength(4);
    expect(RING_CYCLE_MS).toBeGreaterThanOrEqual(2000);
    expect(RING_CYCLE_MS).toBeLessThanOrEqual(3000);
    const inner = ringBreathe(0.08, 0, 4);
    const outer = ringBreathe(0.08, 3, 4);
    expect(inner.opacityBoost).toBeGreaterThan(outer.opacityBoost);
    expect(inner.scale).toBeGreaterThan(1);
    expect(inner.scale).toBeLessThan(1.08);
    const lateInner = ringBreathe(0.9, 0, 4);
    const lateOuter = ringBreathe(0.9, 3, 4);
    expect(lateOuter.opacityBoost).toBeGreaterThan(lateInner.opacityBoost);
    expect(lateOuter.scale).toBeLessThan(1.08);
    expect(advanceRingProgress(0.95, 260, RING_CYCLE_MS)).toBeLessThan(0.2);
    expect(ringPassGlow(0.12, 0, 4)).toBeGreaterThan(0);
    expect(ringPassGlow(0.9, 0, 4)).toBe(0);
  });
});
