/** Visual-only radar sweep. Does not touch BLE, discovery, or Event Mode logic. */

export const SWEEP_DURATION_MS = 2800;
export const EVENT_SWEEP_DURATION_MS = 2600;
export const TRAIL_STEPS = 16;
export const TRAIL_STEP_DEG = 3.6;
export const BEAM_TRAIL_DEG = 28;
export const BEAM_APPROACH_DEG = 8;
export const RING_PULSE_AMOUNT = 0.07;
export const CONCENTRIC_RING_RATIOS = [0.33, 0.66, 1] as const;

export function sweepDurationMs(eventActive: boolean): number {
  return eventActive ? EVENT_SWEEP_DURATION_MS : SWEEP_DURATION_MS;
}

/** Degrees in [0, 360). */
export function wrapDeg(deg: number): number {
  'worklet';
  return ((deg % 360) + 360) % 360;
}

/**
 * Clockwise sweep: 1 when the beam is on the node, fading through the trail
 * behind it. Wraps across 0/360 so the loop has no visual jump.
 */
export function beamGlow(sweepDeg: number, nodeDeg: number): number {
  'worklet';
  const delta = wrapDeg(sweepDeg - nodeDeg);
  if (delta <= BEAM_TRAIL_DEG) {
    return 1 - delta / BEAM_TRAIL_DEG;
  }
  const ahead = 360 - delta;
  if (ahead <= BEAM_APPROACH_DEG) {
    return 1 - ahead / BEAM_APPROACH_DEG;
  }
  return 0;
}

/** Subtle 0..1 pulse, one cycle per revolution. */
export function ringSweepPulse(sweepDeg: number): number {
  'worklet';
  const t = wrapDeg(sweepDeg) / 360;
  return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
}

export function trailOpacity(step: number): number {
  const t = step / TRAIL_STEPS;
  return 0.36 * (1 - t) * (1 - t);
}

export function trailHeight(step: number): number {
  return 2 + (step / TRAIL_STEPS) * 5;
}
