/**
 * Weapons & gear — the item tables and the durability rules.
 *
 * Weapons come in two kinds:
 *  - MELEE: every swing that CONNECTS costs 1 durability.
 *  - RANGED: every SHOT costs 1 durability — durability IS the ammo/fuel.
 * At 0 the weapon is gone. Fists are the unbreakable floor of the system,
 * not an item: they're what an empty hand resolves to.
 *
 * The player carries up to TWO weapons (slots) and swaps between them; the
 * slot logic itself lives in core.ts/state.ts — this file is just the tables
 * and the pure durability math (tested).
 *
 * Gear (one of each slot per level, v1): helmet and armor are ablative — each
 * point of incoming damage consumes a point of that piece's durability before
 * touching hearts, helmet first. Boots don't absorb; they make you faster.
 *
 * DOM- and three-free: the durability math is tested.
 */

export type WeaponId =
  | "fists" | "sword" | "stick" | "mace" | "chair"
  | "greatsword" | "warhammer" | "wreckingball"
  | "gun" | "bow" | "flamethrower";

export type WeaponKind = "melee" | "ranged";
export type ProjectileKind = "bullet" | "arrow" | "flame" | "glob" | "web" | "shard";

export interface WeaponDef {
  id: WeaponId;
  label: string;
  icon: string; // HUD emoji
  kind: WeaponKind;
  damage: number;
  /** Melee: swing reach. Ranged: max projectile travel, in tiles. */
  range: number;
  /** cos of the half-arc — smaller means a wider swing. Melee only. */
  arcCos: number;
  cooldown: number;
  /** Uses before it's gone. Melee wears on hit, ranged spends per shot. Infinity = fists. */
  maxDurability: number;
  /** Ranged only — what leaves the muzzle and how. */
  projectile?: ProjectileKind;
  projectileSpeed?: number;
  /** Aim jitter, radians. The flamethrower's spray IS this. */
  spread?: number;
  /** Projectiles per trigger pull (the flamethrower spits a pair of puffs). */
  pellets?: number;
  /** Melee slash-arc VFX tint (sRGB hex). Defaults to a cold steel white. */
  slashColor?: number;
  /** Multiplier on the knockback this weapon's hits impart. The chair's whole
   *  identity is a 360 sweep that SHOVES — reach + shove, not damage. */
  knockbackMult?: number;
  /**
   * HEFT — how heavy this weapon is to SWING, as a multiplier on the move
   * timeline (windup + recovery). 1 = the standard sword feel.
   *
   * Until this existed every weapon shared one set of move timings, so "slow"
   * could only mean "longer cooldown between identical swings" — a mace and a
   * stick wound up at exactly the same speed. Heft is what makes a greatsword
   * COMMIT: a long tell you can be punished during, and a recovery you are
   * rooted through if you whiff.
   *
   * Only stretches windup/recovery, never the ACTIVE window — a heavy weapon
   * should be slow to start and slow to end, not have a more forgiving hitbox.
   */
  heft?: number;
  /**
   * MOMENTUM WEAPON — damage scales with the pinball momentum you are carrying
   * when the blow lands. The wrecking ball's whole identity: it is the one
   * weapon that rewards swinging mid-ride rather than punishing it.
   */
  momentumScaling?: boolean;
  /** Ranged only — extra enemies a shot passes THROUGH before dying. Baseline
   *  for the weapon; STACKS with the Piercer/Railgun cards (cards.ts pierce).
   *  This is the bow's niche: the gun out-ranges and out-paces it, but only the
   *  bow threads a whole corridor queue with one arrow. */
  pierce?: number;
}

/**
 * ITEM RARITY — what decides how many CARDS a piece of kit can socket.
 *
 * Card slots used to be hand-authored per weapon (sword 1, mace 2, flamer 3) and
 * armour had none at all, so the only way to fit more cards was to buy slots.
 * Rarity replaces that: the item you FOUND decides its ceiling, which is what
 * makes a legendary drop exciting rather than just a bigger number.
 */
export type ItemRarity = "common" | "rare" | "epic" | "legendary";

export const ITEM_RARITIES: ItemRarity[] = ["common", "rare", "epic", "legendary"];

/** Slots by rarity. 1-4, and 4 is the hard cap for every item in the game. */
export const SLOTS_BY_RARITY: Record<ItemRarity, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

/** Hard cap on socketed cards per item (slot purchases stop here). */
export const WEAPON_MAX_CARD_SLOTS = 4;

/** Rarity accents, shared by the item name, its ground glow and the card face. */
export const ITEM_RARITY_HEX: Record<ItemRarity, string> = {
  common: "#9aa4b4",
  rare: "#4f8fdb",
  epic: "#a46fe8",
  legendary: "#f0a63c",
};

/**
 * Roll the rarity of a dropped item. Deeper floors bias higher, but a common is
 * always possible and a legendary is never guaranteed — a floor that hands out
 * legendaries stops the hunt, which is the thing this whole system exists to
 * avoid. `rand` is injectable so the roll is testable.
 */
export function rollItemRarity(floor: number, rand: () => number = Math.random): ItemRarity {
  // Weights shift with depth: commons fade, legendaries creep in from floor ~4.
  const d = Math.max(0, floor - 1);
  const w: Record<ItemRarity, number> = {
    common: Math.max(10, 60 - d * 6),
    rare: 28 + Math.min(12, d * 2),
    epic: Math.min(34, 10 + d * 3),
    legendary: Math.min(18, Math.max(0, d - 2) * 2.5),
  };
  const total = ITEM_RARITIES.reduce((n, r) => n + w[r], 0);
  let x = rand() * total;
  for (const r of ITEM_RARITIES) {
    x -= w[r];
    if (x < 0) return r;
  }
  return "common";
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: "fists", label: "Fists", icon: "✊", kind: "melee", damage: 1, range: 0.85, arcCos: 0.5, cooldown: 0.3, maxDurability: Infinity, slashColor: 0xc8ccd4 },
  sword: { id: "sword", label: "Sword", icon: "🗡️", kind: "melee", damage: 2, range: 1.35, arcCos: 0.5, cooldown: 0.38, maxDurability: 30, slashColor: 0xeef1f5 },
  stick: { id: "stick", label: "Stick", icon: "🪵", kind: "melee", damage: 1, range: 1.2, arcCos: 0.5, cooldown: 0.24, maxDurability: 15, slashColor: 0x6b4a2e },
  mace: { id: "mace", label: "Mace", icon: "🔨", kind: "melee", damage: 3, range: 1.25, arcCos: 0.55, cooldown: 0.62, maxDurability: 45, slashColor: 0xffd98a },
  // CHAIR — the CROWD weapon. arcCos 0 is a full 360 sweep: alone among melee it
  // hits everything around you, and that is the whole point. It was 2.9 DPS on a
  // 10-swing life, i.e. worse than fists with no visible reason to pick it up.
  // Now it reaches furthest, shoves hardest, and lasts long enough to matter.
  chair: { id: "chair", label: "Chair", icon: "🪑", kind: "melee", damage: 2, range: 1.8, arcCos: 0.0, cooldown: 0.55, maxDurability: 22, slashColor: 0x6b4a2e, knockbackMult: 2.2 },
  gun: { id: "gun", label: "Gun", icon: "🔫", kind: "ranged", damage: 2, range: 10, arcCos: 1, cooldown: 0.32, maxDurability: 30, projectile: "bullet", projectileSpeed: 16, spread: 0.04 },
  // BOW — the LANE weapon. The gun beat it on range, rate and slots, leaving it
  // with no reason to exist. Arrows now PIERCE: one shot down a corridor spits
  // a whole queue of foes, which is a thing no other weapon can do.
  // ══ HEAVY CLASS — slow to swing, and the heft field is what makes that real ══
  // GREATSWORD — the committed sweep. Longest reach and a wide arc, but heft 1.7
  // means a long tell you can be punished during and a recovery you are rooted
  // through if you whiff. You pick your moment with this.
  greatsword: { id: "greatsword", label: "Greatsword", icon: "🗡", kind: "melee", damage: 5, range: 2.0, arcCos: 0.15, cooldown: 0.9, maxDurability: 40, slashColor: 0xeef1f5, heft: 1.7, knockbackMult: 1.5 },
  // WARHAMMER — siege. The narrowest melee arc in the game (it hits ONE thing)
  // paired with the biggest damage and shove: it doesn't clear crowds, it
  // deletes whatever it lands on. Heaviest heft, so missing genuinely costs.
  warhammer: { id: "warhammer", label: "Warhammer", icon: "🔨", kind: "melee", damage: 7, range: 1.4, arcCos: 0.72, cooldown: 1.15, maxDurability: 50, slashColor: 0xffd98a, heft: 2.1, knockbackMult: 3.4 },
  // WRECKING BALL — the pinball weapon. A full 360 sweep like the chair but
  // lethal, and it is the only weapon whose damage scales with the momentum you
  // are carrying (see MOMENTUM_WEAPON_* / playerDamage). Swing it while rolling.
  wreckingball: { id: "wreckingball", label: "Wrecking Ball", icon: "⛓️", kind: "melee", damage: 4, range: 1.9, arcCos: 0.0, cooldown: 1.0, maxDurability: 36, slashColor: 0xc8ccd4, heft: 1.85, knockbackMult: 2.6, momentumScaling: true },
  bow: { id: "bow", label: "Bow", icon: "🏹", kind: "ranged", damage: 3, range: 8.5, arcCos: 1, cooldown: 0.72, maxDurability: 22, projectile: "arrow", projectileSpeed: 11, spread: 0, pierce: 2 },
  // FLAMER — the burst tool. 23.5 DPS is 4x the next-best, so it pays for that
  // with the shortest life in the game: ~3.5s of continuous fire (was 9.4s) and
  // 2 slots rather than the most. You empty it into a horde, you don't carry it.
  flamethrower: { id: "flamethrower", label: "Flamer", icon: "🔥", kind: "ranged", damage: 1, range: 3.4, arcCos: 1, cooldown: 0.085, maxDurability: 42, projectile: "flame", projectileSpeed: 4.6, spread: 0.3, pellets: 2 },
};

/** The weapons that spawn as maze pickups (you start with the sword). */
export const PICKUP_WEAPONS: WeaponId[] = ["stick", "mace", "chair", "greatsword", "warhammer", "wreckingball", "gun", "bow", "flamethrower"];

export interface WeaponState {
  id: WeaponId;
  durability: number;
  /** Socketed modifier cards (CardId[], max = SLOTS_BY_RARITY[rarity] + bonusSlots). */
  cards?: string[];
  /** Extra card slots bought at the Tavern blacksmith (0 by default). */
  bonusSlots?: number;
  /** What this piece rolled when it dropped. Absent = common (old saves). */
  rarity?: ItemRarity;
  /** Weaponsmith UPGRADE level. Each level is stronger AND riskier — see
   *  `breakChance`. Absent = 0, never upgraded. */
  upgrade?: number;
  /** Paid CARD INSURANCE tier (0-2): how many socketed cards survive a shatter.
   *  Bought BEFORE the gamble, so it is a decision rather than a consolation. */
  insured?: number;
}

export function freshWeapon(id: WeaponId, rarity: ItemRarity = "common"): WeaponState {
  return { id, durability: WEAPONS[id].maxDurability, cards: [], bonusSlots: 0, rarity, upgrade: 0 };
}

/** Total card slots an item has: its rarity's allowance plus bought slots, capped. */
export function slotsForRarity(rarity: ItemRarity | undefined, bonus = 0): number {
  return Math.min(WEAPON_MAX_CARD_SLOTS, SLOTS_BY_RARITY[rarity ?? "common"] + bonus);
}

/** Total card slots a weapon has. */
export function weaponSlotCount(w: WeaponState): number {
  return slotsForRarity(w.rarity, w.bonusSlots ?? 0);
}

// ── UPGRADE RISK ────────────────────────────────────────────────
//
// The anti-hoard mechanic. Upgrading raises a weapon's damage, but past a safe
// floor each attempt can DESTROY it. The point is that nothing is permanent:
// if the best kit could be kept forever, players would hoard one god-item and
// the run would stop being a run. This is also what keeps REPAIR worth paying
// for — a weapon you might lose is a weapon worth maintaining.

/** Upgrades below this level are FREE OF RISK, so the system teaches before it
 *  bites. You learn the button is good, then you learn it has a price. */
export const UPGRADE_SAFE_LEVEL = 3;
/** Break chance added per level past the safe floor. */
export const UPGRADE_RISK_STEP = 0.12;
/** No upgrade is ever a coin-flip worse than this. */
export const UPGRADE_RISK_CAP = 0.6;
/** Damage gained per upgrade level (multiplicative on the weapon's base). */
export const UPGRADE_DAMAGE_STEP = 0.12;
/** Max-durability gained per upgrade level. */
export const UPGRADE_DURABILITY_STEP = 0.08;

/**
 * SALVAGE — break a weapon down at the Weaponsmith for GOLD.
 *
 * The deliberate asymmetry that makes the loop work:
 *   · SACRIFICE (your choice)  -> gold back, cards returned. A real decision.
 *   · SHATTER  (a failed roll) -> nothing. The weapon AND its cards are gone.
 *
 * Losing everything to a gamble you chose is what keeps upgrading tense; getting
 * something back for a weapon you deliberately retired is what stops spare
 * weapons being litter. If both paid out, there'd be no reason to ever stop
 * upgrading.
 *
 * Value scales with rarity (what it was) and upgrade level (what you put in),
 * but always returns LESS than the upgrades cost — salvage is a consolation, not
 * an income stream, or the optimal play becomes upgrade-then-salvage forever.
 */
export const SALVAGE_BY_RARITY: Record<ItemRarity, number> = {
  common: 15,
  rare: 40,
  epic: 90,
  legendary: 200,
};
/** Gold per upgrade level recovered. Well under PRICE_UPGRADE_BASE (45) + the
 *  per-level climb, so pumping a weapon to salvage it is always a LOSS. */
export const SALVAGE_PER_UPGRADE = 12;

export function salvageValue(w: { rarity?: ItemRarity; upgrade?: number }): number {
  return SALVAGE_BY_RARITY[w.rarity ?? "common"] + Math.max(0, w.upgrade ?? 0) * SALVAGE_PER_UPGRADE;
}

// ── CARD INSURANCE ──────────────────────────────────────────────
//
// The answer to "upgrade risk is just a grind". Before you gamble, you can PAY
// to protect socketed cards against a shatter. That turns a coin-flip into a
// decision made in advance: spend now for a softer landing, or pocket the gold
// and risk the trophies.
//
// Insurance covers CARDS ONLY. The weapon still dies — protecting that would
// remove the risk entirely and with it the whole anti-hoard point.

/** How many socketed cards each insurance tier saves from a shatter. */
export const INSURANCE_MAX_TIER = 2;
/** Gold per tier, multiplied by the rarity of the weapon being protected — a
 *  legendary's sockets are worth more, so insuring them costs more. */
export const INSURANCE_BASE_COST = 55;
export const INSURANCE_RARITY_MULT: Record<ItemRarity, number> = {
  common: 1,
  rare: 1.4,
  epic: 2,
  legendary: 3,
};

/** Price to raise a weapon's insurance from `tier` to `tier + 1`. */
export function insuranceCost(tier: number, rarity: ItemRarity = "common"): number {
  const next = Math.max(0, tier) + 1;
  return Math.round(INSURANCE_BASE_COST * next * INSURANCE_RARITY_MULT[rarity]);
}

/**
 * Which socketed cards survive a shatter. Insurance saves the RAREST first —
 * the player paid to protect what matters, and making them guess which chip the
 * game considered valuable would be a bad surprise at the worst moment.
 *
 * `rarityRank` is injected so this stays free of the cards module (items.ts is
 * imported by cards.ts, so importing back would be a cycle).
 */
export function insuredCards(cards: string[], tier: number, rarityRank: (id: string) => number): string[] {
  const n = Math.min(Math.max(0, Math.floor(tier)), INSURANCE_MAX_TIER);
  if (n <= 0 || cards.length === 0) return [];
  return [...cards].sort((a, b) => rarityRank(b) - rarityRank(a)).slice(0, n);
}

/**
 * Chance that upgrading FROM `level` destroys the item. Pure and tested: the
 * number shown in the confirm dialog must be the number actually rolled, or the
 * gamble is a lie.
 */
export function breakChance(level: number): number {
  const n = Math.max(0, Math.floor(level));
  if (n < UPGRADE_SAFE_LEVEL) return 0;
  return Math.min(UPGRADE_RISK_CAP, (n - UPGRADE_SAFE_LEVEL + 1) * UPGRADE_RISK_STEP);
}

/** Damage multiplier from a weapon's upgrade level. */
export function upgradeDamageMult(level = 0): number {
  return 1 + Math.max(0, level) * UPGRADE_DAMAGE_STEP;
}

/** Max-durability multiplier from a weapon's upgrade level. */
export function upgradeDurabilityMult(level = 0): number {
  return 1 + Math.max(0, level) * UPGRADE_DURABILITY_STEP;
}

/**
 * One use of the weapon: a melee swing that connected, or a shot fired.
 * Returns the worn state and whether that use finished it off (the use itself
 * still lands — things break ON use, not instead of use). What happens to a
 * broken weapon (the slot empties, the hand falls back to fists) is the
 * caller's business — this is just the arithmetic.
 */
export function degradeWeapon(w: WeaponState): { weapon: WeaponState; broke: boolean } {
  if (!Number.isFinite(w.durability)) return { weapon: w, broke: false };
  const durability = w.durability - 1;
  return { weapon: { id: w.id, durability }, broke: durability <= 0 };
}

// ── Gear ────────────────────────────────────────────────────────

export type GearSlot = "helmet" | "armor" | "boots";

export interface GearDef {
  slot: GearSlot;
  label: string;
  icon: string;
  /** Damage the piece can soak over its lifetime. 0 = doesn't absorb (boots). */
  absorb: number;
}

export const GEAR: Record<GearSlot, GearDef> = {
  helmet: { slot: "helmet", label: "Helmet", icon: "🪖", absorb: 3 },
  armor: { slot: "armor", label: "Armor", icon: "🛡️", absorb: 5 },
  boots: { slot: "boots", label: "Boots", icon: "👟", absorb: 0 },
};

export const GEAR_SLOTS: GearSlot[] = ["helmet", "armor", "boots"];

// ── Potions — walk-over consumables ─────────────────────────────
//
// A third pickup family beside weapons and gear. Two flavours of effect:
//  - INSTANT: healing, applied the moment you grab it (heal potion).
//  - TIMED BUFF: rage (2× damage) and haste (faster move + swing) run for a
//    duration, tracked on the player and ticked down each frame. Grabbing the
//    same buff again refreshes its timer rather than stacking.

export type PotionId =
  | "health"
  | "rage"
  | "haste"
  | "shield"
  | "gold"
  | "ballform"
  | "freeze"
  | "multiball"
  | "curveshot"
  | "magnetboots"
  // ── Craft-only brews (Tavern Alchemist; see recipes.ts) ──
  | "regen"
  | "venomcoat"
  | "stoneskin"
  | "static"
  | "greed"
  | "elixir";

export interface PotionDef {
  id: PotionId;
  label: string;
  icon: string;
  /** Sprite tint / liquid colour, sRGB hex — also the HUD swatch. */
  color: number;
  /** Instant hearts restored (0 for pure-buff potions). */
  heal: number;
  /** Timed-buff duration, seconds (0 for instant potions). */
  duration: number;
  /** Instant gold granted (the greed idol). 0 for everything else. */
  gold?: number;
  /**
   * What it actually DOES, in a few words. The single source of truth for the
   * mechanic text — the HUD tile, the shop row and the pickup toast all read
   * this, instead of the three hand-maintained copies they used to carry.
   */
  description: string;
}

export const POTIONS: Record<PotionId, PotionDef> = {
  health: { id: "health", label: "Health", icon: "❤️", color: 0xd95763, heal: 3, duration: 0, description: "restores 3 hearts" },
  rage: { id: "rage", label: "Rage", icon: "💢", color: 0xd97b29, heal: 0, duration: 12, description: "double damage" },
  haste: { id: "haste", label: "Haste", icon: "⚡", color: 0x6fd0e8, heal: 0, duration: 12, description: "faster moves + swings" },
  // Shield: a bubble of invulnerability — walk through a horde untouched for a
  // few seconds. The escape-hatch power-up.
  shield: { id: "shield", label: "Shield", icon: "🛡️", color: 0x8fc46b, heal: 0, duration: 6, description: "untouchable" },
  // Greed idol: not a liquid — an instant gold windfall. Reads as a golden flask.
  gold: { id: "gold", label: "Idol", icon: "💰", color: 0xffd98a, heal: 0, duration: 0, gold: 25, description: "+25 gold, instantly" },
  // ── The pinball power fantasy, in ONE potion (Wave F, consolidated) ──
  // BALL FORM: you literally become the pinball. Momentum never bleeds AND
  // steers (old Turbo), every ram lands at triple damage from any speed (old
  // Iron Core), and flat walls kick you back FASTER (old Spring Legs). One
  // strong, unmistakable button instead of three thin overlapping buffs.
  ballform: { id: "ballform", label: "Ball Form", icon: "🪩", color: 0xf0a63c, heal: 0, duration: 14, description: "you ARE the pinball" },
  // Freeze Ray: the whole machine holds its breath — thread the bumper room.
  freeze: { id: "freeze", label: "Freeze", icon: "❄️", color: 0xbfe8ff, heal: 0, duration: 6, description: "the floor holds its breath" },
  // Multi-Ball: the pinball classic — two ghost knights peel off you, trail
  // your recent path and ram whatever you skim past. Same duration as ball
  // form: it's the other half of the "you ARE the machine" fantasy.
  multiball: { id: "multiball", label: "Multi-Ball", icon: "🔮", color: 0xb06fe8, heal: 0, duration: 14, description: "two echo knights ram for you" },
  // Curve Shot: your projectiles bend around corners along your sweep.
  curveshot: { id: "curveshot", label: "Curve Shot", icon: "🌀", color: 0x6fd0e8, heal: 0, duration: 12, description: "bending projectiles" },
  // Magnet Boots: repel the magnet crawlers, LAUNCH off the magnet strips.
  magnetboots: { id: "magnetboots", label: "Magnet Boots", icon: "🧲", color: 0xa83244, heal: 0, duration: 18, description: "repel crawlers · strips LAUNCH" },
  // ── Craft-only brews — no shop row, no floor spawn; you BREW these at the
  // Alchemist from monster reagents (recipes.ts). Each is a distinct buff that
  // reads at one existing combat choke point. ──
  // Regen Salve: slow health regen over time (heal handled in the buff tick).
  regen: { id: "regen", label: "Regen Salve", icon: "🧪", color: 0x8fd46b, heal: 0, duration: 10, description: "regenerate over time" },
  // Venom Coat: your hits POISON for the duration (weapon coating).
  venomcoat: { id: "venomcoat", label: "Venom Coat", icon: "☠️", color: 0xa83fd0, heal: 0, duration: 14, description: "your hits POISON" },
  // Stoneskin: incoming damage is halved for the duration.
  stoneskin: { id: "stoneskin", label: "Stoneskin", icon: "🪨", color: 0x9a8f77, heal: 0, duration: 12, description: "halve damage taken" },
  // Static Charge: every hit ARCS to a nearby foe (chain lightning).
  static: { id: "static", label: "Static Charge", icon: "⚡", color: 0xf0e05a, heal: 0, duration: 12, description: "hits ARC to nearby foes" },
  // Greed Draught: kills pay double gold for the duration.
  greed: { id: "greed", label: "Greed Draught", icon: "💰", color: 0xffd98a, heal: 0, duration: 20, description: "double kill gold" },
  // Elixir of Life: instant FULL heal AND a permanent-for-the-run +2 max hearts.
  elixir: { id: "elixir", label: "Elixir of Life", icon: "🌟", color: 0xff8fae, heal: 0, duration: 0, description: "full heal · +2 max hearts (run)" },
};

export const POTION_IDS: PotionId[] = ["health", "rage", "haste", "shield", "gold", "ballform", "freeze", "multiball", "curveshot", "magnetboots", "regen", "venomcoat", "stoneskin", "static", "greed", "elixir"];

/** Multipliers applied while a buff is active. */
export const RAGE_DAMAGE_MULT = 2;
export const HASTE_SPEED_MULT = 1.45;
export const HASTE_COOLDOWN_MULT = 0.6; // attacks come out faster too

// ── Craft-only brew tuning (see applyPotion / combat.ts) ──
/** Regen Salve: hearts restored per tick, and seconds between ticks. */
export const REGEN_HEAL_PER_TICK = 1;
export const REGEN_TICK_INTERVAL = 2;
/** Stoneskin: incoming damage multiplier while active. */
export const STONESKIN_DAMAGE_MULT = 0.5;
/** Greed Draught: kill-gold multiplier while active. */
export const GREED_GOLD_MULT = 2;
/** Static Charge: arc damage + reach (tiles) to the nearest other foe. */
export const STATIC_ARC_DAMAGE = 2;
export const STATIC_ARC_RANGE = 3.2;
/** Elixir of Life: permanent-for-the-run max-hearts bump. */
export const ELIXIR_MAXHP_BONUS = 2;

/** Remaining durability per equipped slot; absent key = nothing equipped. */
export type GearState = Partial<Record<GearSlot, number>>;

/**
 * A gear piece's SOCKETS, kept in a parallel map rather than folded into
 * `GearState`.
 *
 * `GearState` is a bare `slot -> durability` number that eleven modules read
 * directly (`state.gear[slot] ?? 0`), and the absorb path deletes a key to mean
 * "destroyed". Turning those numbers into objects would touch every one of those
 * call sites for no gain, and quietly break any that still expected a number.
 * A parallel map keeps the hot, well-tested durability path untouched.
 *
 * Absent key = an unsocketed (or unequipped) piece.
 */
export interface GearPiece {
  rarity: ItemRarity;
  cards: string[];
  /** Weaponsmith upgrade level — same risk curve as weapons (`breakChance`). */
  upgrade?: number;
}

export type GearCards = Partial<Record<GearSlot, GearPiece>>;

/** Slots a gear piece has, off its rolled rarity. */
export function gearSlotCount(p: GearPiece | undefined): number {
  return p ? slotsForRarity(p.rarity, 0) : 0;
}

export function freshGearPiece(rarity: ItemRarity = "common"): GearPiece {
  return { rarity, cards: [], upgrade: 0 };
}

/**
 * Route incoming damage through the armor, helmet first. Each absorbed point
 * costs the piece a point of durability; a piece at 0 is destroyed (its key is
 * removed). Whatever the gear can't soak comes back as `hpDamage`.
 *
 * Pure — returns a new GearState rather than mutating.
 */
export function absorbDamage(
  gear: GearState,
  damage: number,
): { gear: GearState; hpDamage: number; destroyed: GearSlot[] } {
  const next: GearState = { ...gear };
  const destroyed: GearSlot[] = [];
  let remaining = damage;

  for (const slot of ["helmet", "armor"] as const) {
    if (remaining <= 0) break;
    const dur = next[slot];
    if (dur === undefined || dur <= 0) continue;
    const soaked = Math.min(dur, remaining);
    remaining -= soaked;
    if (dur - soaked <= 0) {
      delete next[slot];
      destroyed.push(slot);
    } else {
      next[slot] = dur - soaked;
    }
  }

  return { gear: next, hpDamage: remaining, destroyed };
}
