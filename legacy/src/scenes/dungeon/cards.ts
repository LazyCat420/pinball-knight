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
  for (const id of cards) {
    const m = CARDS[id]?.modifier;
    if (!m) continue;
    if (m.damageFlat) agg.damageFlat += m.damageFlat;
    if (m.damageMult) agg.damageMult *= m.damageMult;
    if (m.cooldownMult) agg.cooldownMult *= m.cooldownMult;
    if (m.durabilityMult) agg.durabilityMult *= m.durabilityMult;
    if (m.onHit === "chill") agg.chill = true;
    if (m.onHit === "burn") agg.burn = true;
    if (m.pinballMult) agg.pinballMult *= m.pinballMult;
    if (m.bolt) agg.bolt = true;
    if (m.materialMult) agg.materialMult *= m.materialMult;
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
    const m = CARDS[id]?.modifier;
    if (!m) continue;
    if (m.bolt) bolt++;
    if (m.critChance) crit++;
    if (m.materialMult) material++;
  }
  if (bolt >= 2) agg.damageMult *= 1.25; // STORM set: the arcs resonate
  if (crit >= 2) agg.critMult += 0.5; // ASSASSIN set: deeper crits
  if (material >= 2) agg.materialMult *= 1.3; // ATTUNED set: stronger synergy
  agg.critChance = Math.min(1, agg.critChance);
  return agg;
}

/** Does a card fit a weapon of this kind? */
export function cardFitsKind(card: CardId, kind: WeaponKind): boolean {
  const wk = CARDS[card]?.weaponKinds;
  return wk === "both" || wk === kind;
}

/**
 * Socket a card into a weapon if it fits its kind and has a free slot. Tops up
 * the weapon's durability when the card boosts max durability. Returns whether
 * it socketed. Pure (mutates the given WeaponState only) — shared by the pickup
 * path and the Tavern armory.
 */
export function socketCard(w: WeaponState, id: CardId): boolean {
  if (!cardFitsKind(id, WEAPONS[w.id].kind)) return false;
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
   */
  const pick = (pool: CardId[]): CardId => {
    if (opts.kind) {
      // SUB-TYPE first: a Hulk should drop the Hulk card, not just "a zombie
      // card". Falls back to the family pool when this kind has no sub-typed
      // card at this rarity (every non-zombie, and any rarity a sub-type
      // doesn't appear at).
      const sub = opts.subType
        ? pool.filter((id) => CARDS[id].source === opts.kind && CARDS[id].subType === opts.subType)
        : [];
      if (sub.length > 0 && rand() < AFFINITY_CHANCE) return sub[Math.floor(rand() * sub.length)];
      // Family match, excluding cards that belong to a DIFFERENT sub-type — a
      // Midget must never hand you the Hulk card just for being a zombie.
      const own = pool.filter(
        (id) => CARDS[id].source === opts.kind && (!CARDS[id].subType || CARDS[id].subType === opts.subType),
      );
      if (own.length > 0 && rand() < AFFINITY_CHANCE) return own[Math.floor(rand() * own.length)];
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
