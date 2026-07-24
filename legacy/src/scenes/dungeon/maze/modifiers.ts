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

export type ModifierId = "none" | "flooded" | "blackout" | "overcharged" | "gilded" | "collapsing";

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
}

const BASE: Omit<FloorModifier, "id" | "label" | "flavour"> = {
  torchMult: 1,
  partMult: 1,
  hordeMult: 1,
  hazardMult: 1,
  trapdoorMult: 1,
  bonusItems: 0,
  dealBias: [],
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
