/**
 * SURFACES — what a tile is MADE OF, as opposed to what shape it is.
 *
 * Until this file existed, the map had geometry and nothing else. `Grid.t` said
 * wall-or-floor, `Grid.shapes` said square-or-slant-or-arc, and every physical
 * property was either a global constant (PINBALL_WALL_RESTITUTION) or derived
 * from topology on the fly (the open-neighbour friction pick in player.ts). The
 * consequence: every wall in the game bounced identically and every floor
 * dragged identically, so the only way a level could vary the ride was by
 * changing its SHAPE. A designer could not say "this bend is rubber" or "the
 * speedway floor is ice" at all.
 *
 * One byte per tile fixes that. Because a tile is either solid or walkable and
 * never both, ONE storage array carries both vocabularies — `Grid.surfaces`
 * holds a WallSurface on solid tiles and a FloorSurface on walkable ones, and
 * `isWalkable` picks which table to read. That keeps the memory, the painter
 * (maze/surface-paint.ts) and the renderer (maze/build.ts) unified instead of
 * bolting on two parallel systems that would immediately drift apart.
 *
 * ── THE IDENTITY RULE ────────────────────────────────────────────────────────
 * Index 0 of BOTH tables is the historical behaviour and every one of its
 * multipliers is exactly 1 with every additive exactly 0. A grid that never
 * assigns a surface therefore plays bit-identically to the build before this
 * file landed — same as how `Grid.shapes` defaults to SHAPE_FULL. `surfaces.test.ts`
 * asserts that neutrality field by field, because a "default" that quietly
 * multiplies by 0.98 would reroll the feel of every existing floor and nobody
 * would be able to point at the line that did it.
 *
 * DELIBERATELY DOM- and three-free. Pure data + pure lookups, like the rest of
 * engine/.
 */

// ── WALLS ────────────────────────────────────────────────────────────────────

/** Plain masonry. The baseline — every multiplier 1, every additive 0. */
export const WALL_STONE = 0;
/** Kicker rubber: every bounce GAINS. The wall you deliberately aim at. */
export const WALL_RUBBER = 1;
/** Polished ice: keeps nearly all your speed but the glance is too clean to
 *  bite, so it never builds combo. Fast travel, zero scoring. */
export const WALL_ICE = 2;
/** Packed mud: eats most of the impact and BREAKS the chain. The wall you have
 *  to thread past rather than ricochet off. */
export const WALL_MUD = 3;
/** Brass bell-plate: ordinary restitution, but a strike here is worth DOUBLE on
 *  the combo chain. The scoring wall. */
export const WALL_BRASS = 4;

export type WallSurface = number;

export interface WallSurfaceDef {
  id: WallSurface;
  label: string;
  /**
   * Multiplier on whatever flat-bounce restitution the caller had already
   * resolved (marble material → spring legs → the plain constant). A multiplier
   * rather than a replacement, so surfaces COMPOSE with the marble materials
   * instead of overriding them — a diamond ball on a rubber wall should be the
   * best of both, not whichever check happens to run last.
   */
  flatRestMult: number;
  /** Speed ADDED after a flat bounce, u/s. Rubber's whole identity: a
   *  multiplier alone can never turn a slow ball into a fast one. */
  bounceAdd: number;
  /**
   * Multiplier on the CORNER gain. Note the asymmetry in the caller: a surface
   * with `cornerMult >= 1` can never drag you below the speed you arrived with
   * (the historical "a corner never slows you" guarantee), while one below 1 is
   * explicitly allowed to — damping IS its job, and a floor of "never slower"
   * would make WALL_MUD a no-op in exactly the pocket it exists to punish.
   */
  cornerMult: number;
  /** Combo steps a bounce here is worth. 0 = the chain neither grows nor lapses
   *  (the window still refreshes) — see WALL_ICE. */
  comboTicks: number;
  /** True = a bounce here RESETS the chain to zero. Only WALL_MUD. */
  breaksCombo: boolean;
  /** Wall tint, sRGB hex, multiplied over the stone texture in build.ts. A
   *  surface the player cannot see is a bug, not a mechanic: an unreadable
   *  wall that eats your run reads as the physics being broken. */
  hex: number;
  /** Contact-spark tint, sRGB hex. */
  sparkHex: number;
}

export const WALL_SURFACES: readonly WallSurfaceDef[] = [
  {
    id: WALL_STONE,
    label: "Stone",
    flatRestMult: 1,
    bounceAdd: 0,
    cornerMult: 1,
    comboTicks: 1,
    breaksCombo: false,
    hex: 0xffffff, // identity tint — leaves the authored texture untouched
    sparkHex: 0xc8ccd4,
  },
  {
    id: WALL_RUBBER,
    label: "Rubber",
    // 1.06 × the 0.94 base lands just under 1.0, so rubber alone still can't
    // farm two facing walls forever — the flat ADD is where the gain lives, and
    // an additive gain is self-limiting against PINBALL_MAX_SPEED in a way a
    // >1 multiplier is not.
    flatRestMult: 1.06,
    bounceAdd: 1.6,
    cornerMult: 1.12,
    comboTicks: 1,
    breaksCombo: false,
    hex: 0xd9584f,
    sparkHex: 0xf0a63c,
  },
  {
    id: WALL_ICE,
    label: "Ice",
    flatRestMult: 1.05, // 0.94 × 1.05 ≈ 0.99 — nearly lossless
    bounceAdd: 0,
    cornerMult: 1,
    comboTicks: 0, // too clean a glance to bite
    breaksCombo: false,
    hex: 0x9fd8ef,
    sparkHex: 0xbfe8ff,
  },
  {
    id: WALL_MUD,
    label: "Mud",
    flatRestMult: 0.55,
    bounceAdd: 0,
    cornerMult: 0.45,
    comboTicks: 0,
    breaksCombo: true,
    hex: 0x6b5a3e,
    sparkHex: 0x8a7550,
  },
  {
    id: WALL_BRASS,
    label: "Brass",
    flatRestMult: 1,
    bounceAdd: 0,
    cornerMult: 1,
    comboTicks: 2,
    breaksCombo: false,
    hex: 0xd8a63c,
    sparkHex: 0xffd98a,
  },
];

/** Wall response for a surface id. Unknown/undefined → stone, never undefined:
 *  the physics runs every frame and must not branch on a missing table row. */
export function wallSurface(id: WallSurface | undefined): WallSurfaceDef {
  return WALL_SURFACES[id ?? WALL_STONE] ?? WALL_SURFACES[WALL_STONE];
}

// ── FLOORS ───────────────────────────────────────────────────────────────────

/** Plain flagstone. The baseline — every multiplier 1. */
export const FLOOR_STONE = 0;
/**
 * Sheet ice. Almost no friction and almost no STEERING grip: you keep the
 * speed you brought and you keep the heading you brought, which makes an icy
 * room a commitment rather than a playground.
 */
export const FLOOR_ICE = 1;
/** Sand. Drags hard and slows the walk — the "you should have kept to the
 *  track" floor. */
export const FLOOR_SAND = 2;
/** Steel decking. Slightly slicker than stone and raises the walk a touch:
 *  the speedway surface, a mild good-floor to route toward. */
export const FLOOR_STEEL = 3;
/** Cracked flowstone. Ordinary drag, but full steering authority even at
 *  speed — the technical floor, where a skilled line beats a fast one. */
export const FLOOR_GRIP = 4;

export type FloorSurface = number;

export interface FloorSurfaceDef {
  id: FloorSurface;
  label: string;
  /**
   * Multiplier on the momentum bleed. Composes with the EXISTING open-neighbour
   * pick (FRICTION_OPEN / CORRIDOR / TIGHT) rather than replacing it — that
   * topology term is doing real work (a dead-end pocket must still bleed you
   * down) and a surface should colour it, not overwrite it.
   */
  frictionMult: number;
  /** Multiplier on how hard the player can BEND a live momentum heading. Ice
   *  near-zero is what makes it read as ice rather than as "fast stone". */
  steerMult: number;
  /** Multiplier on ordinary walking speed (momentum not engaged). */
  walkMult: number;
  /** Floor tint, sRGB hex. Identity white leaves the authored texture alone. */
  hex: number;
}

export const FLOOR_SURFACES: readonly FloorSurfaceDef[] = [
  { id: FLOOR_STONE, label: "Stone", frictionMult: 1, steerMult: 1, walkMult: 1, hex: 0xffffff },
  { id: FLOOR_ICE, label: "Ice", frictionMult: 0.12, steerMult: 0.25, walkMult: 1.05, hex: 0xa8dcf0 },
  { id: FLOOR_SAND, label: "Sand", frictionMult: 2.4, steerMult: 1.15, walkMult: 0.82, hex: 0xc9ab6e },
  { id: FLOOR_STEEL, label: "Steel", frictionMult: 0.62, steerMult: 0.9, walkMult: 1.08, hex: 0xa9b4c4 },
  { id: FLOOR_GRIP, label: "Flowstone", frictionMult: 1.1, steerMult: 1.6, walkMult: 1, hex: 0x8fae86 },
];

/** Floor response for a surface id. Unknown/undefined → stone. */
export function floorSurface(id: FloorSurface | undefined): FloorSurfaceDef {
  return FLOOR_SURFACES[id ?? FLOOR_STONE] ?? FLOOR_SURFACES[FLOOR_STONE];
}

// ── MATERIALS — the authoring vocabulary ─────────────────────────────────────

/**
 * A material is a coherent (wall, floor) PAIR, and it is what level authoring
 * actually speaks in.
 *
 * The two tables above are the physics; nobody designing a floor wants to pick
 * a wall surface and a floor surface independently. They want to say "this
 * region is ice", and have the walls glance and the floor glide TOGETHER. The
 * independent-axes version was tried on paper first and it is worse in both
 * directions: it makes 25 combinations the designer must reason about, and it
 * produces incoherent rooms (icy walls over sand) that read as a bug.
 *
 * Note `rubber` pairs its bouncy walls with GRIP floor, not with a slick one:
 * a room whose walls throw you needs a floor you can still aim on, or it is
 * just a blender. The pairing is where the room's character is decided.
 */
export const MAT_STONE = 0;
export const MAT_RUBBER = 1;
export const MAT_ICE = 2;
export const MAT_MUD = 3;
export const MAT_BRASS = 4;

export type MaterialId = number;

export interface SurfaceMaterial {
  id: MaterialId;
  label: string;
  /** Shown on the descent card when a modifier makes this material common. */
  flavour: string;
  wall: WallSurface;
  floor: FloorSurface;
}

export const MATERIALS: readonly SurfaceMaterial[] = [
  { id: MAT_STONE, label: "Stone", flavour: "", wall: WALL_STONE, floor: FLOOR_STONE },
  { id: MAT_RUBBER, label: "Rubber", flavour: "the walls throw you back", wall: WALL_RUBBER, floor: FLOOR_GRIP },
  { id: MAT_ICE, label: "Ice", flavour: "nothing here holds a line", wall: WALL_ICE, floor: FLOOR_ICE },
  { id: MAT_MUD, label: "Mud", flavour: "the chain dies where it touches", wall: WALL_MUD, floor: FLOOR_SAND },
  { id: MAT_BRASS, label: "Brass", flavour: "every strike rings twice", wall: WALL_BRASS, floor: FLOOR_STEEL },
];

/** Material for an id. Unknown → stone, never undefined. */
export function material(id: MaterialId | undefined): SurfaceMaterial {
  return MATERIALS[id ?? MAT_STONE] ?? MATERIALS[MAT_STONE];
}

// ── Mixes — how a floor decides what to paint ────────────────────────────────

/**
 * A surface mix is a sparse weight table: `{ [surfaceId]: weight }`. Absent or
 * empty means "all baseline", which is what keeps an un-themed floor identical
 * to the pre-surface build.
 *
 * Weights are relative, not percentages, so a caller can bias one entry without
 * having to rebalance the rest — the theme/modifier layer merges tables by
 * summing weights, and rebalancing on every merge is exactly the bookkeeping
 * that makes such tables rot.
 */
export type SurfaceMix = Readonly<Record<number, number>>;

/** Merge mixes left-to-right, summing weights. Later entries add to earlier
 *  ones rather than replacing them, so a modifier can lean a theme without
 *  erasing it. */
export function mergeMix(...mixes: Array<SurfaceMix | undefined>): SurfaceMix {
  const out: Record<number, number> = {};
  for (const m of mixes) {
    if (!m) continue;
    for (const k of Object.keys(m)) {
      const id = Number(k);
      const w = m[id] ?? 0;
      if (w > 0) out[id] = (out[id] ?? 0) + w;
    }
  }
  return out;
}

/**
 * Draw one surface id from a mix, or `fallback` when the mix is empty. Consumes
 * exactly ONE rng call whatever the table size — the painter runs per tile over
 * a whole floor, and a draw whose rng cost depended on the weights would make
 * the stream un-reproducible the moment a theme gained an entry.
 */
export function pickSurface(mix: SurfaceMix, rand: () => number, fallback = 0): number {
  let total = 0;
  for (const k of Object.keys(mix)) total += mix[Number(k)] ?? 0;
  if (total <= 0) return fallback;
  let r = rand() * total;
  for (const k of Object.keys(mix)) {
    const id = Number(k);
    r -= mix[id] ?? 0;
    if (r <= 0) return id;
  }
  return fallback;
}
