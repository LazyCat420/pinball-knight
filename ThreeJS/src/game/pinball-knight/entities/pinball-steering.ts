/**
 * Pure pinball marble mode steering calculations.
 *
 * Implements baseline high-angle turn-radius boosting and directional counter-braking:
 * - High-angle steering assistance scales up smoothly as requested aim direction opposes travel heading.
 * - When aim opposes travel strongly (dot < PINBALL_COUNTER_BRAKE_DOT), directional forward braking
 *   slows forward carry to produce a compact, carved U-turn without snapping or stopping dead.
 * - Delta per frame is clamped to PINBALL_TURN_MAX_DELTA * dt.
 */
import {
  PINBALL_STEER,
  PINBALL_TURN_BOOST_MAX,
  PINBALL_TURN_BOOST_START_DOT,
  PINBALL_COUNTER_BRAKE,
  PINBALL_COUNTER_BRAKE_DOT,
  PINBALL_TURN_MAX_DELTA,
} from "../constants";

export interface PinballSteeringInput {
  momX: number;
  momZ: number;
  momSpeed: number;
  aimX: number;
  aimZ: number;
  steerMul: number;
  dt: number;
}

export interface PinballSteeringResult {
  momX: number;
  momZ: number;
  momSpeed: number;
  /** Opposition factor in 0..1 (0 = forward/aligned, 1 = directly backward/opposite) */
  opposition: number;
  /** Heading vs Aim dot product in -1..1 */
  dot: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function resolvePinballSteering(input: PinballSteeringInput): PinballSteeringResult {
  const { momX, momZ, momSpeed, aimX, aimZ, steerMul, dt } = input;

  if (dt <= 0 || steerMul <= 0) {
    return { momX, momZ, momSpeed, opposition: 0, dot: 1 };
  }

  const aimLen = Math.hypot(aimX, aimZ);
  if (aimLen <= 1e-6) {
    return { momX, momZ, momSpeed, opposition: 0, dot: 1 };
  }

  const normAimX = aimX / aimLen;
  const normAimZ = aimZ / aimLen;

  const momLen = Math.hypot(momX, momZ);
  const normMomX = momLen > 1e-6 ? momX / momLen : normAimX;
  const normMomZ = momLen > 1e-6 ? normMomZ_calc(normMomX, normAimZ, momZ, momLen) : normAimZ;

  // Dot product between current heading and desired aim (-1 = reverse, 1 = forward)
  const dot = normMomX * normAimX + normMomZ * normAimZ;

  // Opposition factor: 0 when aligned or slight angle (dot >= START_DOT), 1 when directly behind (dot = -1)
  const opposition = clamp01((PINBALL_TURN_BOOST_START_DOT - dot) / (PINBALL_TURN_BOOST_START_DOT + 1.0));
  const turnMul = 1.0 + opposition * (PINBALL_TURN_BOOST_MAX - 1.0);

  // Directional counter-braking against forward travel when opposing motion
  let newSpeed = momSpeed;
  if (dot < PINBALL_COUNTER_BRAKE_DOT && momSpeed > 0) {
    const brakeStrength = clamp01((PINBALL_COUNTER_BRAKE_DOT - dot) / (PINBALL_COUNTER_BRAKE_DOT + 1.0));
    const brakeAmount = PINBALL_COUNTER_BRAKE * brakeStrength * steerMul * dt;
    newSpeed = Math.max(0, momSpeed - brakeAmount);
  }

  // Additive steering acceleration scaled by turn multiplier
  let steerDeltaX = normAimX * PINBALL_STEER * steerMul * turnMul * dt;
  let steerDeltaZ = normAimZ * PINBALL_STEER * steerMul * turnMul * dt;

  // Clamp per-frame delta to protect against lag spikes
  const deltaLen = Math.hypot(steerDeltaX, steerDeltaZ);
  const maxDelta = PINBALL_TURN_MAX_DELTA * dt;
  if (deltaLen > maxDelta && deltaLen > 0) {
    steerDeltaX = (steerDeltaX / deltaLen) * maxDelta;
    steerDeltaZ = (steerDeltaZ / deltaLen) * maxDelta;
  }

  // Apply steering impulse to heading
  const updatedX = normMomX + steerDeltaX;
  const updatedZ = normMomZ + steerDeltaZ;
  const updatedLen = Math.hypot(updatedX, updatedZ);

  const finalMomX = updatedLen > 1e-6 ? updatedX / updatedLen : normAimX;
  const finalMomZ = updatedLen > 1e-6 ? updatedZ / updatedLen : normAimZ;

  return {
    momX: finalMomX,
    momZ: finalMomZ,
    momSpeed: newSpeed,
    opposition,
    dot,
  };
}

function normMomZ_calc(_normMomX: number, _normAimZ: number, momZ: number, momLen: number): number {
  return momZ / momLen;
}
