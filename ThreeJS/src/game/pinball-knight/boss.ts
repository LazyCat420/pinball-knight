/**
 * THE BOSSES — one guardian per biome, each gating its floor's exit portal.
 *
 * WHO the bosses are lives in `boss-kinds.ts`; HOW their attacks behave lives
 * in `boss-moves.ts`. This module is the encounter: the leash, the phase flip,
 * the fairness scaling, the portal, and the co-op mirror.
 *
 * Until 2026-08-28 there was one boss and every floor was gated on him — floor
 * 1 and floor 17 were the same fight, and `BOSS_EVERY` only doubled his HP.
 * The King is now the CRYPT's guardian and three others hold the other biomes.
 *
 * ── ☠ THE REAPER KING, for continuity ──────────────────────────────────────
 *
 * Reuses the dungeon's own enemy pipeline (`makeZombie`) so it chases, takes
 * damage, and dies through the same combat path as everything else — but it is
 * a KILLABLE `brute` wearing the reaper's art (the real `reaper` kind is
 * combat-immune), scaled up, with two bespoke threats layered on top by this
 * module's own tick:
 *
 *   • ORBITING SKULLS — a ring of bone that wheels around the king, and every
 *     so often one detaches and flies at whoever it can see (ranged pressure).
 *   • TENTACLE SLAM — a telegraphed ground-pound: a growing ring marks where it
 *     will land, then it SLAMS, damaging + launching anyone still inside.
 *
 * While a boss lives the floor's stairs won't descend (`state.exitLocked`).
 * On its death the lock lifts and a PORTAL blooms over the stairs — "kill the
 * boss to reach the portal". All meshes here are procedural (no art pipeline),
 * so the module is self-contained and safe to dispose on any level change.
 *
 * Co-op note: the king lives in `state.zombies`, so on a host it is part of the
 * authoritative world snapshot like any enemy; `coop.ts` streams it and the
 * skulls/slam telegraphs to replicas. This module runs its AI on the HOST only
 * (guarded by the caller), replicas render the streamed state.
 */
import * as THREE from "three";
import { state, playerIsVisibleToEnemies, type Zombie } from "./state";
import { showToast } from "./ui";
import { PINBALL_MAX_SPEED, REAPER_SCALE, REAPER_TINT, BRUTE_R } from "./constants";
import { tileCenter, idx, worldToTile, type Grid, type TilePos } from "./maze/generator";
import { moveCircle } from "./engine/collision";
import { hitPlayerRanged, syncActorMesh } from "./entities/combat";
import { facingFromWorld } from "./entities/zombie";
import { peers } from "../../net/presence";
import { BOSSES, BOSS_KINDS, movesAt, type BossKind, type BossSpec } from "./boss-kinds";
import { sheetFor, type SheetKey } from "./boot/sheets";
import { MonsterAnimator } from "./engine/render/monster-animator";
import {
  createDragonSnake,
  updateDragonSnakeKinematics,
  checkDragonSnakeCollisions,
  updateDragonSnakeAttacks,
  onDragonSnakeDeath,
  disposeDragonSnake,
  type DragonSnakeBoss,
} from "./entities/dragon-snake";
import {
  chargeHoldsMovement,
  disposeFanBoomerang,
  freshBarrage,
  freshCharge,
  freshFanBoomerang,
  freshNova,
  freshSlam,
  freshSummon,
  freshTeleportFire,
  makeOrbiter,
  syncOrbit,
  teleportFireHoldsMovement,
  updateBarrage,
  updateCharge,
  updateFanBoomerang,
  updateNova,
  updateShots,
  updateSlam,
  updateSummon,
  updateTeleportFire,
  type BarrageRt,
  type BossShot,
  type ChargeRt,
  type FanBoomerangRt,
  type MoveCtx,
  type NovaRt,
  type Orbiter,
  type SlamRt,
  type SummonRt,
  type TeleportFireRt,
} from "./boss-moves";

// ── Tuning ────────────────────────────────────────────────────────────────────
// (King HP now arrives as a spawn parameter — core scales it by floor, see
// KING_HP_BASE/KING_HP_PER_FLOOR in constants.ts. Every floor is boss-gated.)
const KING_SCALE = REAPER_SCALE * 1.55; // looms over the horde
/**
 * The king's COLLIDER, derived from the same scale as his mesh.
 *
 * Not a free parameter: a hand-picked number here would drift the moment
 * KING_SCALE was retuned, which is exactly the bug this fixes. Slightly under
 * the full visual half-width (0.86 of it) so he can still squeeze through a
 * 2-wide gap that looks passable — a boss that reads as fitting but does not
 * is just as frustrating as one embedded in stone.
 */
export const KING_BODY_R = BRUTE_R * Math.max(...BOSS_KINDS.map((k) => BOSSES[k].art.scale)) * 0.86;
/**
 * ── THE LEASH ─────────────────────────────────────────────────────────────
 *
 * The king is a GUARDIAN. He is spawned on the exit (core.ts sites him at
 * `nearestOpenTile(stairs, 2)`) and he locks it, so his whole job is to be
 * between the player and the way down.
 *
 * He was not behaving like one. `spawnBoss` set `z.aggro = true`, which is the
 * one flag the generic zombie AI uses to decide whether to chase — every other
 * enemy on the floor starts `aggro = false` and wakes only when the player is
 * within `AGGRO_TILES` *by path distance* (entities/zombie.ts reads
 * `state.flowField`, which is BFS from the player). The king opted out of that
 * gate entirely, so from the instant the floor built he walked toward the
 * spawn, across the whole map, and never stopped.
 *
 * That is why the user reported the boss "next to the starting point" while a
 * census of 78 generated floors said the opposite: **his spawn tile is never
 * closer than 56 BFS steps from the player's, mean 68% of the floor's whole
 * reach.** The placement was already correct and always had been. He simply
 * did not stay there, and no generation rule can fix a mover — which is why
 * this is a behaviour change and not a constraint in maze/floor-rules.ts.
 *
 * Two numbers, and they do different jobs:
 *   WAKE  — path distance at which he notices you. Deliberately far wider than
 *           a grunt's AGGRO_TILES: he should register you entering his hall,
 *           not be startled at arm's length.
 *   LEASH — how far from his ANCHOR he will follow before turning back. This
 *           is what makes him a guardian rather than a pursuer, and it is
 *           measured from the anchor (not from the player) so kiting him away
 *           and looping back cannot drag him off the exit.
 *
 * LEASH is comfortably larger than WAKE on purpose. Inverted or too close
 * together and he oscillates — wakes, steps forward, trips the leash, returns,
 * wakes again — which reads as a broken boss rather than a cautious one.
 */
const KING_WAKE_TILES = 26; // path distance (tiles) at which he engages
const KING_LEASH_TILES = 34; // world distance from the anchor before he returns
/** Within this of the anchor he counts as home and stands his ground again. */
/** Exported so `maze/floor-rules.ts` can DERIVE the arena size from the king's
 *  own mechanics instead of restating a number that would then drift. The maze
 *  modules are three-free and this file is not, so the derivation is duplicated
 *  there and pinned against these by a test — the same shape as
 *  RAIL_RIDE_INSET/PLAYER_R. */
export const KING_HOME_TILES = 2.5;
/** He walks home at a fraction of his hunting speed — a stalk back, not a sprint. */
const KING_RETURN_SPEED = 0.75;
/** Mirrored from boss-moves.ts — the replica draws its own copies of these. */
const SHOT_Y = 1.5;
const SHOT_HIT_R = 0.55;
const SKULL_Y = 1.5;
/**
 * The widest thing you must WALK OUT OF — every boss's slam, and every echo.
 *
 * Derived from the roster rather than named, so a new boss's ground-pound is
 * measured against the hall instead of quietly outgrowing it. It is read by
 * `maze/floor-rules.test.ts`, which pins BOSS_ARENA_R to it.
 *
 * ⚠️ THE NOVA IS DELIBERATELY NOT IN HERE, and the distinction is geometric,
 * not an oversight. A slam is centred on YOU: the hall must be big enough that
 * you can travel out of the crater, so its radius drives the arena. A nova is
 * centred on the BOSS: you escape it by being far from HIM, which the hall
 * already allows, or by rolling through the front. Feeding it into this number
 * would demand 10-tile halls to solve a problem the player solves by moving
 * away from the thing they were already moving away from.
 */
export const SLAM_RADIUS = Math.max(
  ...BOSS_KINDS.flatMap((k) => {
    const b = BOSSES[k];
    return [b.moves, b.phase2.moves].flatMap((m) => [m.slam?.radius ?? 0, m.slam?.echo?.radius ?? 0]);
  }),
);
/** The longest a boss can throw. The arena must be no WIDER than this, or the
 *  hall is one you kite him around instead of fighting him in. */
export const BONE_MAX_DIST = Math.max(
  ...BOSS_KINDS.flatMap((k) => [BOSSES[k].moves.barrage?.maxDist ?? 0, BOSSES[k].phase2.moves.barrage?.maxDist ?? 0]),
);

/**
 * Nearest knight to (x,z) among OUR player and every pool-mate on this floor —
 * the king fights the whole party, not just the authority's knight. Peer
 * positions come from presence (fresh at 15Hz).
 */
function nearestKnight(x: number, z: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  const p = state.player;
  if (p) {
    best = { x: p.x, z: p.z };
    bestD = Math.hypot(p.x - x, p.z - z);
  }
  const tag = `dungeon:${state.level}`;
  for (const peer of peers()) {
    if (peer.scene !== tag) continue;
    const d = Math.hypot(peer.x - x, peer.z - z);
    if (d < bestD) {
      bestD = d;
      best = { x: peer.x, z: peer.z };
    }
  }
  return best;
}

/** Knights currently on this floor, ME included — the king's HP fairness unit. */
function knightsOnFloor(): number {
  const tag = `dungeon:${state.level}`;
  let n = 1;
  for (const peer of peers()) if (peer.scene === tag) n++;
  return n;
}

interface Skull {
  mesh: THREE.Mesh;
  phase: number; // orbit angle offset
}
interface Bone {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  vx: number;
  vz: number;
  dist: number;
}
interface BossState {
  /** WHICH boss this is — the row in `boss-kinds.ts` that drives everything. */
  spec: BossSpec;
  z: Zombie;
  /**
   * His LAIR — the world position he was spawned at, i.e. the exit he guards.
   * The leash is measured from here rather than from wherever he happens to be,
   * so a player who kites him away and loops round cannot walk him off the
   * stairs a step at a time.
   */
  anchor: { x: number; z: number };
  /** True while hunting. Owned by `updateBoss`, which writes `z.aggro` from it. */
  engaged: boolean;
  /** 1 until the HP threshold in `spec.phase2.at`, then 2. Never goes back. */
  phase: 1 | 2;

  // ── Attack runtimes. Present only for the moves this boss actually has;
  // created lazily so a phase-2-only move (the Archivist's orbit) can appear
  // mid-fight without every boss carrying a null for it from the start.
  orbiters: Orbiter[];
  orbitT: number;
  shots: BossShot[];
  barrage: BarrageRt | null;
  slam: SlamRt | null;
  charge: ChargeRt | null;
  summon: SummonRt | null;
  nova: NovaRt | null;
  teleportFire: TeleportFireRt | null;
  fanBoomerang: FanBoomerangRt | null;
  dragonSnake?: DragonSnakeBoss | null;

  /** Adds this boss has produced, so the cap can be enforced against reality. */
  adds: Zombie[];
  /** Injected by the spawner — `boss.ts` must not import the monster factory. */
  spawnAdd: ((x: number, z: number) => Zombie | null) | null;

  portal: THREE.Mesh | null;
  opened: boolean;
  /** How many knights the boss's HP is currently scaled for (fairness). */
  scaledFor: number;
}

let boss: BossState | null = null;

/**
 * WHICH boss is on this floor — the authority's own, or the kind the last aux
 * snapshot named on a replica. Null when there is no boss.
 *
 * The HUD reads it for the name on the bar. It used to say "BOSS", which was
 * accurate while there was exactly one; with four of them the bar was the only
 * place the game never told you what you were fighting.
 */
export function bossLabel(): string | null {
  if (boss) return boss.spec.label;
  return replica ? BOSSES[replica.kind].label : null;
}

/** True while a boss is alive and holding the exit shut. */
export function bossActive(): boolean {
  return boss !== null && !boss.opened;
}

// ── Procedural meshes ─────────────────────────────────────────────────────────

function makePortal(): THREE.Mesh {
  const geo = new THREE.TorusGeometry(0.95, 0.22, 12, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xa050e0 });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.y = 1.0;
  ring.renderOrder = 8;
  // A swirling inner disc so it reads as a gateway, not a hoop.
  const discGeo = new THREE.CircleGeometry(0.9, 32);
  const discMat = new THREE.MeshBasicMaterial({ color: 0x2a0d40, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.z = 0.001;
  ring.add(disc);
  return ring;
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
/**
 * Spawn the Reaper King at `spot`, wire the skull ring, and lock the exit.
 * `makeZombie` is injected (it lives in core.ts) to keep this module free of a
 * circular import. Safe no-op if a boss already exists or the scene is gone.
 */
export function spawnBoss(
  grid: Grid,
  spot: TilePos,
  hp: number,
  spec: BossSpec,
  makeZombie: (x: number, z: number, hp: number) => Zombie,
  spawnAdd: ((x: number, z: number) => Zombie | null) | null = null,
): void {
  if (boss || !state.scene || !state.player) return;
  const c = tileCenter(grid, spot.i, spot.j);
  const z = makeZombie(c.x, c.z, Math.max(1, Math.round(hp * spec.hpMult)));
  z.baseTint = spec.art.tint;
  z.sprite.setTint(spec.art.tint);
  z.sprite.mesh.scale.multiplyScalar(spec.art.scale);
  z.speed *= spec.speedMult;
  // The collider must grow WITH the mesh, from the same constant, or the two
  // drift apart. They did: the king rendered ~2.17x wide while colliding as a
  // plain brute (0.42), so he walked half his visible body into 1-tile
  // corridors and read as stuck in the wall. Derived, never hand-tuned — and
  // now from the SPEC's scale, so a new boss cannot reintroduce the drift.
  z.bodyR = BRUTE_R * spec.art.scale * 0.86;
  // NOT `aggro = true`. That single line is what made him leave his post the
  // instant the floor existed — see THE LEASH above. `updateBoss` now owns this
  // flag and writes it from `engaged` every tick.
  z.aggro = false;
  z.bossKind = spec.kind;

  boss = {
    spec,
    z,
    // His post IS where he was sited — the exit. Captured from the spawn
    // position rather than re-derived from `state.stairs` later, because the
    // two differ by `nearestOpenTile`'s search and the leash must be measured
    // from the tile he actually stands on.
    anchor: { x: c.x, z: c.z },
    engaged: false,
    phase: 1,
    orbiters: [],
    orbitT: 0,
    shots: [],
    barrage: null,
    slam: null,
    charge: null,
    summon: null,
    nova: null,
    teleportFire: null,
    fanBoomerang: null,
    adds: [],
    spawnAdd,
    portal: null,
    opened: false,
    dragonSnake: null,
    // Spawn hp is the 1-knight value; the first updateBoss tick rescales to
    // however many knights are actually on the floor.
    scaledFor: 1,
  };

  if (spec.kind === "dragon") {
    const headSheet = sheetFor("dragon_snake_head");
    if (headSheet) {
      z.sprite?.setSheet?.(headSheet);
      if (
        z.sprite?.sheet &&
        typeof z.sprite?.setFlipped === "function" &&
        typeof z.sprite?.setFrame === "function"
      ) {
        z.anim = new MonsterAnimator(z.sprite);
        z.anim.play("idle");
      }
    }
    boss.dragonSnake = createDragonSnake(z, 12, spec.art.scale);
  }

  syncOrbiters();
  state.exitLocked = true;
  showToast(spec.title, spec.tagline);
  state.shakeT = Math.max(state.shakeT, 0.4);
}

/**
 * Match the orbiter meshes to whatever the CURRENT phase asks for.
 *
 * Called on spawn and again on the phase flip, because a phase can add a ring
 * that was not there before (the Archivist gains one at half health) or change
 * its colour. Rebuilds rather than diffs: five spheres is not worth the
 * bookkeeping, and a rebuild cannot leave a stale colour behind.
 */
function syncOrbiters(): void {
  if (!boss) return;
  const spec = movesAt(boss.spec, hpFrac()).orbit;
  for (const o of boss.orbiters) disposeMesh(o.mesh);
  boss.orbiters = [];
  if (!spec || !state.scene) return;
  for (let i = 0; i < spec.count; i++) {
    const mesh = makeOrbiter(spec.color);
    state.scene.add(mesh);
    boss.orbiters.push({ mesh, phase: (i / spec.count) * Math.PI * 2 });
  }
}

/** Current HP as a fraction of max — the phase clock. */
function hpFrac(): number {
  if (!boss) return 1;
  const max = boss.z.maxHp ?? boss.z.hp;
  return max > 0 ? boss.z.hp / max : 1;
}

// ── Per-frame update (HOST authority — caller gates on !isReplica) ─────────────
export function updateBoss(dt: number): void {
  if (!boss) return;

  // Death: the king left `state.zombies` (killZombie removed it) or hp bottomed.
  if (!boss.opened && (boss.z.hp <= 0 || !state.zombies.includes(boss.z))) {
    if (boss.dragonSnake) onDragonSnakeDeath(boss.dragonSnake, dt);
    openPortal();
    return;
  }

  if (boss.opened) {
    if (boss.dragonSnake) onDragonSnakeDeath(boss.dragonSnake, dt);
    updatePortal(dt);
    // Let anything already in flight finish; the target is irrelevant now.
    updateShots(boss.shots, makeCtx(dt, { x: boss.z.x, z: boss.z.z }));
    return;
  }

  const p = state.player;
  if (!p) return;

  // ── FAIRNESS SCALING ── the king's HP tracks the knights actually on the
  // floor: 2 players = ×2, drop-in mid-fight included (the current damage
  // FRACTION is preserved, so arriving help never heals him in relative terms,
  // and a rage-quit doesn't strand the survivor against a double-HP wall).
  const n = knightsOnFloor();
  if (n !== boss.scaledFor) {
    const factor = n / boss.scaledFor;
    const mh = boss.z.maxHp ?? boss.z.hp;
    boss.z.maxHp = Math.max(1, Math.round(mh * factor));
    boss.z.hp = Math.min(boss.z.maxHp, Math.max(1, Math.round(boss.z.hp * factor)));
    if (n > boss.scaledFor) showToast("☠ THE KING FEEDS ON NUMBERS", `${n} knights — his health swells ×${n}`);
    boss.scaledFor = n;
    state.hudDirty = true;
  }

  const bx = boss.z.x;
  const bz = boss.z.z;
  // The king menaces whichever knight is CLOSEST — ours or a pool-mate's.
  const target = nearestKnight(bx, bz) ?? { x: p.x, z: p.z };
  const ctx = makeCtx(dt, target);

  // ── THE LEASH ── decided here, once, and everything below reads `engaged`.
  //
  // Runs AFTER `updateZombies` in `simulate`, so writing `z.aggro` takes effect
  // on the next frame. That one-frame lag is imperceptible and it is the reason
  // this can live here instead of being threaded into the generic AI: the
  // generic path already does the right thing with `aggro`, it just needs
  // someone to own the flag for this one enemy.
  const homeD = Math.hypot(bx - boss.anchor.x, bz - boss.anchor.z);
  // Path distance from the player to the king, exactly the quantity the grunt
  // aggro gate uses — `state.flowField` is BFS from the player, indexed at the
  // ENEMY's tile. Euclidean would wake him through a wall, which on a floor
  // built around a looping circuit is routinely 30 tiles of real walking away.
  let pathD = Infinity;
  const g = state.grid;
  if (g && state.flowField) {
    const t = worldToTile(g, bx, bz);
    const d = state.flowField[idx(g, t.i, t.j)];
    if (d >= 0 && d < 0x3fffffff) pathD = d;
  }
  if (!boss.engaged) {
    // "He has seen you" must be TRUE when the toast says it: a knight still
    // parked in the plunger chute has not been seen by anything yet
    // (`playerIsVisibleToEnemies`, state.ts). On a small floor the chute can
    // sit inside KING_WAKE_TILES of his post, and waking him there burned the
    // stirs-toast before the ball was even in play.
    if (pathD <= KING_WAKE_TILES && playerIsVisibleToEnemies()) {
      boss.engaged = true;
      showToast("☠ THE KING STIRS", "he has seen you");
    }
  } else if (homeD > KING_LEASH_TILES) {
    // Off his post. Disengage and go back; he is a guardian, not a pursuer.
    boss.engaged = false;
  }
  boss.z.aggro = boss.engaged;

  // ── RETURNING ── walk home under our own steam. With `aggro` false the
  // generic AI parks him in `idle` and does not move him at all, so without
  // this he would simply stand wherever the leash tripped — which is worse than
  // chasing, because the exit ends up unguarded AND he is loitering in a
  // corridor. Deliberately slower than his hunt: a stalk back, not a retreat.
  if (!boss.engaged && homeD > KING_HOME_TILES && g && !(boss.charge && chargeHoldsMovement(boss.charge)) && !(boss.teleportFire && teleportFireHoldsMovement(boss.teleportFire))) {
    const step = boss.z.speed * KING_RETURN_SPEED * dt;
    const res = moveCircle(g, bx, bz, boss.z.bodyR ?? KING_BODY_R, ((boss.anchor.x - bx) / homeD) * step, ((boss.anchor.z - bz) / homeD) * step);
    boss.z.x = res.x;
    boss.z.z = res.z;
    boss.z.anim.setFacing(facingFromWorld(boss.anchor.x - bx, boss.anchor.z - bz, "S"));
    boss.z.anim.play("walk");
    syncActorMesh(boss.z);
  }

  // ── DISENGAGED: no ranged pressure ──
  //
  // Every attack aims at `target` with no range test of its own, so a leashed
  // boss would snipe and drop ground-pounds on a player halfway across the
  // floor — the leash would have removed the chase and left the harassment,
  // which is the worse half. The ring keeps wheeling (he is visibly alive and
  // dangerous), nothing fires, and the timers are HELD rather than ticked down
  // so re-entering his hall doesn't eat an instant slam from a countdown that
  // expired while you were away.
  if (!boss.engaged) {
    updateShots(boss.shots, ctx); // let anything already in flight land
    return;
  }

  // ── THE PHASE FLIP ──
  //
  // HP-threshold, one-way, and it ADDS A PATTERN LAYER or swaps the movement
  // mode rather than reskinning — the shape `enter-the-gungeon.md` §5.2
  // describes. The runtimes whose spec changed are re-seeded so the new
  // cadence starts from a full interval instead of inheriting a countdown
  // measured against the old one.
  if (boss.phase === 1 && hpFrac() <= boss.spec.phase2.at) {
    boss.phase = 2;
    const p2 = boss.spec.phase2;
    if (p2.moves.barrage) boss.barrage = freshBarrage(p2.moves.barrage);
    if (p2.moves.slam) boss.slam = freshSlam(p2.moves.slam);
    if (p2.moves.charge) boss.charge = freshCharge(p2.moves.charge);
    if (p2.moves.summon) {
      const alive = boss.summon?.alive ?? 0;
      boss.summon = freshSummon(p2.moves.summon);
      boss.summon.alive = alive; // the brood does not vanish at the threshold
    }
    if (p2.moves.nova) boss.nova = freshNova(p2.moves.nova);
    if (p2.moves.teleportFire) boss.teleportFire = freshTeleportFire(p2.moves.teleportFire);
    if (p2.moves.fanBoomerang) boss.fanBoomerang = freshFanBoomerang(p2.moves.fanBoomerang);
    if (p2.speedMult) boss.z.speed *= p2.speedMult;
    syncOrbiters();
    showToast(p2.title, boss.spec.tagline);
    state.shakeT = Math.max(state.shakeT, 0.5);
    state.hudDirty = true;
  }

  const moves = movesAt(boss.spec, hpFrac());

  // ── The moveset. A boss runs only the moves its row names. ──
  if (moves.barrage) {
    boss.barrage ??= freshBarrage(moves.barrage);
    updateBarrage(boss.barrage, moves.barrage, ctx, boss.shots);
  }
  updateShots(boss.shots, ctx);

  if (moves.slam) {
    boss.slam ??= freshSlam(moves.slam);
    updateSlam(boss.slam, moves.slam, ctx);
  }

  if (moves.charge) {
    boss.charge ??= freshCharge(moves.charge);
    updateCharge(boss.charge, moves.charge, ctx);
  }

  if (moves.summon) {
    boss.summon ??= freshSummon(moves.summon);
    // The cap is measured against what is ALIVE, not against what was ever
    // spawned — a boss you have been out-killing should keep summoning.
    boss.adds = boss.adds.filter((a) => a.hp > 0 && state.zombies.includes(a));
    boss.summon.alive = boss.adds.length;
    const spawnAdd = boss.spawnAdd;
    updateSummon(boss.summon, moves.summon, ctx, (x, z) => {
      const a = spawnAdd?.(x, z) ?? null;
      if (a) boss!.adds.push(a);
      return a !== null;
    });
  }

  if (moves.nova) {
    boss.nova ??= freshNova(moves.nova);
    updateNova(boss.nova, moves.nova, ctx);
  }

  if (moves.teleportFire) {
    boss.teleportFire ??= freshTeleportFire(moves.teleportFire);
    updateTeleportFire(boss.teleportFire, moves.teleportFire, ctx, boss.shots);
  }

  if (moves.fanBoomerang) {
    boss.fanBoomerang ??= freshFanBoomerang(moves.fanBoomerang);
    updateFanBoomerang(boss.fanBoomerang, moves.fanBoomerang, ctx);
  }

  // ── The ring wheels (after moves so teleports track orbiters instantly) ──
  if (moves.orbit) {
    boss.orbitT += dt * moves.orbit.speed;
    syncOrbit(boss.orbiters, moves.orbit, boss.z.x, boss.z.z, boss.orbitT);
  }

  // ── Modular Serpentine Dragon Boss (Snake kinematics, bumper collisions, fire breath) ──
  if (boss.dragonSnake) {
    updateDragonSnakeKinematics(boss.dragonSnake, dt);
    checkDragonSnakeCollisions(boss.dragonSnake, p, dt);
    updateDragonSnakeAttacks(boss.dragonSnake, dt, target);
  }
}

/**
 * The context every attack primitive gets.
 *
 * `hitAt` is the single door damage goes through, so a primitive cannot invent
 * its own damage rule, and `moveTo` is the only way one can move the boss —
 * which is what lets `chargeHoldsMovement` take the wheel for a dash without
 * the generic chase AI fighting it for the same frame.
 */
function makeCtx(dt: number, target: { x: number; z: number }): MoveCtx {
  const b = boss!;
  return {
    dt,
    x: b.z.x,
    z: b.z.z,
    target,
    grid: state.grid,
    bodyR: b.z.bodyR ?? BRUTE_R,
    hitAt(x, z, r, damage, launch) {
      const p = state.player;
      if (!p || p.hp <= 0) return false;
      if (Math.hypot(p.x - x, p.z - z) > r) return false;
      hitPlayerRanged(damage, x, z);
      if (launch > 0) {
        // Reuse the pinball momentum channel, so being hit by a boss reads in
        // the same language as being hit by the table.
        const len = Math.hypot(p.x - x, p.z - z) || 1;
        p.momX = (p.x - x) / len;
        p.momZ = (p.z - z) / len;
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, launch));
        p.iframes = Math.max(p.iframes, 0.2);
      }
      return true;
    },
    moveTo(x, z) {
      b.z.x = x;
      b.z.z = z;
      syncActorMesh(b.z);
    },
    playAnim(clip, opts) {
      b.z.anim.play(clip as any, opts);
    },
    setFacing(dir) {
      b.z.anim.setFacing(dir);
    },
  };
}

/** Drop every telegraph mesh a move might be holding. */
function clearTelegraphs(): void {
  if (!boss) return;
  if (boss.barrage?.tell) {
    disposeMesh(boss.barrage.tell);
    boss.barrage.tell = null;
  }
  if (boss.slam?.ring) {
    disposeMesh(boss.slam.ring);
    boss.slam.ring = null;
  }
  if (boss.charge?.lane) {
    disposeMesh(boss.charge.lane);
    boss.charge.lane = null;
  }
  if (boss.summon?.ring) {
    disposeMesh(boss.summon.ring);
    boss.summon.ring = null;
  }
  if (boss.nova?.ring) {
    disposeMesh(boss.nova.ring);
    boss.nova.ring = null;
  }
  if (boss.teleportFire?.ring) {
    disposeMesh(boss.teleportFire.ring);
    boss.teleportFire.ring = null;
  }
  if (boss.fanBoomerang) {
    disposeFanBoomerang(boss.fanBoomerang);
    boss.fanBoomerang = null;
  }
}

// ── Death → portal ────────────────────────────────────────────────────────────
function openPortal(): void {
  if (!boss || boss.opened) return;
  boss.opened = true;
  state.exitLocked = false;
  if (boss.fanBoomerang) {
    disposeFanBoomerang(boss.fanBoomerang);
    boss.fanBoomerang = null;
  }

  // The ring shatters, and every telegraph in flight is dropped — a boss dying
  // mid-wind-up must not leave a ring on the floor that never resolves.
  for (const o of boss.orbiters) {
    state.vfx?.burst(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, 0xe8e2d0, 10, 5);
    disposeMesh(o.mesh);
  }
  boss.orbiters = [];
  clearTelegraphs();

  // Bloom the portal over the stairs (the exit the king was guarding).
  if (state.scene && state.grid && state.stairs) {
    const c = tileCenter(state.grid, state.stairs.i, state.stairs.j);
    const portal = makePortal();
    portal.position.set(c.x, 1.0, c.z);
    portal.scale.setScalar(0.01); // grows in
    state.scene.add(portal);
    boss.portal = portal;
    state.vfx?.burst(c.x, 1.0, c.z, 0xa050e0, 30, 6);
  }
  showToast("THE REAPER KING FALLS", "the portal opens — step into it to descend");
  state.shakeT = Math.max(state.shakeT, 0.5);
}

function updatePortal(dt: number): void {
  if (!boss?.portal) return;
  boss.portal.rotation.z += dt * 1.5;
  const s = Math.min(1, boss.portal.scale.x + dt * 2);
  boss.portal.scale.setScalar(s);
  const disc = boss.portal.children[0] as THREE.Mesh | undefined;
  if (disc) (disc.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(state.elapsed * 4) * 0.15;
}

// ── Co-op: the king over the wire ─────────────────────────────────────────────
/** The boss aux state a floor authority streams to replicas each snapshot. */
export interface BossAux {
  /** Which boss — replicas need it for the name on the bar and the death toast. */
  kind: BossKind;
  /** Projectiles in flight (was `bones`; every boss that throws uses this). */
  shots: Array<{ x: number; z: number }>;
  /**
   * Ground telegraphs in progress: where, how big, and seconds until impact.
   *
   * Was a single `slam` field. It is a LIST now because a boss can telegraph a
   * slam, a summon or a nova, and a replica that only knew about slams would
   * render an Archivist's nova as nothing at all — the attack would land on a
   * replica's knight with no warning whatsoever, which is the one thing the
   * telegraph rule exists to prevent.
   */
  rings: Array<{ x: number; z: number; r: number; t: number; kind: "slam" | "nova" | "summon" }>;
  /** A charge lane being telegraphed: origin, unit heading, length. */
  lane: { x: number; z: number; dx: number; dz: number; len: number } | null;
  /** The opened portal's position, once the boss is dead. */
  portal: { x: number; z: number } | null;
  /** Boss alive → replicas keep their ring + exit lock. */
  alive: boolean;
  /** Second half of the fight — replicas re-colour their mirrored ring. */
  phase: 1 | 2;
  /**
   * Is it HUNTING (see THE LEASH)? Streamed so a replica's boss bar appears at
   * the same moment the authority's does. Without it a replica would either
   * show the bar from floor-build — the exact "the boss is at my spawn" read
   * this whole change removes — or not until someone landed a hit.
   */
  engaged: boolean;
}

/** Authority side: serialize the aux threats for the snapshot. Null = no boss. */
export function bossNetState(): BossAux | null {
  if (!boss) return null;
  const moves = movesAt(boss.spec, hpFrac());
  const rings: BossAux["rings"] = [];
  if (boss.slam && boss.slam.phase !== "idle" && moves.slam) {
    const r = boss.slam.phase === "echo" ? (moves.slam.echo?.radius ?? moves.slam.radius) : moves.slam.radius;
    rings.push({ x: boss.slam.x, z: boss.slam.z, r, t: boss.slam.phase === "echo" ? boss.slam.echoT : boss.slam.t, kind: "slam" });
  }
  if (boss.nova && boss.nova.phase !== "idle" && moves.nova) {
    rings.push({ x: boss.nova.x, z: boss.nova.z, r: moves.nova.radius, t: boss.nova.t, kind: "nova" });
  }
  if (boss.summon && boss.summon.phase === "telegraph") {
    rings.push({ x: boss.z.x, z: boss.z.z, r: 1.8, t: boss.summon.t, kind: "summon" });
  }
  const charging = boss.charge && boss.charge.phase === "telegraph" && moves.charge;
  const netShots = boss.shots.map((b) => ({ x: Math.round(b.x * 50) / 50, z: Math.round(b.z * 50) / 50 }));
  if (boss.fanBoomerang) {
    for (const f of boss.fanBoomerang.fans) {
      if (f.state !== "done") {
        netShots.push({ x: Math.round(f.x * 50) / 50, z: Math.round(f.z * 50) / 50 });
      }
    }
  }
  return {
    kind: boss.spec.kind,
    shots: netShots,
    rings,
    lane: charging ? { x: boss.z.x, z: boss.z.z, dx: boss.charge!.dx, dz: boss.charge!.dz, len: moves.charge!.distance } : null,
    portal: boss.portal ? { x: boss.portal.position.x, z: boss.portal.position.z } : null,
    alive: !boss.opened,
    phase: boss.phase,
    engaged: boss.engaged,
  };
}

/**
 * Is the king hunting right now? Host-side truth; replicas read `BossAux.engaged`
 * off the snapshot. Exported for the HUD — the boss bar is gated on it so the
 * floor does not announce him before he has noticed you.
 */
export function bossEngaged(): boolean {
  if (boss) return boss.engaged && !boss.opened;
  // Replica: the authority's answer, off the last aux snapshot.
  return !!replica?.engaged;
}

// Replica-side mirrored meshes — deliberately separate from `boss` (the
// authority state) so an authority handover can adopt cleanly.
interface ReplicaAux {
  /** Last streamed `BossAux.engaged` — the replica's copy of THE LEASH state. */
  engaged: boolean;
  /** Which boss the authority says this is; drives colour, reach and damage. */
  kind: BossKind;
  orbiters: THREE.Mesh[];
  shots: THREE.Mesh[];
  /** Mirrored ground telegraphs, one mesh per streamed ring. */
  rings: THREE.Mesh[];
  /** What the rings were LAST frame — a ring that vanishes has just landed. */
  lastRings: BossAux["rings"];
  lane: THREE.Mesh | null;
  portal: THREE.Mesh | null;
  orbitT: number;
}
let replica: ReplicaAux | null = null;

function ensureReplica(): ReplicaAux {
  if (!replica) replica = { engaged: false, kind: "reaper_king", orbiters: [], shots: [], rings: [], lastRings: [], lane: null, portal: null, orbitT: 0 };
  return replica;
}

/**
 * Replica side: reconcile the mirrored boss threats against the authority's
 * aux snapshot (~10Hz). Slam IMPACT is detected here — the telegraph vanishing
 * from the aux means the authority fired it, so we burst and damage OUR knight
 * if they're inside (player HP is client-owned).
 */
export function applyRemoteBossAux(aux: BossAux | null): void {
  const r = ensureReplica();
  r.engaged = !!aux?.engaged;
  if (aux) r.kind = aux.kind;
  const spec = BOSSES[r.kind];
  const moves = aux?.phase === 2 ? { ...spec.moves, ...spec.phase2.moves } : spec.moves;

  // Orbit ring: cosmetic, wheels around whatever boss-flagged zombie we were given.
  const king = state.zombies.find((z) => z.boss && z.mode !== "dead");
  const want = aux?.alive && king && moves.orbit ? moves.orbit.count : 0;
  while (r.orbiters.length < want) {
    const m = makeOrbiter(moves.orbit!.color);
    state.scene?.add(m);
    r.orbiters.push(m);
  }
  while (r.orbiters.length > want) disposeMesh(r.orbiters.pop()!);

  // Projectiles: match mesh count to the snapshot, park them on the reported spots.
  const shots = aux?.shots ?? [];
  while (r.shots.length < shots.length) {
    const geo = new THREE.SphereGeometry(0.14, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: moves.barrage?.color ?? 0xd8c8a8 });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 12;
    state.scene?.add(m);
    r.shots.push(m);
  }
  while (r.shots.length > shots.length) disposeMesh(r.shots.pop()!);
  for (let i = 0; i < shots.length; i++) r.shots[i].position.set(shots[i].x, SHOT_Y, shots[i].z);

  // Projectile hits against OUR knight (the authority only guards its own).
  const p = state.player;
  if (p) {
    for (const b of shots) {
      if (Math.hypot(p.x - b.x, p.z - b.z) < SHOT_HIT_R + 0.15 && p.iframes <= 0) {
        hitPlayerRanged(moves.barrage?.damage ?? 1, b.x, b.z);
      }
    }
  }

  // ── Ground telegraphs, and the impacts they imply ──
  //
  // A ring that was in the last snapshot and is gone from this one has LANDED.
  // That is how the slam has always been detected here; it now covers the nova
  // too, because a replica that mirrored only slams would let an Archivist's
  // nova hit its knight with no warning at all — the one thing the telegraph
  // rule exists to prevent.
  const rings = aux?.rings ?? [];
  for (const was of r.lastRings) {
    if (rings.some((n) => n.kind === was.kind && Math.abs(n.x - was.x) < 0.01 && Math.abs(n.z - was.z) < 0.01)) continue;
    if (was.kind === "summon") continue; // adds arrive as ordinary streamed monsters
    const color = was.kind === "nova" ? (moves.nova?.color ?? 0xb070ff) : (moves.slam?.color ?? 0xff3050);
    state.vfx?.burst(was.x, 0.2, was.z, color, 26, 7);
    state.shakeT = Math.max(state.shakeT, 0.35);
    if (p && Math.hypot(p.x - was.x, p.z - was.z) <= was.r) {
      const dmg = was.kind === "nova" ? (moves.nova?.damage ?? 2) : (moves.slam?.damage ?? 2);
      hitPlayerRanged(dmg, was.x, was.z);
      const launch = was.kind === "nova" ? 0 : (moves.slam?.launch ?? 0);
      if (launch > 0) {
        const len = Math.hypot(p.x - was.x, p.z - was.z) || 1;
        p.momX = (p.x - was.x) / len;
        p.momZ = (p.z - was.z) / len;
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, launch));
        p.iframes = Math.max(p.iframes, 0.2);
      }
    }
  }
  r.lastRings = rings.map((x) => ({ ...x }));

  while (r.rings.length > rings.length) disposeMesh(r.rings.pop()!);
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    // Rebuilt each frame rather than scaled: a ring's radius changes between a
    // slam and its wider echo, and a stale geometry would lie about reach.
    if (r.rings[i]) disposeMesh(r.rings[i]);
    const color = ring.kind === "nova" ? (moves.nova?.color ?? 0xb070ff) : ring.kind === "summon" ? (moves.summon?.color ?? 0x7fdc6a) : (moves.slam?.color ?? 0xff3050);
    const geo = new THREE.RingGeometry(ring.r * 0.9, ring.r, 40);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(ring.x, 0.04, ring.z);
    mesh.renderOrder = 5;
    state.scene?.add(mesh);
    r.rings[i] = mesh;
  }

  // Charge lane.
  if (aux?.lane) {
    if (r.lane) disposeMesh(r.lane);
    const l = aux.lane;
    const geo = new THREE.PlaneGeometry(1.4, l.len);
    const mat = new THREE.MeshBasicMaterial({ color: moves.charge?.color ?? 0xff5a2a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const lane = new THREE.Mesh(geo, mat);
    lane.rotation.x = -Math.PI / 2;
    lane.rotation.z = -Math.atan2(l.dz, l.dx) + Math.PI / 2;
    lane.position.set(l.x + l.dx * l.len * 0.5, 0.045, l.z + l.dz * l.len * 0.5);
    lane.renderOrder = 5;
    state.scene?.add(lane);
    r.lane = lane;
  } else if (r.lane) {
    disposeMesh(r.lane);
    r.lane = null;
  }

  // Portal: bloom it once; the coop layer clears state.exitLocked via the lock flag.
  if (aux?.portal && !r.portal) {
    r.portal = makePortal();
    r.portal.position.set(aux.portal.x, 1.0, aux.portal.z);
    state.scene?.add(r.portal);
    state.vfx?.burst(aux.portal.x, 1.0, aux.portal.z, 0xa050e0, 30, 6);
    showToast(`${spec.label} FALLS`, "the portal opens — step into it to descend");
  }
}

/** Replica per-frame smoothing: the ring orbits the boss, the portal spins. */
export function updateBossReplica(dt: number): void {
  if (!replica) return;
  const king = state.zombies.find((z) => z.boss && z.mode !== "dead");
  const spec = BOSSES[replica.kind];
  const orbit = spec.moves.orbit ?? spec.phase2.moves.orbit;
  replica.orbitT += dt * (orbit?.speed ?? 1.1);
  if (king && orbit && replica.orbiters.length) {
    for (let i = 0; i < replica.orbiters.length; i++) {
      const a = replica.orbitT + (i / replica.orbiters.length) * Math.PI * 2;
      replica.orbiters[i].position.set(king.x + Math.cos(a) * orbit.radius, SHOT_Y + Math.sin(a * 2) * 0.12, king.z + Math.sin(a) * orbit.radius);
    }
  }
  for (const ring of replica.rings) {
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.abs(Math.sin(state.elapsed * 10)) * 0.4;
  }
  if (replica.lane) {
    (replica.lane.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.abs(Math.sin(state.elapsed * 10)) * 0.3;
  }
  replica.portal?.rotateZ(dt * 1.5);
}

/**
 * Authority HANDOVER: the previous simulator left mid-fight and we inherited a
 * living boss-flagged ghost. Wire the full boss module around it so slams and
 * barrages resume; replica-side mirrored meshes are dropped first.
 */
export function adoptBoss(z: Zombie, spec: BossSpec = BOSSES.reaper_king): void {
  if (boss || !state.scene) return;
  disposeReplicaAux();
  boss = {
    spec,
    z,
    // AUTHORITY HANDOVER: the previous simulator's anchor did not come across
    // the wire, so the best available post is where he stands at the moment we
    // inherit him. He is mid-fight by definition here, so `engaged` starts
    // true — re-deriving it from the wake radius would have him stand down for
    // a frame in the middle of a slam.
    anchor: { x: z.x, z: z.z },
    engaged: true,
    // Re-derived from the inherited HP rather than carried over the wire: the
    // threshold is a pure function of the health bar, so both sides agree
    // without another field, and an adopted boss cannot resume in phase 1 with
    // a sliver of health left.
    phase: 1,
    orbiters: [],
    orbitT: 0,
    shots: [],
    barrage: null,
    slam: null,
    charge: null,
    summon: null,
    nova: null,
    teleportFire: null,
    fanBoomerang: null,
    adds: [],
    // Adds cannot be adopted: the previous authority's brood is in
    // `state.zombies` as ordinary monsters and stays that way.
    spawnAdd: null,
    portal: null,
    opened: false,
    // The inherited hp was already scaled by the previous authority — seed
    // scaledFor with the CURRENT knight count so the next tick doesn't double it.
    scaledFor: knightsOnFloor(),
  };
  if (boss && hpFrac() <= spec.phase2.at) boss.phase = 2;
  syncOrbiters();
  state.exitLocked = true;
}

function disposeReplicaAux(): void {
  if (!replica) return;
  for (const m of replica.orbiters) disposeMesh(m);
  for (const m of replica.shots) disposeMesh(m);
  for (const m of replica.rings) disposeMesh(m);
  if (replica.lane) disposeMesh(replica.lane);
  if (replica.portal) disposeMesh(replica.portal);
  replica = null;
}

// ── Teardown ──────────────────────────────────────────────────────────────────
export function disposeBoss(): void {
  disposeReplicaAux();
  if (!boss) return;
  if (boss.dragonSnake) {
    disposeDragonSnake(boss.dragonSnake);
    boss.dragonSnake = null;
  }
  for (const o of boss.orbiters) disposeMesh(o.mesh);
  for (const b of boss.shots) disposeMesh(b.mesh);
  clearTelegraphs();
  if (boss.portal) disposeMesh(boss.portal);
  boss = null;
}

function disposeMesh(m: THREE.Mesh): void {
  m.removeFromParent();
  m.geometry.dispose();
  const mat = m.material as THREE.Material | THREE.Material[];
  if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
  else mat.dispose();
  for (const child of m.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
}
