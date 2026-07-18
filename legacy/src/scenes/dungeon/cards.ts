/**
 * CARDS — weapon modifier chips that socket into a weapon's card slots.
 *
 * A card is NOT an item you equip standalone; it slots into an equipped weapon
 * (WeaponState.cards, bounded by WeaponDef.cardSlots) and changes how that
 * weapon resolves damage. Four rarities scale the power. Effects come in three
 * flavours, all resolved centrally so any weapon benefits:
 *   - STAT   : flat/percent damage, cooldown, durability (aggregateCards).
 *   - ON-HIT : a status stamped on the struck enemy (chill = slow, burn = DoT).
 *   - PINBALL: a bonus that only fires while you're carrying pinball momentum
 *              (the hybrid-identity synergy — reads player.momSpeed at the site).
 *
 * DOM- and three-free so the aggregation math is unit-tested.
 */
import { WEAPONS, weaponSlotCount, type WeaponKind, type WeaponState } from "./items";

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
}

export const RARITY_HEX: Record<CardRarity, string> = {
  common: "#9aa4b4",
  rare: "#4f8fdb",
  epic: "#a46fe8",
  legendary: "#f0a63c",
  mythic: "#ff77e9",
};

export const CARDS: Record<CardId, CardDef> = {
  // ── Common (grey) ──
  bloodedge: { id: "bloodedge", label: "Blood Edge", icon: "🩸", rarity: "common", weaponKinds: "both", description: "+1 damage", modifier: { damageFlat: 1 } },
  sharpened: { id: "sharpened", label: "Sharpened", icon: "🔪", rarity: "common", weaponKinds: "both", description: "−15% cooldown", modifier: { cooldownMult: 0.85 } },
  tempered: { id: "tempered", label: "Tempered", icon: "⚒️", rarity: "common", weaponKinds: "both", description: "+50% durability", modifier: { durabilityMult: 1.5 } },
  frostchip: { id: "frostchip", label: "Frost Chip", icon: "❄️", rarity: "common", weaponKinds: "both", description: "hits CHILL: slow the enemy", modifier: { onHit: "chill" } },
  // ── Rare (blue) ──
  keenedge: { id: "keenedge", label: "Keen Edge", icon: "⚔️", rarity: "rare", weaponKinds: "both", description: "+30% damage", modifier: { damageMult: 1.3 } },
  embercore: { id: "embercore", label: "Ember Core", icon: "🔥", rarity: "rare", weaponKinds: "both", description: "hits BURN over time", modifier: { onHit: "burn" } },
  momentumstrike: { id: "momentumstrike", label: "Momentum Strike", icon: "🪩", rarity: "rare", weaponKinds: "melee", description: "+60% damage while riding momentum", modifier: { pinballMult: 1.6 } },
  reinforced: { id: "reinforced", label: "Reinforced", icon: "🛠️", rarity: "rare", weaponKinds: "both", description: "+1 dmg, +100% durability", modifier: { damageFlat: 1, durabilityMult: 2 } },
  // ── Epic (purple) ──
  executioner: { id: "executioner", label: "Executioner", icon: "🪓", rarity: "epic", weaponKinds: "both", description: "+60% damage", modifier: { damageMult: 1.6 } },
  frostbite: { id: "frostbite", label: "Frostbite", icon: "🧊", rarity: "epic", weaponKinds: "both", description: "+25% dmg and hits CHILL", modifier: { damageMult: 1.25, onHit: "chill" } },
  quickblade: { id: "quickblade", label: "Quickblade", icon: "🌀", rarity: "epic", weaponKinds: "both", description: "−30% cooldown, +1 dmg", modifier: { cooldownMult: 0.7, damageFlat: 1 } },
  // ── Legendary (gold) ──
  pinballwizard: { id: "pinballwizard", label: "Pinball Wizard", icon: "🎰", rarity: "legendary", weaponKinds: "both", description: "+40% dmg, DOUBLE while riding momentum", modifier: { damageMult: 1.4, pinballMult: 2 } },
  soulreaver: { id: "soulreaver", label: "Soul Reaver", icon: "💀", rarity: "legendary", weaponKinds: "both", description: "+2 dmg, +50% dmg, hits BURN", modifier: { damageFlat: 2, damageMult: 1.5, onHit: "burn" } },
  // ── Mythic (iridescent) — build-defining chase cards, sold only at the Tavern ──
  worldbreaker: { id: "worldbreaker", label: "World Breaker", icon: "🌋", rarity: "mythic", weaponKinds: "both", description: "+2 dmg, +75% dmg, hits BURN", modifier: { damageFlat: 2, damageMult: 1.75, onHit: "burn" } },
  timeripper: { id: "timeripper", label: "Time Ripper", icon: "⏳", rarity: "mythic", weaponKinds: "both", description: "−40% cooldown, +60% dmg, DOUBLE on momentum", modifier: { cooldownMult: 0.6, damageMult: 1.6, pinballMult: 2 } },
};

export const CARD_IDS: CardId[] = Object.keys(CARDS);

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
}

export function aggregateCards(cards: CardId[] | undefined): CardAggregate {
  const agg: CardAggregate = { damageFlat: 0, damageMult: 1, cooldownMult: 1, durabilityMult: 1, chill: false, burn: false, pinballMult: 1 };
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
  }
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

/**
 * Roll a card drop for a slain enemy (or a smashed gold secret). Rates per the
 * design: common from anything, rare from bosses, epic from bosses/gold walls,
 * legendary once per run from a deep boss. Returns a CardId or null.
 *
 * `rand` is injectable so the drop is testable; defaults to Math.random.
 */
export function rollCardDrop(
  opts: { boss?: boolean; goldWall?: boolean; floor: number; legendaryAllowed?: boolean },
  rand: () => number = Math.random,
): CardId | null {
  const pick = (pool: CardId[]): CardId => pool[Math.floor(rand() * pool.length)];
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
  // Common: any enemy, ~8%.
  if (rand() < 0.08) {
    return pick(cardsOfRarity("common"));
  }
  return null;
}
