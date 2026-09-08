/**
 * Gorgon Medusa — The Petrifier.
 *
 * Sinuous mythological Gorgon Queen with living viper snake hair and a
 * petrifying gaze attack. Projects a forward scan zone (telegraph box).
 * If the knight is inside the scan box AND looks at her (facing vector
 * aligns toward Medusa), the knight is instantly turned to solid stone
 * for MEDUSA_GAZE_DURATION (5.0s), freezing all movement.
 *
 * Players can break free earlier by rapidly alternating directional
 * inputs to crack the stone shell.
 */

import { state, type Player, type Zombie } from "../state";
import {
  MEDUSA_GAZE_WIDTH,
  MEDUSA_GAZE_LENGTH,
  MEDUSA_GAZE_DURATION,
  MEDUSA_WINDUP,
  MEDUSA_ACTIVE_GAZE,
  MEDUSA_COOLDOWN,
} from "../constants/enemies";
import { requestShake } from "../engine/juice";
import { showToast } from "../ui";
import { worldDirToScreen } from "../engine/camera";
import type { Facing } from "../engine/render/animator";

const SCREEN_FACING: Record<Facing, [number, number]> = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
};

/**
 * Check if a 2D world position (px, pz) is within Medusa's forward scan box.
 * @param px Player world X
 * @param pz Player world Z
 * @param mx Medusa world X
 * @param mz Medusa world Z
 * @param dirX Normalized forward gaze direction X
 * @param dirZ Normalized forward gaze direction Z
 * @param width Width of scan box (tiles)
 * @param length Length of scan box (tiles)
 */
export function isPointInScanBox(
  px: number,
  pz: number,
  mx: number,
  mz: number,
  dirX: number,
  dirZ: number,
  width: number = MEDUSA_GAZE_WIDTH,
  length: number = MEDUSA_GAZE_LENGTH,
): boolean {
  const vx = px - mx;
  const vz = pz - mz;
  const fwd = vx * dirX + vz * dirZ;
  if (fwd < 0 || fwd > length) return false;
  const lat = Math.abs(-vx * dirZ + vz * dirX);
  return lat <= width * 0.5;
}

/**
 * Check if the player is looking towards Medusa (Perseus angle check).
 * Compares player's screen facing direction to the screen-space direction
 * pointing toward Medusa.
 * Returns true if dot product > threshold (default 0.30, ~72° FOV).
 */
export function isPlayerLookingAtMedusa(
  p: Player,
  mx: number,
  mz: number,
  threshold: number = 0.3,
): boolean {
  const toMx = mx - p.x;
  const toMz = mz - p.z;
  const dist = Math.hypot(toMx, toMz);
  if (dist < 0.001) return true; // point-blank eye contact

  const sDir = worldDirToScreen(toMx, toMz);
  const sLen = Math.hypot(sDir.x, sDir.z);
  if (sLen < 0.001) return true;
  const snx = sDir.x / sLen;
  const snz = sDir.z / sLen;

  const [fx, fz] = SCREEN_FACING[p.facing] ?? [0, 1];
  const dot = fx * snx + fz * snz;
  return dot > threshold;
}

/**
 * Update Medusa's state machine each frame:
 * - Stalking/cooldown -> telegraph windup -> active petrifying scan beam.
 * - Emits floor beam indicators and dust VFX.
 * - Petrifys player if caught inside scan box while facing her.
 */
export function updateMedusaGaze(z: Zombie, p: Player, dt: number): void {
  if (z.mode === "dead" || z.hp <= 0 || !p || p.hp <= 0) return;

  // Initialize cadence
  if (z.medusaGazeT === undefined) {
    z.medusaGazeT = MEDUSA_COOLDOWN;
    z.medusaGazeActive = false;
  }

  // Vector to player determines Medusa's gaze aim
  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return;
  const aimX = dx / dist;
  const aimZ = dz / dist;

  z.medusaGazeT -= dt;

  // Windup / telegraph phase: 0.8s before active gaze
  if (z.medusaGazeT <= MEDUSA_WINDUP && z.medusaGazeT > 0 && !z.medusaGazeActive) {
    // Eyes glow amber / golden warning
    z.sprite.setTint(0xffcc22);
    // Flash floor scan indicator line
    if (Math.random() < dt * 10) {
      state.vfx?.dust(z.x + aimX * 2, 0.05, z.z + aimZ * 2);
    }
  } else if (z.medusaGazeT <= 0 && !z.medusaGazeActive) {
    // Transition into active petrifying gaze
    z.medusaGazeActive = true;
    z.medusaGazeT = MEDUSA_ACTIVE_GAZE;
    z.anim.play("attack");
    z.sprite.setTint(0x44ff88); // bright emerald petrifying eye flare
    state.vfx?.sparks(z.x, 0.7, z.z, aimX, aimZ, 12);
  } else if (z.medusaGazeActive) {
    // Active gaze is sweeping!
    // Emit emerald scan particles along the box
    if (Math.random() < dt * 14) {
      const scanDist = Math.random() * MEDUSA_GAZE_LENGTH;
      const scanLat = (Math.random() - 0.5) * MEDUSA_GAZE_WIDTH;
      const px = z.x + aimX * scanDist - aimZ * scanLat;
      const pz = z.z + aimZ * scanDist + aimX * scanLat;
      state.vfx?.dust(px, 0.05, pz);
    }

    // Check if player is caught in the scanned box
    const inBox = isPointInScanBox(p.x, p.z, z.x, z.z, aimX, aimZ);
    if (inBox) {
      const looking = isPlayerLookingAtMedusa(p, z.x, z.z);
      if (looking && (p.petrifiedT ?? 0) <= 0) {
        // PETRIFY THE KNIGHT!
        p.petrifiedT = MEDUSA_GAZE_DURATION;
        p.momSpeed = 0;
        state.vfx?.dust(p.x, 0.3, p.z);
        state.vfx?.sparks(p.x, 0.6, p.z, 0, 1, 14);
        requestShake(0.35);
        showToast("🗿 PETRIFIED!", "Turned to stone by Medusa's gaze! Mash controls to break free!");
      }
    }

    // Check if active gaze phase is done
    if (z.medusaGazeT <= 0) {
      z.medusaGazeActive = false;
      z.medusaGazeT = MEDUSA_COOLDOWN;
      z.sprite.setTint(z.baseTint ?? null);
      z.anim.play("walk");
    }
  }
}
