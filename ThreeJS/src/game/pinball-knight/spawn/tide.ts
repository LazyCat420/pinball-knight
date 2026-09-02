/**
 * THE TIDE — rolling reinforcements, so a floor is never an empty museum.
 *
 * Before this, every monster on a floor was placed at build time and that was
 * the whole supply. Clear the horde and the maze went quiet for the rest of the
 * Death Dealer's 110-second fuse: nothing to farm, and a floor that got LESS
 * dangerous the longer you stayed on it — exactly backwards from the pressure
 * curve the Dealer implies.
 *
 * The tide is a target-seeking trickle, not a wave table. It asks one question
 * on a timer — "are there fewer live monsters than this floor should have right
 * now?" — and if so walks a few in from beyond the knight's aggro ring. What
 * changes over the floor's life is the answer to "should have": both the target
 * population and the delivery rate ramp from calm to peak across TIDE_RAMP.
 *
 * THREE THINGS HOLD THIS TOGETHER, and each is load-bearing:
 *
 *  1. The target is a SHARE OF THE OPENING HORDE (state.tideBase), capped at
 *     1.0. So the live population never exceeds what the floor was built and
 *     draw-budgeted for, and a floor's steady-state cost is bounded by the cost
 *     it already paid at t=0. It also scales with depth for free, since
 *     floorBudgets already grows the opening horde with the level.
 *  2. Corpses are REAPED (reapCorpses below). killZombie only flips `mode` to
 *     "dead" and nothing ever removed the body, so state.zombies has always
 *     been monotonically non-decreasing across a floor. Harmless with a fixed
 *     monster count; a leak with a tide feeding it.
 *  3. Every reinforcement bumps state.levelHordeSize, the grade's carnage
 *     denominator. Without that, farming pushes kills/hordeSize past 1.0 and
 *     the floor grade degenerates into a participation trophy.
 *
 * Authority-only, like every other runtime spawn (reaper, slime splits,
 * necromancer adds) — replicas receive the tide through the co-op snapshot.
 */
import { state } from "../state";
import { recordDeathTrace } from "../dev/death-debug";
import {
  CORPSE_BUDGET,
  TIDE_GRACE,
  TIDE_INTERVAL_CALM,
  TIDE_INTERVAL_PEAK,
  TIDE_MOBILE_TRIES,
  TIDE_PULSE_CALM,
  TIDE_PULSE_PEAK,
  TIDE_RAMP,
  TIDE_SHARE_CALM,
  TIDE_SHARE_PEAK,
  TIDE_SPAWN_MAX_TILES,
  TIDE_SPAWN_MIN_TILES,
  levelConfig,
} from "../constants";
import { isReplica } from "../coop";
import { isWalkable, tileCenter } from "../maze/generator";
import type { TilePos } from "../maze/generator";
import { showToast } from "../ui";
import { spawnHordeMember } from "./factory";
import type { Zombie } from "../state";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Arm the tide for a freshly built floor. Called at the END of populateFloor,
 * once every last pack and pin is placed.
 *
 * The end is not incidental — `tideBase` is the whole population the floor
 * OPENED with, and it is the tide's ceiling. Read it any earlier and the tide
 * would refill toward a number smaller than the fight the player actually
 * walked into. Read it from `levelHordeSize` instead and it would compound,
 * since that grows with every reinforcement the tide itself walks in.
 *
 * @param spawnTiles the floor's vetted spawn tiles (plan.spawns) — already
 *   walkable, out of the rooms and off the stairs. Re-deriving that rule at
 *   runtime would be a second copy of it, free to drift.
 */
export function armTide(spawnTiles: TilePos[]): void {
  state.tideTiles = spawnTiles;
  state.tideBase = state.zombies.length;
  state.tideT = 0;
  state.tideStirred = false;
}

/**
 * How far up the ramp this floor is, 0..1.
 *
 * Exported because it is the honest read of "how intense is it right now" and
 * the tests assert the curve directly rather than inferring it from spawns.
 */
export function tideIntensity(): number {
  const t = (state.levelT - TIDE_GRACE) / TIDE_RAMP;
  return Math.max(0, Math.min(1, t));
}

/** Live (non-corpse) monster count. The reaper counts — it IS on the floor. */
function liveCount(): number {
  let n = 0;
  for (const z of state.zombies) if (z.mode !== "dead") n++;
  return n;
}

/**
 * What the tide wants at this instant, decided WITHOUT spawning anything.
 *
 * Split out from tickTide so the ramp can be asserted directly against a plain
 * state object. Spawning a real reinforcement needs a scene, a sheet and an
 * atlas; the decision that governs the whole feature needs none of that, and a
 * test that has to build a floor to check a curve is a test nobody writes.
 */
export function tideDemand(): { intensity: number; target: number; live: number; pulse: number } {
  const intensity = tideIntensity();
  const target = Math.round(state.tideBase * lerp(TIDE_SHARE_CALM, TIDE_SHARE_PEAK, intensity));
  const live = liveCount();
  const deficit = target - live;
  const pulse = deficit <= 0 ? 0 : Math.min(deficit, Math.round(lerp(TIDE_PULSE_CALM, TIDE_PULSE_PEAK, intensity)));
  return { intensity, target, live, pulse };
}

/**
 * Where the next reinforcement comes in.
 *
 * PREFERRED: anywhere in the band — far enough out that it WALKS in rather
 * than appearing mid-swing, near enough that it arrives while it still matters.
 * The minimum is the hard half: nothing may ever surface inside the knight's
 * aggro ring, and if that cannot be honoured the pulse is skipped.
 *
 * FALLBACK: the nearest tile beyond the minimum, when the band is empty.
 *
 * The fallback is not defensive garnish — it is the measured answer to a real
 * hole. Sampling every standable tile of the shipping floors (tide-reach.test)
 * says 2-4% of them have NO spawn tile inside TIDE_SPAWN_MAX_TILES, rising
 * with depth as floors outgrow the band; on those tiles the nearest one sits
 * at a median of ~38. Every one of those cases is TOO FAR — across six depths
 * and three seeds, not one standable tile was ever surrounded by spawn tiles
 * that were all too NEAR. So without a fallback the tide simply switches off
 * in the far corners of deep floors, which is exactly the dead-floor problem it
 * was built to end. Widening the band instead would push every ordinary
 * reinforcement further out to fix a corner case; this keeps the common walk
 * short and only reaches when it has to.
 */
export function pickSpawnTile(): { x: number; z: number } | null {
  const g = state.grid;
  const p = state.player;
  if (!g || !p || !state.tideTiles.length) return null;
  const minD2 = TIDE_SPAWN_MIN_TILES * TIDE_SPAWN_MIN_TILES;
  const maxD2 = TIDE_SPAWN_MAX_TILES * TIDE_SPAWN_MAX_TILES;
  // One pass, no allocation: reservoir-sample the band, and carry the nearest
  // legal-but-distant tile alongside in case the band turns out to be empty.
  let seen = 0;
  let pick: { x: number; z: number } | null = null;
  let spare: { x: number; z: number } | null = null;
  let spareD2 = Infinity;
  for (const t of state.tideTiles) {
    if (!isWalkable(g, t.i, t.j)) continue; // a secret door may have re-carved
    const c = tileCenter(g, t.i, t.j);
    const dx = c.x - p.x;
    const dz = c.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2) continue; // never, under any circumstances, in your lap
    if (d2 > maxD2) {
      if (d2 < spareD2) {
        spareD2 = d2;
        spare = c;
      }
      continue;
    }
    seen++;
    if (Math.random() * seen < 1) pick = c;
  }
  return pick ?? spare;
}

/**
 * Roll one reinforcement at a world point.
 *
 * Goes through spawnHordeMember, so the tide draws from the SAME biome-themed
 * weights and depth gates as the opening horde — a floor's reinforcements
 * always look like that floor. The only thing it adds is a mobility retry:
 * spawnHordeMember can return a chomper/golem/crystalback (speed 0) or a
 * dormant mimic, and a stationary ambusher surfaced 20 tiles behind you is
 * dead content, not a reinforcement.
 */
function rollReinforcement(x: number, z: number): Zombie | null {
  const cfg = levelConfig(state.level);
  let last: Zombie | null = null;
  for (let attempt = 0; attempt < TIDE_MOBILE_TRIES; attempt++) {
    const hash = (Math.random() * 0xffffffff) >>> 0;
    const zomb = spawnHordeMember(hash, x, z, cfg.zombieSpeed, state.level);
    if (zomb.speed > 0 && !zomb.dormant) return zomb;
    // Undo: makeZombie already parented the mesh into the scene, so a rejected
    // roll that is merely dropped on the floor leaks a sprite into the graph.
    zomb.sprite.mesh.parent?.remove(zomb.sprite.mesh);
    last = zomb;
  }
  // Out of retries: this floor's whole themed table is stationary. Take the
  // last roll rather than starve the tide — but it was already un-parented, so
  // put it back before handing it over.
  if (last && state.scene) state.scene.add(last.sprite.mesh);
  return last;
}

/**
 * One sim step of the tide. Call AFTER updateZombies and the other drains —
 * anything spawned this step must not also be simulated this step.
 */
export function tickTide(dt: number): void {
  if (isReplica()) return; // the authority's tide arrives by snapshot
  if (!state.player || !state.grid || state.gameOver) return;
  if (state.levelT < TIDE_GRACE) return;
  if (state.tideBase <= 0) return; // floor never opened, or a test harness

  state.tideT -= dt;
  if (state.tideT > 0) return;
  const intensity = tideIntensity();
  state.tideT = lerp(TIDE_INTERVAL_CALM, TIDE_INTERVAL_PEAK, intensity);

  const { pulse } = tideDemand();
  if (pulse <= 0) return;

  let added = 0;
  for (let n = 0; n < pulse; n++) {
    const spot = pickSpawnTile();
    if (!spot) break; // nowhere legal this pulse — try again next one
    const zomb = rollReinforcement(spot.x, spot.z);
    if (!zomb) break;
    zomb.aggro = true; // it came for you; it does not need to be noticed first
    state.zombies.push(zomb);
    added++;
  }
  if (!added) return;
  // The carnage denominator has to follow the supply — see the header.
  state.levelHordeSize += added;
  if (!state.tideStirred) {
    state.tideStirred = true;
    showToast("THE DUNGEON STIRS", "it is sending more — the stairs are the only way out");
  }
}

/**
 * Cull the oldest corpses past CORPSE_BUDGET.
 *
 * Bosses are exempt: a slain Reaper King's body is the floor's trophy and the
 * portal blooms over it. Everything else is litter, culled oldest-first so the
 * kills you just made stay on the ground where you made them.
 *
 * Mirrors detonateCroakerCorpse's teardown exactly (splice + unparent, no
 * dispose) — the sprite's material and atlas texture are SHARED across every
 * actor of that kind, so disposing here would blank the living ones.
 */
export function reapCorpses(): void {
  let corpses = 0;
  for (const z of state.zombies) {
    if (z.mode === "dead" && !z.boss && (!z.anim || z.anim.isFinished())) {
      corpses++;
    }
  }
  let excess = corpses - CORPSE_BUDGET;
  if (excess <= 0) return;
  for (let i = 0; i < state.zombies.length && excess > 0; ) {
    const z = state.zombies[i];
    if (z.mode === "dead" && !z.boss && (!z.anim || z.anim.isFinished())) {
      recordDeathTrace(z, "reap", { excess });
      state.zombies.splice(i, 1);
      z.sprite.mesh.parent?.remove(z.sprite.mesh);
      excess--;
      continue; // index i now holds the next element
    }
    i++;
  }
}
