/**
 * ZOMBIE SUB-TYPES — 20 distinct behavioural varieties inside the `zombie` EnemyKind.
 *
 * A sub-type is a MULTIPLIER BUNDLE over the zombie baseline, not a new
 * EnemyKind. That is deliberate and load-bearing: `EnemyKind` is consumed by six
 * exhaustive `Record<EnemyKind, …>` tables (STATS in entities/zombie.ts,
 * HP_BY_KIND in core.ts, ENEMY_DROPS in reagents.ts, the bite table in
 * combat.ts, plus the spawnKind switch and EXPANSION_SKIN). Twenty zombie
 * flavours as kinds would mean 120 new rows that all say the same thing, and it
 * would fork `rotflesh` drops across twenty-one keys. One optional `ztype` field on
 * Zombie plus this table costs almost nothing by comparison.
 *
 * Everything is a MULTIPLIER, never an absolute, so `levelConfig().zombieSpeed`
 * floor-scaling keeps working underneath.
 *
 * DOM- and three-free so the spawn math is unit-tested.
 */
import type { ZVariant } from "./render/cel-painter";
import type { MovementKind } from "./entities/movement";

export type ZombieType =
  | "shambler" // 1: baseline horde core
  | "runner" // 2: fast, frail flanker
  | "lurcher" // 3: heavy, tanky, bounce-immune
  | "hulk" // 4: massive bruiser, heavy knockback, speed-only
  | "midget" // 5: tiny swarm pack-hunter, dodges ranged
  | "crawler" // 6: legless ambusher, prone gait, bounce-immune
  | "flailer" // 7: armless leaper, speed-only
  | "hobbler" // 8: one-legged limper, oscillating gait, bounce-immune
  | "plague" // 9: plague shambler, rot-puddle on death
  | "armored" // 10: grave knight, ironclad defense
  | "bloated" // 11: bloated corpse, toxic explosion on death
  | "frenzy" // 12: frenzy ghoul, enrages when low HP, dodges ranged
  | "frost" // 13: frost husk, chills knight on contact, ice burst
  | "charred" // 14: charred revenant, fire-immune, ignites oil
  | "screamer" // 15: plague screamer, concussive shriek disorients
  | "clutcher" // 16: grave clutcher, leaping grab slows momentum
  | "gravedigger" // 17: grave digger with rusty spade, unearths bony traps
  | "mummy" // 18: cursed mummy, wraps snare on death
  | "herald" // 19: necro-herald with censer, dark aura buffs horde
  | "abomination"; // 20: two-headed mutant abomination behemoth

export interface ZombieTypeDef {
  id: ZombieType;
  /** Shown on the struck-enemy tag + the bestiary. */
  label: string;
  /** × levelConfig().zombieSpeed. For "limp" this is the AVERAGE — the gait
   * oscillates ±LIMP_AMP around it (see entities/zombie.ts). */
  speedMult: number;
  /** × ZOMBIE_HP (or floor-scaled hp, via typeHp()). */
  hpMult: number;
  /** Sprite mesh scale — Reaper-tested collider trap (DECLONE §3). */
  scale: number;
  /**
   * × ZOMBIE_R. MUST track `scale` (see `zombie-types.test.ts`): scaling the
   * visual mesh without moving the collision circle is how the Reaper walked
   * into walls.
   */
  bodyRMult: number;
  /** × ZOMBIE_REACH (the melee bite radius). */
  reachMult: number;
  /** × ZOMBIE_WINDUP (the telegraphed pause before bite lands). */
  windupMult: number;
  /**
   * Relative spawn weight within the zombie roll. Sum of the active roster = 100.
   */
  weight: number;
  /** Minimum floor depth this sub-type can appear on. */
  fromLevel: number;
  /**
   * Selects art from ZOMBIE_VARIANTS. null = any variant is fine (default).
   * A function = only variants passing this filter are picked (e.g. Crawler
   * MUST use a legless silhouette or it makes no sense).
   */
  variantFilter: ((v: ZVariant) => boolean) | null;
  /** Optional gait override — "limp" oscillates speed, "crawl" stays low. */
  gait?: "limp" | "crawl";
  /** Optional push delivered to the player on bite. Defaults to KNOCKBACK_PLAYER. */
  knockback?: number;
  /**
   * STEERING POLICY (entities/movement.ts), overriding the zombie family's
   * `chase`. Absent = it walks the baseline line.
   */
  movement?: MovementKind;
  /**
   * × the zombie family's pain chance (entities/stagger.ts). Absent = 1.
   */
  painMult?: number;
  /**
   * ONE ASYMMETRIC EXCEPTION (DECLONE §6.2) — Hotline Miami's weapon-puzzle
   * trick, as pure data.
   */
  exception?: "bounce-immune" | "speed-only" | "dodges-ranged";
}

/**
 * The 20 Zombie Variations.
 * Shambler keeps the plurality (15%), so the horde reads as A HORDE.
 * All 20 types have distinct profiles, scaling, movements, and mechanics.
 * Active weights sum to exactly 100.
 */
export const ZOMBIE_TYPES: Record<ZombieType, ZombieTypeDef> = {
  shambler: {
    id: "shambler", label: "Shambler",
    speedMult: 1.0, hpMult: 1.0, scale: 1.0, bodyRMult: 1.0, reachMult: 1.0, windupMult: 1.0,
    weight: 15, fromLevel: 1, variantFilter: null,
  },
  runner: {
    id: "runner", label: "Runner",
    speedMult: 1.75, hpMult: 0.67, scale: 0.95, bodyRMult: 0.95, reachMult: 1.0, windupMult: 0.75,
    weight: 7, fromLevel: 2, variantFilter: null,
    movement: "flanker",
    painMult: 1.2,
    exception: "dodges-ranged",
  },
  lurcher: {
    id: "lurcher", label: "Lurcher",
    speedMult: 0.55, hpMult: 2.0, scale: 1.1, bodyRMult: 1.1, reachMult: 1.05, windupMult: 1.3,
    weight: 6, fromLevel: 1, variantFilter: null,
    painMult: 0.6,
    exception: "bounce-immune",
  },
  hulk: {
    id: "hulk", label: "Hulk",
    speedMult: 0.7, hpMult: 3.0, scale: 1.55, bodyRMult: 1.5, reachMult: 1.35, windupMult: 1.45,
    weight: 4, fromLevel: 4, variantFilter: null,
    knockback: 7.5,
    painMult: 0.25,
    exception: "speed-only",
  },
  midget: {
    id: "midget", label: "Midget",
    speedMult: 1.35, hpMult: 0.67, scale: 0.62, bodyRMult: 0.65, reachMult: 0.7, windupMult: 0.85,
    weight: 5, fromLevel: 2, variantFilter: null,
    movement: "packhunter",
    painMult: 1.3,
    exception: "dodges-ranged",
  },
  crawler: {
    id: "crawler", label: "Crypt Crawler",
    speedMult: 0.4, hpMult: 1.33, scale: 0.5, bodyRMult: 0.7, reachMult: 0.65, windupMult: 1.1,
    weight: 4, fromLevel: 3,
    variantFilter: (v) => v.legStump === "both",
    gait: "crawl",
    movement: "ambusher",
    painMult: 0.8,
    exception: "bounce-immune",
  },
  flailer: {
    id: "flailer", label: "Flailer",
    speedMult: 1.15, hpMult: 1.0, scale: 1.0, bodyRMult: 1.0, reachMult: 0.6, windupMult: 0.7,
    weight: 4, fromLevel: 3,
    variantFilter: (v) => v.stump === "both",
    movement: "leaper",
    painMult: 1.0,
    exception: "speed-only",
  },
  hobbler: {
    id: "hobbler", label: "Hobbler",
    speedMult: 0.85, hpMult: 1.0, scale: 1.0, bodyRMult: 1.0, reachMult: 0.9, windupMult: 1.0,
    weight: 4, fromLevel: 2,
    variantFilter: (v) => v.legStump === "L" || v.legStump === "R",
    gait: "limp",
    painMult: 1.15,
    exception: "bounce-immune",
  },
  plague: {
    id: "plague", label: "Plague Shambler",
    speedMult: 0.9, hpMult: 1.2, scale: 1.05, bodyRMult: 1.05, reachMult: 1.0, windupMult: 1.05,
    weight: 5, fromLevel: 2,
    variantFilter: (v) => v.pustules === true || v.gore >= 2,
    painMult: 1.0,
    exception: "bounce-immune",
  },
  armored: {
    id: "armored", label: "Grave Knight",
    speedMult: 0.75, hpMult: 2.2, scale: 1.15, bodyRMult: 1.15, reachMult: 1.1, windupMult: 1.2,
    weight: 5, fromLevel: 3,
    variantFilter: (v) => v.helmet === true || v.bandage === true,
    painMult: 0.5,
    exception: "bounce-immune",
  },
  bloated: {
    id: "bloated", label: "Bloated Corpse",
    speedMult: 0.6, hpMult: 1.8, scale: 1.25, bodyRMult: 1.25, reachMult: 0.95, windupMult: 1.25,
    weight: 5, fromLevel: 3,
    variantFilter: (v) => v.bloated === true || v.bone === "ribs",
    painMult: 0.7,
    exception: "speed-only",
  },
  frenzy: {
    id: "frenzy", label: "Frenzy Ghoul",
    speedMult: 1.6, hpMult: 0.75, scale: 0.9, bodyRMult: 0.9, reachMult: 1.0, windupMult: 0.7,
    weight: 5, fromLevel: 3,
    variantFilter: (v) => v.gore >= 3 || v.spur !== null,
    movement: "flanker",
    painMult: 1.25,
    exception: "dodges-ranged",
  },
  frost: {
    id: "frost", label: "Frostbitten Husk",
    speedMult: 0.85, hpMult: 1.4, scale: 1.05, bodyRMult: 1.05, reachMult: 1.05, windupMult: 1.0,
    weight: 5, fromLevel: 3,
    variantFilter: (v) => v.frost === true || v.bone === "skull",
    movement: "strafer",
    painMult: 0.9,
    exception: "bounce-immune",
  },
  charred: {
    id: "charred", label: "Charred Revenant",
    speedMult: 1.05, hpMult: 1.1, scale: 0.95, bodyRMult: 0.95, reachMult: 1.0, windupMult: 0.9,
    weight: 5, fromLevel: 4,
    variantFilter: (v) => v.charred === true || v.bone === "spine",
    painMult: 1.0,
    exception: "speed-only",
  },
  screamer: {
    id: "screamer", label: "Plague Screamer",
    speedMult: 1.1, hpMult: 0.85, scale: 0.95, bodyRMult: 0.95, reachMult: 1.35, windupMult: 0.8,
    weight: 4, fromLevel: 4,
    variantFilter: (v) => v.screamer === true || v.tatter > 20,
    movement: "kite",
    painMult: 1.2,
    exception: "dodges-ranged",
  },
  clutcher: {
    id: "clutcher", label: "Grave Clutcher",
    speedMult: 1.1, hpMult: 1.25, scale: 1.1, bodyRMult: 1.1, reachMult: 1.3, windupMult: 0.85,
    weight: 4, fromLevel: 4,
    variantFilter: (v) => v.claws === true || v.stump === null,
    movement: "leaper",
    painMult: 1.0,
    exception: "speed-only",
  },
  gravedigger: {
    id: "gravedigger", label: "Grave Digger",
    speedMult: 0.8, hpMult: 1.8, scale: 1.15, bodyRMult: 1.15, reachMult: 1.4, windupMult: 1.15,
    weight: 4, fromLevel: 5,
    variantFilter: (v) => v.shovel === true || v.rag === 27,
    painMult: 0.7,
    exception: "bounce-immune",
  },
  mummy: {
    id: "mummy", label: "Cursed Mummy",
    speedMult: 0.7, hpMult: 2.5, scale: 1.05, bodyRMult: 1.05, reachMult: 1.0, windupMult: 1.1,
    weight: 3, fromLevel: 5,
    variantFilter: (v) => v.linens === true || v.bandage === true,
    painMult: 0.4,
    exception: "bounce-immune",
  },
  herald: {
    id: "herald", label: "Necro-Herald",
    speedMult: 0.9, hpMult: 1.5, scale: 1.05, bodyRMult: 1.05, reachMult: 1.2, windupMult: 1.0,
    weight: 3, fromLevel: 5,
    variantFilter: (v) => v.censer === true || v.rag === 28,
    movement: "orbiter",
    painMult: 0.8,
    exception: "dodges-ranged",
  },
  abomination: {
    id: "abomination", label: "Abomination Hulk",
    speedMult: 0.65, hpMult: 3.5, scale: 1.6, bodyRMult: 1.55, reachMult: 1.4, windupMult: 1.5,
    weight: 3, fromLevel: 5,
    variantFilter: (v) => v.twoheaded === true || v.seed === 9,
    knockback: 8.5,
    painMult: 0.2,
    exception: "speed-only",
  },
};

export const ZOMBIE_TYPE_IDS: readonly ZombieType[] = [
  "shambler",
  "runner",
  "lurcher",
  "hulk",
  "midget",
  "crawler",
  "flailer",
  "hobbler",
  "plague",
  "armored",
  "bloated",
  "frenzy",
  "frost",
  "charred",
  "screamer",
  "clutcher",
  "gravedigger",
  "mummy",
  "herald",
  "abomination",
] as const;

export const ACTIVE_ZOMBIE_TYPE_IDS: readonly ZombieType[] = ZOMBIE_TYPE_IDS;

/**
 * Integer avalanche (the xorshift-multiply finalizer). Pure, deterministic, and
 * total over uint32 — every input bit reaches every output bit, which is what
 * decorrelates the sub-type roll from the family roll that shares this hash.
 */
function mix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Weighted, depth-gated sub-type pick.
 *
 * Driven by the SAME spawn hash `spawnHordeMember` already derives per tile —
 * NOT Math.random(). Co-op peers each generate the horde locally from the shared
 * pool seed, so a random draw here would desync which zombie is a hulk on whose
 * screen. Determinism for a given (hash, level) is asserted in the test.
 */
export function pickZombieType(hash: number, level: number): ZombieType {
  const eligible = ZOMBIE_TYPE_IDS.filter((t) => level >= ZOMBIE_TYPES[t].fromLevel);
  let total = 0;
  for (const t of eligible) total += ZOMBIE_TYPES[t].weight;
  if (total <= 0) return "shambler";
  let r = mix32(hash) % total;
  for (const t of eligible) {
    r -= ZOMBIE_TYPES[t].weight;
    if (r < 0) return t;
  }
  return "shambler";
}

/** HP for a sub-type off the kind's baseline. Never rounds down to 0. */
export function typeHp(baseHp: number, t: ZombieType): number {
  return Math.max(1, Math.round(baseHp * ZOMBIE_TYPES[t].hpMult));
}

/**
 * Loot multiplier for a sub-type — a 9-HP hulk paying a 2-HP midget's wage is
 * the kind of thing that quietly kills the loop. Tracks hpMult but capped, so
 * the biggest bruiser is worth about double the baseline and no more.
 */
export function typeDropMult(t: ZombieType): number {
  return Math.min(2, ZOMBIE_TYPES[t].hpMult);
}

/**
 * Which ZOMBIE_VARIANTS indices a sub-type may wear. Falls back to the whole
 * pool when the filter matches nothing, so a variant-table edit can never
 * starve a sub-type of art (it would spawn invisible, which is worse than a
 * slightly-wrong silhouette).
 */
export function variantIndicesFor(t: ZombieType, pool: readonly ZVariant[]): number[] {
  const f = ZOMBIE_TYPES[t].variantFilter;
  if (!f) return pool.map((_, i) => i);
  const hits: number[] = [];
  for (let i = 0; i < pool.length; i++) if (f(pool[i])) hits.push(i);
  return hits.length > 0 ? hits : pool.map((_, i) => i);
}
