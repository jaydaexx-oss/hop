/** Visual-only radar sweep. Does not touch BLE, discovery, or Event Mode logic. */

export const SWEEP_DURATION_MS = 2800;
export const EVENT_SWEEP_DURATION_MS = 2600;
export const RING_CYCLE_MS = 2600;
export const TRAIL_STEPS = 16;
export const TRAIL_STEP_DEG = 3.6;
export const BEAM_TRAIL_DEG = 32;
export const BEAM_APPROACH_DEG = 8;
export const RING_BREATHE_OPACITY = 0.26;
export const RING_BREATHE_SCALE = 0.04;
export const RING_PASS_GLOW = 0.18;
export const CONCENTRIC_RING_RATIOS = [0.28, 0.5, 0.72, 0.92] as const;

export function sweepDurationMs(eventActive: boolean): number {
  return eventActive ? EVENT_SWEEP_DURATION_MS : SWEEP_DURATION_MS;
}

/** Degrees in [0, 360). */
export function wrapDeg(deg: number): number {
  'worklet';
  return ((deg % 360) + 360) % 360;
}

/** Fractional progress in [0, 1). */
export function wrapUnit(progress: number): number {
  'worklet';
  return progress - Math.floor(progress);
}

/**
 * Advance a clockwise sweep. Uses modulo so 360 wraps to 0 with no visual jump.
 * Do not animate 0deg→360deg as a Reanimated/CSS transform pair — those angles
 * are equivalent, so the native interpolator treats the delta as 0°.
 */
export function advanceSweepDeg(current: number, dtMs: number, durationMs: number): number {
  'worklet';
  if (dtMs <= 0 || durationMs <= 0) return wrapDeg(current);
  return wrapDeg(current + (360 * dtMs) / durationMs);
}

export function advanceRingProgress(current: number, dtMs: number, durationMs: number): number {
  'worklet';
  if (dtMs <= 0 || durationMs <= 0) return wrapUnit(current);
  return wrapUnit(current + dtMs / durationMs);
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

/**
 * Sequential center → outer breathe. Ring 0 peaks first, then 1, 2, outer,
 * then the cycle restarts. Envelope is smoothstep so it doesn't flash.
 */
export function ringBreathe(
  progress: number,
  ringIndex: number,
  ringCount: number,
): { opacityBoost: number; scale: number } {
  'worklet';
  if (ringCount <= 0) return { opacityBoost: 0, scale: 1 };
  const span = 1 / ringCount;
  const peak = (ringIndex + 0.45) * span;
  const dist = Math.abs(wrapUnit(progress) - peak);
  const width = span * 0.72;
  if (dist >= width) return { opacityBoost: 0, scale: 1 };
  const t = 1 - dist / width;
  const envelope = t * t * (3 - 2 * t);
  return {
    opacityBoost: RING_BREATHE_OPACITY * envelope,
    scale: 1 + RING_BREATHE_SCALE * envelope,
  };
}

/** Extra glow on a ring while the scan wave is on it (beam passing that ring). */
export function ringPassGlow(progress: number, ringIndex: number, ringCount: number): number {
  'worklet';
  const breathe = ringBreathe(progress, ringIndex, ringCount);
  const peak = breathe.opacityBoost / RING_BREATHE_OPACITY;
  return peak > 0.55 ? RING_PASS_GLOW * ((peak - 0.55) / 0.45) : 0;
}

export function trailOpacity(step: number): number {
  const t = step / TRAIL_STEPS;
  return 0.36 * (1 - t) * (1 - t);
}

export function trailHeight(step: number): number {
  return 2 + (step / TRAIL_STEPS) * 5;
}
