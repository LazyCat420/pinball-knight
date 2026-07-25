/**
 * 🍺 THE TAVERN'S ECONOMY — the shop counters, and the no-WebGL fallback room.
 *
 * The walkable tavern lives in `scenes/tavern/`. THIS module owns the commerce
 * that hub opens: prices, stock, socketing, forging, rerolls, and the holo-card
 * renderer. The split is deliberate — the 3D scene never needs to know what a
 * card costs, and this never needs to know where the forge is standing.
 *
 * Two entry points:
 *   - `openVendorCounter()` — ONE vendor's counter, opened by walking up to that
 *     station in the 3D room. This is the normal path.
 *   - `openTavern()` — the whole thing as a flat DOM room, used ONLY when WebGL
 *     is unavailable and the walkable scene can't start.
 *
 * All of it reads/writes RUN-persistent state (weaponSlots, gear, cardStash,
 * goldRun), none of which `resetState` wipes between floors.
 *
 * Stations: ⚔ Armory (socket/un-socket) · 🍺 Alchemist (belt potions) ·
 * 🔨 Weaponsmith (repair, add slot, forge, reroll) · 🛡️ Armorer (plate).
 *
 * NOTE: the old 3D-backdrop-plus-DOM-overlay hybrid (`tavern-scene.ts`,
 * `roomView3d`, the name-plate tracker) was deleted. It was unreachable: the
 * fallback only runs when a WebGLRenderer could not be constructed, and that
 * backdrop needed one too — so its scene was always null on the only path that
 * still reached it.
 */
import { state, activeWeapon } from "./state";
import { WEAPONS, GEAR, GEAR_SLOTS, POTIONS, weaponSlotCount, breakChance, upgradeDamageMult, upgradeDurabilityMult, UPGRADE_DURABILITY_STEP, WEAPON_MAX_CARD_SLOTS, salvageValue, insuranceCost, insuredCards, INSURANCE_MAX_TIER, type WeaponState, type GearSlot, type PotionId } from "./items";
import { sfxBreak } from "./audio";
import { renderKnightPortrait } from "./render/knight-portrait";
import { lookFromGear } from "./render/knight-look";
import { ARMOR_STYLES, ELEMENTAL_STYLE_IDS, activeStyle, isStyleUnlocked, unlockStyle, setActiveStyle, styleGearGrant, type ArmorStyleId } from "./armor-styles";
import { CARDS, RARITY_HEX, STASH_MAX, cardsOfRarity, cardFitsKind, socketCard, lowerRarity, type CardDef, type CardId, type CardRarity } from "./cards";
import { REAGENTS, REAGENT_IDS, type ReagentId } from "./reagents";
import { RECIPES, RECIPE_IDS, canCraft, craftCost, type RecipeDef } from "./recipes";
import { getBalance, spendGold, addGold } from "../../utils/gold-wallet";
import { GOLD, iconTag, holoCard, paintHoloCards, injectCardStyles, weaponPanel, btn } from "./ui-cards";

// ── Prices ── widened spread so the shop has genuinely expensive pulls, not
// just cheap chips: a mythic costs a whole run's savings.
// Cards are MONSTER TROPHIES. The shelf exists so a run that rolled badly is not
// dead, not as a way to buy the build you want — so the prices are deliberately
// steep and the stock is 3 random cards you cannot choose (rollBarOffers).
const PRICE_CARD: Record<CardRarity, number> = { common: 55, rare: 170, epic: 420, legendary: 900, mythic: 1800 };
const PRICE_REROLL_BAR = 15;
const PRICE_REPAIR_WEAPON = 30;
const PRICE_ADD_SLOT = 60;
/** Weaponsmith UPGRADE — cost climbs with the level, so pushing deep costs real
 *  gold as well as real risk. */
const PRICE_UPGRADE_BASE = 45;
const PRICE_REROLL_CARD = 40;
const PRICE_REPAIR_GEAR = 40;
// The Alchemist's stock — a curated shelf that carries onto the belt (Shift+1-4).
const POTION_STOCK: PotionId[] = ["health", "rage", "haste", "shield", "freeze", "ballform"];
const PRICE_POTION: Partial<Record<PotionId, number>> = { health: 15, rage: 28, haste: 28, shield: 34, freeze: 40, ballform: 65 };
// The Armorer's stock — grant a gear piece to its base soak (boots use 1 as the
// "equipped" sentinel, matching the dungeon pickup path).
const PRICE_GEAR: Record<GearSlot, number> = { helmet: 45, armor: 70, boots: 40 };
const BELT_MAX = 4;
/** Empty Flask catalyst — cheap off the shelf (RO buys Empty Bottles from an
 * NPC); also craftable from Glass Shards via the `flask` recipe. */
const PRICE_FLASK = 8;
/** The reagent the card forge consumes — a RARE drop (reaper/necromancer/boss),
 *  so forging a rare card costs you a rare monster. */
const FORGE_CATALYST = "grimbone";
/** Rarity ladder, low->high. Insurance saves the RAREST cards first, so it needs
 *  an ordering; `indexOf` on this is that ordering. */
const CARD_RANK: CardRarity[] = ["common", "rare", "epic", "legendary", "mythic"];

/**
 * One-shot flourishes queued by successful counter actions, consumed by the
 * walkable scene when the counter closes: the knight hammers at the anvil for
 * smith work, hoists new plate for a gear buy. The economy layer never touches
 * the 3D knight directly — same split as the rest of this module.
 */
export type TavernFx = "repair" | "gear" | "slot" | "forge";
let pendingFx: TavernFx[] = [];
export function consumePendingTavernFx(): TavernFx[] {
  const out = pendingFx;
  pendingFx = [];
  return out;
}

/** Which vendor's counter is open; null = the room view (walk the tavern). */
export type VendorId = "cards" | "weapons" | "armor" | "potions";
let activeVendor: VendorId | null = null;

/**
 * COUNTER MODE — set when the walkable tavern (`scenes/tavern/`) opened a single
 * vendor by walking up to their station, rather than this module rendering its
 * own room.
 *
 * In that mode there is no room view to go "back" to: the room is the real 3D
 * scene behind us, so `← Tavern` hands control back to it instead. Everything
 * else — prices, stock, socketing, forging — is the same code path, which is the
 * point: the walkable hub reuses the economy rather than reimplementing it.
 */
let counterMode: { onClose: () => void } | null = null;

interface VendorDef {
  id: VendorId;
  name: string;
  icon: string;
  robe: string;
  prop: string;
  blurb: string;
}
const VENDORS: VendorDef[] = [
  { id: "potions", name: "Alchemist", icon: "🧪", robe: "#3f9d5a", prop: "⚗️", blurb: "potions for the belt" },
  { id: "cards", name: "Card Dealer", icon: "🃏", robe: "#8b5cf6", prop: "🎴", blurb: "power cards & socketing" },
  { id: "weapons", name: "Weaponsmith", icon: "🔨", robe: "#b45309", prop: "⚒️", blurb: "repairs, slots & forging" },
  { id: "armor", name: "Armorer", icon: "🛡️", robe: "#5b86c4", prop: "🥋", blurb: "plate & repairs" },
];

interface TavernStats {
  grade: string;
  floor: number;
  kills: number;
  bestCombo: number;
}
interface TavernDeps {
  onDescend: () => void;
  stats: TavernStats;
}

// ── Ephemeral UI selection (reset on open) ──
let selectedStash = -1; // a stash card picked to socket
let forgePick: number[] = []; // stash indices chosen for a forge
/** Upgrade level the player has ARMED (clicked once) but not yet confirmed.
 *  null = nothing armed. Reset on every other action so a stale arm can't fire. */
let upgradeArmed: number | null = null;

/**
 * 🧿 INSURANCE row — pay in advance so a shatter does not take your trophies.
 *
 * This is what stops upgrade risk from being a pure grind. The weapon still
 * dies (protecting that would delete the risk), but the CARDS — the things you
 * actually hunted a specific monster for — can be bought back out of the fire
 * before you roll. Sacrifice gold now for a softer landing, or keep the gold
 * and gamble the trophies.
 */
function insureRow(w: WeaponState): string {
  const cards = w.cards?.length ?? 0;
  if (cards === 0) return "";
  const tier = Math.min(w.insured ?? 0, INSURANCE_MAX_TIER);
  const pips = Array.from({ length: INSURANCE_MAX_TIER }, (_, i) => (i < tier ? "🧿" : "·")).join("");
  if (tier >= INSURANCE_MAX_TIER || tier >= cards) {
    return `<div style="color:#8fc46b;font-size:9px;margin-top:4px">${pips} INSURED — ${Math.min(tier, cards)} card(s) survive a shatter</div>`;
  }
  return `<div style="margin-top:4px">
    <span style="color:#9a8f77;font-size:9px">${pips} insured: ${tier}/${Math.min(INSURANCE_MAX_TIER, cards)} cards survive a shatter</span>
    ${btn("insure", `🧿 Insure ${tier + 1} card${tier + 1 > 1 ? "s" : ""}`, insuranceCost(tier, w.rarity ?? "common"))}
  </div>`;
}

/**
 * ⚒️ UPGRADE panel — the anti-hoard gamble, stated plainly.
 *
 * The whole point of upgrade risk is that the player CHOOSES it, so the exact
 * break chance is on the button before the click, and anything above 0% needs a
 * second click to confirm. A hidden roll that eats a legendary is a feel-bad; a
 * stated 36% gamble is a story the player tells afterwards.
 */
function upgradePanel(): string {
  const w = state.weaponSlots[activeWeaponSlotIndex()];
  if (!w) {
    return `<div style="border-top:1px solid #4a3d28;padding-top:8px;color:#6c5a3e;font-size:10px">UPGRADE — no weapon equipped</div>`;
  }
  const lvl = w.upgrade ?? 0;
  const risk = breakChance(lvl);
  const cost = PRICE_UPGRADE_BASE + lvl * 25;
  const pct = Math.round(risk * 100);
  const armed = upgradeArmed === lvl && risk > 0;
  const riskTxt = risk === 0
    ? `<span style="color:#8fc46b">SAFE — no break chance</span>`
    : `<span style="color:${pct >= 36 ? "#d95763" : "#f0a63c"}">${pct}% chance to SHATTER the weapon</span>`;
  const cards = w.cards?.length ?? 0;
  const tier = w.insured ?? 0;
  const atRisk = Math.max(0, cards - Math.min(tier, INSURANCE_MAX_TIER));
  return `<div style="border-top:1px solid #4a3d28;padding-top:8px;margin-top:8px">
    <div style="color:#c9c1ad;font-size:11px">UPGRADE — ${WEAPONS[w.id].icon} ${WEAPONS[w.id].label} <b style="color:${GOLD}">+${lvl}</b></div>
    <div style="color:#9a8f77;font-size:9px;margin:2px 0">
      next: damage ×${upgradeDamageMult(lvl + 1).toFixed(2)} · durability ×${upgradeDurabilityMult(lvl + 1).toFixed(2)} · ${riskTxt}
    </div>
    ${armed ? `<div style="color:#d95763;font-size:10px;margin:3px 0">⚠ CONFIRM — a failure destroys the weapon${atRisk > 0 ? ` and ${atRisk} of its ${cards} card(s)` : cards > 0 ? " but your insured cards survive" : ""}.</div>` : ""}
    ${btn("upgrade", armed ? `⚠️ CONFIRM +${lvl + 1}` : `⚒️ Upgrade to +${lvl + 1}`, cost)}
    ${insureRow(w)}
    <div style="color:#9a8f77;font-size:9px;margin-top:6px">
      Retiring it pays <b style="color:${GOLD}">${salvageValue(w)}g</b> and returns every card. A SHATTER pays nothing.
    </div>
    ${btn("salvage", "♻️ Sacrifice weapon", undefined)}
  </div>`;
}
let barOffers: CardId[] = [];
let alchemistTab: "buy" | "brew" = "buy"; // Alchemist counter: shelf vs brew book
let deps: TavernDeps | null = null;

/** Belt room for a potion WITHOUT mutating (a matching stack, or an empty slot). */
function beltHasRoom(id: PotionId): boolean {
  return state.belt.some((s) => s && s.id === id) || state.belt.some((s) => !s);
}

function rollBarOffers(): void {
  // Weighted stock: mostly common/rare with the occasional epic, and a RARE
  // chance at a legendary or a mythic — so the shelf sometimes shows a pull you
  // have to save the whole run for, not just cheap chips.
  const pool: CardId[] = [];
  for (let k = 0; k < 3; k++) {
    const r = Math.random();
    const rarity: CardRarity = r < 0.5 ? "common" : r < 0.82 ? "rare" : r < 0.95 ? "epic" : r < 0.99 ? "legendary" : "mythic";
    const bag = cardsOfRarity(rarity);
    pool.push(bag[Math.floor(Math.random() * bag.length)]);
  }
  barOffers = pool;
}

/** Spend gold (wallet is the source of truth; keep the run tally in sync). */
function pay(amount: number): boolean {
  if (getBalance() < amount || !spendGold(amount)) return false;
  state.goldRun = Math.max(0, state.goldRun - amount);
  return true;
}

/** Stow a potion on the quick-use belt (stacks onto a match, else first empty).
 * Mirrors core.ts addToBelt so tavern buys behave like dungeon pickups. */
function stowOnBelt(id: PotionId): boolean {
  for (const s of state.belt) {
    if (s && s.id === id) { s.count++; return true; }
  }
  for (let i = 0; i < state.belt.length; i++) {
    if (!state.belt[i]) { state.belt[i] = { id, icon: POTIONS[id].icon, count: 1 }; return true; }
  }
  return false;
}

/** Undo a stow (refund path when the pay fails after we already placed it). */
function unstowFromBelt(id: PotionId): void {
  for (let i = 0; i < state.belt.length; i++) {
    const s = state.belt[i];
    if (s && s.id === id) { s.count--; if (s.count <= 0) state.belt[i] = null; return; }
  }
}

function activeWeaponSlotIndex(): number {
  // Prefer the active slot; fall back to the first non-null.
  if (state.weaponSlots[state.activeSlot]) return state.activeSlot;
  const i = state.weaponSlots.findIndex((w) => w);
  return i < 0 ? state.activeSlot : i;
}

/** Inject the tavern's holo-card stylesheet once (idempotent). */
function injectTavernStyles(): void {
  if (document.getElementById("tavern-holo-style")) return;
  const s = document.createElement("style");
  s.id = "tavern-holo-style";
  s.textContent = `
    /* ── The isometric tavern room ── */
    .tv-room{position:absolute;inset:0;overflow:hidden;
      background:linear-gradient(180deg,#1c150d 0%,#140f09 62%,#0c0906 100%)}
    .tv-backwall{position:absolute;left:0;right:0;top:0;height:56%;
      background:linear-gradient(180deg,#2c2114 0%,#241a10 70%,#1b140c 100%);
      box-shadow:inset 0 -22px 34px rgba(0,0,0,.55);
      background-image:repeating-linear-gradient(90deg,rgba(0,0,0,.16) 0 2px,transparent 2px 62px),
        repeating-linear-gradient(0deg,rgba(0,0,0,.14) 0 2px,transparent 2px 40px)}
    /* isometric plank floor: a receding wood pattern under a warm wash */
    .tv-floor{position:absolute;left:0;right:0;bottom:0;height:46%;
      background:linear-gradient(180deg,#3a2a18,#241a0f);
      background-image:repeating-linear-gradient(90deg,rgba(0,0,0,.28) 0 1px,transparent 1px 46px),
        repeating-linear-gradient(0deg,rgba(255,220,150,.05) 0 1px,transparent 1px 26px);
      box-shadow:inset 0 40px 60px rgba(0,0,0,.5);
      transform:perspective(520px) rotateX(46deg);transform-origin:bottom center}
    /* fireplace on the back wall */
    .tv-fireplace{position:absolute;left:50%;top:14%;transform:translateX(-50%);width:150px;height:150px}
    .tv-mantel{position:absolute;top:-10px;left:-16px;right:-16px;height:14px;border-radius:3px;
      background:linear-gradient(180deg,#5a4426,#3a2c17);box-shadow:0 3px 6px rgba(0,0,0,.5)}
    .tv-firebox{position:absolute;inset:8px 20px 0;border-radius:8px 8px 4px 4px;
      background:radial-gradient(circle at 50% 90%,#3a1c08,#120a05 75%);
      box-shadow:inset 0 0 20px #000,0 0 0 6px #241609,0 0 0 8px #3a2c17;overflow:hidden}
    .tv-flame{position:absolute;bottom:6px;left:50%;width:26px;height:44px;border-radius:50% 50% 50% 50%/62% 62% 38% 38%;
      transform-origin:bottom center;filter:blur(.4px);mix-blend-mode:screen}
    .tv-flame.f1{background:radial-gradient(circle at 50% 80%,#ffe08a,#ff8a1e 55%,transparent 72%);animation:tv-fl 1.1s ease-in-out infinite}
    .tv-flame.f2{width:18px;height:34px;background:radial-gradient(circle at 50% 80%,#fff3c0,#ffb43a 55%,transparent 72%);animation:tv-fl .8s ease-in-out infinite .2s}
    .tv-flame.f3{width:12px;height:24px;background:radial-gradient(circle at 50% 80%,#fff,#ffd76a 60%,transparent 74%);animation:tv-fl .6s ease-in-out infinite .1s}
    @keyframes tv-fl{0%,100%{transform:translateX(-50%) scaleY(.92) scaleX(1)}50%{transform:translateX(-50%) scaleY(1.14) scaleX(.9)}}
    .tv-fireglow{position:absolute;inset:-40px;border-radius:50%;pointer-events:none;
      background:radial-gradient(circle,rgba(255,150,40,.34),transparent 62%);animation:tv-glow 2.4s ease-in-out infinite}
    @keyframes tv-glow{0%,100%{opacity:.72}50%{opacity:1}}
    /* notice board hung on the wall */
    .tv-board{position:absolute;right:3.5%;top:8%;width:170px;padding:9px 11px;border-radius:6px;
      background:linear-gradient(180deg,#3a2c17,#241a0f);border:2px solid #5a4426;box-shadow:0 5px 14px rgba(0,0,0,.55);transform:rotate(-1.2deg)}
    .tv-board-row{display:flex;justify-content:space-between;gap:8px;color:#d9cfb6;font-size:10px;margin-top:4px}
    /* an NPC keeper you walk up to */
    .tv-npc{position:absolute;bottom:17%;width:100px;transform:translateX(-50%);background:none;border:none;padding:0;
      cursor:pointer;display:flex;flex-direction:column;align-items:center;color:#e8dcc0;font-family:inherit}
    .tv-npc .tv-prop{font-size:22px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));margin-bottom:1px;opacity:.9}
    .tv-person{position:relative;width:44px;height:66px;animation:tv-bob 3s ease-in-out infinite}
    .tv-npc:nth-child(3) .tv-person{animation-delay:.5s}
    .tv-npc:nth-child(4) .tv-person{animation-delay:1s}
    .tv-npc:nth-child(5) .tv-person{animation-delay:1.5s}
    @keyframes tv-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
    .tv-head{position:absolute;top:0;left:50%;transform:translateX(-50%);width:20px;height:20px;border-radius:50%;
      background:radial-gradient(circle at 40% 35%,#f1c9a5,#c98f63);box-shadow:0 1px 2px rgba(0,0,0,.5),inset -2px -2px 3px rgba(0,0,0,.25)}
    .tv-body{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:40px;height:46px;border-radius:16px 16px 8px 8px;
      background:linear-gradient(180deg,var(--robe),color-mix(in srgb,var(--robe) 55%,#000));
      box-shadow:inset 0 -6px 10px rgba(0,0,0,.35),0 3px 8px rgba(0,0,0,.5)}
    .tv-arm{position:absolute;bottom:14px;width:9px;height:30px;border-radius:6px;
      background:linear-gradient(180deg,var(--robe),color-mix(in srgb,var(--robe) 50%,#000))}
    .tv-arm-l{left:2px;transform:rotate(9deg)}.tv-arm-r{right:2px;transform:rotate(-9deg)}
    .tv-talk{margin-top:5px;font-size:9px;letter-spacing:1px;color:#f0a63c;opacity:0;transition:opacity .15s;
      text-shadow:0 0 6px rgba(240,166,60,.6)}
    .tv-npc:hover .tv-talk{opacity:1}
    .tv-npc:hover .tv-person{filter:drop-shadow(0 0 8px rgba(240,166,60,.5))}
    .tv-plate{margin-top:2px;font-size:10px;font-weight:800;letter-spacing:.4px;white-space:nowrap;
      background:#00000066;padding:2px 7px;border-radius:9px;border:1px solid #4a3d28}
    /* the descend door */
    .tv-door{position:absolute;left:50%;bottom:2.5%;transform:translateX(-50%);width:200px;text-align:center;z-index:3}
    .tv-descend{cursor:pointer;width:100%;background:${GOLD};color:#160f06;border:none;border-radius:6px;padding:10px;
      font:900 15px ui-monospace,Menlo,monospace;letter-spacing:3px;box-shadow:0 4px 14px rgba(240,166,60,.4)}
    .tv-descend:hover{filter:brightness(1.08)}
    /* a vendor's open counter, over a dimmed room */
    .tv-vendor{position:fixed;inset:0;z-index:6;background:rgba(6,4,3,.86);backdrop-filter:blur(3px);
      display:flex;flex-direction:column;align-items:center;padding:16px 16px 20px;box-sizing:border-box;animation:tv-fade .18s ease}
    @keyframes tv-fade{from{opacity:0}to{opacity:1}}
    .tv-vendor-head{width:100%;max-width:880px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #4a3d28;padding-bottom:8px;margin-bottom:10px}
    .tv-back{cursor:pointer;background:#171208;color:${GOLD};border:1px solid ${GOLD};border-radius:5px;
      padding:5px 10px;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.5px}
    .tv-back:hover{background:#241609}
    .tv-vendor-body{width:100%;max-width:880px;overflow:auto;flex:1;min-height:0}
    /* ── 3D-room DOM overlays (name-plates parked over the rendered keepers) ── */
    .tv-board3d{position:fixed;z-index:2;right:2%;top:74px}
    .tv-hotspots{position:fixed;inset:0;z-index:2;pointer-events:none}
    .tv-hotspot{position:fixed;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:2px;
      background:none;border:none;padding:0;cursor:pointer;pointer-events:auto;opacity:0;transition:opacity .2s;font-family:inherit}
    .tv-talk3d{font-size:9px;letter-spacing:1px;color:${GOLD};opacity:0;transition:opacity .15s;text-shadow:0 0 6px rgba(240,166,60,.7)}
    .tv-hotspot:hover .tv-talk3d{opacity:1}
    .tv-hotspot:hover .tv-plate{border-color:${GOLD};box-shadow:0 0 10px rgba(240,166,60,.4)}
    .tv-door3d{position:fixed;z-index:2;left:50%;bottom:3%;transform:translateX(-50%);width:220px;text-align:center}`;
  document.head.appendChild(s);
}

// ── Vendor counter bodies (each NPC's shop content) ──────────────────────────

/** 🃏 Card Dealer — buy cards, reroll the stock, and socket the stash into weapons. */
function cardsBody(): string {
  const stash = state.cardStash;
  const offers = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end">${barOffers
    .map((id, i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">${holoCard(id, { size: "lg" })}${btn(`buycard:${i}`, "Buy", PRICE_CARD[CARDS[id].rarity], stash.length >= STASH_MAX)}</div>`)
    .join("")}</div>`;
  const weapons = state.weaponSlots.map((w, i) => (w ? weaponPanel(w, i) : "")).join("");
  const stashHtml = stash.length
    ? stash.map((id, i) => holoCard(id, { act: "pick", idx: i, picked: i === selectedStash, size: "md" })).join("")
    : `<span style="color:#6c5a3e;font-size:11px">no stashed cards — kill enemies to find them</span>`;
  return `
    <div style="color:#c9c1ad;font-size:11px;margin-bottom:4px">CARDS FOR SALE</div>
    ${offers}
    <div style="margin:8px 0">${btn("reroll-bar", "🔄 Reroll stock", PRICE_REROLL_BAR)}</div>
    <div style="border-top:1px solid #4a3d28;padding-top:8px;margin-top:4px;color:#c9c1ad;font-size:11px;letter-spacing:.5px">YOUR WEAPONS — pick a stash card, then click a ＋ slot</div>
    ${weapons}
    <div style="margin-top:8px;color:#c9c1ad;font-size:10px;letter-spacing:.5px">STASH (${stash.length}/${STASH_MAX})</div>
    <div style="display:flex;flex-wrap:wrap;margin-top:4px">${stashHtml}</div>`;
}

/** 🔨 Weaponsmith — repair the blade, add a card slot, forge + reroll cards. */
function weaponsBody(): string {
  const stash = state.cardStash;
  const commons = stash.map((id, i) => ({ id, i })).filter((x) => CARDS[x.id].rarity === "common");
  const forgeList = commons.length
    ? commons.map((x) => `<span data-act="forgepick" data-idx="${x.i}" style="cursor:pointer">${holoCard(x.id, { size: "sm", picked: forgePick.includes(x.i) })}</span>`).join("")
    : `<span style="color:#6c5a3e;font-size:10px">no common cards to forge</span>`;
  const rerollList = stash.length
    ? stash.map((id, i) => `<span data-act="rerollcard" data-idx="${i}" title="reroll (${PRICE_REROLL_CARD}g)" style="cursor:pointer">${holoCard(id, { size: "sm" })}</span>`).join("")
    : `<span style="color:#6c5a3e;font-size:10px">—</span>`;
  return `
    <div style="margin-bottom:8px">
      ${btn("repair-weapon", "🛠️ Repair weapon", PRICE_REPAIR_WEAPON)}
      ${btn("addslot", "➕ Add card slot", PRICE_ADD_SLOT)}
    </div>
    ${upgradePanel()}
    <div style="border-top:1px solid #4a3d28;padding-top:8px;color:#c9c1ad;font-size:11px">FORGE — pick 2 commons → 1 rare</div>
    <div style="display:flex;flex-wrap:wrap;margin:4px 0">${forgeList}</div>
    <div>${btn("forge", `⚒️ Forge (💀 ${state.reagents[FORGE_CATALYST] ?? 0})`, undefined, forgePick.length !== 2 || (state.reagents[FORGE_CATALYST] ?? 0) < 1)}</div>
    <div style="border-top:1px solid #4a3d28;padding-top:8px;margin-top:8px;color:#c9c1ad;font-size:11px">REROLL a card (same rarity, new roll) — click one:</div>
    <div style="display:flex;flex-wrap:wrap;margin:4px 0">${rerollList}</div>`;
}

/** 🛡️ Armorer — buy fresh plate for empty/worn slots, repair all gear. The
 * MIRROR beside the list is the menu's paperdoll (`renderKnightPortrait`), so
 * hovering a piece shows the plate ON your actual sprite before you pay. */
function armorBody(): string {
  const pieces = GEAR_SLOTS.map((s) => {
    const base = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
    const grant = styleGearGrant(s, base);
    const cur = state.gear[s] ?? 0;
    const owned = cur >= grant;
    const soak = GEAR[s].absorb > 0 ? `soaks ${grant}` : "+move speed";
    return `<div data-prev="${s}" style="display:flex;align-items:center;gap:8px;margin:4px 0;padding:4px 6px;border:1px solid transparent;border-radius:6px">
      ${iconTag(s, GEAR[s].icon, 34)}
      <span style="display:flex;flex-direction:column;line-height:1.15"><b style="color:#e8dcc0;font-size:12px">${GEAR[s].label}</b><span style="color:#9a8f77;font-size:9px">${soak}${owned ? ` · equipped (${cur})` : ""}</span></span>
      <span style="flex:1"></span>
      ${owned ? `<span style="color:#5a7d4a;font-size:10px;letter-spacing:.5px">EQUIPPED</span>` : btn(`buygear:${s}`, "Buy", PRICE_GEAR[s])}
    </div>`;
  }).join("");
  // ── Elemental SETS — permanent style unlocks (armor-styles.ts). A set is a
  // prestige purchase: several runs of banked kills, not an impulse buy. Iron
  // heads the list so switching back is always one click.
  const worn = activeStyle();
  const styleRow = (id: ArmorStyleId): string => {
    const d = ARMOR_STYLES[id];
    const unlocked = isStyleUnlocked(id);
    const isWorn = worn === id;
    const bonus = d.bonusAbsorb.helmet > 0 ? ` · finer steel (helm +${d.bonusAbsorb.helmet}, armor +${d.bonusAbsorb.armor} soak)` : "";
    const action = isWorn
      ? `<span style="color:#5a7d4a;font-size:10px;letter-spacing:.5px">WORN</span>`
      : unlocked
        ? btn(`wearstyle:${id}`, "Wear")
        : btn(`buyset:${id}`, "Buy set", d.price);
    return `<div data-prevstyle="${id}" style="display:flex;align-items:center;gap:8px;margin:4px 0;padding:4px 6px;border:1px solid transparent;border-radius:6px">
      <span style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:19px;background:#00000055;border:1px solid ${d.swatch};border-radius:6px">${d.icon}</span>
      <span style="display:flex;flex-direction:column;line-height:1.15"><b style="color:${d.swatch};font-size:12px">${d.label}</b><span style="color:#9a8f77;font-size:9px">${d.blurb}${unlocked ? "" : bonus}</span></span>
      <span style="flex:1"></span>
      ${action}
    </div>`;
  };
  const sets = (["iron", ...ELEMENTAL_STYLE_IDS] as ArmorStyleId[]).map(styleRow).join("");
  return `
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 12px;background:#00000044;border:1px solid #4a3d28;border-radius:8px;flex:0 0 auto">
        <span style="color:#c9c1ad;font-size:10px;letter-spacing:.5px">THE MIRROR</span>
        <canvas id="armorer-doll" width="180" height="200" style="image-rendering:pixelated"></canvas>
        <span id="armorer-doll-cap" style="color:#9a8f77;font-size:9px;text-align:center;max-width:180px">hover a piece to see it on you</span>
      </div>
      <div style="flex:1;min-width:260px">
        <div style="color:#c9c1ad;font-size:11px;margin-bottom:4px">PLATE FOR SALE</div>
        ${pieces}
        <div style="border-top:1px solid #4a3d28;padding-top:8px;margin-top:6px">${btn("repair-gear", "🛡️ Repair all gear", PRICE_REPAIR_GEAR)}</div>
        <div style="border-top:1px solid #4a3d28;padding-top:8px;margin-top:8px;color:#c9c1ad;font-size:11px;margin-bottom:4px">STYLES OF THE FORGE <span style="color:#9a8f77;font-size:9px">— buy a set once, wear it forever · comes with full plate</span></div>
        ${sets}
      </div>
    </div>`;
}

/**
 * Paint the armorer's mirror and wire the hover previews.
 *
 * Called after every armor-counter render: the counter is string-HTML, so the
 * canvas and its rows are recreated each time and the listeners must be too
 * (same reason `paintHoloCards` runs post-render). The preview forces the
 * hovered slot ON over your real gear — for a piece you already wear it simply
 * shows what you have, which is honest either way.
 */
function wireArmorerMirror(stage: Element): void {
  const canvas = stage.querySelector<HTMLCanvasElement>("#armorer-doll");
  if (!canvas) return;
  const cap = stage.querySelector<HTMLElement>("#armorer-doll-cap");
  const paint = (previewSlot: GearSlot | null, previewStyle?: ArmorStyleId): void => {
    // A style preview shows the FULL SET in that style — that's what the gold
    // buys, so that's what the mirror sells. Slot previews keep your worn style.
    const look = previewStyle ? { helmet: true, armor: true, boots: true, style: previewStyle } : lookFromGear(state.gear);
    if (previewSlot) look[previewSlot] = true;
    renderKnightPortrait(canvas, activeWeapon().id, look);
    if (cap) cap.textContent = previewStyle ? `${ARMOR_STYLES[previewStyle].label} — the full set` : previewSlot ? `wearing the ${GEAR[previewSlot].label}` : "hover a piece to see it on you";
  };
  paint(null);
  const hoverRow = (row: HTMLElement, over: () => void): void => {
    row.addEventListener("mouseenter", () => { row.style.borderColor = "#4a3d28"; row.style.background = "#00000044"; over(); });
    row.addEventListener("mouseleave", () => { row.style.borderColor = "transparent"; row.style.background = "none"; paint(null); });
  };
  stage.querySelectorAll<HTMLElement>("[data-prev]").forEach((row) => hoverRow(row, () => paint(row.dataset.prev as GearSlot)));
  stage.querySelectorAll<HTMLElement>("[data-prevstyle]").forEach((row) => hoverRow(row, () => paint(null, row.dataset.prevstyle as ArmorStyleId)));
}

/** The alchemy pouch line: flasks + every reagent you're carrying. */
function pouchStrip(): string {
  const chips = REAGENT_IDS.filter((id) => (state.reagents[id] ?? 0) > 0)
    .map((id) => `<span title="${REAGENTS[id].label}" style="color:${REAGENTS[id].color};font-size:11px;white-space:nowrap">${REAGENTS[id].icon}×${state.reagents[id]}</span>`)
    .join("  ");
  const body = chips || `<span style="color:#6c5a3e;font-size:10px">no reagents yet — slay monsters to gather them</span>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:2px 0 8px;padding:5px 7px;background:#00000044;border:1px solid #4a3d28;border-radius:6px">
    <b style="color:#c9c1ad;font-size:10px;letter-spacing:.5px">POUCH</b>
    <span style="color:#e8dcc0;font-size:11px">🧴×${state.flasks}</span>
    ${body}</div>`;
}

/** One reagent-cost badge, green when satisfied and red when short. */
function costBadge(icon: string, have: number, need: number): string {
  const ok = have >= need;
  return `<span style="color:${ok ? "#8fc46b" : "#c0705a"};font-size:10px;white-space:nowrap">${icon}${have}/${need}</span>`;
}

/** One row of the brew book — output, its have/need ingredient badges, Brew. */
function recipeRow(r: RecipeDef): string {
  const parts = (Object.entries(r.inputs) as Array<[ReagentId, number]>)
    .map(([id, n]) => costBadge(REAGENTS[id].icon, state.reagents[id] ?? 0, n))
    .join(" ");
  const flaskBadge = r.flasks > 0 ? " " + costBadge("🧴", state.flasks, r.flasks) : "";
  const goldBadge = r.gold ? ` <span style="color:${getBalance() >= r.gold ? GOLD : "#c0705a"};font-size:10px">${r.gold}g</span>` : "";
  const iconId = r.output === "flask" ? "flask" : r.output;
  const can = canCraft(r, state.reagents, state.flasks, getBalance()) && (r.output === "flask" || beltHasRoom(r.output as PotionId));
  return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;padding:5px 7px;background:#00000044;border:1px solid #4a3d28;border-radius:6px">
    ${iconTag(iconId, r.icon, 32)}
    <span style="display:flex;flex-direction:column;line-height:1.25;gap:1px"><b style="color:#e8dcc0;font-size:12px">${r.label}</b><span>${parts}${flaskBadge}${goldBadge}</span></span>
    <span style="flex:1"></span>
    ${btn(`brew:${r.id}`, "Brew", undefined, !can)}
  </div>`;
}

/** 🧪 Alchemist — BUY belt potions off the shelf, or BREW them from reagents. */
function potionsBody(): string {
  const beltCount = state.belt.filter((b) => b).length;
  const beltFull = beltCount >= BELT_MAX && !state.belt.some((b) => b && b.count < 99);
  const beltTxt = state.belt.map((b) => (b ? `${b.icon}×${b.count}` : "·")).join("  ");
  const tab = (id: "buy" | "brew", label: string): string => {
    const on = alchemistTab === id;
    return `<button data-act="alchtab:${id}" style="cursor:pointer;background:${on ? "#2a2010" : "#171208"};color:${on ? GOLD : "#9a8f77"};border:1px solid ${on ? GOLD : "#4a3d28"};border-bottom:none;border-radius:5px 5px 0 0;padding:5px 12px;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.5px">${label}</button>`;
  };
  const header = `
    <div style="color:#c9c1ad;font-size:11px;margin-bottom:2px">BELT ${beltCount}/${BELT_MAX} — <span style="color:#e8dcc0">${beltTxt}</span></div>
    <div style="color:#9a8f77;font-size:9px;margin-bottom:6px">potions ride your belt into the next floor · use with Shift+1-4</div>
    <div style="display:flex;gap:4px;margin-bottom:-1px">${tab("buy", "🛒 Buy")}${tab("brew", "⚗️ Brew")}</div>`;

  if (alchemistTab === "buy") {
    const shelf = POTION_STOCK.map((id) => {
      const p = POTIONS[id];
      const price = PRICE_POTION[id] ?? 30;
      const eff = p.heal ? `heal ${p.heal}` : p.duration ? `${p.duration}s` : "instant";
      return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;padding:5px 7px;background:#00000044;border:1px solid #4a3d28;border-radius:6px">
        ${iconTag(id, p.icon, 34)}
        <span style="display:flex;flex-direction:column;line-height:1.15"><b style="color:#e8dcc0;font-size:12px">${p.label}</b><span style="color:#9a8f77;font-size:9px">${eff}</span></span>
        <span style="flex:1"></span>
        ${btn(`buypotion:${id}`, "Buy", price, beltFull)}
      </div>`;
    }).join("");
    return `${header}<div style="border:1px solid #4a3d28;border-radius:0 6px 6px 6px;padding:8px">${shelf}</div>`;
  }

  // Brew tab: pouch, a cheap flask buy, then the recipe book (flask recipe first).
  const flaskRow = `<div style="display:flex;align-items:center;gap:8px;margin:0 0 6px;padding:5px 7px;background:#00000044;border:1px dashed #4a3d28;border-radius:6px">
    <span style="font-size:26px">🧴</span>
    <span style="display:flex;flex-direction:column;line-height:1.15"><b style="color:#e8dcc0;font-size:12px">Empty Flask</b><span style="color:#9a8f77;font-size:9px">catalyst · every brew needs one</span></span>
    <span style="flex:1"></span>
    ${btn("buyflask", "Buy", PRICE_FLASK)}
  </div>`;
  const book = RECIPE_IDS.map((id) => recipeRow(RECIPES[id])).join("");
  return `${header}<div style="border:1px solid #4a3d28;border-radius:0 6px 6px 6px;padding:8px">
    ${pouchStrip()}
    ${flaskRow}
    <div style="color:#c9c1ad;font-size:10px;letter-spacing:.5px;margin:2px 0 4px">BREW BOOK — reagents drop from the monsters they suit</div>
    ${book}</div>`;
}

const VENDOR_BODY: Record<VendorId, () => string> = { cards: cardsBody, weapons: weaponsBody, armor: armorBody, potions: potionsBody };

/** One NPC standing in the tavern — click to open their counter. */
function npcFigure(v: VendorDef, leftPct: number): string {
  return `<button data-act="vendor:${v.id}" class="tv-npc" style="left:${leftPct}%;--robe:${v.robe}" title="${v.blurb}">
    <span class="tv-prop">${v.prop}</span>
    <span class="tv-person"><span class="tv-head"></span><span class="tv-arm tv-arm-l"></span><span class="tv-arm tv-arm-r"></span><span class="tv-body"></span></span>
    <span class="tv-talk">▲ Talk</span>
    <span class="tv-plate">${v.icon} ${v.name}</span>
  </button>`;
}

/** The isometric tavern room: fireplace, plank floor, four vendor NPCs, board, door. */
function roomView(): string {
  if (!deps) return "";
  const npcs = VENDORS.map((v, i) => npcFigure(v, 12 + i * 25.5)).join("");
  const gearTxt = GEAR_SLOTS.map((s) => `${GEAR[s].icon} ${state.gear[s] ?? 0}`).join("  ");
  return `<div class="tv-room">
    <div class="tv-backwall">
      <div class="tv-fireplace"><div class="tv-mantel"></div><div class="tv-firebox"><span class="tv-flame f1"></span><span class="tv-flame f2"></span><span class="tv-flame f3"></span></div><div class="tv-fireglow"></div></div>
      <div class="tv-board">
        <b style="color:${GOLD};letter-spacing:1px;font-size:11px">📜 NOTICE BOARD</b>
        <div class="tv-board-row"><span>Floor cleared</span><b style="color:${GOLD}">${deps.stats.floor}</b></div>
        <div class="tv-board-row"><span>Grade</span><b style="color:${GOLD}">${deps.stats.grade}</b></div>
        <div class="tv-board-row"><span>Kills</span><b>${deps.stats.kills}</b></div>
        <div class="tv-board-row"><span>Best combo</span><b>×${deps.stats.bestCombo}</b></div>
        <div class="tv-board-row"><span>Gear</span><b>${gearTxt}</b></div>
      </div>
    </div>
    <div class="tv-floor"></div>
    ${npcs}
    <div class="tv-door">
      <button data-act="descend" class="tv-descend">DESCEND ▼</button>
      <div style="color:#9a8f77;font-size:9px;text-align:center;margin-top:3px">talk to a keeper, then take the stairs</div>
    </div>
  </div>`;
}


/** A vendor's open counter, over a dimmed room. */
function vendorView(v: VendorDef): string {
  return `<div class="tv-vendor">
    <div class="tv-vendor-head">
      <button data-act="back" class="tv-back" title="back to the tavern">← Tavern</button>
      <b style="font-size:16px;color:${GOLD};letter-spacing:1px;font-variant:small-caps">${v.icon} ${v.name}</b>
      <span style="flex:1"></span>
      <span style="color:#c9c1ad;font-size:12px">purse <b style="color:${GOLD}">${getBalance()}g</b></span>
    </div>
    <div class="tv-vendor-body">${VENDOR_BODY[v.id]()}</div>
  </div>`;
}

function render(): void {
  const el = state.tavernEl;
  if (!el || !deps) return;
  const stage = el.querySelector("#tavern-grid");
  if (!stage) return;
  const v = activeVendor ? VENDORS.find((x) => x.id === activeVendor) : null;
  if (counterMode) {
    // One counter, no room view — the walkable tavern is the room.
    stage.innerHTML = v ? vendorView(v) : "";
    paintHoloCards(stage);
    if (v?.id === "armor") wireArmorerMirror(stage);
    const g = el.querySelector("#tavern-gold");
    if (g) g.textContent = `${getBalance()}g`;
    return;
  }
  stage.innerHTML = roomView() + (v ? vendorView(v) : "");
  paintHoloCards(stage); // fill in the card canvases this render just emitted
  if (v?.id === "armor") wireArmorerMirror(stage);
  const goldEl = el.querySelector("#tavern-gold");
  if (goldEl) goldEl.textContent = `${getBalance()}g`;
}

function handle(act: string, ds: { idx?: string; w?: string }): void {
  if (!deps) return;
  // Any action OTHER than the upgrade button disarms a pending confirm. Without
  // this, arming a gamble then wandering off to buy a potion leaves it primed,
  // and the next stray click on Upgrade fires a roll the player never re-read.
  if (act !== "upgrade") upgradeArmed = null;
  const raw = ds.idx ?? ""; // string-keyed acts (vendor / buypotion / buygear) use this
  const idx = ds.idx !== undefined && ds.idx !== "" ? parseInt(ds.idx, 10) : -1;
  const wIdx = ds.w !== undefined && ds.w !== "" ? parseInt(ds.w, 10) : -1;

  if (act === "descend") { const go = deps.onDescend; closeTavern(); go(); return; }

  // ── Navigation between the room and a vendor's counter ──
  if (act === "vendor") {
    activeVendor = (["cards", "weapons", "armor", "potions"] as VendorId[]).includes(raw as VendorId) ? (raw as VendorId) : null;
    selectedStash = -1;
    forgePick = [];
    render();
    return;
  }
  if (act === "back") {
    selectedStash = -1;
    forgePick = [];
    if (counterMode) {
      // There is no room view behind this counter — hand control back to the
      // walkable scene rather than rendering an empty overlay.
      const done = counterMode.onClose;
      closeVendorCounter();
      done();
      return;
    }
    activeVendor = null;
    render();
    return;
  }

  // ── Alchemist: buy a potion onto the belt (stacks / first empty slot) ──
  if (act === "buypotion") {
    const id = raw as PotionId;
    if (!POTIONS[id]) return;
    if (!stowOnBelt(id)) { flash("belt is full"); return; }
    if (!pay(PRICE_POTION[id] ?? 30)) { unstowFromBelt(id); flash("not enough gold"); return; }
    flash(`${POTIONS[id].icon} ${POTIONS[id].label} → belt`);
    render();
    return;
  }

  // ── Alchemist: switch the counter between the shelf and the brew book ──
  if (act === "alchtab") {
    alchemistTab = raw === "brew" ? "brew" : "buy";
    render();
    return;
  }

  // ── Alchemist: buy an Empty Flask catalyst ──
  if (act === "buyflask") {
    if (!pay(PRICE_FLASK)) { flash("not enough gold"); return; }
    state.flasks += 1;
    state.hudDirty = true;
    flash("🧴 Empty Flask bought");
    render();
    return;
  }

  // ── Alchemist: BREW a recipe from reagents (+ flask + optional gold) ──
  if (act === "brew") {
    const r = RECIPES[raw];
    if (!r) return;
    if (!canCraft(r, state.reagents, state.flasks, getBalance())) { flash("missing materials"); return; }
    // A potion output needs belt room; check BEFORE consuming so a full belt
    // never eats the reagents.
    if (r.output !== "flask" && !beltHasRoom(r.output as PotionId)) { flash("belt is full"); return; }
    const cost = craftCost(r);
    for (const [rid, n] of cost.inputs) state.reagents[rid] = (state.reagents[rid] ?? 0) - n;
    state.flasks -= cost.flasks;
    if (cost.gold > 0) pay(cost.gold);
    if (r.output === "flask") {
      state.flasks += 1;
      flash("🧴 Empty Flask brewed");
    } else {
      stowOnBelt(r.output as PotionId);
      flash(`${r.icon} ${r.label} → belt`);
    }
    state.hudDirty = true;
    render();
    return;
  }

  // ── Armorer: buy a fresh gear piece for an empty/worn slot ──
  if (act === "buygear") {
    const s = raw as GearSlot;
    if (!GEAR[s]) return;
    const base = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
    const grant = styleGearGrant(s, base); // finer steel while an elemental set is worn
    if ((state.gear[s] ?? 0) >= grant) { flash("already equipped"); return; }
    if (!pay(PRICE_GEAR[s])) { flash("not enough gold"); return; }
    state.gear = { ...state.gear, [s]: grant };
    pendingFx.push("gear");
    state.hudDirty = true;
    flash(`${GEAR[s].icon} ${GEAR[s].label} equipped`);
    render();
    return;
  }

  // ── Armorer: buy an elemental SET — permanent style unlock + full plate ──
  if (act === "buyset") {
    const id = raw as ArmorStyleId;
    const def = ARMOR_STYLES[id];
    if (!def || def.price <= 0 || isStyleUnlocked(id)) return;
    if (!pay(def.price)) { flash("not enough gold"); return; }
    unlockStyle(id); // unlock AND wear it
    // You walk out dressed: the set comes with full plate in its finer steel
    // (never downgrading a piece that somehow has more left).
    const plate: typeof state.gear = { ...state.gear };
    for (const s of GEAR_SLOTS) {
      const base = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
      plate[s] = Math.max(plate[s] ?? 0, styleGearGrant(s, base, id));
    }
    state.gear = plate;
    pendingFx.push("gear");
    state.hudDirty = true;
    flash(`${def.icon} ${def.label} — forged & worn`);
    render();
    return;
  }

  // ── Armorer: wear a set you already own (free) ──
  if (act === "wearstyle") {
    const id = raw as ArmorStyleId;
    if (!ARMOR_STYLES[id] || !setActiveStyle(id)) return;
    state.hudDirty = true; // sprites re-dress via the per-frame look-key checks
    flash(`${ARMOR_STYLES[id].icon} ${ARMOR_STYLES[id].label} worn`);
    render();
    return;
  }

  if (act === "pick") { selectedStash = selectedStash === idx ? -1 : idx; render(); return; }

  if (act === "slot") {
    // socket the picked stash card into weapon wIdx if it fits + has room
    if (selectedStash < 0 || wIdx < 0) return;
    const w = state.weaponSlots[wIdx];
    const id = state.cardStash[selectedStash];
    if (!w || !id) return;
    if (!cardFitsKind(id, WEAPONS[w.id].kind)) { flash("this card doesn't fit that weapon"); return; }
    if (socketCard(w, id)) {
      state.cardStash.splice(selectedStash, 1);
      selectedStash = -1;
      state.hudDirty = true;
      render();
    } else {
      flash("no free slot on that weapon");
    }
    return;
  }

  if (act === "unsocket") {
    const w = state.weaponSlots[wIdx];
    if (!w || !w.cards || !w.cards[idx]) return;
    if (state.cardStash.length >= STASH_MAX) { flash("stash full"); return; }
    const removed = w.cards.splice(idx, 1)[0];
    // respec cost: the card drops one rarity tier (a random card of the lower
    // rarity); a common just crumbles to dust.
    const lower = lowerRarity(CARDS[removed].rarity);
    if (lower) {
      const bag = cardsOfRarity(lower);
      state.cardStash.push(bag[Math.floor(Math.random() * bag.length)]);
      flash(`un-socketed → dropped to ${lower}`);
    } else {
      flash("common card crumbled to dust");
    }
    state.hudDirty = true;
    render();
    return;
  }

  if (act === "buycard") {
    const id = barOffers[idx];
    if (!id) return;
    if (state.cardStash.length >= STASH_MAX) { flash("stash full"); return; }
    if (!pay(PRICE_CARD[CARDS[id].rarity])) { flash("not enough gold"); return; }
    state.cardStash.push(id);
    barOffers.splice(idx, 1);
    render();
    return;
  }

  if (act === "reroll-bar") { if (pay(PRICE_REROLL_BAR)) { rollBarOffers(); render(); } else flash("not enough gold"); return; }

  if (act === "repair-weapon") {
    const w = state.weaponSlots[activeWeaponSlotIndex()];
    if (!w) { flash("no weapon equipped"); return; }
    if (!Number.isFinite(w.durability) || w.durability >= WEAPONS[w.id].maxDurability) { flash("weapon is already sound"); return; }
    if (!pay(PRICE_REPAIR_WEAPON)) { flash("not enough gold"); return; }
    w.durability = WEAPONS[w.id].maxDurability;
    pendingFx.push("repair");
    state.hudDirty = true;
    render();
    return;
  }

  if (act === "upgrade") {
    const w = state.weaponSlots[activeWeaponSlotIndex()];
    if (!w) { flash("no weapon equipped"); return; }
    const lvl = w.upgrade ?? 0;
    const risk = breakChance(lvl);
    // TWO-STEP once there is real risk. A hidden coin-flip that eats a legendary
    // is a feel-bad; a stated 36% gamble the player deliberately took is a story.
    if (risk > 0 && upgradeArmed !== lvl) {
      upgradeArmed = lvl;
      render();
      return;
    }
    if (!pay(PRICE_UPGRADE_BASE + lvl * 25)) { flash("not enough gold"); return; }
    upgradeArmed = null;
    if (Math.random() < risk) {
      // DESTROYED. The weapon is always gone — that is the anti-hoard mechanic
      // doing its job, and insuring the weapon itself would delete the risk.
      // Socketed cards are gone TOO, except the ones insurance bought back out
      // of the fire (rarest first — the player paid to protect what matters).
      const held = w.cards ?? [];
      const saved = insuredCards(held, w.insured ?? 0, (id) => CARD_RANK.indexOf(CARDS[id]?.rarity));
      const lost = held.length - saved.length;
      state.weaponSlots[activeWeaponSlotIndex()] = null;
      for (const id of saved) if (state.cardStash.length < STASH_MAX) state.cardStash.push(id);
      sfxBreak();
      flash(
        saved.length > 0
          ? `💥 THE BLADE SHATTERS — 🧿 ${saved.length} card(s) saved${lost > 0 ? `, ${lost} lost` : ""}`
          : lost > 0
            ? `💥 THE BLADE SHATTERS — ${lost} card(s) lost`
            : "💥 THE BLADE SHATTERS",
      );
      render();
      return;
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
    flash(`⚒️ +${w.upgrade} — damage ×${upgradeDamageMult(w.upgrade).toFixed(2)}`);
    render();
    return;
  }

  if (act === "insure") {
    const w = state.weaponSlots[activeWeaponSlotIndex()];
    if (!w) { flash("no weapon equipped"); return; }
    const cards = w.cards?.length ?? 0;
    if (cards === 0) { flash("nothing socketed to insure"); return; }
    const tier = Math.min(w.insured ?? 0, INSURANCE_MAX_TIER);
    if (tier >= INSURANCE_MAX_TIER || tier >= cards) { flash("already fully insured"); return; }
    if (!pay(insuranceCost(tier, w.rarity ?? "common"))) { flash("not enough gold"); return; }
    w.insured = tier + 1;
    pendingFx.push("slot");
    flash(`🧿 insured — ${w.insured} card(s) survive a shatter`);
    render();
    return;
  }

  if (act === "salvage") {
    const w = state.weaponSlots[activeWeaponSlotIndex()];
    if (!w) { flash("no weapon equipped"); return; }
    // A DELIBERATE sacrifice pays out and returns every card — unlike a shatter,
    // which pays nothing. That asymmetry is the whole point: retiring a weapon
    // on your terms is a decision, losing one to a bad roll is a consequence.
    const gold = salvageValue(w);
    const back = w.cards ?? [];
    let kept = 0;
    for (const id of back) if (state.cardStash.length < STASH_MAX) { state.cardStash.push(id); kept++; }
    state.weaponSlots[activeWeaponSlotIndex()] = null;
    state.goldRun += gold;
    addGold(gold, "dungeon-game");
    pendingFx.push("forge");
    flash(`♻️ sacrificed for ${gold}g${kept > 0 ? ` · ${kept} card(s) returned` : ""}${kept < back.length ? " · stash full!" : ""}`);
    render();
    return;
  }

  if (act === "addslot") {
    const w = state.weaponSlots[activeWeaponSlotIndex()];
    if (!w) { flash("no weapon equipped"); return; }
    if (weaponSlotCount(w) >= 3) { flash("weapon is maxed out"); return; }
    if (!pay(PRICE_ADD_SLOT)) { flash("not enough gold"); return; }
    w.bonusSlots = (w.bonusSlots ?? 0) + 1;
    pendingFx.push("slot");
    render();
    return;
  }

  if (act === "forgepick") {
    if (forgePick.includes(idx)) forgePick = forgePick.filter((i) => i !== idx);
    else if (forgePick.length < 2) forgePick.push(idx);
    render();
    return;
  }

  if (act === "forge") {
    if (forgePick.length !== 2) return;
    // both must still be commons
    if (!forgePick.every((i) => CARDS[state.cardStash[i]]?.rarity === "common")) { forgePick = []; render(); return; }
    // A GRIM BONE gates the forge. It used to be unlimited and free, which made
    // rare cards manufacturable from the commons any floor hands out — the exact
    // "you can craft cards" hole the design is trying to avoid. Now the forge
    // still works, but it costs a rare monster material, so even crafting is
    // downstream of hunting.
    if ((state.reagents[FORGE_CATALYST] ?? 0) < 1) { flash("the forge needs a 💀 Grim Bone"); return; }
    state.reagents[FORGE_CATALYST] = (state.reagents[FORGE_CATALYST] ?? 0) - 1;
    // remove the two (descending index so splices don't shift), add a rare
    const rare = cardsOfRarity("rare");
    const newCard = rare[Math.floor(Math.random() * rare.length)];
    forgePick.sort((a, b) => b - a).forEach((i) => state.cardStash.splice(i, 1));
    forgePick = [];
    state.cardStash.push(newCard);
    pendingFx.push("forge");
    flash(`forged a RARE: ${CARDS[newCard].label}`);
    render();
    return;
  }

  if (act === "rerollcard") {
    const cur = state.cardStash[idx];
    if (!cur) return;
    if (!pay(PRICE_REROLL_CARD)) { flash("not enough gold"); return; }
    const bag = cardsOfRarity(CARDS[cur].rarity).filter((c) => c !== cur);
    state.cardStash[idx] = bag.length ? bag[Math.floor(Math.random() * bag.length)] : cur;
    flash(`rerolled → ${CARDS[state.cardStash[idx]].label}`);
    render();
    return;
  }

  if (act === "repair-gear") {
    const missing = GEAR_SLOTS.some((s) => (state.gear[s] ?? 0) < (GEAR[s].absorb || 1));
    if (!missing) { flash("all gear is sound"); return; }
    if (!pay(PRICE_REPAIR_GEAR)) { flash("not enough gold"); return; }
    for (const s of GEAR_SLOTS) if (state.gear[s] !== undefined || GEAR[s].absorb > 0) state.gear[s] = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
    pendingFx.push("repair");
    state.hudDirty = true;
    render();
    return;
  }
}

let flashTimer = 0;
function flash(msg: string): void {
  const el = state.tavernEl?.querySelector("#tavern-flash") as HTMLElement | null;
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = "1";
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { el.style.opacity = "0"; }, 1600);
}

/** Open the Tavern hub over the (paused) dungeon. */
export function openTavern(container: HTMLElement, d: TavernDeps): void {
  if (state.tavernEl) return;
  deps = d;
  selectedStash = -1;
  forgePick = [];
  alchemistTab = "buy";
  activeVendor = null;
  injectCardStyles();
  injectTavernStyles();
  rollBarOffers();

  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10005;
    background: radial-gradient(circle at 50% 30%, rgba(40,28,14,0.96), rgba(8,6,4,0.98));
    display: flex; flex-direction: column; align-items: center;
    font: 400 13px ui-monospace, Menlo, monospace; color: #e8dcc0; user-select: none;
    padding: 14px; box-sizing: border-box;
  `;
  el.innerHTML = `
    <div style="position:relative;z-index:3;display:flex;align-items:center;gap:14px;margin-bottom:6px">
      <b style="font:900 26px ui-monospace,Menlo,monospace;letter-spacing:6px;color:${GOLD};font-variant:small-caps;text-shadow:0 0 16px rgba(240,166,60,.4)">🍺 The Tavern</b>
      <span style="color:#c9c1ad;font-size:12px">purse <b id="tavern-gold" style="color:${GOLD}">${getBalance()}g</b></span>
    </div>
    <div id="tavern-flash" style="position:relative;z-index:3;height:16px;color:${GOLD};font-size:11px;letter-spacing:1px;opacity:0;transition:opacity .25s;margin-bottom:6px"></div>
    <div id="tavern-grid" style="position:relative;z-index:1;width:min(940px,97vw);flex:1;min-height:0;border-radius:12px;overflow:hidden"></div>
  `;
  el.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!t) return;
    const [name, suffix] = t.dataset.act!.split(":");
    handle(name, { idx: t.dataset.idx ?? suffix, w: t.dataset.w });
  });
  container.appendChild(el);
  state.tavernEl = el;
  render();
}

export function closeTavern(): void {
  state.tavernEl?.remove();
  state.tavernEl = null;
  deps = null;
}

/**
 * Open ONE vendor's counter over the walkable tavern (`scenes/tavern/`).
 *
 * The walkable hub owns the room; this owns the commerce. Splitting it this way
 * means the 3D scene never has to know what a card costs and this module never
 * has to know where the forge is standing — and, more to the point, the whole
 * tested economy (socketing, forging, rerolls, stock, prices) is reused rather
 * than rebuilt against a new UI.
 */
export function openVendorCounter(container: HTMLElement, vendor: VendorId, stats: TavernStats, onClose: () => void): void {
  if (state.tavernEl) return;
  deps = { stats, onDescend: onClose };
  counterMode = { onClose };
  activeVendor = vendor;
  selectedStash = -1;
  forgePick = [];
  alchemistTab = "buy";
  injectCardStyles();
  injectTavernStyles();
  if (barOffers.length === 0) rollBarOffers();

  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10007;
    background: rgba(8,6,4,0.82);
    display: flex; flex-direction: column; align-items: center;
    font: 400 13px ui-monospace, Menlo, monospace; color: #e8dcc0; user-select: none;
    padding: 14px; box-sizing: border-box;
  `;
  el.innerHTML = `
    <div id="tavern-flash" style="position:relative;z-index:3;height:16px;color:${GOLD};font-size:11px;letter-spacing:1px;opacity:0;transition:opacity .25s;margin-bottom:6px"></div>
    <div id="tavern-grid" style="position:relative;z-index:1;width:min(940px,97vw);flex:1;min-height:0;border-radius:12px;overflow:hidden"></div>
  `;
  el.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!t) return;
    const [name, suffix] = t.dataset.act!.split(":");
    handle(name, { idx: t.dataset.idx ?? suffix, w: t.dataset.w });
  });
  container.appendChild(el);
  state.tavernEl = el;
  render();
}

/** Tear down a counter opened by `openVendorCounter`. */
export function closeVendorCounter(): void {
  counterMode = null;
  activeVendor = null;
  state.tavernEl?.remove();
  state.tavernEl = null;
  deps = null;
}

/** True while a vendor counter is up — the walkable scene freezes movement. */
export function isVendorCounterOpen(): boolean {
  return counterMode !== null;
}
