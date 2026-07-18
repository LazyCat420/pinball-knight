/**
 * 🍺 THE TAVERN — the between-floor hub (plan Part 2).
 *
 * When you take the stairs, instead of dropping straight onto the next floor you
 * land in the Tavern: a paused DOM overlay (it pauses the sim exactly like the
 * merchant shop, via state.tavernEl) where you spend the run's gold and cards
 * before descending. Four stations, all reading/writing the RUN-persistent
 * state (weaponSlots, gear, cardStash, goldRun — none of which resetState wipes
 * between floors):
 *   ⚔ Armory     — socket stashed cards into a weapon's slots / un-socket.
 *   🍺 Bar        — buy cards (reroll the stock), repair the weapon, add a slot.
 *   🔨 Blacksmith — forge 2 commons → 1 rare, reroll a card, repair gear.
 *   📜 Notice Board — run stats + the DESCEND button.
 *
 * Built as a DOM overlay (like the shop) rather than a separate 3D scene: it
 * reuses the loadout state directly and pauses cleanly, which is what makes it
 * shippable and testable. Styling is self-contained tavern gothic.
 */
import { state } from "./state";
import { WEAPONS, GEAR, GEAR_SLOTS, POTIONS, weaponSlotCount, type WeaponState, type GearSlot, type PotionId } from "./items";
import { CARDS, RARITY_HEX, cardsOfRarity, cardFitsKind, socketCard, lowerRarity, type CardDef, type CardId, type CardRarity } from "./cards";
import { getBalance, spendGold, addGold } from "../../utils/gold-wallet";

// ── Prices ── widened spread so the shop has genuinely expensive pulls, not
// just cheap chips: a mythic costs a whole run's savings.
const PRICE_CARD: Record<CardRarity, number> = { common: 20, rare: 60, epic: 140, legendary: 320, mythic: 600 };
const PRICE_REROLL_BAR = 15;
const PRICE_REPAIR_WEAPON = 30;
const PRICE_ADD_SLOT = 60;
const PRICE_REROLL_CARD = 40;
const PRICE_REPAIR_GEAR = 40;
const STASH_MAX = 10;
// The Alchemist's stock — a curated shelf that carries onto the belt (Shift+1-4).
const POTION_STOCK: PotionId[] = ["health", "rage", "haste", "shield", "freeze", "ballform"];
const PRICE_POTION: Partial<Record<PotionId, number>> = { health: 15, rage: 28, haste: 28, shield: 34, freeze: 40, ballform: 65 };
// The Armorer's stock — grant a gear piece to its base soak (boots use 1 as the
// "equipped" sentinel, matching the dungeon pickup path).
const PRICE_GEAR: Record<GearSlot, number> = { helmet: 45, armor: 70, boots: 40 };
const BELT_MAX = 4;

/** Which vendor's counter is open; null = the room view (walk the tavern). */
type VendorId = "cards" | "weapons" | "armor" | "potions";
let activeVendor: VendorId | null = null;

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

const GOLD = "#f0a63c";

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
let barOffers: CardId[] = [];
let deps: TavernDeps | null = null;

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

// ── Holo trading-card renderer (Pokémon-card inspiration, per plan C1) ──
// A real card FACE — framed art window, name + power line, effect strip, rarity
// ribbon, a foil shimmer sweep, and tier treatment (gold etch for legendary,
// iridescent rainbow border for mythic) — replacing the old flat chip. Styles
// live in one injected <style> block (injectTavernStyles); markup below only
// sets per-card CSS vars (--rc rarity colour, --art element gradient).

const TIER: Record<CardRarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };

/** The card's element look, read off what its modifier actually DOES. */
function cardArt(c: CardDef): { art: string; tag: string } {
  const m = c.modifier;
  if (m.onHit === "burn") return { art: "radial-gradient(circle at 50% 34%,#fb923c,#7c2d12 72%)", tag: "FIRE" };
  if (m.onHit === "chill") return { art: "radial-gradient(circle at 50% 34%,#7dd3fc,#0c4a6e 72%)", tag: "ICE" };
  if (m.pinballMult && m.pinballMult > 1) return { art: "radial-gradient(circle at 50% 34%,#fcd34d,#7c4a12 72%)", tag: "MOMENTUM" };
  if (m.cooldownMult && m.cooldownMult < 1) return { art: "radial-gradient(circle at 50% 34%,#5eead4,#0f5c54 72%)", tag: "SWIFT" };
  if (m.durabilityMult && m.durabilityMult > 1) return { art: "radial-gradient(circle at 50% 34%,#cbd5e1,#334155 72%)", tag: "GUARD" };
  return { art: "radial-gradient(circle at 50% 34%,#f87171,#4c1010 72%)", tag: "POWER" };
}

/** A flavour "power" number (like a card's HP), summarising the modifier. */
function cardPower(c: CardDef): number {
  const m = c.modifier;
  let p = 10;
  if (m.damageFlat) p += m.damageFlat * 15;
  if (m.damageMult) p += (m.damageMult - 1) * 100;
  if (m.pinballMult) p += (m.pinballMult - 1) * 40;
  if (m.cooldownMult) p += (1 - m.cooldownMult) * 80;
  if (m.durabilityMult) p += (m.durabilityMult - 1) * 20;
  if (m.onHit) p += 25;
  return Math.max(10, Math.round(p / 5) * 5);
}

function holoCard(id: CardId, opts: { act?: string; idx?: number; picked?: boolean; size?: "sm" | "md" | "lg" } = {}): string {
  const c = CARDS[id];
  if (!c) return "";
  const col = RARITY_HEX[c.rarity];
  const tier = TIER[c.rarity];
  const { art, tag } = cardArt(c);
  const attrs = opts.act ? `data-act="${opts.act}" data-idx="${opts.idx ?? ""}"` : "";
  const cls = ["hcard", `hc-${opts.size ?? "md"}`, tier >= 3 ? "hcard-gold" : "", tier >= 4 ? "hcard-myth" : "", opts.picked ? "picked" : ""].filter(Boolean).join(" ");
  const nameCol = tier >= 4 ? "#ffffff" : tier >= 3 ? "#fff3c0" : col;
  return `<div ${attrs} class="${cls}" style="--rc:${col};--art:${art};cursor:${opts.act ? "pointer" : "default"}" title="${c.description}">
    <div class="hc-top"><b class="hc-name" style="color:${nameCol}">${c.label}</b><span class="hc-pwr">${cardPower(c)}</span></div>
    <div class="hc-art"><span class="hc-emoji">${c.icon}</span><span class="hc-tag">${tag}</span></div>
    <div class="hc-fx">${c.description}</div>
    <div class="hc-rar" style="color:${col}">${c.rarity.toUpperCase()}</div>
    <span class="hcard-shimmer"></span>
  </div>`;
}

/** Inject the tavern's holo-card stylesheet once (idempotent). */
function injectTavernStyles(): void {
  if (document.getElementById("tavern-holo-style")) return;
  const s = document.createElement("style");
  s.id = "tavern-holo-style";
  s.textContent = `
    .hcard{position:relative;box-sizing:border-box;aspect-ratio:63/88;border-radius:8px;overflow:hidden;
      border:2px solid var(--rc);background:linear-gradient(160deg,#241a10,#12100c);
      box-shadow:0 3px 10px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.05);
      display:flex;flex-direction:column;margin:3px;font-family:ui-monospace,Menlo,monospace;flex:0 0 auto;transition:transform .12s}
    .hcard:hover{transform:translateY(-2px)}
    .hcard.picked{box-shadow:0 0 0 2px #f0a63c,0 0 14px var(--rc)}
    .hc-sm{width:58px}.hc-md{width:90px}.hc-lg{width:118px}
    .hcard-gold{border-color:#ffd76a;box-shadow:0 0 0 1px #fff3c0 inset,0 3px 12px rgba(0,0,0,.55),0 0 12px rgba(255,215,106,.35)}
    .hcard-myth{border:2px solid transparent;
      background:linear-gradient(#12100c,#12100c) padding-box,conic-gradient(from 0deg,#ff5edb,#7cf9ff,#f5f36e,#ff8a5e,#ff5edb) border-box;
      animation:hcard-rainbow 5s linear infinite}
    @keyframes hcard-rainbow{to{filter:hue-rotate(360deg)}}
    .hc-top{display:flex;justify-content:space-between;align-items:center;gap:4px;padding:3px 5px 1px}
    .hc-name{font-weight:800;font-size:8px;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .hc-lg .hc-name{font-size:10px}
    .hc-pwr{font-size:8px;color:#f0a63c;font-weight:800;flex:0 0 auto}
    .hc-art{position:relative;flex:1;margin:0 4px;border-radius:4px;background:var(--art);
      display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
    .hc-emoji{font-size:26px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))}
    .hc-sm .hc-emoji{font-size:20px}.hc-lg .hc-emoji{font-size:34px}
    .hc-tag{position:absolute;bottom:2px;right:3px;font-size:6px;letter-spacing:1px;color:rgba(255,255,255,.72)}
    .hc-fx{padding:3px 5px 2px;font-size:7px;line-height:1.15;color:#d9cfb6;min-height:2.2em}
    .hc-lg .hc-fx{font-size:8px}
    .hc-rar{text-align:center;font-size:6px;letter-spacing:1.6px;padding-bottom:3px;font-weight:800}
    .hcard-shimmer{position:absolute;inset:0;overflow:hidden;pointer-events:none}
    .hcard-shimmer::before{content:'';position:absolute;top:-40%;bottom:-40%;left:0;width:45%;
      background:linear-gradient(100deg,transparent,rgba(255,255,255,.10),rgba(120,220,255,.16),rgba(255,150,255,.12),transparent);
      transform:translateX(-160%) rotate(14deg);animation:hcard-sweep 3.4s ease-in-out infinite}
    @keyframes hcard-sweep{0%{transform:translateX(-160%) rotate(14deg)}60%,100%{transform:translateX(320%) rotate(14deg)}}
    .tavern-slot{display:inline-flex;align-items:center;justify-content:center;width:58px;height:81px;margin:3px;
      border:1px dashed #6c5a3e;border-radius:8px;color:#6c5a3e;font-size:20px}

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
    .tv-vendor{position:absolute;inset:0;background:rgba(6,4,3,.82);backdrop-filter:blur(2px);
      display:flex;flex-direction:column;padding:14px;box-sizing:border-box;animation:tv-fade .18s ease}
    @keyframes tv-fade{from{opacity:0}to{opacity:1}}
    .tv-vendor-head{display:flex;align-items:center;gap:12px;border-bottom:1px solid #4a3d28;padding-bottom:8px;margin-bottom:10px}
    .tv-back{cursor:pointer;background:#171208;color:${GOLD};border:1px solid ${GOLD};border-radius:5px;
      padding:5px 10px;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.5px}
    .tv-back:hover{background:#241609}
    .tv-vendor-body{overflow:auto;flex:1;min-height:0}`;
  document.head.appendChild(s);
}

function weaponPanel(w: WeaponState, slotIdx: number): string {
  const def = WEAPONS[w.id];
  const slots = weaponSlotCount(w);
  const cards = w.cards ?? [];
  const isActive = slotIdx === state.activeSlot;
  const cells: string[] = [];
  for (let s = 0; s < slots; s++) {
    const cid = cards[s];
    if (cid) {
      cells.push(`<span data-act="unsocket" data-w="${slotIdx}" data-idx="${s}" title="un-socket (drops one rarity tier)" style="cursor:pointer">${holoCard(cid, { size: "sm" })}</span>`);
    } else {
      cells.push(`<span data-act="slot" data-w="${slotIdx}" class="tavern-slot" style="cursor:pointer">＋</span>`);
    }
  }
  if (slots === 0) cells.push(`<span style="color:#6c5a3e;font-size:10px">no card slots</span>`);
  const durTxt = Number.isFinite(w.durability) ? `${w.durability}/${def.maxDurability}` : "∞";
  return `<div style="border:1px solid ${isActive ? GOLD : "#4a3d28"};border-radius:7px;padding:8px;margin:5px 0;background:#00000033">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
      <span style="font-size:18px">${def.icon}</span>
      <b style="color:#e8dcc0">${def.label}</b>
      <span style="color:#9a8f77;font-size:10px">${def.kind} · dur ${durTxt} · ${slots} slot${slots === 1 ? "" : "s"}</span>
      ${isActive ? `<span style="color:${GOLD};font-size:9px;border:1px solid ${GOLD};border-radius:3px;padding:1px 4px">EQUIPPED</span>` : ""}
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:center">${cells.join("")}</div>
  </div>`;
}

function btn(act: string, label: string, cost?: number, disabled = false): string {
  const afford = cost === undefined || getBalance() >= cost;
  const off = disabled || !afford;
  const col = off ? "#5a4d34" : GOLD;
  return `<button data-act="${act}" ${off ? "disabled" : ""} style="cursor:${off ? "not-allowed" : "pointer"};background:#171208;color:${col};border:1px solid ${col};border-radius:5px;padding:5px 9px;margin:3px 3px 3px 0;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.5px">
    ${label}${cost !== undefined ? ` · ${cost}g` : ""}</button>`;
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
    <div style="border-top:1px solid #4a3d28;padding-top:8px;color:#c9c1ad;font-size:11px">FORGE — pick 2 commons → 1 rare</div>
    <div style="display:flex;flex-wrap:wrap;margin:4px 0">${forgeList}</div>
    <div>${btn("forge", "⚒️ Forge", undefined, forgePick.length !== 2)}</div>
    <div style="border-top:1px solid #4a3d28;padding-top:8px;margin-top:8px;color:#c9c1ad;font-size:11px">REROLL a card (same rarity, new roll) — click one:</div>
    <div style="display:flex;flex-wrap:wrap;margin:4px 0">${rerollList}</div>`;
}

/** 🛡️ Armorer — buy fresh plate for empty/worn slots, repair all gear. */
function armorBody(): string {
  const pieces = GEAR_SLOTS.map((s) => {
    const base = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
    const cur = state.gear[s] ?? 0;
    const owned = cur >= base;
    const soak = GEAR[s].absorb > 0 ? `soaks ${GEAR[s].absorb}` : "+move speed";
    return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0">
      <span style="font-size:20px">${GEAR[s].icon}</span>
      <span style="display:flex;flex-direction:column;line-height:1.15"><b style="color:#e8dcc0;font-size:12px">${GEAR[s].label}</b><span style="color:#9a8f77;font-size:9px">${soak}${owned ? ` · equipped (${cur})` : ""}</span></span>
      <span style="flex:1"></span>
      ${owned ? `<span style="color:#5a7d4a;font-size:10px;letter-spacing:.5px">EQUIPPED</span>` : btn(`buygear:${s}`, "Buy", PRICE_GEAR[s])}
    </div>`;
  }).join("");
  return `
    <div style="color:#c9c1ad;font-size:11px;margin-bottom:4px">PLATE FOR SALE</div>
    ${pieces}
    <div style="border-top:1px solid #4a3d28;padding-top:8px;margin-top:6px">${btn("repair-gear", "🛡️ Repair all gear", PRICE_REPAIR_GEAR)}</div>`;
}

/** 🧪 Alchemist — buy belt potions that carry into the next floor (Shift+1-4). */
function potionsBody(): string {
  const beltCount = state.belt.filter((b) => b).length;
  const beltFull = beltCount >= BELT_MAX && !state.belt.some((b) => b && b.count < 99);
  const beltTxt = state.belt.map((b) => (b ? `${b.icon}×${b.count}` : "·")).join("  ");
  const shelf = POTION_STOCK.map((id) => {
    const p = POTIONS[id];
    const price = PRICE_POTION[id] ?? 30;
    const eff = p.heal ? `heal ${p.heal}` : p.duration ? `${p.duration}s` : "instant";
    return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;padding:5px 7px;background:#00000044;border:1px solid #4a3d28;border-radius:6px">
      <span style="font-size:20px">${p.icon}</span>
      <span style="display:flex;flex-direction:column;line-height:1.15"><b style="color:#e8dcc0;font-size:12px">${p.label}</b><span style="color:#9a8f77;font-size:9px">${eff}</span></span>
      <span style="flex:1"></span>
      ${btn(`buypotion:${id}`, "Buy", price, beltFull)}
    </div>`;
  }).join("");
  return `
    <div style="color:#c9c1ad;font-size:11px;margin-bottom:2px">BELT ${beltCount}/${BELT_MAX} — <span style="color:#e8dcc0">${beltTxt}</span></div>
    <div style="color:#9a8f77;font-size:9px;margin-bottom:6px">bought potions ride your belt into the next floor · use with Shift+1-4</div>
    ${shelf}`;
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
  stage.innerHTML = roomView() + (v ? vendorView(v) : "");
  const goldEl = el.querySelector("#tavern-gold");
  if (goldEl) goldEl.textContent = `${getBalance()}g`;
}

function handle(act: string, ds: { idx?: string; w?: string }): void {
  if (!deps) return;
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
  if (act === "back") { activeVendor = null; selectedStash = -1; forgePick = []; render(); return; }

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

  // ── Armorer: buy a fresh gear piece for an empty/worn slot ──
  if (act === "buygear") {
    const s = raw as GearSlot;
    if (!GEAR[s]) return;
    const base = GEAR[s].absorb > 0 ? GEAR[s].absorb : 1;
    if ((state.gear[s] ?? 0) >= base) { flash("already equipped"); return; }
    if (!pay(PRICE_GEAR[s])) { flash("not enough gold"); return; }
    state.gear = { ...state.gear, [s]: base };
    state.hudDirty = true;
    flash(`${GEAR[s].icon} ${GEAR[s].label} equipped`);
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
    state.hudDirty = true;
    render();
    return;
  }

  if (act === "addslot") {
    const w = state.weaponSlots[activeWeaponSlotIndex()];
    if (!w) { flash("no weapon equipped"); return; }
    if (weaponSlotCount(w) >= 3) { flash("weapon is maxed out"); return; }
    if (!pay(PRICE_ADD_SLOT)) { flash("not enough gold"); return; }
    w.bonusSlots = (w.bonusSlots ?? 0) + 1;
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
    // remove the two (descending index so splices don't shift), add a rare
    const rare = cardsOfRarity("rare");
    const newCard = rare[Math.floor(Math.random() * rare.length)];
    forgePick.sort((a, b) => b - a).forEach((i) => state.cardStash.splice(i, 1));
    forgePick = [];
    state.cardStash.push(newCard);
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
  activeVendor = null;
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
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
      <b style="font:900 26px ui-monospace,Menlo,monospace;letter-spacing:6px;color:${GOLD};font-variant:small-caps;text-shadow:0 0 16px rgba(240,166,60,.4)">🍺 The Tavern</b>
      <span style="color:#c9c1ad;font-size:12px">purse <b id="tavern-gold" style="color:${GOLD}">${getBalance()}g</b></span>
    </div>
    <div id="tavern-flash" style="height:16px;color:${GOLD};font-size:11px;letter-spacing:1px;opacity:0;transition:opacity .25s;margin-bottom:6px"></div>
    <div id="tavern-grid" style="position:relative;width:min(940px,97vw);flex:1;min-height:0;border-radius:12px;overflow:hidden"></div>
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

export function isTavernOpen(): boolean {
  return !!state.tavernEl;
}
