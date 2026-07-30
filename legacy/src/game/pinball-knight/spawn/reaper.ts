/**
 * The REAPER KING — the boss that guards every floor's stairs.
 *
 * Extracted verbatim from core.ts. Its own module because three unrelated
 * places summon it: the floor build, the simulation's exit gate, and the debug
 * panel. The debug verbs used to reach it through `setDebugActionDeps`
 * injection purely because it lived in core; now they can import it.
 */
import { state } from "../state";
import { spawnBoss } from "../boss";
import { showToast } from "../ui";
import { tileCenter } from "../maze/generator";
import { REAPER_HP, REAPER_SCALE, REAPER_SPEED_BASE, REAPER_TINT } from "../constants";
import { isReplica } from "../coop";
import { reaperSheet } from "../render/reaper-sheet";
import { makeZombie } from "../spawn/factory";

/**
 * Spawn the DEATH DEALER: an unkillable blood-red reaper that enters a dozen
 * tiles out from the player (through the walls — it doesn't care) and drifts
 * straight at them, accelerating forever. One per floor; the stairs erase it.
 */
export function spawnReaper(): void {
  const p = state.player;
  if (!p || isReplica()) return; // replica floors get the authority's reaper via snapshot
  state.reaperOut = true;
  const a = Math.random() * Math.PI * 2;
  // Bespoke hooded-and-scythed art (was the ghost sheet dyed with REAPER_TINT).
  const reaper = makeZombie(reaperSheet(), p.x + Math.cos(a) * 12, p.z + Math.sin(a) * 12, REAPER_SPEED_BASE, {
    kind: "reaper",
    hp: REAPER_HP,
  });
  reaper.aggro = true;
  // The sheet is already painted blood-dark, so the tint is now only a faint
  // wash — enough that telegraph/flash clears restore the reaper's colour
  // rather than white, without washing the new art flat.
  reaper.baseTint = REAPER_TINT;
  reaper.sprite.setTint(REAPER_TINT);
  reaper.sprite.mesh.scale.multiplyScalar(REAPER_SCALE);
  state.zombies.push(reaper);
  showToast("☠ THE DEATH DEALER ☠", "it cannot be slain — take the stairs");
  state.shakeT = Math.max(state.shakeT, 0.3);
}
