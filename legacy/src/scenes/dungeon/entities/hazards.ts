/**
 * Self-firing hazard simulation — currently the BOXING GLOVES. Their clock
 * (fireT) and punch animation live with the other part animations in
 * render/pinball-parts.ts; this module owns the CONSEQUENCES: while a punch
 * is extended (hitT inside the active window), anything in the lane gets hit —
 * the PLAYER is flung into a momentum ride (a wall-mounted flipper, no
 * damage), ZOMBIES take a haymaker with hard knockback. Runs on the fixed
 * sim step from core.simulate.
 */
import { state } from "../state";
import {
  GLOVE_ACTIVE,
  GLOVE_LANE_LEN,
  GLOVE_LANE_HALF,
  GLOVE_SPEED,
  GLOVE_DAMAGE,
  GLOVE_KNOCKBACK,
  PINBALL_MAX_SPEED,
  PINBALL_COMBO_WINDOW,
} from "../constants";
import { damageZombie } from "./combat";
import { sfxBumper } from "../audio";

/** Is (x,z) inside the glove's punch lane? Lane runs from the part along dir. */
function inLane(part: { x: number; z: number; dirX: number; dirZ: number }, x: number, z: number): boolean {
  const rx = x - part.x;
  const rz = z - part.z;
  const along = rx * part.dirX + rz * part.dirZ;
  if (along < -0.1 || along > GLOVE_LANE_LEN) return false;
  const across = Math.abs(rx * -part.dirZ + rz * part.dirX);
  return across <= GLOVE_LANE_HALF;
}

export function simulateHazards(_dt: number): void {
  const p = state.player;
  if (state.freezeT > 0) return; // the freeze-ray stops every fist mid-air

  for (const part of state.pinballParts) {
    if (part.kind !== "glove") continue;
    const punching = part.hitT >= 0 && part.hitT <= GLOVE_ACTIVE;
    if (!punching || part.punchSpent) continue;

    let connected = false;

    // The player: launched, not hurt — the glove is a flipper aimed by the maze.
    if (p && p.hp > 0 && p.rideT < 0 && inLane(part, p.x, p.z)) {
      p.momX = part.dirX;
      p.momZ = part.dirZ;
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, GLOVE_SPEED));
      p.bounceCombo += 1;
      p.bounceComboT = PINBALL_COMBO_WINDOW;
      state.partComboHits += 1;
      p.iframes = Math.max(p.iframes, 0.15);
      connected = true;
    }

    // The horde: a haymaker. One punch, one sweep of the lane.
    for (const z of state.zombies) {
      if (z.mode === "dead" || z.kind === "reaper") continue;
      if (!inLane(part, z.x, z.z)) continue;
      damageZombie(z, GLOVE_DAMAGE, part.dirX, part.dirZ, GLOVE_KNOCKBACK);
      connected = true;
    }

    part.punchSpent = true;
    if (connected) {
      state.vfx?.sparks(part.x + part.dirX * 0.6, 0.4, part.z + part.dirZ * 0.6, part.dirX, part.dirZ, 10);
      state.shakeT = Math.max(state.shakeT, 0.16);
      sfxBumper();
    }
  }
}
