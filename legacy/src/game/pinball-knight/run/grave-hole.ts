/**
 * The GRAVE HOLE a departing co-op knight leaves behind.
 *
 * Extracted verbatim from core.ts. Kept as its own module because it is a
 * complete set piece — detonation, blast damage, and the lasting scar — driven
 * from two places (the floor authority directly, and replicas via the mirrored
 * `hole` act in coop.ts) and belonging to neither.
 */
import { state } from "../state";
import { worldToTile, tileCenter, isWalkable } from "../maze/generator";
import { nearestOpenTile } from "../maze/nearest-open-tile";
import { spawnPinballPart } from "../render/pinball-parts";
import { damageZombie } from "../entities/combat";
import { showToast } from "../ui";
import { sfxHeavy } from "../sfx";
import { PALETTE_HEX } from "../render/palette";
import { GRAVEPIT_BLAST_RADIUS, GRAVEPIT_BLAST_LIFE, GRAVEPIT_BLAST_DAMAGE } from "../constants";

/**
 * A knight left the pool: detonate their body and tear a LETHAL hole where they
 * stood. Runs on every client — the floor authority calls it directly and
 * broadcasts, replicas call it from the mirrored `hole` act (coop.ts) — so the
 * hole exists once, in the same place, in everyone's world.
 *
 * The position is SNAPPED to a tile centre. Two reasons, and both matter:
 * the departing peer's last-known pose is whatever 15Hz `move` frame arrived
 * before they dropped, so it can sit fractionally inside a wall; and snapping
 * makes the hole land somewhere a player can actually be, rather than half
 * under a wall band where it would be an invisible instant-death trap.
 */
export function tearGraveHole(x: number, z: number, name: string): void {
  const g = state.grid;
  if (!g || !state.scene) return;
  let t = worldToTile(g, x, z);
  if (!isWalkable(g, t.i, t.j)) {
    // They died against (or inside) geometry — put the hole on the nearest tile
    // a knight could stand on instead. n=1 is the ORDINAL of the first walkable
    // tile found, not a distance (see nearestOpenTile).
    const open = nearestOpenTile(g, t.i, t.j, 1);
    if (!open) return; // nowhere sane to put it — better no hole than a bad one
    t = open;
  }
  // Never stack a second hole on a tile that already has one: a departing pool
  // can re-use the same doorway, and two colliders on one spot is just waste.
  if (state.pinballParts.some((p) => p.kind === "gravepit" && p.i === t.i && p.j === t.j)) return;
  const c = tileCenter(g, t.i, t.j);

  // ── The detonation ──
  state.vfx?.burst(c.x, 0.5, c.z, PALETTE_HEX[12], 34, 5.5);
  state.vfx?.ring(c.x, c.z, PALETTE_HEX[11], GRAVEPIT_BLAST_RADIUS, GRAVEPIT_BLAST_LIFE);
  state.vfx?.blood(c.x, 0.6, c.z, "red", 26);
  state.shakeT = Math.max(state.shakeT, 0.55);
  state.hitstopT = Math.max(state.hitstopT, 0.06);
  sfxHeavy();
  // The blast damages ENEMIES only. A player standing next to the departure
  // point could not have seen it coming, and killing them for someone else's
  // disconnect is punishment without agency — the HOLE is the lasting threat.
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - c.x;
    const dz = zmb.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > GRAVEPIT_BLAST_RADIUS) continue;
    const inv = d > 1e-3 ? 1 / d : 0;
    damageZombie(zmb, GRAVEPIT_BLAST_DAMAGE, dx * inv, dz * inv, 1.1, true);
  }

  // ── The scar ──
  spawnPinballPart("gravepit", c.x, c.z, g, state.scene);
  showToast("💀 A KNIGHT HAS FALLEN", `${name} left the pool — mind the hole`);
}
