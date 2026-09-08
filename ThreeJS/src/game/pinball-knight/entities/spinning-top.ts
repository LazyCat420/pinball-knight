/**
 * 🪀 WHIRLIGIG TOP — Armored Gyroscopic Battle Top Mechanics
 *
 * The Spinning Top is a mechanical, brass-and-iron automaton that patrols
 * dungeon corridors on a precision carbide pivot peg.
 *
 * States:
 * 1. CRUISE: Normal patrol navigation. Detects player proximity and line of sight.
 * 2. WINDUP: Digs its pivot peg into the stone, revving centrifugal rotation to
 *    blinding speeds with showers of sparks and rising smoke.
 * 3. SLAM: Rockets forward along its locked trajectory at 2.4x speed.
 *    - On player contact: deals 2 damage and imparts a massive 6.5 u/s pinball
 *      deflection impulse, bouncing the knight away like a bumper.
 *    - On wall contact: ricochets off the surface normal with friction sparks.
 * 4. WOBBLE: Following a slam or ricochet sequence, the top suffers gyroscopic
 *    instability, wobbling off-axis at 0.4x speed for 1.8s, vulnerable to counter-attacks.
 */
import { state, type Player, type Zombie } from "../state";
import { moveCircle } from "../engine/collision";
import { syncActorMesh, hitPlayer } from "./combat";
import { comboWindow } from "./combo-curve";
import { facingFromWorld } from "./zombie";
import { PLAYER_R } from "../constants";
import { sfxSpin, sfxHit, sfxSwing } from "../sfx";
import {
  SPINNING_TOP_HP,
  SPINNING_TOP_R,
  SPINNING_TOP_CRUISE_SPEED,
  SPINNING_TOP_SLAM_SPEED,
  SPINNING_TOP_CHARGE_RANGE,
  SPINNING_TOP_WINDUP,
  SPINNING_TOP_SLAM_DURATION,
  SPINNING_TOP_WOBBLE_DURATION,
  SPINNING_TOP_SLAM_DAMAGE,
  SPINNING_TOP_SLAM_DEFLECT,
  SPINNING_TOP_COOLDOWN,
} from "../constants/enemies";

/**
 * Checks whether the player is in range and line-of-sight for a slam charge.
 */
export function canSpinningTopCharge(
  z: { x: number; z: number; topTimer?: number },
  p: { x: number; z: number; hp: number },
  range = SPINNING_TOP_CHARGE_RANGE,
): boolean {
  if (p.hp <= 0 || (z.topTimer ?? 0) > 0) return false;
  const dx = p.x - z.x;
  const dz = p.z - z.z;
  return Math.hypot(dx, dz) <= range;
}

export function initSpinningTop(z: Zombie): void {
  z.topState = "cruise";
  z.topTimer = 0;
  z.topDashDirX = 0;
  z.topDashDirZ = 0;
  z.topRicochets = 0;
}

export function startSpinningTopWindup(z: Zombie, p: { x: number; z: number }): void {
  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const pdist = Math.hypot(dx, dz) || 1;
  z.topState = "windup";
  z.topTimer = SPINNING_TOP_WINDUP;
  z.topDashDirX = dx / pdist;
  z.topDashDirZ = dz / pdist;
  z.anim?.setFacing?.(facingFromWorld(z.topDashDirX, z.topDashDirZ, "S"));
  z.anim?.play?.("attack", { force: true });
}

export function startSpinningTopSlam(z: Zombie, dirX = z.topDashDirX ?? 0, dirZ = z.topDashDirZ ?? 1): void {
  z.topState = "slam";
  z.topTimer = SPINNING_TOP_SLAM_DURATION;
  z.topDashDirX = dirX;
  z.topDashDirZ = dirZ;
  z.topRicochets = 0;
  z.anim?.play?.("attack", { force: true });
}

export function startSpinningTopWobble(z: Zombie): void {
  z.topState = "wobble";
  z.topTimer = SPINNING_TOP_WOBBLE_DURATION;
  z.anim?.play?.("stumble");
}

/**
 * Updates the Spinning Top's state machine each simulation step.
 */
export function updateSpinningTop(
  z: Zombie,
  p: Player,
  dt: number,
  moveFn?: (g: any, cx: number, cz: number, r: number, dx: number, dz: number) => { x: number; z: number },
): void {
  if (z.mode === "dead") return;

  // Initialize state if needed
  if (!z.topState) {
    initSpinningTop(z);
  }

  // If staggered, break active slam or windup into wobble
  if (z.staggerT && z.staggerT > 0) {
    if (z.topState === "windup" || z.topState === "slam") {
      z.topState = "wobble";
      z.topTimer = SPINNING_TOP_WOBBLE_DURATION;
      z.anim.play("stumble");
    }
  }

  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const pdist = Math.hypot(dx, dz) || 1;

  switch (z.topState) {
    case "cruise": {
      // Cooldown timer count down
      if (z.topTimer && z.topTimer > 0) {
        z.topTimer = Math.max(0, z.topTimer - dt);
      }

      // Check charge trigger
      if (pdist <= SPINNING_TOP_CHARGE_RANGE && (z.topTimer ?? 0) <= 0 && p.hp > 0) {
        z.topState = "windup";
        z.topTimer = SPINNING_TOP_WINDUP;
        z.topDashDirX = dx / pdist;
        z.topDashDirZ = dz / pdist;
        z.anim.setFacing(facingFromWorld(z.topDashDirX, z.topDashDirZ, "S"));
        z.anim.play("attack", { force: true });
        sfxSpin();
        sfxSwing();
        state.vfx?.smoke?.(z.x, 0.35, z.z, 2, 0.4);
      }
      break;
    }

    case "windup": {
      // Stationary rev-up: spin in place, spray pivot sparks
      z.anim.play("attack");
      state.vfx?.sparks?.(
        z.x,
        0.25,
        z.z,
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5,
        3,
      );

      const nextTimer = (z.topTimer ?? SPINNING_TOP_WINDUP) - dt;
      z.topTimer = nextTimer;

      if (nextTimer <= 0) {
        // Launch slam charge!
        z.topState = "slam";
        z.topTimer = SPINNING_TOP_SLAM_DURATION;
        z.topRicochets = 0;
        z.anim.play("attack", { force: true });
        sfxSpin();
        state.vfx?.burst?.(z.x, 0.35, z.z, 0xd4a359, 10, 2.0);
      }
      break;
    }

    case "slam": {
      // High-speed charge along locked direction
      const dirX = z.topDashDirX ?? 0;
      const dirZ = z.topDashDirZ ?? 1;
      const moveDist = z.speed * SPINNING_TOP_SLAM_SPEED * dt;

      const bodyR = z.bodyR ?? SPINNING_TOP_R;
      const g = state.grid;
      if (moveFn || g) {
        const targetX = z.x + dirX * moveDist;
        const targetZ = z.z + dirZ * moveDist;
        const res = moveFn
          ? moveFn(g, z.x, z.z, bodyR, dirX * moveDist, dirZ * moveDist)
          : moveCircle(g!, z.x, z.z, bodyR, dirX * moveDist, dirZ * moveDist);

        // Wall collision / ricochet detection
        const blockedX = Math.abs(res.x - targetX) > 1e-3;
        const blockedZ = Math.abs(res.z - targetZ) > 1e-3;

        if (blockedX || blockedZ) {
          sfxHit();
          state.vfx?.sparks?.(res.x, 0.35, res.z, -dirX, -dirZ, 6);
          state.vfx?.dust?.(res.x, 0.3, res.z);

          if (blockedX) z.topDashDirX = -dirX;
          if (blockedZ) z.topDashDirZ = -dirZ;

          z.topRicochets = (z.topRicochets ?? 0) + 1;
          if ((z.topRicochets ?? 0) >= 3) {
            // Max ricochets reached -> enter wobble recovery
            z.topState = "wobble";
            z.topTimer = SPINNING_TOP_WOBBLE_DURATION;
            z.anim.play("stumble");
          }
        }

        z.x = res.x;
        z.z = res.z;
        if (z.sprite?.mesh?.position) {
          syncActorMesh(z);
        }
      }

      // Check collision with player
      const contactDist = bodyR + PLAYER_R + 0.15;
      if (pdist <= contactDist && p.hp > 0) {
        // Slam into player!
        hitPlayer(z);
        sfxHit();

        // Pinball bumper deflection impulse
        const nx = pdist > 1e-4 ? (p.x - z.x) / pdist : 1;
        const nz = pdist > 1e-4 ? (p.z - z.z) / pdist : 0;
        p.momX = nx;
        p.momZ = nz;
        p.momSpeed = Math.max(p.momSpeed, SPINNING_TOP_SLAM_DEFLECT);
        p.bounceCombo += 1;
        p.bounceComboT = comboWindow(p.bounceCombo);
        p.iframes = Math.max(p.iframes, 0.3);

        // Heavy slam visual effects
        state.vfx?.slashCircle?.(z.x, 0.35, z.z, 1.2);
        state.vfx?.burst?.(z.x, 0.35, z.z, 0xd4a359, 14, 2.5);

        // Post-slam wobble
        z.topState = "wobble";
        z.topTimer = SPINNING_TOP_WOBBLE_DURATION;
        z.anim.play("stumble");
        break;
      }

      // Charge timer countdown
      const nextTimer = (z.topTimer ?? SPINNING_TOP_SLAM_DURATION) - dt;
      z.topTimer = nextTimer;
      if (nextTimer <= 0) {
        z.topState = "wobble";
        z.topTimer = SPINNING_TOP_WOBBLE_DURATION;
        z.anim.play("stumble");
      }
      break;
    }

    case "wobble": {
      // Gyroscopic instability recovery state
      z.anim.play("stumble");
      const nextTimer = (z.topTimer ?? SPINNING_TOP_WOBBLE_DURATION) - dt;
      z.topTimer = nextTimer;

      if (nextTimer <= 0) {
        // Gyro recovers stability!
        z.topState = "cruise";
        z.topTimer = SPINNING_TOP_COOLDOWN;
        z.anim.play("idle");
      }
      break;
    }
  }
}
