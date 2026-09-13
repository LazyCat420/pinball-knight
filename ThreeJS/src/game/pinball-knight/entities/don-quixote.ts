/**
 * DON QUIXOTE — what happens when the charge MISSES.
 *
 * Everything else about him is already in the engine and is deliberately not
 * re-implemented here. He steers as a `leaper` (entities/movement.ts), he ends
 * his wind-up in a committed locked-line dash through `startCharge`, and that
 * dash bowls into the knight for a heavy hit — the same machinery the Hound and
 * the woken Mimic run on. Writing a second state machine for him was the first
 * attempt and it moved him with code nothing called; this module is the ONE
 * thing his family does that no other family does.
 *
 * A hound that slams a wall shrugs and re-chases after half a second. The Don
 * runs a couched lance into the masonry: it costs him real health, and it
 * leaves him STAGGERED — the standard `staggerT` stun, so he plays the recoil
 * clip, cannot re-aim, and is open for the whole of it. Steering him into a
 * wall is the intended way to fight him, which is why the punishment has to be
 * worth more than simply out-trading him.
 */
import {
  DON_QUIXOTE_CRASH_SELF_DAMAGE,
  DON_QUIXOTE_CRASH_STUN,
} from "../constants";
import { state, type Zombie } from "../state";
import { damageZombie } from "./combat";

/**
 * Resolve a charge that ended against a wall.
 *
 * Returns the stun in seconds actually applied, so a caller (and a test) can
 * tell a crash apart from a charge that merely timed out. Called from the
 * `charge` branch of `updateZombies`, which is the only place that knows a dash
 * stopped short of the ground it asked for.
 */
export function donQuixoteWallCrash(z: Zombie, dirX: number, dirZ: number): number {
  if (z.hp <= 0) return 0;

  state.vfx?.sparks(z.x, 0.55, z.z, -dirX, -dirZ, 14);
  state.vfx?.dust(z.x, 0.05, z.z);
  state.shakeT = Math.max(state.shakeT, 0.3);

  // Self-damage runs through the normal damage path so the crash flashes, pops
  // a number, and can KILL him — a Don who rides his last two hearts into a
  // wall dies of it, and that is the joke landing rather than a special case.
  //
  // FORCED, though. The un-forced path weighs the damage against the PLAYER's
  // momentum (`MOMENTUM_GATES` in damageZombie), and the player is usually
  // standing still watching this happen from across the room. A wall does not
  // hit softer because you were not running.
  damageZombie(z, DON_QUIXOTE_CRASH_SELF_DAMAGE, -dirX, -dirZ, 0.35, true, "bounce");

  z.staggerT = Math.max(z.staggerT ?? 0, DON_QUIXOTE_CRASH_STUN);
  return DON_QUIXOTE_CRASH_STUN;
}
