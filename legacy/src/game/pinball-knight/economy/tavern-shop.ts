/**
 * THE TAVERN ECONOMY — prices, stock and every action a vendor can perform.
 *
 * Lifted out of `tavern.ts` so that the rules have ONE home independent of how
 * they are drawn. The DOM tavern kept its prices, its shelf and its twenty-four
 * action handlers interleaved with `innerHTML` strings and `render()` calls, so
 * porting it to the in-game UI would otherwise have meant either reimplementing
 * the economy (two divergent copies of "what does an upgrade cost") or keeping
 * a DOM module alive purely to host arithmetic.
 *
 * Every action here is the same shape: it mutates game state, and returns a
 * message to show or `null` when nothing happened. No rendering, no elements,
 * no selection state — the caller owns what is selected, because that is a
 * property of a particular screen and not of the economy.
 *
 * ── THE COMMENTS THAT MOVED WITH THE CODE ──
 * Several of these rules exist because of a specific failure and say so. They
 * are kept verbatim: the two-step upgrade confirm, insurance saving the rarest
 * cards first, the forge's Grim Bone gate, and the respec costing a rarity tier
 * but never the level. Deleting those notes would leave rules that look
 * arbitrary and invite someone to "simplify" them back into the bugs.
 */
import { state } from "../state";
import {
  WEAPONS,
  GEAR,
  GEAR_SLOTS,
  POTIONS,
  weaponSlotCount,
  breakChance,
  upgradeDamageMult,
  upgradeDurabilityMult,
  UPGRADE_DURABILITY_STEP,
  salvageValue,
  insuranceCost,
  insuredCards,
  INSURANCE_MAX_TIER,
  type GearSlot,
  type PotionId,
} from "../items";
import { sfxBreak } from "../sfx";
import { ARMOR_STYLES, isStyleUnlocked, unlockStyle, setActiveStyle, styleGearGrant, type ArmorStyleId } from "../armor-styles";
import {
  CARD_LEVEL_MAX,
  cardBase,
  cardDef,
  cardKey,
  cardsOfRarity,
  cardFitsKind,
  parseCard,
  reKeyCard,
  rollCardLevel,
  rollShiny,
  socketCard,
  lowerRarity,
  type CardId,
  type CardRarity,
} from "../cards";
import { RECIPES, canCraft, craftCost } from "../recipes";
import { getBalance, spendGold, addGold } from "../../../utils/gold-wallet";

// ── Prices ───────────────────────────────────────────────────────────────────
// Widened spread so the shelf has genuinely expensive pulls, not just cheap
// chips: a mythic costs a whole run's savings. Cards are MONSTER TROPHIES; the
// shelf exists so a run that rolled badly is not dead, NOT as a way to buy the
// build you want — hence steep prices and three cards you cannot choose.
export const PRICE_CARD: Record<CardRarity, number> = { common: 55, rare: 170, epic: 420, legendary: 900, mythic: 1800 };
export const PRICE_REROLL_BAR = 15;
export const PRICE_REPAIR_WEAPON = 30;
export const PRICE_ADD_SLOT = 60;
/** Climbs with the level, so pushing deep costs real gold as well as real risk. */
export const PRICE_UPGRADE_BASE = 45;
export const PRICE_REROLL_CARD = 40;
export const PRICE_REPAIR_GEAR = 40;
export const POTION_STOCK: PotionId[] = ["health", "rage", "haste", "shield", "freeze", "ballform"];
export const PRICE_POTION: Partial<Record<PotionId, number>> = { health: 15, rage: 28, haste: 28, shield: 34, freeze: 40, ballform: 65 };
export const PRICE_GEAR: Record<GearSlot, number> = { helmet: 45, armor: 70, boots: 40 };
export const PRICE_FLASK = 8;
const BELT_MAX = 4;
/** The reagent the forge consumes — a RARE drop, so forging costs a rare monster. */
export const FORGE_CATALYST = "grimbone";
/** Rarity ladder, low→high. Insurance saves the RAREST first, so it needs order. */
const CARD_RANK: CardRarity[] = ["common", "rare", "epic", "legendary", "mythic"];

export type TavernFx = "repair" | "gear" | "slot" | "forge";
let pendingFx: TavernFx[] = [];
export function consumeTavernFx(): TavernFx[] {
  const out = pendingFx;
  pendingFx = [];
  return out;
}

/** Result of an action: a message to flash, or null for "nothing happened". */
export type ActionResult = string | null;

// ── The shelf ────────────────────────────────────────────────────────────────

let barOffers: CardId[] = [];
export function currentOffers(): readonly CardId[] {
  return barOffers;
}

export function rollBarOffers(): void {
  const pool: CardId[] = [];
  // DISTINCT cards, by base. Each slot used to roll independently, so with five
  // cards per rarity and a 50% weight on commons the shelf showed the same card
  // twice about a third of the time — three slots, two choices, and the dealer
  // looked broken rather than unlucky.
  const taken = new Set<CardId>();
  for (let k = 0; k < 3; k++) {
    // Bounded retry rather than a filtered bag: the rarity roll is what makes
    // the shelf interesting, so it is re-rolled too, and a run of collisions
    // gives up rather than looping (a duplicate beats an empty slot).
    for (let attempt = 0; attempt < 12; attempt++) {
      const r = Math.random();
      const rarity: CardRarity = r < 0.5 ? "common" : r < 0.82 ? "rare" : r < 0.95 ? "epic" : r < 0.99 ? "legendary" : "mythic";
      const bag = cardsOfRarity(rarity);
      const base = bag[Math.floor(Math.random() * bag.length)];
      if (taken.has(base) && attempt < 11) continue;
      taken.add(base);
      // Levelled off how DEEP the run has been, not off floor 1: a twenty-floor
      // run returning to a shelf of level-1 chips would make the dealer strictly
      // worse than the dungeon, and the shelf would stop being a reason to hold
      // gold.
      pool.push(cardKey(base, rollCardLevel(state.runDeepestFloor), rollShiny()));
      break;
    }
  }
  barOffers = pool;
}

/** Spend gold. The wallet is the source of truth; the run tally is kept in sync. */
export function pay(amount: number): boolean {
  if (getBalance() < amount || !spendGold(amount)) return false;
  state.goldRun = Math.max(0, state.goldRun - amount);
  return true;
}

function beltHasRoom(id: PotionId): boolean {
  return state.belt.some((b) => b?.id === id) || state.belt.filter(Boolean).length < BELT_MAX;
}

function stowOnBelt(id: PotionId): boolean {
  const existing = state.belt.findIndex((b) => b?.id === id);
  if (existing >= 0) {
    const slot = state.belt[existing];
    if (slot) slot.count += 1;
    state.hudDirty = true;
    return true;
  }
  const free = state.belt.findIndex((b) => !b);
  if (free < 0) return false;
  state.belt[free] = { id, icon: POTIONS[id].icon, count: 1 };
  state.hudDirty = true;
  return true;
}

function unstowFromBelt(id: PotionId): void {
  const i = state.belt.findIndex((b) => b?.id === id);
  const slot = state.belt[i];
  if (!slot) return;
  slot.count -= 1;
  if (slot.count <= 0) state.belt[i] = null;
  state.hudDirty = true;
}

/** The slot the equipped weapon lives in — every smith action targets it. */
export function activeWeaponSlotIndex(): number {
  return state.activeSlot;
}

// ── Alchemist ────────────────────────────────────────────────────────────────

export function buyPotion(id: PotionId): ActionResult {
  if (!POTIONS[id]) return null;
  if (!stowOnBelt(id)) return "belt is full";
  // Stow BEFORE paying, and unwind if the payment fails — the opposite order
  // would take the gold and then discover there was nowhere to put the potion.
  if (!pay(PRICE_POTION[id] ?? 30)) {
    unstowFromBelt(id);
    return "not enough gold";
  }
  return `${POTIONS[id].label} → belt`;
}

export function buyFlask(): ActionResult {
  if (!pay(PRICE_FLASK)) return "not enough gold";
  state.flasks += 1;
  state.hudDirty = true;
  return "Empty Flask bought";
}

export function brew(recipeId: string): ActionResult {
  const r = RECIPES[recipeId];
  if (!r) return null;
  if (!canCraft(r, state.reagents, state.flasks, getBalance())) return "missing materials";
  // A potion output needs belt room; check BEFORE consuming so a full belt
  // never eats the reagents.
  if (r.output !== "flask" && !beltHasRoom(r.output as PotionId)) return "belt is full";
  const cost = craftCost(r);
  for (const [rid, n] of cost.inputs) state.reagents[rid] = (state.reagents[rid] ?? 0) - n;
  state.flasks -= cost.flasks;
  if (cost.gold > 0) pay(cost.gold);
  state.hudDirty = true;
  if (r.output === "flask") {
    state.flasks += 1;
    return "Empty Flask brewed";
  }
  stowOnBelt(r.output as PotionId);
  return `${r.label} → belt`;
}

// ── Armorer ──────────────────────────────────────────────────────────────────

export function buyGear(s: GearSlot): ActionResult {
  if (!GEAR[s]) return null;
  const base = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
  const grant = styleGearGrant(s, base); // finer steel while an elemental set is worn
  if ((state.gear[s] ?? 0) >= grant) return "already equipped";
  if (!pay(PRICE_GEAR[s])) return "not enough gold";
  state.gear = { ...state.gear, [s]: grant };
  pendingFx.push("gear");
  state.hudDirty = true;
  return `${GEAR[s].label} equipped`;
}

export function buyStyleSet(id: ArmorStyleId): ActionResult {
  const def = ARMOR_STYLES[id];
  if (!def || def.price <= 0 || isStyleUnlocked(id)) return null;
  if (!pay(def.price)) return "not enough gold";
  unlockStyle(id); // unlock AND wear it
  // You walk out dressed: the set comes with full plate in its finer steel,
  // never downgrading a piece that somehow has more left.
  const plate: typeof state.gear = { ...state.gear };
  for (const s of GEAR_SLOTS) {
    const base = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
    plate[s] = Math.max(plate[s] ?? 0, styleGearGrant(s, base, id));
  }
  state.gear = plate;
  pendingFx.push("gear");
  state.hudDirty = true;
  return `${def.label} — forged & worn`;
}

export function wearStyle(id: ArmorStyleId): ActionResult {
  if (!ARMOR_STYLES[id] || !setActiveStyle(id)) return null;
  state.hudDirty = true; // sprites re-dress via the per-frame look-key checks
  return `${ARMOR_STYLES[id].label} worn`;
}

export function repairGear(): ActionResult {
  const missing = GEAR_SLOTS.some((s) => (state.gear[s] ?? 0) < (GEAR[s].absorb || 1));
  if (!missing) return "all gear is sound";
  if (!pay(PRICE_REPAIR_GEAR)) return "not enough gold";
  for (const s of GEAR_SLOTS) {
    if (state.gear[s] !== undefined || GEAR[s].absorb > 0) state.gear[s] = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
  }
  pendingFx.push("repair");
  state.hudDirty = true;
  return "plate repaired";
}

// ── Card dealer ──────────────────────────────────────────────────────────────

export function buyCard(offerIdx: number): ActionResult {
  const id = barOffers[offerIdx];
  if (!id) return null;
  if (!pay(PRICE_CARD[cardDef(id)!.rarity])) return "not enough gold";
  state.cardStash.push(id);
  barOffers.splice(offerIdx, 1);
  return `bought ${cardDef(id)!.label}`;
}

export function rerollBar(): ActionResult {
  if (!pay(PRICE_REROLL_BAR)) return "not enough gold";
  rollBarOffers();
  return null;
}

export function socketStashCard(stashIdx: number, wIdx: number): ActionResult {
  const w = state.weaponSlots[wIdx];
  const id = state.cardStash[stashIdx];
  if (!w || !id) return null;
  if (!cardFitsKind(id, WEAPONS[w.id].kind)) return "this card doesn't fit that weapon";
  if (!socketCard(w, id)) return "no free slot on that weapon";
  state.cardStash.splice(stashIdx, 1);
  state.hudDirty = true;
  return null;
}

export function unsocketCard(wIdx: number, cardIdx: number): ActionResult {
  const w = state.weaponSlots[wIdx];
  if (!w?.cards?.[cardIdx]) return null;
  const removed = w.cards.splice(cardIdx, 1)[0];
  // The respec costs you a RARITY tier, NOT the level you earned — losing both
  // would make un-socketing a level-9 card unthinkable, and the point of the
  // mechanic is that respeccing stays available.
  const lower = lowerRarity(cardDef(removed)!.rarity);
  state.hudDirty = true;
  if (!lower) return "common card crumbled to dust";
  const bag = cardsOfRarity(lower);
  state.cardStash.push(reKeyCard(removed, bag[Math.floor(Math.random() * bag.length)]));
  return `un-socketed → dropped to ${lower}`;
}

export function rerollCard(stashIdx: number): ActionResult {
  const cur = state.cardStash[stashIdx];
  if (!cur) return null;
  if (!pay(PRICE_REROLL_CARD)) return "not enough gold";
  const bag = cardsOfRarity(cardDef(cur)!.rarity).filter((c) => c !== cardBase(cur));
  // Same rarity, new card, SAME level and shine — you paid to change which card
  // it is, not to have the level rolled back.
  state.cardStash[stashIdx] = bag.length ? reKeyCard(cur, bag[Math.floor(Math.random() * bag.length)]) : cur;
  return `rerolled → ${cardDef(state.cardStash[stashIdx])!.label}`;
}

export function canForge(picks: readonly number[]): boolean {
  return picks.length === 2 && picks.every((i) => cardDef(state.cardStash[i])?.rarity === "common");
}

export function forge(picks: readonly number[]): ActionResult {
  if (!canForge(picks)) return null;
  // A GRIM BONE gates the forge. It used to be unlimited and free, which made
  // rare cards manufacturable from the commons any floor hands out — the exact
  // "you can craft cards" hole the design is trying to avoid. The forge still
  // works, but it costs a rare monster material, so even crafting is downstream
  // of hunting.
  if ((state.reagents[FORGE_CATALYST] ?? 0) < 1) return "the forge needs a Grim Bone";
  state.reagents[FORGE_CATALYST] = (state.reagents[FORGE_CATALYST] ?? 0) - 1;
  // The forge INHERITS from what it consumed: the higher of the two levels, +1
  // when both inputs matched, and the shine if either input had one. Feeding two
  // level-8 commons in and getting a level-1 rare back would make the forge a
  // downgrade for anyone deep enough to have levelled commons.
  const inputs = picks.map((i) => parseCard(state.cardStash[i]));
  const forgedLevel = Math.min(
    CARD_LEVEL_MAX,
    Math.max(...inputs.map((c) => c.level)) + (inputs[0].level === inputs[1].level ? 1 : 0),
  );
  const forgedShiny = inputs.some((c) => c.shiny);
  const rare = cardsOfRarity("rare");
  const newCard = cardKey(rare[Math.floor(Math.random() * rare.length)], forgedLevel, forgedShiny);
  // Descending index so the splices do not shift each other.
  [...picks].sort((a, b) => b - a).forEach((i) => state.cardStash.splice(i, 1));
  state.cardStash.push(newCard);
  pendingFx.push("forge");
  return `forged a RARE: ${cardDef(newCard)!.label}${forgedLevel > 1 ? ` Lv${forgedLevel}` : ""}${forgedShiny ? " SHINY" : ""}`;
}

// ── Weaponsmith ──────────────────────────────────────────────────────────────

export function repairWeapon(): ActionResult {
  const w = state.weaponSlots[activeWeaponSlotIndex()];
  if (!w) return "no weapon equipped";
  if (!Number.isFinite(w.durability) || w.durability >= WEAPONS[w.id].maxDurability) return "weapon is already sound";
  if (!pay(PRICE_REPAIR_WEAPON)) return "not enough gold";
  w.durability = WEAPONS[w.id].maxDurability;
  pendingFx.push("repair");
  state.hudDirty = true;
  return "weapon repaired";
}

/**
 * Upgrade the equipped weapon.
 *
 * `armed` is the level the player has already confirmed once. TWO-STEP once
 * there is real risk: a hidden coin-flip that eats a legendary is a feel-bad; a
 * stated 36% gamble the player deliberately took is a story. Returns `armed` so
 * the caller can hold the confirm without knowing the risk curve.
 */
export function upgradeWeapon(armed: number | null): { result: ActionResult; armed: number | null } {
  const w = state.weaponSlots[activeWeaponSlotIndex()];
  if (!w) return { result: "no weapon equipped", armed: null };
  const lvl = w.upgrade ?? 0;
  const risk = breakChance(lvl);
  if (risk > 0 && armed !== lvl) return { result: null, armed: lvl };
  if (!pay(PRICE_UPGRADE_BASE + lvl * 25)) return { result: "not enough gold", armed: null };

  if (Math.random() < risk) {
    // DESTROYED. The weapon is always gone — that is the anti-hoard mechanic
    // doing its job, and insuring the weapon itself would delete the risk.
    // Socketed cards are gone TOO, except the ones insurance bought back out of
    // the fire (rarest first — the player paid to protect what matters).
    const held = w.cards ?? [];
    const saved = insuredCards(held, w.insured ?? 0, (id) => CARD_RANK.indexOf(cardDef(id)?.rarity as CardRarity));
    const lost = held.length - saved.length;
    state.weaponSlots[activeWeaponSlotIndex()] = null;
    // Every insured card comes back — a clamp here could silently eat cards the
    // player had PAID to protect once the stash was full, which is the worst
    // possible place for a silent cap.
    for (const id of saved) state.cardStash.push(id);
    sfxBreak();
    return {
      result:
        saved.length > 0
          ? `THE BLADE SHATTERS — ${saved.length} card(s) saved${lost > 0 ? `, ${lost} lost` : ""}`
          : lost > 0
            ? `THE BLADE SHATTERS — ${lost} card(s) lost`
            : "THE BLADE SHATTERS",
      armed: null,
    };
  }

  w.upgrade = lvl + 1;
  // Top the blade up to its new, higher ceiling so the upgrade is felt now.
  const def = WEAPONS[w.id];
  if (Number.isFinite(w.durability)) {
    w.durability = Math.min(
      Math.round(def.maxDurability * upgradeDurabilityMult(w.upgrade)),
      w.durability + Math.round(def.maxDurability * UPGRADE_DURABILITY_STEP),
    );
  }
  pendingFx.push("slot");
  return { result: `+${w.upgrade} — damage x${upgradeDamageMult(w.upgrade).toFixed(2)}`, armed: null };
}

export function insureWeapon(): ActionResult {
  const w = state.weaponSlots[activeWeaponSlotIndex()];
  if (!w) return "no weapon equipped";
  const cards = w.cards?.length ?? 0;
  if (cards === 0) return "nothing socketed to insure";
  const tier = Math.min(w.insured ?? 0, INSURANCE_MAX_TIER);
  if (tier >= INSURANCE_MAX_TIER || tier >= cards) return "already fully insured";
  if (!pay(insuranceCost(tier, w.rarity ?? "common"))) return "not enough gold";
  w.insured = tier + 1;
  pendingFx.push("slot");
  return `insured — ${w.insured} card(s) survive a shatter`;
}

export function salvageWeapon(): ActionResult {
  const w = state.weaponSlots[activeWeaponSlotIndex()];
  if (!w) return "no weapon equipped";
  // A DELIBERATE sacrifice pays out and returns every card — unlike a shatter,
  // which pays nothing. That asymmetry is the whole point: retiring a weapon on
  // your terms is a decision, losing one to a bad roll is a consequence.
  const gold = salvageValue(w);
  const back = w.cards ?? [];
  for (const id of back) state.cardStash.push(id);
  state.weaponSlots[activeWeaponSlotIndex()] = null;
  state.goldRun += gold;
  addGold(gold, "dungeon-game");
  pendingFx.push("forge");
  return `sacrificed for ${gold}g${back.length > 0 ? ` · ${back.length} card(s) returned` : ""}`;
}

export function addSlot(): ActionResult {
  const w = state.weaponSlots[activeWeaponSlotIndex()];
  if (!w) return "no weapon equipped";
  if (weaponSlotCount(w) >= 3) return "weapon is maxed out";
  if (!pay(PRICE_ADD_SLOT)) return "not enough gold";
  w.bonusSlots = (w.bonusSlots ?? 0) + 1;
  pendingFx.push("slot");
  return "socket added";
}
