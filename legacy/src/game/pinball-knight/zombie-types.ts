/**
 * ZOMBIE SUB-TYPES — behavioural variety inside the `zombie` EnemyKind.
 *
 * The horde used to be five zombies that LOOKED different and FOUGHT identically:
 * `ZOMBIE_VARIANTS` (render/cel-painter.ts) varies the silhouette — stumps,
 * spurs, bared bone, trailing rags — but every one of them carried ZOMBIE_HP,
 * ZOMBIE_R and the single `levelConfig().zombieSpeed`. A one-armed zombie hit
 * exactly as hard, as fast, and as far as an intact one.
 *
 * A sub-type is a MULTIPLIER BUNDLE over the zombie baseline, not a new
 * EnemyKind. That is deliberate and load-bearing: `EnemyKind` is consumed by six
 * exhaustive `Record<EnemyKind, …>` tables (STATS in entities/zombie.ts,
 * HP_BY_KIND in core.ts, ENEMY_DROPS in reagents.ts, the bite table in
 * combat.ts, plus the spawnKind switch and EXPANSION_SKIN). Eight zombie
 * flavours as kinds would mean 48 new rows that all say the same thing, and it
 * would fork `rotflesh` drops across nine keys. One optional `ztype` field on
 * Zombie plus this table costs almost nothing by comparison.
 *
 * Everything is a MULTIPLIER, never an absolute, so `levelConfig().zombieSpeed`
 * floor-scaling keeps working underneath.
 *
 * DOM- and three-free so the spawn math is unit-tested.
 */
import type { ZVariant } from "./render/cel-painter";

export type ZombieType =
  | "shambler" // baseline — what a zombie was before this table existed
  | "runner" // fast, frail
  | "lurcher" // slow, tanky
  | "hulk" // BIG: slow, very tanky, knocks you back
  | "midget" // small, quick, short reach
  | "crawler" // NO LEGS: prone, very slow, tough
  | "flailer" // NO ARMS: bites instead of swinging — short reach, fast windup
  | "hobbler"; // one leg: LIMPS, gait oscillates

export interface ZombieTypeDef {
  id: ZombieType;
  /** Shown on the struck-enemy tag + the bestiary. */
  label: string;
  /** × levelConfig().zombieSpeed. For "limp" this is the AVERAGE — the gait
   * oscillates ±LIMP_AMP around it (see entities/zombie.ts). */
  speedMult: number;
  /** × ZOMBIE_HP, rounded, floor of 1. */
  hpMult: number;
  /** Sprite mesh scale. */
  scale: number;
  /**
   * × ZOMBIE_R for the collider.
   *
   * MUST differ from 1 whenever `scale` does — state.ts's `Zombie.bodyR`
   * comment documents the Reaper King walking half-buried into corridors
   * because its mesh scaled 2.17× while the collider stayed at 0.42.
   * `zombie-types.test.ts` asserts this pairing so the trap can't come back.
   */
  bodyRMult: number;
  /** × ZOMBIE_CONTACT_RANGE. */
  reachMult: number;
  /** × ZOMBIE_ATTACK_WINDUP. */
  windupMult: number;
  /** Spawn weight within the zombie kind. The table sums to 100 so the numbers
   * read as straight percentages (asserted in the test). */
  weight: number;
  /** Depth gate — the nastier flavours stay out of floor 1. */
  fromLevel: number;
  /**
   * Forces a silhouette from ZOMBIE_VARIANTS so the art agrees with the stats:
   * a crawler that renders with two good legs is a lie the player will notice.
   * null = any variant (scale/speed carries the read instead).
   */
  variantFilter: ((v: ZVariant) => boolean) | null;
  /** Animation hook — "limp" oscillates speed, "crawl" renders prone. */
  gait?: "limp" | "crawl";
  /** Contact knockback impulse (hulk only); undefined = the normal shove. */
  knockback?: number;
}

/**
 * The roster. Shambler keeps the plurality on purpose — the horde must still
 * read as A HORDE, not a freak show, so the baseline is a third of every spawn.
 *
 * First-pass numbers; tune after playtest. Weights sum to 100.
 */
export const ZOMBIE_TYPES: Record<ZombieType, ZombieTypeDef> = {
  shambler: {
    id: "shambler", label: "Shambler",
    speedMult: 1.0, hpMult: 1.0, scale: 1.0, bodyRMult: 1.0, reachMult: 1.0, windupMult: 1.0,
    weight: 34, fromLevel: 1, variantFilter: null,
  },
  runner: {
    id: "runner", label: "Runner",
    speedMult: 1.75, hpMult: 0.67, scale: 0.95, bodyRMult: 0.95, reachMult: 1.0, windupMult: 0.75,
    weight: 16, fromLevel: 2, variantFilter: null,
  },
  lurcher: {
    id: "lurcher", label: "Lurcher",
    speedMult: 0.55, hpMult: 2.0, scale: 1.1, bodyRMult: 1.1, reachMult: 1.05, windupMult: 1.3,
    weight: 14, fromLevel: 1, variantFilter: null,
  },
  hulk: {
    id: "hulk", label: "Hulk",
    speedMult: 0.7, hpMult: 3.0, scale: 1.55, bodyRMult: 1.5, reachMult: 1.35, windupMult: 1.45,
    weight: 6, fromLevel: 4, variantFilter: null, knockback: 7.5,
  },
  midget: {
    id: "midget", label: "Midget",
    speedMult: 1.35, hpMult: 0.67, scale: 0.62, bodyRMult: 0.65, reachMult: 0.7, windupMult: 0.85,
    weight: 12, fromLevel: 2, variantFilter: null,
  },
  crawler: {
    id: "crawler", label: "Crawler",
    speedMult: 0.4, hpMult: 1.33, scale: 0.5, bodyRMult: 0.7, reachMult: 0.65, windupMult: 1.1,
    weight: 8, fromLevel: 3,
    // Legless: BOTH legs gone in the art, and it renders prone (§gait).
    variantFilter: (v) => v.legStump === "both",
    gait: "crawl",
  },
  flailer: {
    id: "flailer", label: "Flailer",
    speedMult: 1.15, hpMult: 1.0, scale: 1.0, bodyRMult: 1.0, reachMult: 0.6, windupMult: 0.7,
    weight: 6, fromLevel: 3,
    // No arms: it bites, so it needs the armless silhouette. (`stump` is the
    // ARM field — legs are `legStump`. Easy to transpose; the test pins it.)
    variantFilter: (v) => v.stump === "both",
  },
  hobbler: {
    id: "hobbler", label: "Hobbler",
    speedMult: 0.85, hpMult: 1.0, scale: 1.0, bodyRMult: 1.0, reachMult: 0.9, windupMult: 1.0,
    weight: 4, fromLevel: 2,
    // One leg gone IS the limp — exactly one, not both (that's the crawler).
    variantFilter: (v) => v.legStump === "L" || v.legStump === "R",
    gait: "limp",
  },
};

export const ZOMBIE_TYPE_IDS: ZombieType[] = Object.keys(ZOMBIE_TYPES) as ZombieType[];

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
  // RE-MIX rather than merely shifting. The caller's residue classes
  // (hash % BRUTE_RATIO, % SPIDER_RATIO, …) already consumed the low bits to
  // choose the FAMILY, so reusing them raw would correlate sub-type with kind.
  // A bare `hash >>> 11` looked like the fix and is not: it maps every hash
  // below 2048 to zero, so a caller passing small sequential hashes gets
  // nothing but shamblers. Hashing the whole word decorrelates without caring
  // how big the input happens to be.
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
