/**
 * Pure-math analytical swingarm collision and momentum transfer.
 *
 * Designed to zero-steer-lock: hands control back immediately, transferring
 * tangential momentum through batImpulse without dynamic colliders or Rapier rigidbodies.
 *
 * No THREE, no DOM, zero global state imports.
 */
import { PLAYER_R } from "../constants";
import type { PinballPart } from "../state";

export const SWING_RATE = 2.2; // rad/s oscillation
export const SWING_ARC = 2.0; // peak-to-peak rad (~115°)
export const SWING_LEN = 1.6; // length from pivot to tip
export const SWING_THICK = 0.1; // half-thickness of the arm blade
export const SWING_RESTITUTION = 0.9; // e
export const SWING_DAMAGE = 1;
export const SWING_KNOCKBACK = 0.8;
export const MAX_SWEEP_OCCUPANCY = 0.25; // at most 25% occupancy to prevent blocking corridor

/** Deterministic oscillation phase. */
export function swingPhase(simT: number, i: number, j: number): number {
  return simT * SWING_RATE + (i * 0.7 + j * 1.3);
}

/** Instantaneous deflection angle relative to base heading. */
export function swingAngle(simT: number, i: number, j: number): number {
  return (SWING_ARC / 2) * Math.sin(swingPhase(simT, i, j));
}

/** Instantaneous angular velocity (rad/s). */
export function swingOmega(simT: number, i: number, j: number): number {
  return (SWING_ARC / 2) * SWING_RATE * Math.cos(swingPhase(simT, i, j));
}

/**
 * Transfer momentum on impact with a moving surface.
 *
 * @param vx Player velocity x
 * @param vz Player velocity z
 * @param armVx Arm surface velocity x at contact point
 * @param armVz Arm surface velocity z at contact point
 * @param nx Outward collision normal x pointing toward player
 * @param nz Outward collision normal z pointing toward player
 * @param e Restitution coefficient
 */
export function batImpulse(
  vx: number,
  vz: number,
  armVx: number,
  armVz: number,
  nx: number,
  nz: number,
  e: number,
): { vx: number; vz: number } | null {
  const relN = (vx - armVx) * nx + (vz - armVz) * nz; // closing speed in the arm's frame
  if (relN > 0) return null; // moving away from each other — no contact
  return {
    vx: vx - (1 + e) * relN * nx,
    vz: vz - (1 + e) * relN * nz,
  };
}

export interface SwingArmContactResult {
  hit: boolean;
  vx: number;
  vz: number;
  tipHit: boolean;
  nx: number;
  nz: number;
  contactR: number;
}

/**
 * Test player contact against a swinging pendulum arm.
 * Uses both pre- and post-move position to prevent tunnelling at high speed.
 */
export function checkSwingArmContact(
  part: PinballPart,
  px: number,
  pz: number,
  prevPx: number,
  prevPz: number,
  pVx: number,
  pVz: number,
  simT: number,
): SwingArmContactResult | null {
  const baseAngle = Math.atan2(part.dirZ, part.dirX);
  const theta = baseAngle + swingAngle(simT, part.i, part.j);
  const omega = swingOmega(simT, part.i, part.j);

  const armDirX = Math.cos(theta);
  const armDirZ = Math.sin(theta);

  // Test closest point on segment from pivot (part.x, part.z) to tip
  const dx = px - part.x;
  const dz = pz - part.z;
  const proj = dx * armDirX + dz * armDirZ;

  // Clamped radius along arm
  const r = Math.max(0, Math.min(SWING_LEN, proj));
  const closestX = part.x + armDirX * r;
  const closestZ = part.z + armDirZ * r;

  const distX = px - closestX;
  const distZ = pz - closestZ;
  const dist2 = distX * distX + distZ * distZ;

  const hitDist = PLAYER_R + SWING_THICK;
  if (dist2 > hitDist * hitDist) {
    // Also test previous position for fast moving balls
    const pDx = prevPx - part.x;
    const pDz = prevPz - part.z;
    const pProj = pDx * armDirX + pDz * armDirZ;
    const pR = Math.max(0, Math.min(SWING_LEN, pProj));
    const pClosestX = part.x + armDirX * pR;
    const pClosestZ = part.z + armDirZ * pR;
    const pDist2 = (prevPx - pClosestX) * (prevPx - pClosestX) + (prevPz - pClosestZ) * (prevPz - pClosestZ);
    if (pDist2 > hitDist * hitDist) return null;
  }

  // Normal in the direction of motion or outward normal
  const dist = Math.sqrt(dist2) || 1;
  let nx = distX / dist;
  let nz = distZ / dist;

  // Tangential velocity of arm at radius r: v = omega * r perpendicular to arm direction
  // Arm direction is (cos theta, sin theta), perpendicular is (-sin theta, cos theta)
  const armTanX = -armDirZ;
  const armTanZ = armDirX;
  const armVx = armTanX * omega * r;
  const armVz = armTanZ * omega * r;

  // If normal aligns with omega direction, ensure normal points in arm's travel direction
  const dotTan = nx * armTanX + nz * armTanZ;
  if (Math.abs(omega) > 0.05 && dotTan * omega < 0) {
    // Player is on the trailing side of the arm
    if (dotTan < 0 && omega > 0) {
      nx = -armTanX;
      nz = -armTanZ;
    }
  }

  const impulse = batImpulse(pVx, pVz, armVx, armVz, nx, nz, SWING_RESTITUTION);
  if (!impulse) return null;

  return {
    hit: true,
    vx: impulse.vx,
    vz: impulse.vz,
    tipHit: r > SWING_LEN * 0.75,
    nx,
    nz,
    contactR: r,
  };
}
