/**
 * Self-firing hazard simulation — the BOXING GLOVES, the ELECTRIC GRID and the
 * FIRE VENTS. Their clocks/anim live with the other part animations in
 * render/pinball-parts.ts; this module owns the CONSEQUENCES: gloves fling +
 * haymaker whatever's in the lane, live electric plates zap whoever stands on
 * them, roaring vents burn the lane. Runs on the fixed sim step from
 * core.simulate.
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
  ELEC_ON,
  ELEC_OFF,
  ELEC_RADIUS,
  ELEC_DAMAGE,
  ELEC_ZAP_COOLDOWN,
  VENT_WARN,
  VENT_ACTIVE,
  VENT_LANE_LEN,
  VENT_LANE_HALF,
  VENT_DAMAGE,
  VENT_BURN_COOLDOWN,
} from "../constants";
import { damageZombie, hitPlayerRanged } from "./combat";
import { sfxBumper, sfxFlame } from "../audio";

/** A shared clock the electric-plate phase reads (mirrors pinball-parts' animT). */
let hazT = 0;
/** Per-player re-hit lockouts so a hazard reads as ticks, not per-frame drain. */
let elecCd = 0;
let ventCd = 0;

/** Is (x,z) inside a lane of length `len`/half-width `half` from the part along dir? */
function inLaneOf(part: { x: number; z: number; dirX: number; dirZ: number }, x: number, z: number, len: number, half: number): boolean {
  const rx = x - part.x;
  const rz = z - part.z;
  const along = rx * part.dirX + rz * part.dirZ;
  if (along < -0.1 || along > len) return false;
  const across = Math.abs(rx * -part.dirZ + rz * part.dirX);
  return across <= half;
}

export function simulateHazards(dt: number): void {
  const p = state.player;
  hazT += dt;
  elecCd = Math.max(0, elecCd - dt);
  ventCd = Math.max(0, ventCd - dt);
  if (state.freezeT > 0) return; // the freeze-ray stops every fist, plate and vent

  for (const part of state.pinballParts) {
    // ── BOXING GLOVE ── one punch sweeps its lane: player launched, horde hit.
    if (part.kind === "glove") {
      const punching = part.hitT >= 0 && part.hitT <= GLOVE_ACTIVE;
      if (!punching || part.punchSpent) continue;
      let connected = false;
      if (p && p.hp > 0 && p.rideT < 0 && inLaneOf(part, p.x, p.z, GLOVE_LANE_LEN, GLOVE_LANE_HALF)) {
        p.momX = part.dirX;
        p.momZ = part.dirZ;
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, GLOVE_SPEED));
        p.bounceCombo += 1;
        p.bounceComboT = PINBALL_COMBO_WINDOW;
        state.partComboHits += 1;
        p.iframes = Math.max(p.iframes, 0.15);
        connected = true;
      }
      for (const z of state.zombies) {
        if (z.mode === "dead" || z.kind === "reaper") continue;
        if (!inLaneOf(part, z.x, z.z, GLOVE_LANE_LEN, GLOVE_LANE_HALF)) continue;
        damageZombie(z, GLOVE_DAMAGE, part.dirX, part.dirZ, GLOVE_KNOCKBACK);
        connected = true;
      }
      part.punchSpent = true;
      if (connected) {
        state.vfx?.sparks(part.x + part.dirX * 0.6, 0.4, part.z + part.dirZ * 0.6, part.dirX, part.dirZ, 10);
        state.shakeT = Math.max(state.shakeT, 0.16);
        sfxBumper();
      }
    } else if (part.kind === "electric") {
      // ── ELECTRIC GRID ── zap whoever stands on a LIVE plate (rhythm dodge).
      const live = ((hazT + (part.phase ?? 0)) % (ELEC_ON + ELEC_OFF)) < ELEC_ON;
      if (!live || !p || p.hp <= 0 || p.rideT >= 0 || elecCd > 0) continue;
      const dx = p.x - part.x;
      const dz = p.z - part.z;
      if (dx * dx + dz * dz > ELEC_RADIUS * ELEC_RADIUS) continue;
      elecCd = ELEC_ZAP_COOLDOWN;
      hitPlayerRanged(ELEC_DAMAGE, part.x, part.z); // funnels through armor/i-frames
      state.vfx?.sparks(p.x, 0.5, p.z, 0, 1, 16);
      state.shakeT = Math.max(state.shakeT, 0.2);
    } else if (part.kind === "firevent") {
      // ── FIRE VENT ── burn anything in the lane while the jet roars.
      const roaring = part.hitT >= VENT_WARN && part.hitT <= VENT_WARN + VENT_ACTIVE;
      if (!roaring) continue;
      if (p && p.hp > 0 && p.rideT < 0 && ventCd <= 0 && inLaneOf(part, p.x, p.z, VENT_LANE_LEN, VENT_LANE_HALF)) {
        ventCd = VENT_BURN_COOLDOWN;
        hitPlayerRanged(VENT_DAMAGE, part.x, part.z);
        state.vfx?.ember(p.x, 0.4, p.z);
        if (Math.random() < 0.3) sfxFlame();
      }
      for (const z of state.zombies) {
        if (z.mode === "dead" || z.kind === "reaper") continue;
        if (z.burnT > 0 || !inLaneOf(part, z.x, z.z, VENT_LANE_LEN, VENT_LANE_HALF)) continue;
        z.burnT = VENT_BURN_COOLDOWN;
        damageZombie(z, VENT_DAMAGE, part.dirX, part.dirZ, 0.05);
      }
    }
  }
}
