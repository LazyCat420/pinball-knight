/**
 * CARDS — a slain monster's power, bottled and socketed into your GEAR.
 *
 * THE TWO AXES, and they must not overlap:
 *   · the SKILL TREE upgrades the PLAYER (hp, mana, move speed, ability unlocks)
 *   · CARDS upgrade the GEAR (weapons and armour)
 * An earlier cut had cards granting Q/E abilities. That was wrong — abilities
 * are the tree's job, and a card that hands you one blurs the only line that
 * makes two progression systems worth having.
 *
 * A card is NOT an item you equip standalone; it slots into a weapon or a piece
 * of armour (bounded by that item's RARITY — see SLOTS_BY_RARITY in items.ts)
 * and changes how it performs. Every card is the essence of exactly one monster,
 * INCLUDING the eight zombie sub-types: a Hulk and a Midget are different
 * monsters and drop different cards. Effects come in three flavours, all
 * resolved centrally so any weapon benefits:
 *   - STAT   : flat/percent damage, cooldown, durability (aggregateCards).
 *   - ON-HIT : a status stamped on the struck enemy (chill = slow, burn = DoT).
 *   - PINBALL: a bonus that only fires while you're carrying pinball momentum
 *              (the hybrid-identity synergy — reads player.momSpeed at the site).
 *
 * DOM- and three-free so the aggregation math is unit-tested.
 */
import { WEAPONS, weaponSlotCount, type WeaponKind, type WeaponState } from "./items";
import type { EnemyKind } from "./state";
import type { ZombieType } from "./zombie-types";

export type CardRarity = "common" | "rare" | "epic" | "legendary" | "mythic";
export type CardId = string;

/** What a card does. All fields optional — a card sets only what it changes. */
export interface CardModifier {
  /** Flat damage added AFTER the percent multiplier. */
  damageFlat?: number;
  /** Percent damage multiplier (1.3 = +30%). Multiplied across sockets. */
  damageMult?: number;
  /** Attack cooldown multiplier (<1 = faster). Multiplied across sockets. */
  cooldownMult?: number;
  /** Max-durability multiplier (>1 = tougher). Multiplied across sockets. */
  durabilityMult?: number;
  /** On-hit status stamped on the struck enemy. */
  onHit?: "chill" | "burn";
  /** Bonus damage MULTIPLIER applied only while riding pinball momentum. */
  pinballMult?: number;
  /** On hit, arc a THUNDERBOLT out along the strike line — a throttled line-AoE
   * that damages every foe in front of the struck enemy (see combat.fireBolt). */
  bolt?: boolean;
  /** Bonus damage MULTIPLIER applied only while a MARBLE MATERIAL is active
   * (the material-synergy hybrid — reads player.material at the damage site). */
  materialMult?: number;
  /** Chance [0..1] for a hit to CRIT. Summed across sockets, capped at 1. */
  critChance?: number;
  /** Crit damage multiplier (max across sockets; default 2 when any crit card). */
  critMult?: number;
  /** HP restored to the knight per landed hit. Summed across sockets. */
  lifesteal?: number;
  /** Extra enemies a ranged shot passes THROUGH before dying. Summed. */
  pierce?: number;
}

export interface CardDef {
  id: CardId;
  label: string;
  icon: string;
  rarity: CardRarity;
  description: string;
  /** Which weapons this fits — "both" fits melee and ranged. */
  weaponKinds: WeaponKind | "both";
  modifier: CardModifier;
  /**
   * THIS COPY's level, 1..CARD_LEVEL_MAX. Present on every def that comes out of
   * `cardDef()`; the raw CARDS catalogue leaves it undefined (i.e. level 1).
   * Set by the drop roll from the FLOOR — see rollCardLevel.
   */
  level?: number;
  /** THIS COPY is a shiny (see SHINY_CHANCE). Cosmetic AND a stat bonus. */
  shiny?: boolean;
  /** The catalogue id this copy is a level of — `id` minus the `#4s` suffix. */
  base?: CardId;
  /**
   * Which MONSTER this card is the essence of — the Ragnarok model, where a card
   * is a slain monster's power bottled rather than an anonymous stat chip.
   *
   * Drives three things: the AFFINITY drop roll (rollCardDrop biases toward the
   * slain kind's own cards), the bestiary's "what does this thing drop" column,
   * and the source-monster art window on the holo card.
   *
   * `undefined` = not monster-derived. The mythics are sourceless: they have no
   * single monster to be the essence OF, so an affinity roll can't bias toward
   * them. They still drop — see MYTHIC_FLOOR — just from a deep boss rather
   * than from a kind.
   */
  source?: EnemyKind;
  /**
   * For a card sourced to a zombie SUB-TYPE rather than the family as a whole.
   * All eight sub-types share `kind: "zombie"` (see zombie-types.ts — they are a
   * multiplier bundle, not an EnemyKind), so `source` alone cannot tell a Hulk
   * card from a Midget card. The affinity roll prefers a sub-type match over a
   * family match, and the bestiary files these under the SUB-TYPE row — which is
   * what makes "farm Hulks for the Hulk card" a legible goal.
   */
  subType?: ZombieType;
}

export const RARITY_HEX: Record<CardRarity, string> = {
  common: "#9aa4b4",
  rare: "#4f8fdb",
  epic: "#a46fe8",
  legendary: "#f0a63c",
  mythic: "#ff77e9",
};

export const CARDS: Record<CardId, CardDef> = {
  // 25 cards, exactly 5 per rarity. Every non-mythic is the essence of ONE
  // monster; the eight zombie SUB-TYPES each get their own card, because a Hulk
  // and a Midget are different monsters and should not drop the same chip.
  //
  // MECHANIC COVERAGE RULE: every mechanic needs at least TWO cards or its
  // 2-card set bonus in `aggregateCards` is unreachable and the mechanic reads
  // as a one-card orphan.
  //   bolt     -> wispspark, tempestcrown
  //   material -> crystalshard, golemcore
  //   crit     -> goblintooth, flailerjaw, bloodpact
  //   pierce   -> venomgland, webspinnersilk
  //   lifesteal-> ectoplasmcore, grimscythe, bloodpact
  //   pinball  -> runnersinew, timeripper

  // ══ COMMON (5) — the shallow-floor horde ══
  shamblerhide: { id: "shamblerhide", label: "Shambler Hide", icon: "🧟", rarity: "common", weaponKinds: "both", description: "+35% durability", source: "zombie", subType: "shambler", modifier: { durabilityMult: 1.35 } },
  midgetclaw: { id: "midgetclaw", label: "Midget Claw", icon: "🦴", rarity: "common", weaponKinds: "both", description: "−12% cooldown", source: "zombie", subType: "midget", modifier: { cooldownMult: 0.88 } },
  hobblerbrace: { id: "hobblerbrace", label: "Hobbler Brace", icon: "🦯", rarity: "common", weaponKinds: "both", description: "+25% durability, −5% cooldown", source: "zombie", subType: "hobbler", modifier: { durabilityMult: 1.25, cooldownMult: 0.95 } },
  batwingchip: { id: "batwingchip", label: "Bat Wing", icon: "🦇", rarity: "common", weaponKinds: "both", description: "−10% cooldown, +15% durability", source: "bat", modifier: { cooldownMult: 0.9, durabilityMult: 1.15 } },
  spidersilk: { id: "spidersilk", label: "Spider Silk", icon: "🕸️", rarity: "common", weaponKinds: "both", description: "+20% damage", source: "spider", modifier: { damageMult: 1.2 } },

  // ══ RARE (5) — specialists ══
  runnersinew: { id: "runnersinew", label: "Runner Sinew", icon: "🏃", rarity: "rare", weaponKinds: "both", description: "+35% damage while riding momentum", source: "zombie", subType: "runner", modifier: { pinballMult: 1.35 } },
  lurcherspine: { id: "lurcherspine", label: "Lurcher Spine", icon: "🦴", rarity: "rare", weaponKinds: "both", description: "+1 dmg, +80% durability", source: "zombie", subType: "lurcher", modifier: { damageFlat: 1, durabilityMult: 1.8 } },
  goblintooth: { id: "goblintooth", label: "Goblin Tooth", icon: "👺", rarity: "rare", weaponKinds: "both", description: "20% chance to CRIT (×2)", source: "goblin", modifier: { critChance: 0.2 } },
  venomgland: { id: "venomgland", label: "Venom Gland", icon: "🤮", rarity: "rare", weaponKinds: "both", description: "shots pierce 2 more foes, hits BURN", source: "spitter", modifier: { pierce: 2, onHit: "burn" } },
  wispspark: { id: "wispspark", label: "Wisp Spark", icon: "✨", rarity: "rare", weaponKinds: "both", description: "hits arc a THUNDERBOLT through foes ahead", source: "wisp", modifier: { bolt: true } },

  // ══ EPIC (5) — the heavies ══
  hulkknuckle: { id: "hulkknuckle", label: "Hulk Knuckle", icon: "💪", rarity: "epic", weaponKinds: "both", description: "+60% damage, but +15% cooldown", source: "zombie", subType: "hulk", modifier: { damageMult: 1.6, cooldownMult: 1.15 } },
  crawlergrip: { id: "crawlergrip", label: "Crawler Grip", icon: "🖐️", rarity: "epic", weaponKinds: "both", description: "+40% dmg and hits CHILL", source: "zombie", subType: "crawler", modifier: { damageMult: 1.4, onHit: "chill" } },
  ectoplasmcore: { id: "ectoplasmcore", label: "Ectoplasm Core", icon: "👻", rarity: "epic", weaponKinds: "both", description: "+25% dmg, hits CHILL, heal 1/hit", source: "ghost", modifier: { damageMult: 1.25, onHit: "chill", lifesteal: 1 } },
  crystalshard: { id: "crystalshard", label: "Crystal Shard", icon: "🔷", rarity: "epic", weaponKinds: "both", description: "+50% dmg while a MARBLE is active", source: "crystalback", modifier: { materialMult: 1.5 } },
  webspinnersilk: { id: "webspinnersilk", label: "Webspinner Silk", icon: "🕸️", rarity: "epic", weaponKinds: "ranged", description: "shots pierce 3 more foes, −15% cooldown", source: "webspinner", modifier: { pierce: 3, cooldownMult: 0.85 } },

  // ══ LEGENDARY (5) — build-defining, off the deep roster ══
  flailerjaw: { id: "flailerjaw", label: "Flailer Jaw", icon: "😬", rarity: "legendary", weaponKinds: "both", description: "+50% dmg, 30% CRIT for ×2.5", source: "zombie", subType: "flailer", modifier: { damageMult: 1.5, critChance: 0.3, critMult: 2.5 } },
  grimscythe: { id: "grimscythe", label: "Grim Scythe", icon: "☠️", rarity: "legendary", weaponKinds: "both", description: "+2 dmg, +45% dmg, heal 1/hit", source: "reaper", modifier: { damageFlat: 2, damageMult: 1.45, lifesteal: 1 } },
  necrosigil: { id: "necrosigil", label: "Necro Sigil", icon: "🕯️", rarity: "legendary", weaponKinds: "both", description: "+40% dmg, hits BURN", source: "necromancer", modifier: { damageMult: 1.4, onHit: "burn" } },
  golemcore: { id: "golemcore", label: "Golem Core", icon: "🗿", rarity: "legendary", weaponKinds: "both", description: "+2 dmg, +35% dmg while a MARBLE is active, +100% durability", source: "golem", modifier: { damageFlat: 2, materialMult: 1.35, durabilityMult: 2 } },
  brutecleaver: { id: "brutecleaver", label: "Brute Cleaver", icon: "🪓", rarity: "legendary", weaponKinds: "melee", description: "+70% damage (melee)", source: "brute", modifier: { damageMult: 1.7 } },

  // ══ MYTHIC (5) — chase cards. SOURCELESS on purpose: no single monster is
  // their essence, so affinity can never bias toward them. Tavern shelf, or a
  // deep boss. Two are CURSED — a real drawback for a huge upside. ══
  worldbreaker: { id: "worldbreaker", label: "World Breaker", icon: "🌋", rarity: "mythic", weaponKinds: "both", description: "+2 dmg, +75% dmg, hits BURN", modifier: { damageFlat: 2, damageMult: 1.75, onHit: "burn" } },
  timeripper: { id: "timeripper", label: "Time Ripper", icon: "⏳", rarity: "mythic", weaponKinds: "both", description: "−40% cooldown, +60% dmg, DOUBLE on momentum", modifier: { cooldownMult: 0.6, damageMult: 1.6, pinballMult: 2 } },
  tempestcrown: { id: "tempestcrown", label: "Tempest Crown", icon: "🌀", rarity: "mythic", weaponKinds: "both", description: "+50% dmg, hits BURN and arc a THUNDERBOLT", modifier: { damageMult: 1.5, onHit: "burn", bolt: true } },
  gladeath: { id: "gladeath", label: "Glass Cannon", icon: "🩻", rarity: "mythic", weaponKinds: "both", description: "+120% dmg, but −60% durability", modifier: { damageMult: 2.2, durabilityMult: 0.4 } },
  bloodpact: { id: "bloodpact", label: "Blood Pact", icon: "🖤", rarity: "mythic", weaponKinds: "both", description: "50% CRIT ×3 and heal 1/hit, but −40% durability", modifier: { critChance: 0.5, critMult: 3, lifesteal: 1, durabilityMult: 0.6 } },
};

export const CARD_IDS: CardId[] = Object.keys(CARDS);

/** How many unsocketed cards the run can carry. One source of truth — the
 * pickup path (core.ts), the Tavern dealer and the menu all read this. */
export const STASH_MAX = 10;

const BY_RARITY: Record<CardRarity, CardId[]> = {
  common: CARD_IDS.filter((id) => CARDS[id].rarity === "common"),
  rare: CARD_IDS.filter((id) => CARDS[id].rarity === "rare"),
  epic: CARD_IDS.filter((id) => CARDS[id].rarity === "epic"),
  legendary: CARD_IDS.filter((id) => CARDS[id].rarity === "legendary"),
  mythic: CARD_IDS.filter((id) => CARDS[id].rarity === "mythic"),
};

export function cardsOfRarity(r: CardRarity): CardId[] {
  return BY_RARITY[r].slice();
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD INSTANCES — the same monster, a different card
//
// A Spider Silk off floor 1 and a Spider Silk off floor 17 used to be the same
// byte-identical string, which made the twelfth copy of a common worth exactly
// as much as the first and the end-of-floor haul a wall of repeated faces.
//
// A card in the WORLD now carries a LEVEL and a SHINY flag, encoded into the id:
//
//   spidersilk      level 1, plain   (canonical — every pre-existing id still valid)
//   spidersilk#4    level 4, plain
//   spidersilk#4s   level 4, SHINY
//
// WHY AN ENCODED STRING rather than an object: `state.cardStash`, the ground
// item, `WeaponState.cards`, the co-op wire (coop.ts SnapItem.i) and the corpse
// drop are all `string` today, three of them across a serialisation boundary.
// Encoding keeps this change at "swap the lookup function"; an object model
// would be a rewrite of the loadout with a wire format to version.
//
// `CARDS[id]` keeps its meaning — the CATALOGUE, base defs only. Every site that
// can see a world card resolves through `cardDef(id)` instead.
// ═══════════════════════════════════════════════════════════════════════════

/** Level ceiling. At 10 a card carries ~2.08× its base delta, which is about
 * where the aggregate outruns what the enemy HP curve can absorb. */
export const CARD_LEVEL_MAX = 10;

/** Fraction of the card's BASE DELTA added per level above 1. */
export const CARD_LEVEL_STEP = 0.12;

/** A shiny's stat bonus, in the same delta-fraction units — worth ~2.5 levels.
 * Enough that a shiny is a pull; not so much that a shiny common beats a plain
 * epic, which would make rarity meaningless. */
export const SHINY_GROWTH = 0.3;

/** Base chance a dropped card is SHINY. Doubled off a boss, capped by
 * SHINY_CHANCE_MAX — roughly one per run or two. */
export const SHINY_CHANCE = 0.04;
export const SHINY_CHANCE_MAX = 0.12;

export interface CardInstance {
  base: CardId;
  level: number;
  shiny: boolean;
}

/** Split a world card id into its parts. Tolerant by design: anything that
 * doesn't parse (a bare catalogue id, a hand-typed dev id, a wire value from an
 * older peer) reads as level 1 plain rather than throwing. */
export function parseCard(id: CardId): CardInstance {
  const hash = id.indexOf("#");
  if (hash < 0) return { base: id, level: 1, shiny: false };
  const base = id.slice(0, hash);
  let suffix = id.slice(hash + 1);
  const shiny = suffix.endsWith("s");
  if (shiny) suffix = suffix.slice(0, -1);
  const level = Number.parseInt(suffix, 10);
  return {
    base,
    level: Number.isFinite(level) ? clampLevel(level) : 1,
    shiny,
  };
}

/** The catalogue id a world card is a copy of. Use this for anything keyed by
 * CARD KIND rather than by copy — `ITEM_PAINTS`, the bestiary, affinity. */
export function cardBase(id: CardId): CardId {
  const hash = id.indexOf("#");
  return hash < 0 ? id : id.slice(0, hash);
}

export function clampLevel(level: number): number {
  return Math.max(1, Math.min(CARD_LEVEL_MAX, Math.round(level)));
}

/**
 * Build a world card id. CANONICAL: a level-1 plain card collapses back to the
 * bare base id, so the game never holds two spellings of the same card — which
 * is what lets the haul screen stack by raw string equality.
 */
export function cardKey(base: CardId, level = 1, shiny = false): CardId {
  const lv = clampLevel(level);
  if (lv === 1 && !shiny) return base;
  return `${base}#${lv}${shiny ? "s" : ""}`;
}

/** Is this copy a shiny? Cheap enough for a render path. */
export function isShinyCard(id: CardId): boolean {
  return id.endsWith("s") && id.includes("#");
}

/** This copy's level (1 for a bare catalogue id). */
export function cardLevel(id: CardId): number {
  return id.includes("#") ? parseCard(id).level : 1;
}

/** How much of the base delta this copy carries. Level 1 plain = 1 (unchanged). */
export function cardGrowth(level: number, shiny: boolean): number {
  return 1 + CARD_LEVEL_STEP * (clampLevel(level) - 1) + (shiny ? SHINY_GROWTH : 0);
}

/** Multipliers rounded so float noise never reaches the card face. */
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Scale a modifier by `growth`.
 *
 * THE RULE: a level multiplies the card's DELTA FROM NEUTRAL, in BOTH
 * directions. A level-6 Hulk Knuckle is a bigger Hulk Knuckle — more damage AND
 * more cooldown penalty. Scaling only the upside would quietly launder every
 * drawback card (gladeath, bloodpact, hulkknuckle) into a strict upgrade, and
 * cards with real downsides are a design pillar here.
 */
export function scaleModifier(m: CardModifier, growth: number): CardModifier {
  if (growth === 1) return m;
  const out: CardModifier = {};
  // Integers never regress: at low growth `round(1 * 1.12)` is still 1, and a
  // levelled card that gave LESS pierce than its level-1 twin would be a bug.
  const scaleInt = (v: number): number => Math.max(v, Math.round(v * growth));
  const scaleMult = (v: number): number => r3(1 + (v - 1) * growth);

  if (m.damageFlat) out.damageFlat = scaleInt(m.damageFlat);
  if (m.damageMult) out.damageMult = scaleMult(m.damageMult);
  if (m.cooldownMult) {
    // Clamped both ways. An unclamped level-10 Time Ripper reaches 0.17, at
    // which point the swing animation stops reading as a swing at all.
    out.cooldownMult = Math.max(0.35, Math.min(2, scaleMult(m.cooldownMult)));
  }
  if (m.durabilityMult) out.durabilityMult = Math.max(0.05, scaleMult(m.durabilityMult));
  if (m.onHit) out.onHit = m.onHit;
  if (m.pinballMult) out.pinballMult = scaleMult(m.pinballMult);
  if (m.bolt) out.bolt = m.bolt;
  if (m.materialMult) out.materialMult = scaleMult(m.materialMult);
  if (m.critChance) out.critChance = Math.min(0.9, r3(m.critChance * growth));
  if (m.critMult) out.critMult = Math.min(6, scaleMult(m.critMult));
  if (m.lifesteal) out.lifesteal = scaleInt(m.lifesteal);
  if (m.pierce) out.pierce = scaleInt(m.pierce);
  return out;
}

/**
 * The card's effects as one sentence, generated from the modifier.
 *
 * The hand-written `description` ("+35% durability") becomes a LIE the moment a
 * card levels, and a card that misreports its own stats is worse than one with
 * no text at all. A level-1 plain card keeps its authored string — it reads
 * better — and every other copy gets this.
 */
export function describeModifier(m: CardModifier): string {
  const pct = (v: number): string => `${v > 1 ? "+" : "−"}${Math.round(Math.abs(v - 1) * 100)}%`;
  const parts: string[] = [];
  if (m.damageFlat) parts.push(`+${m.damageFlat} dmg`);
  if (m.damageMult && m.damageMult !== 1) parts.push(`${pct(m.damageMult)} damage`);
  // Cooldown reads inverted from every other multiplier — BELOW 1 is the good
  // outcome — so it says faster/slower instead of signing a bare percent.
  if (m.cooldownMult && m.cooldownMult !== 1) {
    parts.push(`${Math.round(Math.abs(1 - m.cooldownMult) * 100)}% ${m.cooldownMult < 1 ? "faster" : "slower"}`);
  }
  if (m.durabilityMult && m.durabilityMult !== 1) parts.push(`${pct(m.durabilityMult)} durability`);
  if (m.critChance) parts.push(`${Math.round(m.critChance * 100)}% CRIT (×${m.critMult ?? 2})`);
  if (m.lifesteal) parts.push(`heal ${m.lifesteal}/hit`);
  if (m.pierce) parts.push(`pierce +${m.pierce}`);
  if (m.onHit) parts.push(`hits ${m.onHit.toUpperCase()}`);
  if (m.bolt) parts.push("arcs a THUNDERBOLT");
  if (m.pinballMult && m.pinballMult > 1) parts.push(`×${r3(m.pinballMult)} on momentum`);
  if (m.materialMult && m.materialMult > 1) parts.push(`×${r3(m.materialMult)} on marble`);
  return parts.join(", ");
}

/** Derived defs are memoised — `paintCard` and the haul screen both resolve the
 * same id many times a frame and the scaling is pure. */
const _instanceDefs = new Map<CardId, CardDef>();

/**
 * THE LOOKUP for a card that came out of the world.
 *
 * Returns the catalogue def unchanged for a plain level-1 card, and a derived
 * def (scaled modifier, generated description, level/shiny/base set) for a
 * levelled or shiny copy. Undefined for an id whose BASE isn't in the catalogue,
 * which is the same contract `CARDS[id]` had.
 */
export function cardDef(id: CardId): CardDef | undefined {
  const direct = CARDS[id];
  if (direct) return direct;
  const cached = _instanceDefs.get(id);
  if (cached) return cached;
  const { base, level, shiny } = parseCard(id);
  const def = CARDS[base];
  if (!def) return undefined;
  const modifier = scaleModifier(def.modifier, cardGrowth(level, shiny));
  const derived: CardDef = {
    ...def,
    id,
    base,
    level,
    shiny,
    modifier,
    description: describeModifier(modifier) || def.description,
  };
  _instanceDefs.set(id, derived);
  return derived;
}

/**
 * Roll THIS drop's level off the floor it dropped on — the "cards get better as
 * you go deeper" rule. Floors 1-2 hand out level 1s with the occasional 2;
 * floor 19 hands out 9s and 10s, so the same monster's card is a genuinely
 * different card at depth.
 */
export function rollCardLevel(floor: number, rand: () => number = Math.random): number {
  const base = 1 + Math.floor((Math.max(1, floor) - 1) / 2);
  const r = rand();
  const lv = r < 0.2 ? base - 1 : r < 0.75 ? base : r < 0.95 ? base + 1 : base + 2;
  return clampLevel(lv);
}

/** Roll whether this drop is a shiny. Bosses pay double. */
export function rollShiny(boss = false, rand: () => number = Math.random): boolean {
  return rand() < Math.min(SHINY_CHANCE_MAX, SHINY_CHANCE * (boss ? 2 : 1));
}

/**
 * A dungeon drop, level and shine included.
 *
 * Deliberately a WRAPPER rather than folding the rolls into `rollCardDrop`:
 * that function's rand-stream ordering is pinned by cards.test.ts against a
 * rate-inflation regression (drawing a value before the gates shifts which
 * kills drop). Here the level/shiny draws happen strictly AFTER the gates have
 * already decided a card drops, so the drop RATE is untouched by construction.
 */
export function rollCardInstance(
  opts: Parameters<typeof rollCardDrop>[0],
  rand: () => number = Math.random,
): CardId | null {
  const base = rollCardDrop(opts, rand);
  if (!base) return null;
  return cardKey(base, rollCardLevel(opts.floor, rand), rollShiny(!!opts.boss, rand));
}

/** Re-key a card to a different BASE, keeping this copy's level and shine. Used
 * by the tavern reroll and the un-socket tier drop: you paid to change WHICH
 * card it is, not to lose the level you earned. */
export function reKeyCard(id: CardId, newBase: CardId): CardId {
  const { level, shiny } = parseCard(id);
  return cardKey(newBase, level, shiny);
}

/** The combined effect of every socketed card (order-independent). */
export interface CardAggregate {
  damageFlat: number;
  damageMult: number;
  cooldownMult: number;
  durabilityMult: number;
  chill: boolean;
  burn: boolean;
  pinballMult: number; // 1 = none; only applied while riding momentum
  bolt: boolean; // any socketed card arcs a thunderbolt on hit
  materialMult: number; // 1 = none; only applied while a marble material is active
  critChance: number; // 0..1, summed then capped
  critMult: number; // crit damage × (max across sockets)
  lifesteal: number; // HP restored per hit, summed
  pierce: number; // extra ranged pass-throughs, summed
}

export function aggregateCards(cards: CardId[] | undefined): CardAggregate {
  const agg: CardAggregate = {
    damageFlat: 0, damageMult: 1, cooldownMult: 1, durabilityMult: 1, chill: false, burn: false, pinballMult: 1, bolt: false,
    materialMult: 1, critChance: 0, critMult: 2, lifesteal: 0, pierce: 0,
  };
  if (!cards) return agg;
  // The single strongest card per softened field — see softenAggregate. Tracked
  // during the fold so the exemption reads off the same `cardDef` (levelled)
  // values the aggregate does.
  const best = { damage: 1, pinball: 1, material: 1 };
  for (const id of cards) {
    // cardDef, not CARDS — a socketed card carries its own LEVEL, and folding
    // the base modifier here would silently throw away every level the player
    // earned the moment they socketed the card.
    const m = cardDef(id)?.modifier;
    if (!m) continue;
    if (m.damageFlat) agg.damageFlat += m.damageFlat;
    if (m.damageMult) {
      agg.damageMult *= m.damageMult;
      best.damage = Math.max(best.damage, m.damageMult);
    }
    if (m.cooldownMult) agg.cooldownMult *= m.cooldownMult;
    if (m.durabilityMult) agg.durabilityMult *= m.durabilityMult;
    if (m.onHit === "chill") agg.chill = true;
    if (m.onHit === "burn") agg.burn = true;
    if (m.pinballMult) {
      agg.pinballMult *= m.pinballMult;
      best.pinball = Math.max(best.pinball, m.pinballMult);
    }
    if (m.bolt) agg.bolt = true;
    if (m.materialMult) {
      agg.materialMult *= m.materialMult;
      best.material = Math.max(best.material, m.materialMult);
    }
    if (m.critChance) agg.critChance += m.critChance;
    if (m.critMult) agg.critMult = Math.max(agg.critMult, m.critMult);
    if (m.lifesteal) agg.lifesteal += m.lifesteal;
    if (m.pierce) agg.pierce += m.pierce;
  }
  // ── SET BONUSES ── committing 2+ cards of a family resonates (a real choice
  // with only 3 slots). Counted after the fold so it reads off the same cards.
  let bolt = 0;
  let crit = 0;
  let material = 0;
  for (const id of cards) {
    const m = cardDef(id)?.modifier;
    if (!m) continue;
    if (m.bolt) bolt++;
    if (m.critChance) crit++;
    if (m.materialMult) material++;
  }
  if (bolt >= 2) agg.damageMult *= 1.25; // STORM set: the arcs resonate
  if (crit >= 2) agg.critMult += 0.5; // ASSASSIN set: deeper crits
  if (material >= 2) agg.materialMult *= 1.3; // ATTUNED set: stronger synergy
  agg.critChance = Math.min(1, agg.critChance);
  return softenAggregate(agg, best);
}

/**
 * TWO-BUCKET STAT MATH — the diminishing-returns pass every aggregate goes
 * through on its way out.
 *
 * Sockets multiply raw: four +30% damage cards used to be a flat 2.86×, and
 * the same four at card level 10 (`CARD_LEVEL_STEP` scales each delta) close
 * on 6×. That is the shape that makes card systems explode, and it is the one
 * failure mode every reference game in `docs/game-dev-rules/game-research/`
 * independently guarded against: farmable bonuses go through a CONCAVE curve,
 * and un-curved multiplication is reserved for slot-limited structures.
 *
 * So the STACK is folded through the same hyperbolic curve `momentumT` uses —
 * the house diminishing-returns shape:
 *
 *   effective = best × soften(raw / best)
 *   soften(x) = 1 + over / (1 + over/CAP)      where over = x − 1
 *
 * Note what is divided out first: the single BEST card in the socket keeps its
 * printed value exactly, and only what the others pile on top of it bends. That
 * is not a rounding detail, it is the contract — `describeModifier` regenerates
 * every card's text from its own modifier, so a card that reads "+50% while a
 * marble rides" and then quietly delivered +44% would be the card lying about
 * itself, which is precisely what the card-level system was built to prevent.
 * One card does what it says. Four cards do not do four times what one says.
 *
 * Two +20% cards land at ×1.43 instead of ×1.44; four +30% cards at ×2.50
 * instead of ×2.86; the level-10 version of that same set at ×4.4 instead of
 * ×6.6. The stack can approach best×5 but never reach it, so no future card,
 * level, shine or set bonus can make this run away — the same structural
 * argument as the booster corner-jam fix: a curve that cannot exceed its
 * asymptote beats a guard that tries to catch a number after it has blown up.
 *
 * Two rules it deliberately does NOT apply:
 *  · PENALTIES STAY LINEAR. A drawback below 1× bites at full value (a level-10
 *    drawback card is SUPPOSED to hurt more — `scaleModifier` scales deltas in
 *    both directions on purpose). Softening downsides would quietly delete the
 *    cost half of every trade-off card.
 *  · Set bonuses run BEFORE this, so their multiplier bends with the stack. A
 *    set bonus is a reward for committing sockets, not an exemption from the
 *    rule that committing sockets has diminishing returns.
 */
export const CARD_STACK_SOFT_CAP = 4; // the pile-on approaches +400% of the best card, never reaches it

function soften(raw: number): number {
  if (raw <= 1) return raw; // penalties and neutral values pass through untouched
  const over = raw - 1;
  return 1 + over / (1 + over / CARD_STACK_SOFT_CAP);
}

/** `best × soften(raw/best)` — the best single card is exempt, the pile bends. */
function softenStack(raw: number, best: number): number {
  if (raw <= 1 || best <= 1) return raw;
  return best * soften(raw / best);
}

function softenAggregate(agg: CardAggregate, best: { damage: number; pinball: number; material: number }): CardAggregate {
  agg.damageMult = softenStack(agg.damageMult, best.damage);
  agg.pinballMult = softenStack(agg.pinballMult, best.pinball);
  agg.materialMult = softenStack(agg.materialMult, best.material);
  // critMult takes the MAX across sockets rather than a product, so it is
  // already self-limiting; cooldownMult and durabilityMult are inverted
  // (lower is better) and clamped by `scaleModifier` at the card level.
  return agg;
}

/** Does a card fit a weapon of this kind? */
export function cardFitsKind(card: CardId, kind: WeaponKind): boolean {
  const wk = cardDef(card)?.weaponKinds;
  return wk === "both" || wk === kind;
}

/**
 * Socket a card into a weapon if it fits its kind and has a free slot. Tops up
 * the weapon's durability when the card boosts max durability. Returns whether
 * it socketed. Pure (mutates the given WeaponState only) — shared by the pickup
 * path and the Tavern armory.
 */
export function socketCard(w: WeaponState, id: CardId): boolean {
  if (!cardDef(id) || !cardFitsKind(id, WEAPONS[w.id].kind)) return false;
  const cards = w.cards ?? (w.cards = []);
  if (cards.length >= weaponSlotCount(w)) return false;
  const before = aggregateCards(cards).durabilityMult;
  cards.push(id);
  const after = aggregateCards(cards).durabilityMult;
  if (after > before && Number.isFinite(w.durability)) {
    w.durability += Math.round(WEAPONS[w.id].maxDurability * (after - before));
  }
  return true;
}

/** One rarity tier lower (for the un-socket respec cost); null if already common. */
export function lowerRarity(r: CardRarity): CardRarity | null {
  return r === "mythic" ? "legendary" : r === "legendary" ? "epic" : r === "epic" ? "rare" : r === "rare" ? "common" : null;
}

/** Cards that are the essence of a given monster (see CardDef.source). */
export function cardsOfSource(kind: EnemyKind): CardId[] {
  return CARD_IDS.filter((id) => CARDS[id].source === kind);
}

/**
 * How often an affinity-eligible drop comes from the slain monster's OWN pool
 * rather than the rarity pool at large. High enough that farming a specific
 * monster for its card is a real strategy, low enough that you still see the
 * rest of the table.
 */
export const AFFINITY_CHANCE = 0.7;

/** Base chance any kill drops a common card. Cards must stay RARE, and this is
 * the number that keeps them so — exported so the tests can pin it. */
export const COMMON_DROP_CHANCE = 0.08;

/**
 * MYTHIC — the top of the table, and until now UNREACHABLE from play.
 *
 * `rollCardDrop` had branches for legendary/epic/rare/common and none for
 * mythic, so the five mythics existed only on the tavern's 1% shelf roll at
 * 600g. Measured over 200k best-case boss rolls (boss + gold wall + floor 20 +
 * legendary allowed): 0 mythics in 167,830 drops. A whole rarity tier was dead
 * content you could finish a run without ever seeing.
 *
 * Deliberately rarer and DEEPER than legendary — it sits above it in the same
 * once-per-run shape, so the tier reads as "the run-defining pull" rather than
 * a second legendary.
 */
export const MYTHIC_FLOOR = 10; // boss floors are every 5th, so this is boss #2+
export const MYTHIC_CHANCE = 0.18;

/**
 * Roll a card drop for a slain enemy (or a smashed gold secret). Rates per the
 * design: common from anything, rare from bosses, epic from bosses/gold walls,
 * legendary once per run from a deep boss, mythic once per run from a DEEPER
 * boss. Returns a CardId or null.
 *
 * AFFINITY: when `kind` is given, a dropping card is AFFINITY_CHANCE likely to be
 * one of THAT monster's own cards (CardDef.source) at the rarity the gates
 * already chose. Affinity decides WHICH card, never WHETHER one drops.
 *
 * `dropMult` scales only the COMMON gate, carrying the zombie SUB-TYPE's loot
 * weight (zombie-types.ts typeDropMult) so a hulk out-drops a midget. The boss
 * rarities are deliberately NOT scaled — those are milestone rewards, not grind.
 *
 * `rand` is injectable so the drop is testable; defaults to Math.random.
 */
export function rollCardDrop(
  opts: {
    boss?: boolean;
    goldWall?: boolean;
    floor: number;
    legendaryAllowed?: boolean;
    /** False once this run has already dropped its one mythic. */
    mythicAllowed?: boolean;
    kind?: EnemyKind;
    /** Zombie SUB-TYPE of the slain foe, when it had one (zombie-types.ts). */
    subType?: ZombieType;
    dropMult?: number;
    /**
     * Bestiary earn, as a multiplier on AFFINITY_CHANCE (1 = unearned). From
     * `familyAffinity(killsByKind[kind])` — see the pick below for why it is
     * taken here and not anywhere earlier.
     */
    affinity?: number;
  },
  rand: () => number = Math.random,
): CardId | null {
  /**
   * Pick from the slain monster's OWN cards at this rarity when affinity wins the
   * coin-flip and that monster has one; otherwise from the rarity pool at large.
   *
   * The affinity `rand()` is drawn INSIDE the pick — i.e. only once a drop has
   * already been decided by the gates below. Drawing it any earlier would shift
   * the random stream the gates see and change the drop RATE as a side effect,
   * which is the one failure mode this design exists to avoid. `cards.test.ts`
   * pins the rate against exactly that regression.
   *
   * The bestiary earn (`opts.affinity`) is applied HERE, as a multiplier on the
   * THRESHOLD — never as an extra draw and never a step earlier. That is what
   * keeps the trap shut: the number of `rand()` calls and their positions are
   * identical whether the multiplier is 1 or 2, so farming a family can only
   * change WHICH card lands, never WHETHER one does. Clamped to 1 because
   * AFFINITY_CHANCE 0.7 × BESTIARY_AFFINITY_MAX 2 = 1.4, and a comparison
   * against a threshold above 1 is a certainty wearing a probability's clothes.
   */
  const affinityChance = Math.min(1, AFFINITY_CHANCE * (opts.affinity ?? 1));
  const pick = (pool: CardId[]): CardId => {
    if (opts.kind) {
      // SUB-TYPE first: a Hulk should drop the Hulk card, not just "a zombie
      // card". Falls back to the family pool when this kind has no sub-typed
      // card at this rarity (every non-zombie, and any rarity a sub-type
      // doesn't appear at).
      const sub = opts.subType
        ? pool.filter((id) => CARDS[id].source === opts.kind && CARDS[id].subType === opts.subType)
        : [];
      if (sub.length > 0 && rand() < affinityChance) return sub[Math.floor(rand() * sub.length)];
      // Family match, excluding cards that belong to a DIFFERENT sub-type — a
      // Midget must never hand you the Hulk card just for being a zombie.
      const own = pool.filter(
        (id) => CARDS[id].source === opts.kind && (!CARDS[id].subType || CARDS[id].subType === opts.subType),
      );
      if (own.length > 0 && rand() < affinityChance) return own[Math.floor(rand() * own.length)];
    }
    // NON-AFFINITY fallback. A sub-typed card must never arrive from a monster
    // that is not that sub-type — a Hulk handing you the Midget card breaks the
    // one promise the whole system makes ("farm THIS thing for THIS card"), and
    // the affinity branches above are not enough on their own because this line
    // is reached ~30% of the time by design. Foreign sub-type cards are simply
    // not in the pool for this kill.
    const eligible = pool.filter((id) => {
      const st = CARDS[id].subType;
      return !st || (CARDS[id].source === opts.kind && st === opts.subType);
    });
    const from = eligible.length > 0 ? eligible : pool;
    return from[Math.floor(rand() * from.length)];
  };
  // Mythic: once per run, only from a DEEP boss, and rarer than legendary.
  // Checked FIRST so the top tier isn't shadowed by the legendary branch
  // consuming the same boss roll.
  if (opts.boss && opts.floor >= MYTHIC_FLOOR && opts.mythicAllowed && rand() < MYTHIC_CHANCE) {
    return pick(cardsOfRarity("mythic"));
  }
  // Legendary: once per run, only from a floor-5+ boss.
  if (opts.boss && opts.floor >= 5 && opts.legendaryAllowed && rand() < 0.5) {
    return pick(cardsOfRarity("legendary"));
  }
  // Epic: from a boss or the gold secret wall.
  if ((opts.boss || opts.goldWall) && rand() < 0.3) {
    return pick(cardsOfRarity("epic"));
  }
  // Rare: from a boss.
  if (opts.boss && rand() < 0.5) {
    return pick(cardsOfRarity("rare"));
  }
  // Common: any enemy, ~8%, weighted by the sub-type's loot multiplier and
  // clamped so a big multiplier can never make a "rare" drop a certainty.
  if (rand() < Math.min(0.5, COMMON_DROP_CHANCE * (opts.dropMult ?? 1))) {
    return pick(cardsOfRarity("common"));
  }
  return null;
}
