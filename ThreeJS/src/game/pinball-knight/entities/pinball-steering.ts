/**
 * Pure pinball marble mode steering calculations.
 *
 * Implements shortest-arc angular slew with dynamic opposition boost and directional counter-braking:
 * - When aiming forward or to the side, turns with natural smooth rotational agility (PINBALL_STEER rad/sec).
 * - When aiming behind / in reverse, opposition factor scales angular velocity up to PINBALL_TURN_BOOST_MAX
 *   (up to ~515 deg/sec), enabling crisp, tight U-turns without vector normalization cancellation.
 * - Directional forward counter-braking (PINBALL_COUNTER_BRAKE) compresses the turn radius down to ~1.5–2.5 tiles.
 * - Caps per-frame angular step by PINBALL_TURN_MAX_DELTA * dt.
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
  /** Opposition factor in 0..1 (0 = aligned, 1 = directly opposite/behind) */
  opposition: number;
  /** Heading vs Aim dot product in -1..1 */
  dot: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function wrapAngle(rad: number): number {
  while (rad > Math.PI) rad -= Math.PI * 2;
  while (rad < -Math.PI) rad += Math.PI * 2;
  return rad;
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
  const normMomZ = momLen > 1e-6 ? momZ / momLen : normAimZ;

  // Angles in radians [-PI, PI]
  const thetaMom = Math.atan2(normMomZ, normMomX);
  const thetaAim = Math.atan2(normAimZ, normAimX);

  // Shortest angular difference from current heading to target aim
  let dTheta = wrapAngle(thetaAim - thetaMom);

  // Exact 180° dead-rearward aim: tie-break clockwise
  if (Math.abs(Math.abs(dTheta) - Math.PI) < 1e-4) {
    dTheta = Math.PI;
  }

  // Dot product between heading and aim
  const dot = Math.cos(dTheta);

  // Opposition factor: 0 when aligned/slight angle (dot >= START_DOT), 1 when directly behind (dot = -1)
  const opposition = clamp01((PINBALL_TURN_BOOST_START_DOT - dot) / (PINBALL_TURN_BOOST_START_DOT + 1.0));

  // Angular turn rate in rad/sec, scaling smoothly with opposition
  let turnRate = PINBALL_STEER + opposition * (PINBALL_TURN_BOOST_MAX - PINBALL_STEER);

  // Low-speed agility boost: when rolling slowly (< 4 u/s), assist rotation so ball isn't sluggish
  if (momSpeed > 0 && momSpeed < 4) {
    const lowSpeedBoost = 1.0 + ((4 - momSpeed) / 4) * 0.75;
    turnRate *= lowSpeedBoost;
  }

  // Directional counter-braking against forward travel when opposing motion
  let newSpeed = momSpeed;
  if (dot < PINBALL_COUNTER_BRAKE_DOT && momSpeed > 0) {
    const brakeStrength = clamp01((PINBALL_COUNTER_BRAKE_DOT - dot) / (PINBALL_COUNTER_BRAKE_DOT + 1.0));
    const brakeAmount = PINBALL_COUNTER_BRAKE * brakeStrength * steerMul * dt;
    newSpeed = Math.max(0, momSpeed - brakeAmount);
  }

  // Angular step clamped to max delta
  const maxAngularStep = Math.min(turnRate * steerMul * dt, PINBALL_TURN_MAX_DELTA * dt);
  const stepAngle = Math.sign(dTheta) * Math.min(Math.abs(dTheta), maxAngularStep);

  const finalTheta = wrapAngle(thetaMom + stepAngle);
  const finalMomX = Math.cos(finalTheta);
  const finalMomZ = Math.sin(finalTheta);

  return {
    momX: finalMomX,
    momZ: finalMomZ,
    momSpeed: newSpeed,
    opposition,
    dot,
  };
}
