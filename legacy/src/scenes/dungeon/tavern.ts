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
import { WEAPONS, GEAR, GEAR_SLOTS, weaponSlotCount, type WeaponState, type GearSlot } from "./items";
import { CARDS, RARITY_HEX, cardsOfRarity, cardFitsKind, socketCard, lowerRarity, type CardId, type CardRarity } from "./cards";
import { getBalance, spendGold, addGold } from "../../utils/gold-wallet";

// ── Prices ──
const PRICE_CARD: Record<CardRarity, number> = { common: 20, rare: 45, epic: 90, legendary: 180 };
const PRICE_REROLL_BAR = 15;
const PRICE_REPAIR_WEAPON = 30;
const PRICE_ADD_SLOT = 60;
const PRICE_REROLL_CARD = 40;
const PRICE_REPAIR_GEAR = 40;
const STASH_MAX = 10;

const GOLD = "#f0a63c";
const PANEL_BG = "linear-gradient(180deg,#2a2118 0%,#1a140e 60%,#0f0b07 100%)";

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
  // Weighted stock: mostly common/rare, an occasional epic.
  const pool: CardId[] = [];
  for (let k = 0; k < 3; k++) {
    const r = Math.random();
    const rarity: CardRarity = r < 0.55 ? "common" : r < 0.9 ? "rare" : "epic";
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

function activeWeaponSlotIndex(): number {
  // Prefer the active slot; fall back to the first non-null.
  if (state.weaponSlots[state.activeSlot]) return state.activeSlot;
  const i = state.weaponSlots.findIndex((w) => w);
  return i < 0 ? state.activeSlot : i;
}

// ── HTML fragments ──
function cardChip(id: CardId, opts: { act?: string; idx?: number; picked?: boolean; small?: boolean } = {}): string {
  const c = CARDS[id];
  if (!c) return "";
  const col = RARITY_HEX[c.rarity];
  const attrs = opts.act ? `data-act="${opts.act}" data-idx="${opts.idx ?? ""}"` : "";
  const ring = opts.picked ? `box-shadow:0 0 0 2px ${GOLD}, 0 0 10px ${col};` : `box-shadow:0 0 0 1px ${col}55;`;
  const pad = opts.small ? "3px 5px" : "5px 7px";
  return `<div ${attrs} title="${c.description}" style="cursor:${opts.act ? "pointer" : "default"};display:inline-flex;align-items:center;gap:5px;background:#00000055;border:1px solid ${col};border-radius:5px;padding:${pad};margin:2px;${ring}">
    <span style="font-size:14px">${c.icon}</span>
    <span style="display:flex;flex-direction:column;line-height:1.05">
      <b style="color:${col};font-size:10px;letter-spacing:.5px">${c.label}</b>
      <span style="color:#c9c1ad;font-size:8px">${c.description}</span>
    </span>
  </div>`;
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
      cells.push(`<span data-act="unsocket" data-w="${slotIdx}" data-idx="${s}" title="un-socket (drops one rarity tier)" style="cursor:pointer">${cardChip(cid, { small: true })}</span>`);
    } else {
      cells.push(`<span data-act="slot" data-w="${slotIdx}" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:34px;height:30px;margin:2px;border:1px dashed #6c5a3e;border-radius:5px;color:#6c5a3e;font-size:16px">＋</span>`);
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

function station(title: string, icon: string, body: string): string {
  return `<div style="background:${PANEL_BG};border:1px solid #4a3d28;border-radius:9px;padding:12px;display:flex;flex-direction:column;min-height:0">
    <div style="display:flex;align-items:center;gap:8px;border-bottom:1px solid #4a3d28;padding-bottom:6px;margin-bottom:8px">
      <span style="font-size:20px">${icon}</span><b style="color:${GOLD};letter-spacing:2px;font-variant:small-caps;font-size:15px">${title}</b>
    </div>
    <div style="overflow:auto;flex:1;min-height:0">${body}</div>
  </div>`;
}

function btn(act: string, label: string, cost?: number, disabled = false): string {
  const afford = cost === undefined || getBalance() >= cost;
  const off = disabled || !afford;
  const col = off ? "#5a4d34" : GOLD;
  return `<button data-act="${act}" ${off ? "disabled" : ""} style="cursor:${off ? "not-allowed" : "pointer"};background:#171208;color:${col};border:1px solid ${col};border-radius:5px;padding:5px 9px;margin:3px 3px 3px 0;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.5px">
    ${label}${cost !== undefined ? ` · ${cost}g` : ""}</button>`;
}

function render(): void {
  const el = state.tavernEl;
  if (!el || !deps) return;
  const gold = getBalance();
  const stash = state.cardStash;

  // ── Armory ──
  const weapons = state.weaponSlots.map((w, i) => (w ? weaponPanel(w, i) : "")).join("");
  const stashHtml = stash.length
    ? stash.map((id, i) => cardChip(id, { act: "pick", idx: i, picked: i === selectedStash })).join("")
    : `<span style="color:#6c5a3e;font-size:11px">no stashed cards — kill enemies to find them</span>`;
  const armory = station("Armory", "⚔", `
    ${weapons}
    <div style="margin-top:8px;color:#c9c1ad;font-size:10px;letter-spacing:.5px">STASH (${stash.length}/${STASH_MAX}) — pick one, then click a weapon's ＋ slot</div>
    <div style="display:flex;flex-wrap:wrap;margin-top:4px">${stashHtml}</div>`);

  // ── Bar ──
  const offers = barOffers.map((id, i) => {
    const price = PRICE_CARD[CARDS[id].rarity];
    return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
      ${cardChip(id)}
      ${btn(`buycard:${i}`, "Buy", price, stash.length >= STASH_MAX)}
    </div>`;
  }).join("");
  const bar = station("The Bar", "🍺", `
    <div style="color:#c9c1ad;font-size:10px;margin-bottom:4px">CARDS FOR SALE</div>
    ${offers}
    <div style="margin:6px 0">${btn("reroll-bar", "🔄 Reroll stock", PRICE_REROLL_BAR)}</div>
    <div style="border-top:1px solid #4a3d28;padding-top:6px;margin-top:4px">
      ${btn("repair-weapon", "🛠️ Repair weapon", PRICE_REPAIR_WEAPON)}
      ${btn("addslot", "➕ Add card slot", PRICE_ADD_SLOT)}
    </div>`);

  // ── Blacksmith ──
  const commons = stash.map((id, i) => ({ id, i })).filter((x) => CARDS[x.id].rarity === "common");
  const forgeList = commons.length
    ? commons.map((x) => `<span data-act="forgepick" data-idx="${x.i}" style="cursor:pointer">${cardChip(x.id, { small: true, picked: forgePick.includes(x.i) })}</span>`).join("")
    : `<span style="color:#6c5a3e;font-size:10px">no common cards to forge</span>`;
  const rerollList = stash.length
    ? stash.map((id, i) => `<span data-act="rerollcard" data-idx="${i}" title="reroll (${PRICE_REROLL_CARD}g)" style="cursor:pointer">${cardChip(id, { small: true })}</span>`).join("")
    : `<span style="color:#6c5a3e;font-size:10px">—</span>`;
  const smith = station("Blacksmith", "🔨", `
    <div style="color:#c9c1ad;font-size:10px">FORGE — pick 2 commons → 1 rare</div>
    <div style="display:flex;flex-wrap:wrap;margin:4px 0">${forgeList}</div>
    <div>${btn("forge", "⚒️ Forge", undefined, forgePick.length !== 2)}</div>
    <div style="border-top:1px solid #4a3d28;padding-top:6px;margin-top:6px;color:#c9c1ad;font-size:10px">REROLL a card (same rarity, new roll) — click one:</div>
    <div style="display:flex;flex-wrap:wrap;margin:4px 0">${rerollList}</div>
    <div style="border-top:1px solid #4a3d28;padding-top:6px;margin-top:4px">${btn("repair-gear", "🛡️ Repair all gear", PRICE_REPAIR_GEAR)}</div>`);

  // ── Notice Board ──
  const gearTxt = GEAR_SLOTS.map((s) => `${GEAR[s].icon} ${state.gear[s] ?? 0}`).join("  ");
  const board = station("Notice Board", "📜", `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;color:#e8dcc0;font-size:12px">
      <span>Floor cleared</span><b style="color:${GOLD};text-align:right">${deps.stats.floor}</b>
      <span>Grade</span><b style="color:${GOLD};text-align:right">${deps.stats.grade}</b>
      <span>Total kills</span><b style="text-align:right">${deps.stats.kills}</b>
      <span>Best combo</span><b style="text-align:right">×${deps.stats.bestCombo}</b>
      <span>Gold</span><b style="color:${GOLD};text-align:right">${gold}g</b>
      <span>Gear</span><b style="text-align:right">${gearTxt}</b>
    </div>
    <button data-act="descend" style="cursor:pointer;width:100%;margin-top:14px;background:${GOLD};color:#160f06;border:none;border-radius:6px;padding:11px;font:900 15px ui-monospace,Menlo,monospace;letter-spacing:3px">DESCEND ▼</button>
    <div style="color:#9a8f77;font-size:9px;text-align:center;margin-top:5px">the next floor awaits, knight</div>`);

  el.querySelector("#tavern-grid")!.innerHTML = armory + bar + smith + board;
  const goldEl = el.querySelector("#tavern-gold");
  if (goldEl) goldEl.textContent = `${gold}g`;
}

function handle(act: string, ds: { idx?: string; w?: string }): void {
  if (!deps) return;
  const idx = ds.idx !== undefined && ds.idx !== "" ? parseInt(ds.idx, 10) : -1;
  const wIdx = ds.w !== undefined && ds.w !== "" ? parseInt(ds.w, 10) : -1;

  if (act === "descend") { const go = deps.onDescend; closeTavern(); go(); return; }

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
    <div id="tavern-grid" style="display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:12px;width:min(900px,96vw);flex:1;min-height:0"></div>
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
