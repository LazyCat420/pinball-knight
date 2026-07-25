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
import type { EnemyKind } from "./state";
import type { AbilityId } from "./abilities";

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
  /**
   * SKILL CARD — socketing this GRANTS an active Q/E ability while the weapon is
   * HELD. Same AbilityId space the skill tree unlocks (skills.ts unlockAbility),
   * merged in the one `unlockedAbilities()` funnel so there is still a single
   * answer to "what can I cast".
   *
   * Held-weapon-scoped on purpose: swapping weapons swaps your ability loadout,
   * which is what makes the second weapon slot a real decision instead of a
   * spare damage stat.
   */
  grantsAbility?: AbilityId;
  /** Ability MANA cost multiplier (<1 = cheaper). Multiplied across sockets. */
  abilityCostMult?: number;
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
  bloodedge: { id: "bloodedge", label: "Blood Edge", icon: "🩸", rarity: "common", weaponKinds: "both", description: "+1 damage", source: "zombie", modifier: { damageFlat: 1 } },
  sharpened: { id: "sharpened", label: "Sharpened", icon: "🔪", rarity: "common", weaponKinds: "both", description: "−15% cooldown", source: "goblin", modifier: { cooldownMult: 0.85 } },
  tempered: { id: "tempered", label: "Tempered", icon: "⚒️", rarity: "common", weaponKinds: "both", description: "+50% durability", source: "golem", modifier: { durabilityMult: 1.5 } },
  frostchip: { id: "frostchip", label: "Frost Chip", icon: "❄️", rarity: "common", weaponKinds: "both", description: "hits CHILL: slow the enemy", source: "ghost", modifier: { onHit: "chill" } },
  // ── Rare (blue) ──
  keenedge: { id: "keenedge", label: "Keen Edge", icon: "⚔️", rarity: "rare", weaponKinds: "both", description: "+30% damage", source: "hound", modifier: { damageMult: 1.3 } },
  embercore: { id: "embercore", label: "Ember Core", icon: "🔥", rarity: "rare", weaponKinds: "both", description: "hits BURN over time", source: "bloater", modifier: { onHit: "burn" } },
  momentumstrike: { id: "momentumstrike", label: "Momentum Strike", icon: "🪩", rarity: "rare", weaponKinds: "melee", description: "+60% damage while riding momentum", source: "pin", modifier: { pinballMult: 1.6 } },
  reinforced: { id: "reinforced", label: "Reinforced", icon: "🛠️", rarity: "rare", weaponKinds: "both", description: "+1 dmg, +100% durability", source: "golem", modifier: { damageFlat: 1, durabilityMult: 2 } },
  // ── Epic (purple) ──
  executioner: { id: "executioner", label: "Executioner", icon: "🪓", rarity: "epic", weaponKinds: "both", description: "+60% damage", source: "brute", modifier: { damageMult: 1.6 } },
  frostbite: { id: "frostbite", label: "Frostbite", icon: "🧊", rarity: "epic", weaponKinds: "both", description: "+25% dmg and hits CHILL", source: "ghost", modifier: { damageMult: 1.25, onHit: "chill" } },
  quickblade: { id: "quickblade", label: "Quickblade", icon: "🌀", rarity: "epic", weaponKinds: "both", description: "−30% cooldown, +1 dmg", source: "bat", modifier: { cooldownMult: 0.7, damageFlat: 1 } },
  stormchain: { id: "stormchain", label: "Storm Chain", icon: "⚡", rarity: "epic", weaponKinds: "both", description: "hits arc a THUNDERBOLT through foes ahead", source: "wisp", modifier: { bolt: true } },
  // ── Legendary (gold) ──
  pinballwizard: { id: "pinballwizard", label: "Pinball Wizard", icon: "🎰", rarity: "legendary", weaponKinds: "both", description: "+40% dmg, DOUBLE while riding momentum", source: "pin", modifier: { damageMult: 1.4, pinballMult: 2 } },
  soulreaver: { id: "soulreaver", label: "Soul Reaver", icon: "💀", rarity: "legendary", weaponKinds: "both", description: "+2 dmg, +50% dmg, hits BURN", source: "reaper", modifier: { damageFlat: 2, damageMult: 1.5, onHit: "burn" } },
  thunderlord: { id: "thunderlord", label: "Thunderlord", icon: "🌩️", rarity: "legendary", weaponKinds: "both", description: "+40% dmg, hits arc a THUNDERBOLT ahead", source: "wisp", modifier: { damageMult: 1.4, bolt: true } },
  // ── Mythic (iridescent) — build-defining chase cards: the Tavern shelf, or a floor-10+ boss ──
  worldbreaker: { id: "worldbreaker", label: "World Breaker", icon: "🌋", rarity: "mythic", weaponKinds: "both", description: "+2 dmg, +75% dmg, hits BURN", modifier: { damageFlat: 2, damageMult: 1.75, onHit: "burn" } },
  timeripper: { id: "timeripper", label: "Time Ripper", icon: "⏳", rarity: "mythic", weaponKinds: "both", description: "−40% cooldown, +60% dmg, DOUBLE on momentum", modifier: { cooldownMult: 0.6, damageMult: 1.6, pinballMult: 2 } },
  tempestcrown: { id: "tempestcrown", label: "Tempest Crown", icon: "🌀", rarity: "mythic", weaponKinds: "both", description: "+50% dmg, hits BURN and arc a THUNDERBOLT", modifier: { damageMult: 1.5, onHit: "burn", bolt: true } },

  // ══ EXPANSION — weapon-kind identity ══
  rapidfire: { id: "rapidfire", label: "Rapid Fire", icon: "🔫", rarity: "rare", weaponKinds: "ranged", description: "−40% cooldown (ranged)", source: "webspinner", modifier: { cooldownMult: 0.6 } },
  cleaver: { id: "cleaver", label: "Cleaver", icon: "🪒", rarity: "rare", weaponKinds: "melee", description: "+50% damage (melee)", source: "brute", modifier: { damageMult: 1.5 } },
  gluttony: { id: "gluttony", label: "Gluttony", icon: "🍖", rarity: "epic", weaponKinds: "both", description: "+3 flat damage", source: "chomper", modifier: { damageFlat: 3 } },

  // ══ EXPANSION — MARBLE SYNERGY (bonus while a material is active) ══
  elementalist: { id: "elementalist", label: "Elementalist", icon: "🔷", rarity: "rare", weaponKinds: "both", description: "+40% dmg while a MARBLE is active", source: "crystalback", modifier: { materialMult: 1.4 } },
  overcharged: { id: "overcharged", label: "Overcharged", icon: "🌈", rarity: "epic", weaponKinds: "both", description: "+85% dmg while a MARBLE is active", source: "crystalback", modifier: { materialMult: 1.85 } },
  attunement: { id: "attunement", label: "Attunement", icon: "🪬", rarity: "legendary", weaponKinds: "both", description: "+30% dmg always, +60% more while a MARBLE is active", source: "crystalback", modifier: { damageMult: 1.3, materialMult: 1.6 } },

  // ══ EXPANSION — CRIT / LIFESTEAL / PIERCE (Phase 2) ══
  keenmind: { id: "keenmind", label: "Keen Mind", icon: "🎯", rarity: "rare", weaponKinds: "both", description: "20% chance to CRIT (×2)", source: "spider", modifier: { critChance: 0.2 } },
  assassin: { id: "assassin", label: "Assassin", icon: "🗡️", rarity: "epic", weaponKinds: "both", description: "30% CRIT for ×2.5", source: "spider", modifier: { critChance: 0.3, critMult: 2.5 } },
  deathmark: { id: "deathmark", label: "Death Mark", icon: "☠️", rarity: "legendary", weaponKinds: "both", description: "40% CRIT for ×3, +25% dmg", source: "reaper", modifier: { critChance: 0.4, critMult: 3, damageMult: 1.25 } },
  leech: { id: "leech", label: "Leech", icon: "🧛", rarity: "rare", weaponKinds: "both", description: "heal 1 HP per hit", source: "bat", modifier: { lifesteal: 1 } },
  vampiricedge: { id: "vampiricedge", label: "Vampiric Edge", icon: "🦇", rarity: "epic", weaponKinds: "both", description: "heal 1 HP per hit, +25% dmg", source: "bat", modifier: { lifesteal: 1, damageMult: 1.25 } },
  piercer: { id: "piercer", label: "Piercer", icon: "➷", rarity: "rare", weaponKinds: "ranged", description: "shots pierce 2 extra foes", source: "spitter", modifier: { pierce: 2 } },
  railgun: { id: "railgun", label: "Railgun", icon: "🎇", rarity: "legendary", weaponKinds: "ranged", description: "shots pierce 5 foes, +40% dmg", source: "spitter", modifier: { pierce: 5, damageMult: 1.4 } },

  // ══ EXPANSION — CURSED (Phase 4): huge upside, real drawback ══
  gladeath: { id: "gladeath", label: "Glass Cannon", icon: "🩻", rarity: "mythic", weaponKinds: "both", description: "+120% dmg, but −60% durability", modifier: { damageMult: 2.2, durabilityMult: 0.4 } },
  bloodpact: { id: "bloodpact", label: "Blood Pact", icon: "🖤", rarity: "mythic", weaponKinds: "both", description: "50% CRIT ×3 and heal 1/hit, but −40% durability", modifier: { critChance: 0.5, critMult: 3, lifesteal: 1, durabilityMult: 0.6 } },

  // ══ MONSTER ESSENCE — one card per otherwise-uncovered kind ══
  // The point of `source` is that every monster is worth hunting for something.
  // These fill the kinds the original table left with no card of their own.
  spidersilk: { id: "spidersilk", label: "Spider Silk", icon: "🕸️", rarity: "common", weaponKinds: "both", description: "−10% cooldown, +25% durability", source: "spider", modifier: { cooldownMult: 0.9, durabilityMult: 1.25 } },
  slimecoat: { id: "slimecoat", label: "Slime Coat", icon: "🟢", rarity: "common", weaponKinds: "both", description: "+35% durability", source: "slime", modifier: { durabilityMult: 1.35 } },
  houndfang: { id: "houndfang", label: "Hound Fang", icon: "🐺", rarity: "rare", weaponKinds: "both", description: "+35% damage while riding momentum", source: "hound", modifier: { pinballMult: 1.35 } },
  wardenplate: { id: "wardenplate", label: "Warden Plate", icon: "🛡️", rarity: "rare", weaponKinds: "both", description: "+1 dmg, +150% durability", source: "warden", modifier: { damageFlat: 1, durabilityMult: 2.5 } },
  magnetcore: { id: "magnetcore", label: "Magnet Core", icon: "🧲", rarity: "rare", weaponKinds: "both", description: "+20% dmg while a MARBLE is active, −10% cooldown", source: "magnet", modifier: { materialMult: 1.2, cooldownMult: 0.9 } },
  sapperfuse: { id: "sapperfuse", label: "Sapper Fuse", icon: "🧨", rarity: "epic", weaponKinds: "both", description: "+35% dmg, hits BURN", source: "sapper", modifier: { damageMult: 1.35, onHit: "burn" } },
  mimicjaw: { id: "mimicjaw", label: "Mimic Jaw", icon: "🪤", rarity: "epic", weaponKinds: "both", description: "25% CRIT for ×2.75", source: "mimic", modifier: { critChance: 0.25, critMult: 2.75 } },
  necrosigil: { id: "necrosigil", label: "Necro Sigil", icon: "🕯️", rarity: "legendary", weaponKinds: "both", description: "+35% dmg, heal 1 HP per hit", source: "necromancer", modifier: { damageMult: 1.35, lifesteal: 1 } },

  // ══ SKILL CARDS — a monster's power as an ACTIVE ability ══
  // Socketing one grants its Q/E ability while that weapon is HELD (see
  // CardModifier.grantsAbility). Each is sourced from the monster whose own
  // behaviour the ability imitates: a wisp blinks and crackles, a pin IS the
  // pinball, a reaper bends time around itself.
  // Only THREE abilities are genuinely locked — magnetaura, timecrawl and
  // bladestorm (skills.ts unlock nodes). The knight already starts holding
  // flippercharge / arcanepulse / slickfield (state.unlockedAbilities), so a card
  // "granting" one of those would be a dead chip wearing a build-defining
  // description. The other monsters get a cost discount instead, which is a real
  // effect on abilities you already have.
  magnetheart: { id: "magnetheart", label: "Magnet Heart", icon: "🧿", rarity: "rare", weaponKinds: "both", description: "GRANTS Magnet Aura", source: "magnet", modifier: { grantsAbility: "magnetaura" } },
  witchfocus: { id: "witchfocus", label: "Witch Focus", icon: "🔮", rarity: "rare", weaponKinds: "both", description: "−25% ability mana cost", source: "necromancer", modifier: { abilityCostMult: 0.75 } },
  wispspark: { id: "wispspark", label: "Wisp Spark", icon: "✨", rarity: "epic", weaponKinds: "both", description: "−35% ability mana cost", source: "wisp", modifier: { abilityCostMult: 0.65 } },
  pinsoul: { id: "pinsoul", label: "Pin Soul", icon: "🎳", rarity: "epic", weaponKinds: "both", description: "+45% dmg on momentum, −20% ability cost", source: "pin", modifier: { pinballMult: 1.45, abilityCostMult: 0.8 } },
  bloateroil: { id: "bloateroil", label: "Bloater Oil", icon: "🛢️", rarity: "epic", weaponKinds: "both", description: "+30% dmg, hits BURN, −15% ability cost", source: "bloater", modifier: { damageMult: 1.3, onHit: "burn", abilityCostMult: 0.85 } },
  reaperclock: { id: "reaperclock", label: "Reaper Clock", icon: "⏱️", rarity: "legendary", weaponKinds: "both", description: "GRANTS Time Crawl, −20% ability cost", source: "reaper", modifier: { grantsAbility: "timecrawl", abilityCostMult: 0.8 } },
  brutewhirl: { id: "brutewhirl", label: "Brute Whirl", icon: "🌪️", rarity: "legendary", weaponKinds: "melee", description: "GRANTS Blade Storm, −20% ability cost", source: "brute", modifier: { grantsAbility: "bladestorm", abilityCostMult: 0.8 } },
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
  /** Q/E abilities the socketed SKILL CARDS grant (deduped). Mirrors
   * SkillAggregate.unlocked so both feed the one `unlockedAbilities()` funnel. */
  unlocked: AbilityId[];
  /** Ability mana cost multiplier, compounded across sockets (1 = full price). */
  abilityCostMult: number;
}

export function aggregateCards(cards: CardId[] | undefined): CardAggregate {
  const agg: CardAggregate = {
    damageFlat: 0, damageMult: 1, cooldownMult: 1, durabilityMult: 1, chill: false, burn: false, pinballMult: 1, bolt: false,
    materialMult: 1, critChance: 0, critMult: 2, lifesteal: 0, pierce: 0, unlocked: [], abilityCostMult: 1,
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
    // SKILL CARDS. Deduped: two copies of the same grant is still one ability,
    // and a duplicate must not push a second entry into the Q/E list.
    if (m.grantsAbility && !agg.unlocked.includes(m.grantsAbility)) agg.unlocked.push(m.grantsAbility);
    if (m.abilityCostMult) agg.abilityCostMult *= m.abilityCostMult;
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
      const own = pool.filter((id) => CARDS[id].source === opts.kind);
      if (own.length > 0 && rand() < AFFINITY_CHANCE) return own[Math.floor(rand() * own.length)];
    }
    return pool[Math.floor(rand() * pool.length)];
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
