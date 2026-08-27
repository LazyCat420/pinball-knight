/**
 * Monster Mouth (maw / gargoyle gobbler) mechanics.
 *
 * An earned trajectory shot rather than a hazard.
 * Swallows the player on a fast aimed line into the throat, holds for a snap beat,
 * and spits them out across the machine along an authored or Φ-bounded path.
 */
import { type Grid, T_FLOOR, at, tileCenter } from "../maze/generator";
import type { PinballPart } from "../state";

export const MAW_SWALLOW_SPEED = 10.0;
export const MAW_SPIT_SPEED = 15.0;
export const MAW_CAPTURE_RADIUS = 0.9;
export const MAW_CONE_COS = 0.707; // cos(45°)
export const MAW_PHI_DROP_MAX = 30; // max lateral progression across floor
export const MAW_COOLDOWN = 2.0;

/**
 * Determine if a player entering the mouth cell meets the velocity and angle requirements.
 */
export function canMawSwallow(
  part: PinballPart,
  px: number,
  pz: number,
  pSpeed: number,
  pDirX: number,
  pDirZ: number,
): boolean {
  if (pSpeed < MAW_SWALLOW_SPEED) return false;

  const dx = px - part.x;
  const dz = pz - part.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > MAW_CAPTURE_RADIUS * MAW_CAPTURE_RADIUS) return false;

  // Mouth throat is opposite to part.dir (part.dir is outward facing)
  const throatDirX = -part.dirX;
  const throatDirZ = -part.dirZ;

  const dot = pDirX * throatDirX + pDirZ * throatDirZ;
  return dot >= MAW_CONE_COS;
}

export interface MawExitResult {
  i: number;
  j: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

/**
 * Select an exit floor tile that progresses laterally across the machine without skipping to the stairs.
 */
export function pickMawExit(
  g: Grid,
  phi: Int32Array,
  entryI: number,
  entryJ: number,
  phiEntry: number,
  rng: () => number,
): MawExitResult | null {
  const candidates: Array<{ i: number; j: number; phiVal: number }> = [];

  // Search surrounding area (within radius of ~12-18 tiles)
  const R_SEARCH = 15;
  const minI = Math.max(1, entryI - R_SEARCH);
  const maxI = Math.min(g.w - 2, entryI + R_SEARCH);
  const minJ = Math.max(1, entryJ - R_SEARCH);
  const maxJ = Math.min(g.h - 2, entryJ + R_SEARCH);

  const minPhi = Math.max(1, phiEntry - MAW_PHI_DROP_MAX);
  const maxPhi = phiEntry;

  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      if (at(g, i, j) !== T_FLOOR) continue;
      if (i === entryI && j === entryJ) continue;

      const pVal = phi[j * g.w + i];
      if (pVal >= minPhi && pVal <= maxPhi) {
        candidates.push({ i, j, phiVal: pVal });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Shuffle / pick candidate
  const chosen = candidates[Math.floor(rng() * candidates.length)];
  const { x, z } = tileCenter(g, chosen.i, chosen.j);

  // Eject direction: downhill along phi or away from entry
  let dirX = chosen.i - entryI;
  let dirZ = chosen.j - entryJ;
  const len = Math.hypot(dirX, dirZ) || 1;
  dirX /= len;
  dirZ /= len;

  return {
    i: chosen.i,
    j: chosen.j,
    x,
    z,
    dirX,
    dirZ,
  };
}
