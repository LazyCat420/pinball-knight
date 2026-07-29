/**
 * POPULATING a floor — the player, the horde, the loot and the set dressing.
 *
 * The second half of the old `buildLevel`. Everything here runs AFTER the floor
 * has been committed to `state`, so these phases read the world back out
 * (`state.grid`, `state.stairs`, `state.zombies`) rather than working on locals.
 *
 * ⚠️ Still on the authoring RNG. The pin crews and the ARPG packs draw from
 * `f.rng`, and the ARPG pack sizing additionally reads `state.zombies.length`,
 * so it is order-dependent on the horde, the boss and the antechamber having
 * already spawned. Keep the phase order.
 */
import { state, freshPlayerFields } from "../state";
import { invalidateMeterBlocks } from "../hud-meter";
import type { AuthoredFloor } from "./floor-authoring";
import { playerSheetFor, sheetFor } from "../boot/sheets";
import { spawnBoss } from "../boss";
import { BOSS_EVERY, BOSS_SPEED_FACTOR, BRUTE_SPEED_FACTOR, KING_HP_BASE, KING_HP_PER_FLOOR, MERCHANT_FROM_LEVEL, MERCHANT_SPAWN_MIN_RING, PIN_FROM_LEVEL, PLUNGER_SKILL_RANGE } from "../constants";
import { isReplica } from "../coop";
import { nextItemNid } from "../economy/ground-items";
import { snapCameraTo } from "../engine/camera";
import { Animator } from "../engine/render/animator";
import { createActorSprite, createOcclusionSilhouette, createStaticSprite } from "../engine/render/sprite";
import { syncActorMesh } from "../entities/combat";
import { MATERIAL_LIST } from "../entities/marble";
import { spawnFrog, spawnMerchant } from "../entities/npc";
import { resetPlayerMotion } from "../entities/player";
import { isWalkable, tileCenter, worldToTile } from "../maze/generator";
import { nearestOpenTile } from "../maze/nearest-open-tile";
import { ITEM_PAINTS, PROP_PAINTS } from "../render/cel-painter";
import { lookFromGear, lookKey } from "../render/knight-look";
import { createPinballParts } from "../render/pinball-parts";
import { reaperSheet } from "../render/reaper-sheet";
import { spawnCorpsePiles } from "../run/death";
import { playerMaxHp } from "../skill-runtime";
import { makeZombie, spawnHordeMember, spawnPinCrew } from "../spawn/factory";
import { type GroundItem, type Zombie, activeWeapon } from "../state";

/** Fill the committed floor with everything that lives on it. */
export function populateFloor(f: AuthoredFloor): void {
  const { level, cfg, rng, arch, modifier, track, grid, plan } = f;
  // core.buildLevel already returned early if there is no scene; this local
  // re-narrows it for the type checker instead of scattering `!` through the
  // file, and keeps the guard honest if this is ever called from elsewhere.
  const scene = state.scene;
  if (!scene) return;
  // ── Player ──
  const startPos = tileCenter(grid, plan.start.i, plan.start.j);
  state.levelStart = { x: startPos.x, z: startPos.z }; // where a pit spits you back
  if (!state.player) {
    const weaponId = activeWeapon().id;
    const sprite = createActorSprite(playerSheetFor(weaponId), false);
    scene.add(sprite.mesh);
    const anim = new Animator(sprite);
    state.player = {
      sprite,
      anim,
      x: startPos.x,
      z: startPos.z,
      silhouette: createOcclusionSilhouette(sprite),
      ...freshPlayerFields(),
    };
    state.player.hp = playerMaxHp(); // legacy hearts land at creation
    state.playerArtKey = lookKey(weaponId, lookFromGear(state.gear));
  } else {
    state.player.x = startPos.x;
    state.player.z = startPos.z;
    state.player.attackT = -1;
  }
  // Both branches above leave a player; the local re-narrows it for TS rather
  // than repeating a non-null assertion on every line.
  const player = state.player;
  player.anim.setFacing("S");
  player.anim.play("idle", { force: true });
  syncActorMesh(player);
  // Clear movement smoothing + HUD meter cache so a new/re-entered level
  // doesn't inherit sprint momentum or a stale meter block count.
  resetPlayerMotion();
  invalidateMeterBlocks();

  // ── Horde: a shambling baseline mixed with the special families as depth
  // grows — spiders (fast), brutes (tanks) and spitters (ranged). Each spawn
  // deterministically rolls a kind by hash so a run+level is reproducible. ──
  state.zombies = plan.spawns.map((s, si): Zombie => {
    const hash = ((s.i * 73856093) ^ (s.j * 19349663) ^ (level * 83492791) ^ si) >>> 0;
    const pos = tileCenter(grid, s.i, s.j);
    return spawnHordeMember(hash, pos.x, pos.z, cfg.zombieSpeed, level);
  });

  // ── D4 THE PLUNGER: every floor OPENS parked in a launch chute you PULL ──
  // A real pinball machine starts by drawing the plunger back and firing the
  // ball into play. The knight is parked; the player holds the dodge key to pull
  // back (power builds), ←/→ steer the launch line ±30°, release fires. We only
  // ARM it here (base aim + skill target); the pull/release + launch live in the
  // player update (updatePlunger). Aim the base line at the nearest scoring part
  // so a full pull straight down the lane lands a SKILL SHOT.
  {
    const p = state.player;
    // On a chute floor the skill target must be REACHABLE BY THE LAUNCH — the
    // launch line is the chute's axis and steering is capped at
    // PLUNGER_AIM_MAX, so a target off to the side is a skill shot you cannot
    // take however well you pull. Require it to sit ahead down the lane
    // (a generous cone, since the target lives out in the playfield past the
    // mouth); with no chute the old nearest-part rule stands unchanged.
    const chuteDir = track?.chute ?? null;
    const skillPart = state.pinballParts
      .filter((q) => q.kind === "target" || q.kind === "bumper" || q.kind === "rollover")
      .map((q) => ({ q, d: Math.hypot(q.x - startPos.x, q.z - startPos.z) }))
      .filter((e) => e.d > 4 && e.d < PLUNGER_SKILL_RANGE)
      .filter((e) => {
        if (!chuteDir) return true;
        const ax = (e.q.x - startPos.x) / e.d;
        const az = (e.q.z - startPos.z) / e.d;
        return ax * chuteDir.dirI + az * chuteDir.dirJ > 0.8;
      })
      .sort((a, b) => a.d - b.d)[0]?.q;
    if (p) {
      // Base launch line, in priority order:
      //
      //  1. STRAIGHT DOWN THE CHUTE, when the floor has one. This is the whole
      //     point of the lane — the plunger fires along the hallway, and ←/→
      //     steer only within PLUNGER_AIM_MAX of it. Aiming at a scoring part
      //     instead (which is what shipped) would point the launch diagonally
      //     into the chute's own wall, since the chute is sealed by design.
      //  2. Else the nearest scoring part, so a full pull still lands a skill
      //     shot on a floor where no chute fitted.
      //  3. Else straight at the stairs.
      let dx = 0;
      let dz = 1;
      const chute = track?.chute ?? null;
      if (chute) {
        // Tile deltas ARE world deltas here — both axes map straight through
        // tileCenter — so the chute's cardinal is already the launch vector.
        dx = chute.dirI;
        dz = chute.dirJ;
      } else if (skillPart) {
        dx = skillPart.x - p.x;
        dz = skillPart.z - p.z;
      } else if (state.stairs) {
        const c = tileCenter(grid, state.stairs.i, state.stairs.j);
        dx = c.x - p.x;
        dz = c.z - p.z;
      }
      const dl = Math.hypot(dx, dz) || 1;
      state.plungerBaseX = dx / dl;
      state.plungerBaseZ = dz / dl;
      state.plungerSkill = skillPart ? { i: skillPart.i, j: skillPart.j } : null;
      state.plungerArmed = true;
      state.plungerCharging = false;
      state.plungerPower = 0;
      state.plungerAim = 0;
      p.momSpeed = 0;
    }
  }

  // ── EVERY floor's exit is boss-gated: the REAPER KING guards the stairs ──
  // (Live QA ask: "a boss at the end to get to the next level, even solo".)
  // The king (boss.ts) is a killable reaper-art brute with an orbiting skull
  // ring + a telegraphed tentacle slam; while it lives `state.exitLocked` holds
  // the stairs shut, and its death blooms the exit PORTAL. HP scales with the
  // floor; every BOSS_EVERY-th floor is a MEGA king at double HP. Only spawns
  // for the floor authority — a replica renders the streamed king.
  if (state.stairs && scene && state.player && !isReplica()) {
    const mega = level % BOSS_EVERY === 0;
    const bhp = Math.round((KING_HP_BASE + KING_HP_PER_FLOOR * (level - 1)) * (mega ? 2 : 1));
    const spot = nearestOpenTile(grid, state.stairs.i, state.stairs.j, 2) ?? state.stairs;
    const speed = cfg.zombieSpeed * BOSS_SPEED_FACTOR;
    spawnBoss(grid, spot, bhp, (x, z, hp) => {
      const b = makeZombie(reaperSheet(), x, z, speed, { kind: "brute", hp, boss: true, maxHp: hp });
      state.zombies.push(b);
      return b;
    });
  }

  // ── Loot on the floor ──
  state.groundItems = plan.items.map((it, k): GroundItem => {
    const sprite = createStaticSprite(ITEM_PAINTS[it.id]);
    const pos = tileCenter(grid, it.i, it.j);
    sprite.mesh.position.set(pos.x, 0, pos.z);
    scene!.add(sprite.mesh);
    return { nid: "L" + k, kind: it.kind, id: it.id, x: pos.x, z: pos.z, sprite, bobPhase: k * 1.7, rarity: it.rarity };
  });

  // ── R&D: seed the three marble materials near the floor-1 spawn so the whole
  // system is always testable without hunting a vault (toggle in the ` panel). ──
  if (level === 1 && state.dbgMaterialFloor1Spawn && scene && state.player) {
    const pt = worldToTile(grid, state.player.x, state.player.z);
    MATERIAL_LIST.forEach((m, i) => {
      // minRing staggers each marble into its own distance shell (4/7/10 tiles
      // out) — nearestOpenTile's `n` is an ORDINAL, so without minRing all
      // three land in the ring right on top of the spawn.
      const spot = nearestOpenTile(grid, pt.i, pt.j, 1 + i, 4 + i * 3) ?? pt;
      const c = tileCenter(grid, spot.i, spot.j);
      const sprite = createStaticSprite(ITEM_PAINTS[m]);
      sprite.mesh.position.set(c.x, 0, c.z);
      scene!.add(sprite.mesh);
      state.groundItems.push({ kind: "material", id: m, x: c.x, z: c.z, sprite, bobPhase: i * 2 });
    });
  }

  // ── Set dressing ──
  state.props = plan.props.map((pr) => {
    const sprite = createStaticSprite(PROP_PAINTS[pr.kind]);
    const pos = tileCenter(grid, pr.i, pr.j);
    sprite.mesh.position.set(pos.x, 0, pos.z);
    scene!.add(sprite.mesh);
    return { sprite };
  });

  state.flowField = null;
  state.flowTimer = 0;
  snapCameraTo(startPos.x, startPos.z);
  state.hudDirty = true;

  // ── CORPSE PILES ── everything you dropped here on a previous death.
  spawnCorpsePiles(grid, level);

  // ── BOWLING PIN CREWS ── racked around far spawn tiles from PIN_FROM_LEVEL.
  if (level >= PIN_FROM_LEVEL && plan.spawns.length > 0) {
    const crews = 1 + (level >= 5 ? 1 : 0);
    for (let c = 0; c < crews; c++) {
      const centre = plan.spawns[Math.floor(rng() * plan.spawns.length)];
      spawnPinCrew(grid, centre);
    }
  }

  // ── BOSS ANTECHAMBER ── from depth 3 (non-boss floors), the stairs are a
  // real set piece: a carom ARENA (bumpers ringed round the exit) guarded by a
  // brute pack, with a guaranteed prize so clearing it pays. The run's last leg
  // is always a fight-or-flight, and the bumpers make it a PINBALL fight.
  // ⚠️ IT USED TO SKIP `level % BOSS_EVERY === 0` — i.e. EVERY MEGA-BOSS FLOOR.
  //
  // Floor 5 is the first of them, and live QA reported its boss fight as "a
  // jumbled mess". It was the one floor in five that got a DOUBLE-HP king
  // (core.ts doubles his health on exactly this cadence) in bare corridor with
  // no bumper ring, no brute guard and no prize — the set piece was withheld
  // from precisely the floors built around a set-piece fight. The likely
  // original reasoning is that the king IS the set piece there, but the two do
  // not compete: the ring is what makes the arena read as an arena, and the
  // king now has a hall to fight in (maze/track-floor.ts carveBossChamber).
  // `state.bruteSheet` used to be part of this condition. It could never be
  // false when every atlas was built up front — but with lazy atlases it would
  // have deleted the whole exit arena on any floor the backfill hadn't reached
  // the brute yet. The sheet is fetched below, where it is used.
  if (level >= 3 && state.stairs && scene) {
    const s = state.stairs;
    // A ring of bumpers around the exit — carom off them mid-brawl.
    //
    // ── IT ASKS THE MAZE FOR SPACE INSTEAD OF STAMPING FIXED OFFSETS ──
    //
    // The offsets were hard-coded at radius 2 and filtered by `isWalkable`, so a
    // tight exit silently shipped two bumpers instead of six and the "arena"
    // read as a couple of stray props. Now it walks outward: take the first
    // radius that can seat most of the ring, so a King's Hall gets a full wide
    // circle and a cramped legacy floor still gets the best ring it can hold.
    const ringSpots: Array<{ i: number; j: number }> = [];
    for (const r of [3, 2, 4]) {
      const offs: Array<readonly [number, number]> = [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
        [r - 1, r - 1],
        [-(r - 1), -(r - 1)],
        [r - 1, -(r - 1)],
        [-(r - 1), r - 1],
      ];
      const fit = offs.filter(([di, dj]) => isWalkable(grid, s.i + di, s.j + dj)).map(([di, dj]) => ({ i: s.i + di, j: s.j + dj }));
      if (fit.length >= 6 || (r === 4 && fit.length > ringSpots.length)) {
        ringSpots.length = 0;
        ringSpots.push(...fit);
        if (fit.length >= 6) break;
      } else if (fit.length > ringSpots.length) {
        ringSpots.length = 0;
        ringSpots.push(...fit);
      }
    }
    createPinballParts(
      ringSpots.map((r) => ({ i: r.i, j: r.j, kind: "bumper" as const, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 })),
      grid,
      scene,
    );
    // The brute guard — scales a touch with depth.
    const guards = 2 + Math.floor((level - 3) / 3);
    for (let n = 1; n <= guards; n++) {
      const spot = nearestOpenTile(grid, s.i, s.j, n + 1);
      if (!spot) break;
      const c = tileCenter(grid, spot.i, spot.j);
      state.zombies.push(makeZombie(sheetFor("brute"), c.x, c.z, cfg.zombieSpeed * BRUTE_SPEED_FACTOR, { kind: "brute" }));
    }
    // A guaranteed prize on the exit's doorstep (gold idol + a heal).
    const prizeSpot = nearestOpenTile(grid, s.i, s.j, 1);
    if (prizeSpot) {
      for (const [id, dx] of [["gold", -0.4], ["health", 0.4]] as const) {
        const sprite = createStaticSprite(ITEM_PAINTS[id]);
        const c = tileCenter(grid, prizeSpot.i, prizeSpot.j);
        sprite.mesh.position.set(c.x + dx, 0, c.z);
        scene.add(sprite.mesh);
        state.groundItems.push({ nid: nextItemNid(), kind: "potion", id, x: c.x + dx, z: c.z, sprite, bobPhase: Math.random() * 6 });
      }
    }
  }

  // ── The ORACLE FROG's dead-end perch ──
  if (plan.frog) spawnFrog(plan.frog.i, plan.frog.j);

  // ── The ROLLING CART MERCHANT — one per floor from its depth, parked a
  // few tiles out from the start so you spot it early and give chase. ──
  if (level >= MERCHANT_FROM_LEVEL) {
    // Genuinely out in the floor, not on the doorstep: spawning it a tile away
    // put it inside MERCHANT_FLEE_RANGE at t=0, so it bolted before you ever
    // saw it. Its bell (updateMerchant) is what leads you to it now.
    const spot = nearestOpenTile(grid, plan.start.i, plan.start.j, 3, MERCHANT_SPAWN_MIN_RING) ?? plan.start;
    spawnMerchant(spot.i, spot.j);
  }

  // ── Per-floor score ledger + the Death Dealer's fuse ──
  state.levelT = 0;
  state.levelStartKills = state.kills;
  // ── ARPG PACKS along the fast lanes ──
  // The spine (the connected booster route down the artery) is where the run
  // moves at pinball speed — exactly where an ARPG wants its monster packs, so
  // ripping through at speed means ripping THROUGH something. 2-3 enemies
  // cluster near ~half the spine stations, capped relative to the base horde.
  // Seed-deterministic (floor rng) so every co-op client builds the same packs.
  {
    const spineParts = plan.parts.filter((pt) => pt.spine);
    const packCap = Math.min(38, Math.ceil(state.zombies.length * 0.6));
    let packAdded = 0;
    for (const pt of spineParts) {
      if (packAdded >= packCap) break;
      if (rng() > 0.65) continue;
      const packSize = 2 + Math.floor(rng() * 2);
      for (let n = 0; n < packSize && packAdded < packCap; n++) {
        const spot = nearestOpenTile(grid, pt.i, pt.j, 1 + Math.floor(rng() * 5), 2);
        if (!spot) continue;
        const c = tileCenter(grid, spot.i, spot.j);
        state.zombies.push(spawnHordeMember((rng() * 0xffffffff) | 0, c.x, c.z, cfg.zombieSpeed, level));
        packAdded++;
      }
    }
    // Plaza packs: the polish pass stamped bumper diamonds into big empty
    // rooms and reported their centres — garrison each one (3-4 enemies), so
    // a plaza is a bounce-pattern ARENA, never dead space.
    for (const pz of plan.plazas) {
      const packSize = 3 + Math.floor(rng() * 2);
      for (let n = 0; n < packSize; n++) {
        const spot = nearestOpenTile(grid, pz.i, pz.j, 1 + Math.floor(rng() * 5), 1);
        if (!spot) continue;
        const c = tileCenter(grid, spot.i, spot.j);
        state.zombies.push(spawnHordeMember((rng() * 0xffffffff) | 0, c.x, c.z, cfg.zombieSpeed, level));
      }
    }
  }
}
