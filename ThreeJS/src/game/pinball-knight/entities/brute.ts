/**
 * BRUTE — Heavy musclebound monster wielding and throwing cast-iron dumbbells.
 *
 * Modular entity logic following the Lego architecture:
 * - Melee double-dumbbell ground smash (`bruteSlam`)
 * - In-flight dumbbell heave and enraged twin V-spread projectile hurling (`executeBruteAttack`)
 * - Low-HP rage transition (`checkBruteEnrage`)
 */
import {
  BRUTE_HP,
  BRUTE_CONTACT_RANGE,
} from "../constants";
import { state, type Zombie } from "../state";
import { hitPlayer } from "./combat";
import { hurlDumbbell } from "./projectiles";
import { sfxHeavy } from "../sfx";

/**
 * BRUTE ground-slam: double-dumbbell ground smash with radial shockwave, sparks, and dust.
 * Triggered in close quarters (pdist <= 1.8).
 */
export function bruteSlam(z: Zombie, pdist: number): void {
  const p = state.player;
  if (!p || p.hp <= 0) return;
  if (pdist <= BRUTE_CONTACT_RANGE * 1.8) hitPlayer(z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    state.vfx?.dust(z.x + Math.cos(a) * 0.7, 0.05, z.z + Math.sin(a) * 0.7);
  }
  state.vfx?.sparks(z.x, 0.1, z.z, 0, 0, 8);
  sfxHeavy();
  state.shakeT = Math.max(state.shakeT, 0.35);
}

/**
 * Checks and activates the Brute's enraged phase when damaged below 40% HP.
 * Enraged Brutes gain +40% speed and throw twin dumbbells in a V-spread.
 */
export function checkBruteEnrage(z: Zombie): boolean {
  if (z.kind === "brute" && !z.enraged && z.hp <= BRUTE_HP * 0.4) {
    z.enraged = true;
    z.speed *= 1.4;
    state.vfx?.sparks(z.x, 0.75, z.z, 0, 1, 12);
    state.vfx?.blood(z.x, 0.6, z.z, "red", 6);
    return true;
  }
  return false;
}

/**
 * Executes the Brute's attack on windup completion:
 * - Close quarters (pdist <= 1.8): double dumbbell ground slam
 * - Ranged (pdist > 1.8): heaves a heavy dumbbell projectile
 * - Enraged mode: throws twin dumbbells in a V-spread
 */
export function executeBruteAttack(z: Zombie, pdx: number, pdz: number, pdist: number): void {
  if (pdist <= BRUTE_CONTACT_RANGE * 1.8) {
    bruteSlam(z, pdist); // close quarters: double dumbbell ground smash
  } else if (pdist > 1e-4) {
    const ux = pdx / pdist;
    const uz = pdz / pdist;
    hurlDumbbell(z.x, z.z, ux, uz);
    if (z.enraged) {
      // Enraged brute (< 40% HP) throws twin dumbbells in a V-spread!
      const spread = 0.22;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      hurlDumbbell(z.x, z.z, ux * cos - uz * sin, ux * sin + uz * cos, 1.08);
    }
  }
}
