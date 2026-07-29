/**
 * The monster factory — every path from "an enemy should exist here" to a
 * `Zombie` in `state.zombies`.
 *
 * Extracted verbatim from core.ts. Four spawn routes share one set of stat
 * tables (HP_BY_KIND / EXPANSION_SKIN / RESKIN) and one nid sequence, so they
 * belong together: the bespoke families (spawnKind), the tinted expansion
 * skins, the Wave-B reskins, and the baseline horde with its zombie SUB-TYPES.
 *
 * The two deferred queues are here for the reason the comments below give:
 * spawning mid-iteration over `state.zombies` would invalidate the loop, so a
 * slime split or a necromancer summon is queued and drained at a safe point.
 */
import { peers } from "../../../net/presence";
import { BAT_FROM_LEVEL, BAT_HP, BAT_RATIO, BAT_SPEED_FACTOR, BLOATER_FROM_LEVEL, BLOATER_HP, BLOATER_SPEED_FACTOR, BRUTE_FROM_LEVEL, BRUTE_HP, BRUTE_RATIO, BRUTE_SPEED_FACTOR, CHOMPER_FROM_LEVEL, CHOMPER_HP, CHOMPER_RATIO, CRAWLER_PITCH, CRYSTAL_FROM_LEVEL, CRYSTAL_HP, GHOST_FROM_LEVEL, GHOST_HP, GHOST_RATIO, GHOST_SPEED_FACTOR, GOBLIN_FROM_LEVEL, GOBLIN_HP, GOBLIN_RATIO, GOBLIN_SPEED_FACTOR, JESTER_FROM_LEVEL, JESTER_HP, JESTER_RATIO, JESTER_SPEED_FACTOR, SPORELING_FROM_LEVEL, SPORELING_RATIO, SPORELING_SPEED_FACTOR, GOLEM_FROM_LEVEL, GOLEM_HP, GOLEM_RATIO, HOUND_FROM_LEVEL, HOUND_HP, HOUND_SPEED_FACTOR, HULK_MIN_OPEN_NEIGHBOURS, MAGNET_FROM_LEVEL, MAGNET_HP, MAGNET_RATIO, MAGNET_SPEED_FACTOR, MIMIC_FROM_LEVEL, MIMIC_HP, MIMIC_SPEED_FACTOR, NECRO_FROM_LEVEL, NECRO_HP, NECRO_SPEED_FACTOR, PIN_CREW_SIZE, PIN_HP, REAPER_HP, SAPPER_FROM_LEVEL, SAPPER_HP, SAPPER_SPEED_FACTOR, SLIME_FROM_LEVEL, SLIME_HP, SLIME_MINI_HP, SLIME_MINI_SCALE, SLIME_MINI_SPEED_MULT, SLIME_RATIO, SLIME_SPEED_FACTOR, SPIDER_FROM_LEVEL, SPIDER_HP, SPIDER_RATIO, SPIDER_SPEED_FACTOR, SPITTER_FROM_LEVEL, SPITTER_HP, SPITTER_RATIO, SPITTER_SPEED_FACTOR, THEME_HORDE_BIAS, WARDEN_FROM_LEVEL, WARDEN_HP, WARDEN_SPEED_FACTOR, WEBSPIN_FROM_LEVEL, WEBSPIN_HP, WEBSPIN_RATIO, WEBSPIN_SPEED_FACTOR, WISP_FROM_LEVEL, WISP_HP, WISP_SPEED_FACTOR, ZOMBIE_HP, ZOMBIE_R, levelConfig } from "../constants";
import { syncActorMesh } from "../entities/combat";
import * as THREE from "three";
import { updateZombies } from "../entities/zombie";
import { at, isWalkable, tileCenter, worldToTile, type Grid, type TilePos } from "../maze/generator";
import { nearestOpenTile } from "../maze/nearest-open-tile";
import { themeFor } from "../maze/prefabs";
import { Animator } from "../engine/render/animator";
import { ZOMBIE_VARIANTS } from "../render/cel-painter";
import { createActorSprite, type SpriteSheet } from "../engine/render/sprite";
import { sheetFor } from "../boot/sheets";
import { state, type EnemyKind, type Zombie } from "../state";
import { ZOMBIE_TYPES, pickZombieType, typeHp, variantIndicesFor, type ZombieType } from "../zombie-types";

/** Base HP per enemy family. */
const HP_BY_KIND: Record<EnemyKind, number> = {
  zombie: ZOMBIE_HP,
  spider: SPIDER_HP,
  brute: BRUTE_HP,
  spitter: SPITTER_HP,
  ghost: GHOST_HP,
  bat: BAT_HP,
  slime: SLIME_HP,
  reaper: REAPER_HP, // nominal — combat.ts makes it immune anyway
  goblin: GOBLIN_HP,
  pin: PIN_HP,
  golem: GOLEM_HP,
  chomper: CHOMPER_HP,
  magnet: MAGNET_HP,
  webspinner: WEBSPIN_HP,
  sporeling: Math.round(ZOMBIE_HP * 1.4),
  jester: JESTER_HP,
  hound: HOUND_HP,
  bloater: BLOATER_HP,
  necromancer: NECRO_HP,
  warden: WARDEN_HP,
  wisp: WISP_HP,
  sapper: SAPPER_HP,
  crystalback: CRYSTAL_HP,
  mimic: MIMIC_HP,
};

/** Expansion-roster reused-sheet map: which existing atlas + tint + scale each
 *  new kind borrows (art is placeholder; behavior in zombie.ts carries identity). */
export const EXPANSION_SKIN: Partial<Record<EnemyKind, { sheet: () => SpriteSheet | null; tint: number; scale: number }>> = {
  // NB `hound` used to live here as a red-tinted SPIDER. It now has a bespoke
  // atlas (render/monsters/hound.ts) and so belongs in RESKIN below — its art
  // carries its own identity and must not be recoloured.
  bloater: { sheet: () => sheetFor("slime"), tint: 0xb6c24a, scale: 1.3 }, // bloated sickly gas-bag
  necromancer: { sheet: () => sheetFor("spitter"), tint: 0x8a5cd0, scale: 1.05 }, // purple caster
  warden: { sheet: () => sheetFor("brute"), tint: 0x4f8fdb, scale: 1.05 }, // blue guardian
  wisp: { sheet: () => sheetFor("ghost"), tint: 0x6fe8e8, scale: 0.9 }, // cyan will-o-wisp
  sapper: { sheet: () => sheetFor("magnet"), tint: 0xf0e05a, scale: 0.95 }, // yellow charge-thief
  crystalback: { sheet: () => sheetFor("golem"), tint: 0x8fdfff, scale: 1.12 }, // crystalline golem
  mimic: { sheet: () => sheetFor("golem"), tint: 0xd9a441, scale: 0.8 }, // gold treasure-crate
};

/** Spawn an expansion enemy from its reused sheet + tint; null if art missing. */
export function makeExpansion(kind: EnemyKind, x: number, z: number, speed: number): Zombie | null {
  const skin = EXPANSION_SKIN[kind];
  const sheet = skin?.sheet();
  if (!skin || !sheet) return null;
  const z2 = makeZombie(sheet, x, z, speed, { kind });
  z2.sprite.mesh.scale.multiplyScalar(skin.scale);
  z2.baseTint = skin.tint;
  z2.sprite.setTint(skin.tint);
  return z2;
}

/**
 * The Wave-B roster now has BESPOKE atlases (was tinted reskins). Each maps to
 * its own sheet + a display scale; no resting tint (the art carries identity).
 * `RESKIN` keeps its name so the debug ring + spawn table read unchanged.
 */
export const RESKIN: Partial<Record<EnemyKind, { sheet: () => SpriteSheet | null; scale: number }>> = {
  // A long low quadruped: scaled up slightly so its LENGTH reads at gameplay
  // distance, which is the cue you dodge a charge by.
  hound: { sheet: () => sheetFor("hound"), scale: 1.05 },
  goblin: { sheet: () => sheetFor("goblin"), scale: 1.0 },
  pin: { sheet: () => sheetFor("pin"), scale: 0.85 },
  golem: { sheet: () => sheetFor("golem"), scale: 1.12 },
  chomper: { sheet: () => sheetFor("chomper"), scale: 1.1 },
  magnet: { sheet: () => sheetFor("magnet"), scale: 0.95 },
  webspinner: { sheet: () => sheetFor("webspinner"), scale: 1.05 },
  jester: { sheet: () => sheetFor("jester"), scale: 1.0 },
};

/** Spawn a bespoke Wave-B enemy; returns null if its atlas isn't built. */
export function makeReskin(kind: EnemyKind, x: number, z: number, speed: number): Zombie | null {
  const skin = RESKIN[kind];
  const sheet = skin?.sheet();
  if (!skin || !sheet) return null;
  const z2 = makeZombie(sheet, x, z, speed, { kind });
  z2.sprite.mesh.scale.multiplyScalar(skin.scale);
  return z2;
}

/**
 * Slime minis spawned by a split, DEFERRED to the end of the sim step —
 * killZombie fires inside loops over state.zombies, and minis born mid-swing
 * would be clipped by the very blow that split their parent.
 */
const pendingMinis: Array<{ x: number; z: number; speed: number }> = [];

export function drainPendingMinis(): void {
  if (!pendingMinis.length) return;
  for (const spec of pendingMinis) {
    // The parent slime already forced this atlas into existence, so sheetFor is
    // a cache read here — it just isn't a guard that can silently eat the split.
    const slime = sheetFor("slime");
    // Two minis scatter to either side of the corpse.
    for (const side of [-1, 1]) {
      const mini = makeZombie(slime, spec.x + side * 0.35, spec.z + (Math.random() - 0.5) * 0.3, spec.speed * SLIME_MINI_SPEED_MULT, {
        kind: "slime",
        hp: SLIME_MINI_HP,
      });
      mini.mini = true;
      mini.aggro = true; // it just watched you kill its parent
      mini.sprite.mesh.scale.multiplyScalar(SLIME_MINI_SCALE);
      state.zombies.push(mini);
    }
  }
  pendingMinis.length = 0;
}

/** Necromancer summons, deferred past the horde loop (spawning mid-iteration
 *  would corrupt the array being walked, same as slime split). */
const pendingSummons: Array<{ x: number; z: number }> = [];

export function drainPendingSummons(): void {
  if (!pendingSummons.length) return;
  const speed = levelConfig(state.level).zombieSpeed;
  const sheet = state.zombieVariantSheets[0] ?? state.zombieSheet;
  for (const spec of pendingSummons) {
    if (!sheet) break;
    const add = makeZombie(sheet, spec.x + (Math.random() - 0.5) * 0.6, spec.z + (Math.random() - 0.5) * 0.6, speed, { kind: "zombie" });
    add.aggro = true; // raised to serve — already hunting
    state.zombies.push(add);
  }
  pendingSummons.length = 0;
}

/**
 * Spawn one enemy from a prebuilt sheet at a world point. Shared by the level
 * horde, the debug spawner, and the giant-spider spawns — every enemy runs the
 * same pathing/combat in updateZombies, differing only by `kind` + stats.
 */
/** Co-op network-id sequence — reset per floor. Creation order at startLevel is
 * seed-deterministic, so every pool member hands out the SAME nids and replicas
 * adopt the authority's snapshot without respawning a thing. Runtime spawns
 * (reaper, splits) only happen on the authority, whose counter keeps going. */
let zombieNidSeq = 0;
/** Ghost adoption saw an authority nid — keep our counter past it so a later
 * authority handover can't mint a colliding id. */
export function bumpZombieNid(nid: string): void {
  const n = Number(nid.replace(/^z/, ""));
  if (Number.isFinite(n) && n >= zombieNidSeq) zombieNidSeq = n + 1;
}

export function makeZombie(
  sheet: SpriteSheet,
  x: number,
  z: number,
  speed: number,
  opts: { kind?: EnemyKind; hp?: number; boss?: boolean; maxHp?: number; ztype?: ZombieType } = {},
): Zombie {
  const kind = opts.kind ?? "zombie";
  const sprite = createActorSprite(sheet, false);
  // A ghost is SPECTRAL: knock its material translucent + disable the hard alpha
  // cutout so the see-through drape reads (it also renders after opaque actors).
  // The reaper shares the treatment, a shade more solid — it's a PRESENCE.
  if (kind === "ghost" || kind === "reaper") {
    const mat = sprite.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = kind === "reaper" ? 0.82 : 0.62;
    mat.alphaTest = 0.02;
    mat.depthWrite = false;
    sprite.mesh.renderOrder = 11;
  }
  state.scene!.add(sprite.mesh);
  const anim = new Animator(sprite);
  anim.setFacing("S");
  anim.play("idle");
  const nid = "z" + zombieNidSeq++;
  const z2: Zombie = {
    nid,
    sprite,
    anim,
    x,
    z,
    kind,
    hp: opts.hp ?? HP_BY_KIND[kind],
    maxHp: opts.maxHp,
    boss: opts.boss,
    mode: "idle",
    speed,
    windupT: 0,
    cooldown: 0,
    flashT: 0,
    aggro: false,
    burnT: 0,
    bobT: 0,
    // MOVEMENT phase (entities/movement.ts): which way a flanker peels, which
    // way an orbiter rings, which way a leaper's arc bends. Derived from the
    // nid — NOT Math.random — for the same reason the hobbler's limp phase is:
    // every co-op peer builds the horde locally, so a random draw here would
    // have two clients watching the same monster take opposite arcs. The golden
    // ratio keeps consecutive nids from alternating in lockstep.
    movePhase: (((Number(nid.replace(/^z/, "")) || 0) * 0.618033988749895) % 1 + 1) % 1,
  };
  // ── ZOMBIE SUB-TYPE (zombie-types.ts) ──
  // Applied at the single construction site so the stat bundle and the collider
  // can never disagree. An explicit `opts.hp` still wins: a boss or a scripted
  // spawn sets HP deliberately and must not be re-scaled underneath it.
  const t = opts.ztype;
  if (t && t !== "shambler") {
    const d = ZOMBIE_TYPES[t];
    z2.ztype = t;
    z2.speed = speed * d.speedMult;
    if (opts.hp == null) z2.hp = typeHp(HP_BY_KIND[kind], t);
    if (opts.maxHp != null) z2.maxHp = typeHp(opts.maxHp, t);
    if (d.scale !== 1) {
      sprite.mesh.scale.multiplyScalar(d.scale);
      // NOT optional. state.ts's `bodyR` comment records the Reaper King walking
      // half-buried into corridors because a scaled mesh kept an unscaled
      // collider; zombie-types.test.ts asserts bodyRMult moves with scale.
      z2.bodyR = ZOMBIE_R * d.bodyRMult;
    }
    // Limp phase off the nid — deterministic across peers, distinct per actor,
    // so a pair of hobblers never limps in lockstep.
    if (d.gait === "limp") z2.gaitPhase = (Number(nid.replace(/^z/, "")) || 0) * 1.7;
    // A crawler has no legs: tip the billboard onto its belly. Rotation ONLY —
    // syncActorMesh re-pins y to 0 every frame, so a height offset set here
    // would be silently erased on the next update (which is why the ghost's
    // hover has to live in syncGhostMesh instead of on the actor).
    if (d.gait === "crawl") sprite.mesh.rotation.z = CRAWLER_PITCH;
  }
  syncActorMesh(z2);
  return z2;
}

/**
 * Pick + spawn one horde member for a spawn tile, given its hash. The special
 * families each own a residue class of the hash and only appear from their
 * FROM_LEVEL, so shallow floors are pure zombies and deeper floors mix in
 * spiders → brutes → spitters. Priority order matters (a spawn can only be one
 * thing): tank/ranged specials are checked before falling back to a zombie.
 */
/**
 * Spawn ONE enemy of an explicit kind, honouring its depth gate and sheet
 * availability — returns null if it's not unlocked yet or its art is missing,
 * so a themed pick can cleanly fall through to the base cascade. Only the
 * biome-favourable families are mapped; anything else returns null.
 */
export function spawnKind(kind: EnemyKind, x: number, z: number, baseSpeed: number, level: number): Zombie | null {
  switch (kind) {
    // NB the `state.xSheet &&` guards these lines used to carry are gone, and
    // deliberately. They dated from when every atlas was built up front, so
    // they could only ever be true — but once sheets are built on demand a
    // falsy read stops being "art is missing" and becomes "art has not been
    // asked for yet", and the guard silently deletes the spawn instead. Going
    // through sheetFor() makes the request the thing that builds it.
    case "brute":
      return level >= BRUTE_FROM_LEVEL ? makeZombie(sheetFor("brute"), x, z, baseSpeed * BRUTE_SPEED_FACTOR, { kind: "brute" }) : null;
    case "spitter":
      return level >= SPITTER_FROM_LEVEL ? makeZombie(sheetFor("spitter"), x, z, baseSpeed * SPITTER_SPEED_FACTOR, { kind: "spitter" }) : null;
    case "spider":
      return level >= SPIDER_FROM_LEVEL ? makeZombie(sheetFor("spider"), x, z, baseSpeed * SPIDER_SPEED_FACTOR, { kind: "spider" }) : null;
    case "ghost":
      return level >= GHOST_FROM_LEVEL ? makeZombie(sheetFor("ghost"), x, z, baseSpeed * GHOST_SPEED_FACTOR, { kind: "ghost" }) : null;
    case "bat":
      return level >= BAT_FROM_LEVEL ? makeZombie(sheetFor("bat"), x, z, baseSpeed * BAT_SPEED_FACTOR, { kind: "bat" }) : null;
    case "slime":
      return level >= SLIME_FROM_LEVEL ? makeZombie(sheetFor("slime"), x, z, baseSpeed * SLIME_SPEED_FACTOR, { kind: "slime" }) : null;
    case "sporeling":
      return level >= SPORELING_FROM_LEVEL ? makeZombie(sheetFor("sporeling"), x, z, baseSpeed * SPORELING_SPEED_FACTOR, { kind: "sporeling" }) : null;
    case "jester":
      return level >= JESTER_FROM_LEVEL ? makeReskin("jester", x, z, baseSpeed * JESTER_SPEED_FACTOR) : null;
    case "goblin":
      return level >= GOBLIN_FROM_LEVEL ? makeReskin("goblin", x, z, baseSpeed * GOBLIN_SPEED_FACTOR) : null;
    case "chomper":
      return level >= CHOMPER_FROM_LEVEL ? makeReskin("chomper", x, z, 0) : null;
    case "golem":
      return level >= GOLEM_FROM_LEVEL ? makeReskin("golem", x, z, 0) : null;
    case "magnet":
      return level >= MAGNET_FROM_LEVEL ? makeReskin("magnet", x, z, baseSpeed * MAGNET_SPEED_FACTOR) : null;
    case "webspinner":
      return level >= WEBSPIN_FROM_LEVEL ? makeReskin("webspinner", x, z, baseSpeed * WEBSPIN_SPEED_FACTOR) : null;
    case "hound":
      return level >= HOUND_FROM_LEVEL ? makeReskin("hound", x, z, baseSpeed * HOUND_SPEED_FACTOR) : null;
    case "bloater":
      return level >= BLOATER_FROM_LEVEL ? makeExpansion("bloater", x, z, baseSpeed * BLOATER_SPEED_FACTOR) : null;
    case "necromancer":
      return level >= NECRO_FROM_LEVEL ? makeExpansion("necromancer", x, z, baseSpeed * NECRO_SPEED_FACTOR) : null;
    case "warden":
      return level >= WARDEN_FROM_LEVEL ? makeExpansion("warden", x, z, baseSpeed * WARDEN_SPEED_FACTOR) : null;
    case "wisp":
      return level >= WISP_FROM_LEVEL ? makeExpansion("wisp", x, z, baseSpeed * WISP_SPEED_FACTOR) : null;
    case "sapper":
      return level >= SAPPER_FROM_LEVEL ? makeExpansion("sapper", x, z, baseSpeed * SAPPER_SPEED_FACTOR) : null;
    case "crystalback":
      return level >= CRYSTAL_FROM_LEVEL ? makeExpansion("crystalback", x, z, 0) : null;
    case "mimic": {
      if (level < MIMIC_FROM_LEVEL) return null;
      const m = makeExpansion("mimic", x, z, baseSpeed * MIMIC_SPEED_FACTOR);
      if (m) { m.dormant = true; m.aggro = false; }
      return m;
    }
    default:
      return null; // zombie/pin/reaper aren't horde-rollable via theme bias
  }
}

/** Weighted-pick a themed kind from the hash, or null if the biome sets none. */
function themedHordePick(hash: number, x: number, z: number, baseSpeed: number, level: number): Zombie | null {
  const theme = themeFor(level, state.runSeed);
  if (!theme.enemies || hash % 100 >= THEME_HORDE_BIAS) return null;
  const kinds = Object.keys(theme.enemies) as EnemyKind[];
  let total = 0;
  for (const k of kinds) total += theme.enemies[k]!;
  if (total <= 0) return null;
  let r = (hash >>> 8) % total;
  for (const k of kinds) {
    r -= theme.enemies[k]!;
    if (r < 0) return spawnKind(k, x, z, baseSpeed, level);
  }
  return null;
}

export function spawnHordeMember(hash: number, x: number, z: number, baseSpeed: number, level: number): Zombie {
  const themed = themedHordePick(hash, x, z, baseSpeed, level);
  if (themed) return themed;
  // As in spawnKind: the sheet is fetched, not tested. A `state.xSheet` guard
  // here would be a horde-composition bug the moment atlases became lazy —
  // every brute would quietly fall through to a plain zombie.
  if (level >= BRUTE_FROM_LEVEL && hash % BRUTE_RATIO === 0) {
    return makeZombie(sheetFor("brute"), x, z, baseSpeed * BRUTE_SPEED_FACTOR, { kind: "brute" });
  }
  if (level >= SPITTER_FROM_LEVEL && hash % SPITTER_RATIO === 1) {
    return makeZombie(sheetFor("spitter"), x, z, baseSpeed * SPITTER_SPEED_FACTOR, { kind: "spitter" });
  }
  if (level >= SPIDER_FROM_LEVEL && hash % SPIDER_RATIO === 2) {
    return makeZombie(sheetFor("spider"), x, z, baseSpeed * SPIDER_SPEED_FACTOR, { kind: "spider" });
  }
  if (level >= GHOST_FROM_LEVEL && hash % GHOST_RATIO === 3) {
    return makeZombie(sheetFor("ghost"), x, z, baseSpeed * GHOST_SPEED_FACTOR, { kind: "ghost" });
  }
  if (level >= BAT_FROM_LEVEL && hash % BAT_RATIO === 3) {
    return makeZombie(sheetFor("bat"), x, z, baseSpeed * BAT_SPEED_FACTOR, { kind: "bat" });
  }
  if (level >= SLIME_FROM_LEVEL && hash % SLIME_RATIO === 4) {
    return makeZombie(sheetFor("slime"), x, z, baseSpeed * SLIME_SPEED_FACTOR, { kind: "slime" });
  }
  // ── The Wave-B pinball roster (reskins; see RESKIN) ──
  if (level >= GOBLIN_FROM_LEVEL && hash % GOBLIN_RATIO === 1) {
    const zb = makeReskin("goblin", x, z, baseSpeed * GOBLIN_SPEED_FACTOR);
    if (zb) return zb;
  }
  if (level >= SPORELING_FROM_LEVEL && hash % SPORELING_RATIO === 3) {
    return makeZombie(sheetFor("sporeling"), x, z, baseSpeed * SPORELING_SPEED_FACTOR, { kind: "sporeling" });
  }
  if (level >= CHOMPER_FROM_LEVEL && hash % CHOMPER_RATIO === 5) {
    const zb = makeReskin("chomper", x, z, 0); // rooted — it IS the chokepoint
    if (zb) return zb;
  }
  if (level >= GOLEM_FROM_LEVEL && hash % GOLEM_RATIO === 5) {
    const zb = makeReskin("golem", x, z, 0);
    if (zb) return zb;
  }
  if (level >= MAGNET_FROM_LEVEL && hash % MAGNET_RATIO === 6) {
    const zb = makeReskin("magnet", x, z, baseSpeed * MAGNET_SPEED_FACTOR);
    if (zb) return zb;
  }
  if (level >= JESTER_FROM_LEVEL && hash % JESTER_RATIO === 4) {
    const zb = makeReskin("jester", x, z, baseSpeed * JESTER_SPEED_FACTOR);
    if (zb) return zb;
  }
  if (level >= WEBSPIN_FROM_LEVEL && hash % WEBSPIN_RATIO === 2) {
    const zb = makeReskin("webspinner", x, z, baseSpeed * WEBSPIN_SPEED_FACTOR);
    if (zb) return zb;
  }
  // ── Baseline zombie — but WHICH zombie (zombie-types.ts) ──
  // The sub-type comes off the SAME hash the family cascade above used (re-mixed
  // inside pickZombieType so the two rolls do not correlate), never Math.random:
  // co-op peers each build the horde locally from the shared pool seed, so a
  // random draw here would disagree about who is a hulk.
  const ztype = resolveZombieType(pickZombieType(hash, level), x, z);
  const variantSheets = state.zombieVariantSheets;
  // The silhouette must agree with the stat story: a crawler wearing two good
  // legs is a lie the player notices immediately.
  const allowed = variantIndicesFor(ztype, ZOMBIE_VARIANTS);
  const vi = allowed[hash % allowed.length];
  const sheet = variantSheets[vi] ?? variantSheets[0] ?? state.zombieSheet!;
  return makeZombie(sheet, x, z, baseSpeed, { ztype });
}

/**
 * Veto a sub-type whose BODY does not fit where it is being spawned.
 *
 * A hulk's collider is ~1.5x a zombie's — wider than a 1-tile corridor tolerates
 * — so spawning one in a dead end wedges it in rock. That is the Reaper King bug
 * (see `Zombie.bodyR` in state.ts) in a new costume, and the cheapest honest fix
 * is to not place it there: fall through to a LURCHER, which keeps the "big slow
 * bruiser" beat with a body that fits.
 */
function resolveZombieType(t: ZombieType, x: number, z: number): ZombieType {
  if (t !== "hulk") return t;
  const g = state.grid;
  if (!g) return t;
  const c = worldToTile(g, x, z);
  let open = 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (isWalkable(g, c.i + di, c.j + dj)) open++;
  }
  return open >= HULK_MIN_OPEN_NEIGHBOURS ? "hulk" : "lurcher";
}

/**
 * Drop a BOWLING PIN CREW: PIN_CREW_SIZE pins racked in triangle formation
 * around a centre tile (offsets in world units, clamped to walkable tiles by
 * nearestOpenTile fallback). They don't fight — they score.
 */
export function spawnPinCrew(g: Grid, centre: TilePos): void {
  const rack: Array<[number, number]> = [
    [0, 0],
    [0.55, -0.35],
    [0.55, 0.35],
    [1.1, -0.7],
    [1.1, 0],
    [1.1, 0.7],
  ];
  const c = tileCenter(g, centre.i, centre.j);
  for (let k = 0; k < Math.min(PIN_CREW_SIZE, rack.length); k++) {
    const px = c.x + rack[k][0];
    const pz = c.z + rack[k][1];
    const t = worldToTile(g, px, pz);
    const spot = isWalkable(g, t.i, t.j) ? { x: px, z: pz } : (() => {
      const open = nearestOpenTile(g, centre.i, centre.j, k + 1);
      return open ? tileCenter(g, open.i, open.j) : c;
    })();
    const pin = makeReskin("pin", spot.x, spot.z, 0);
    if (pin) state.zombies.push(pin);
  }
}

/** Per-floor reset of the co-op network-id sequence. Creation order at
 *  startLevel is deterministic across the pool, so the ids match on every
 *  client. Mirrors resetItemNid() in economy/ground-items.ts. */
export function resetZombieNid(): void {
  zombieNidSeq = 0;
}

/** Queue a slime MINI. Deferred: see drainPendingMinis. */
export function queueMini(x: number, z: number, speed: number): void {
  pendingMinis.push({ x, z, speed });
}

/** Queue a necromancer SUMMON. Deferred: see drainPendingSummons. */
export function queueSummon(x: number, z: number): void {
  pendingSummons.push({ x, z });
}

