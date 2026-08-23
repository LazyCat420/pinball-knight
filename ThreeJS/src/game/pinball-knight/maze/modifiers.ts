/**
 * FLOOR MODIFIERS — the roguelike "this floor is different" layer.
 *
 * Archetypes change a floor's shape and themes change its furniture, but both
 * are on a fixed cycle: once you have seen 20 floors you have seen every
 * pairing. A modifier is rolled from the floor's own seed, so two runs that
 * reach depth 7 don't get the same depth 7. It is announced on the descent card
 * — an unannounced modifier reads as the game being buggy, not as a twist.
 *
 * Every field is a MULTIPLIER on a budget core.ts already computes, so a
 * modifier can never invent a mechanic the floor builder doesn't have; the
 * worst a bad roll can do is a floor that is too dark or too crowded. Nothing
 * here can affect connectivity.
 *
 * DOM- and three-free: tested in modifiers.test.ts.
 */
import { MAT_ICE, MAT_MUD, MAT_RUBBER, MAT_BRASS } from "../engine/surfaces";

export type ModifierId = "none" | "flooded" | "blackout" | "overcharged" | "gilded" | "collapsing" | "frozen" | "silted";

export interface FloorModifier {
  id: ModifierId;
  /** Shown on the descent card. Empty for "none" so the card stays clean. */
  label: string;
  flavour: string;
  /** Multipliers on the level budgets (1 = leave alone). */
  torchMult: number;
  partMult: number;
  hordeMult: number;
  hazardMult: number;
  trapdoorMult: number;
  /** Extra loot rolls beyond the level's normal armoury. */
  bonusItems: number;
  /**
   * Part kinds pushed to the FRONT of the theme's deal, biasing which furniture
   * the corridor pass reaches for first.
   */
  dealBias: string[];
  /**
   * What the floor is MADE OF (engine/surfaces.ts): relative weights over
   * MaterialId, stamped as patches by maze/surface-paint.ts.
   *
   * This is the first modifier field that changes PHYSICS rather than a budget.
   * It is still safe against the module's standing guarantee that "nothing here
   * can affect connectivity", because the painter only ever rewrites what a
   * tile is made of — it never moves one. An empty mix paints nothing.
   */
  surfaceMix: Record<number, number>;
  /** Roughly what fraction of the floor the mix covers, 0..1. */
  surfaceCoverage: number;
}

const BASE: Omit<FloorModifier, "id" | "label" | "flavour"> = {
  torchMult: 1,
  partMult: 1,
  hordeMult: 1,
  hazardMult: 1,
  trapdoorMult: 1,
  bonusItems: 0,
  dealBias: [],
  surfaceMix: {},
  surfaceCoverage: 0,
};

export const MODIFIERS: FloorModifier[] = [
  {
    ...BASE,
    id: "none",
    label: "",
    flavour: "",
  },
  {
    // Nothing brakes. The floor is a slip-and-slide and bumpers become the only
    // way to shed speed — which makes them read as safety rather than hazard.
    ...BASE,
    id: "flooded",
    label: "Flooded",
    flavour: "ankle-deep and slick · nothing here stops",
    dealBias: ["oil", "oil", "bumper"],
    partMult: 1.15,
    hazardMult: 1.2,
    // The flavour text has promised "nothing here stops" since this modifier
    // shipped; until surfaces existed the only thing backing it up was an oil
    // deal bias. Ice patches make the claim literally true underfoot.
    surfaceMix: { [MAT_ICE]: 1 },
    surfaceCoverage: 0.3,
  },
  {
    // Half-lit, double-paid. The classic risk/reward dark floor.
    ...BASE,
    id: "blackout",
    label: "Blackout",
    flavour: "the torches are out · something wanted them out",
    torchMult: 0.45,
    bonusItems: 2,
    hordeMult: 0.85,
    // The only modifier where the player cannot SEE the floor, so it is the
    // one where a surface has to be legible by ear and by feel instead. Brass
    // is exactly that: ordinary restitution, so it never surprises you, but
    // double combo ticks and a bright spark on contact — in the dark the walls
    // you bounce off become the map. A small mud fraction keeps it a gamble
    // rather than a gift, since a chain broken by a wall you never saw is the
    // risk half of a risk/reward floor.
    //
    // Explicitly NOT ice or heavy rubber: a surface that steers or throws you
    // is a surface you have to see coming, and stacking one on an unlit floor
    // is not difficulty, it is a coin flip.
    surfaceMix: { [MAT_BRASS]: 4, [MAT_MUD]: 1 },
    surfaceCoverage: 0.24,
  },
  {
    // A denser table AND a bigger horde — the floor that plays fastest.
    ...BASE,
    id: "overcharged",
    label: "Overcharged",
    flavour: "the machinery is running hot · everything hits harder",
    partMult: 1.4,
    hordeMult: 1.25,
    dealBias: ["bumper", "slingshot", "glove"],
    // Hot machinery = live rubber. Small patches, because rubber walls GAIN and
    // a floor that is mostly rubber is a floor with no brakes anywhere.
    surfaceMix: { [MAT_RUBBER]: 1 },
    surfaceCoverage: 0.16,
  },
  {
    // Treasure floor: the armoury is fat, and so is what's guarding it.
    ...BASE,
    id: "gilded",
    label: "Gilded",
    flavour: "gold in the cracks · and a queue for it",
    bonusItems: 3,
    hordeMult: 1.6,
    hazardMult: 0.8,
    // Brass bell-plate: the treasure floor is also the SCORING floor, since
    // every strike on it is worth double on the chain.
    surfaceMix: { [MAT_BRASS]: 1 },
    surfaceCoverage: 0.22,
  },
  {
    // The floor is coming apart: hatches and pits everywhere, few torches.
    // Falling costs you position, not your run, so this stays a pace modifier.
    ...BASE,
    id: "collapsing",
    label: "Collapsing",
    flavour: "the floor is giving way · keep moving",
    trapdoorMult: 2.2,
    hazardMult: 1.5,
    torchMult: 0.75,
    dealBias: ["pit", "trapdoor"],
    // "Keep moving" is a rule the floor should enforce, not just announce.
    // Rubble underfoot (sand drags, mud walls break the chain) is what makes
    // standing still expensive, and the scattered rubber slabs are the sprung
    // masonry of a floor coming apart — the one thing that will still throw
    // you clear of a hatch. Wide coverage because a collapsing floor that is
    // mostly intact is just a floor with some holes in it.
    surfaceMix: { [MAT_MUD]: 3, [MAT_RUBBER]: 1 },
    surfaceCoverage: 0.4,
  },
  {
    // SURFACE-LED. The whole floor is a skating rink: you keep every unit of
    // speed you build and almost none of your steering, so the route has to be
    // chosen before you commit to it rather than corrected mid-ride. Fewer
    // parts on purpose — the ICE is the obstacle, and stacking a dense table on
    // top of it makes an unreadable floor rather than a hard one.
    ...BASE,
    id: "frozen",
    label: "Frozen",
    flavour: "black ice wall to wall · pick your line early",
    partMult: 0.85,
    hazardMult: 0.9,
    surfaceMix: { [MAT_ICE]: 5, [MAT_MUD]: 1 },
    surfaceCoverage: 0.62,
  },
  {
    // SURFACE-LED, and the mirror of Frozen: mud kills chains, so a silted
    // floor is where combo scoring goes to die and raw clearing pays instead.
    // The bonus items are the compensation for a floor that refuses to be
    // played stylishly.
    ...BASE,
    id: "silted",
    label: "Silted",
    flavour: "silt over everything · the chain dies where it touches",
    bonusItems: 2,
    hordeMult: 0.9,
    surfaceMix: { [MAT_MUD]: 4, [MAT_BRASS]: 1 },
    surfaceCoverage: 0.45,
  },
];

const byId = new Map(MODIFIERS.map((m) => [m.id, m]));

export function modifierById(id: ModifierId): FloorModifier {
  return byId.get(id) ?? MODIFIERS[0];
}

/** The "no modifier" record — exported so callers can default without a lookup. */
export const NO_MODIFIER = MODIFIERS[0];

/**
 * Levels 1-2 never roll one: the opening floors are where a player is still
 * learning the base rules, and a twist there reads as the rules being unclear.
 */
export const MODIFIER_FROM_LEVEL = 3;
/** Chance a qualifying floor draws a modifier at all. */
export const MODIFIER_CHANCE = 0.45;

/**
 * Roll this floor's modifier. Draws ZERO rng values below MODIFIER_FROM_LEVEL
 * (early return) and one or two otherwise (one when the chance gate fails), so
 * the stream stays predictable for a given (run, level).
 */
export function rollModifier(level: number, rng: () => number): FloorModifier {
  if (level < MODIFIER_FROM_LEVEL) return NO_MODIFIER;
  if (rng() >= MODIFIER_CHANCE) return NO_MODIFIER;
  const pool = MODIFIERS.filter((m) => m.id !== "none");
  return pool[Math.floor(rng() * pool.length)];
}
