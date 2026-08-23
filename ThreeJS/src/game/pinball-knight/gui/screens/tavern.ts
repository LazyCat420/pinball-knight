/**
 * 🍺 THE TAVERN, in the game.
 *
 * A room with four vendors; walk up to one and its counter opens. Every price,
 * every action and every rule now lives in `economy/tavern-shop.ts` — this file
 * only lays it out and routes input, which is the split the DOM version never
 * had (its twenty-four handlers were interleaved with `innerHTML` strings).
 *
 * ── COUNTER MODE ──
 * The walkable 3D tavern (`scenes/tavern/`) opens a SINGLE vendor by walking up
 * to their station. In that mode there is no room view to go back to — the room
 * is the real scene behind us — so "back" hands control to the caller instead
 * of rendering an empty overlay. Same code path for prices and stock either
 * way, which is the point: the walkable hub reuses the economy rather than
 * reimplementing it.
 */
import { state } from "../../state";
import { WEAPONS, GEAR, GEAR_SLOTS, POTIONS, weaponSlotCount, breakChance, salvageValue, insuranceCost, INSURANCE_MAX_TIER } from "../../items";
import { ARMOR_STYLES, ELEMENTAL_STYLE_IDS, activeStyle, isStyleUnlocked } from "../../armor-styles";
import { cardDef } from "../../cards";
import { REAGENTS, REAGENT_IDS } from "../../reagents";
import { RECIPES, RECIPE_IDS, canCraft, craftCost } from "../../recipes";
import { getBalance } from "../../../../utils/gold-wallet";
import {
  PRICE_CARD,
  PRICE_REROLL_BAR,
  PRICE_REPAIR_WEAPON,
  PRICE_ADD_SLOT,
  PRICE_UPGRADE_BASE,
  PRICE_REROLL_CARD,
  PRICE_REPAIR_GEAR,
  POTION_STOCK,
  PRICE_POTION,
  PRICE_GEAR,
  PRICE_FLASK,
  FORGE_CATALYST,
  activeWeaponSlotIndex,
  addSlot,
  brew,
  buyCard,
  buyFlask,
  buyGear,
  buyPotion,
  buyStyleSet,
  canForge,
  currentOffers,
  forge,
  insureWeapon,
  repairGear,
  repairWeapon,
  rerollBar,
  rerollCard,
  rollBarOffers,
  salvageWeapon,
  socketStashCard,
  unsocketCard,
  upgradeWeapon,
  wearStyle,
  type ActionResult,
} from "../../economy/tavern-shop";
import { UI, GRID, ROW_H } from "../theme";
import {
  beginScroll,
  button,
  cutRight,
  cutTop,
  endScroll,
  fillRect,
  focusRing,
  focusable,
  heading,
  inset,
  rect,
  followFocus,
  scrim,
  sheet,
  strokeRect,
  text,
  well,
  type Rect,
  type UiFrame,
} from "../im";
import { drawIcon, glyph, itemIcon, type GlyphId } from "../icons";
import { cardFaceAt, CARD_W, CARD_H } from "../card-face";
import { pop, type UiScreen } from "../stack";

export type VendorId = "cards" | "weapons" | "armor" | "potions";

interface VendorDef {
  id: VendorId;
  name: string;
  icon: GlyphId;
  blurb: string;
}
const VENDORS: VendorDef[] = [
  { id: "potions", name: "ALCHEMIST", icon: "flask", blurb: "potions for the belt" },
  { id: "cards", name: "CARD DEALER", icon: "card", blurb: "power cards & socketing" },
  { id: "weapons", name: "WEAPONSMITH", icon: "sword", blurb: "repairs, slots & forging" },
  { id: "armor", name: "ARMORER", icon: "shield", blurb: "plate & repairs" },
];

interface TavernStats {
  grade: string;
  floor: number;
  kills: number;
  bestCombo: number;
}

interface TavernUi {
  vendor: VendorId | null;
  picked: number;
  forgePick: number[];
  /** The upgrade level ARMED but not confirmed. null = nothing armed. */
  upgradeArmed: number | null;
  alchTab: "buy" | "brew";
  flash: string;
  flashUntil: number;
  // NB: the scroll offset is NOT here. It lives on `UiScreen.scroll`, which is
  // the field the stack declares for exactly this and the one `__gui().scroll`
  // reads (`dev/gui-hooks.ts` → `top()?.scroll`). A private copy here kept the
  // region working while reporting a flat 0 to the probe — the one readout you
  // reach for when a list will not scroll.
}

const CARD_SLOT_W = 56;
const CARD_SLOT_H = Math.round((CARD_H / CARD_W) * CARD_SLOT_W);

function say(u: TavernUi, msg: ActionResult): void {
  if (!msg) return;
  u.flash = msg;
  u.flashUntil = performance.now() + 1800;
}

// ── ALCHEMIST ─────────────────────────────────────────────────────────────────

function potionsBody(f: UiFrame, body: Rect, u: TavernUi): void {
  const tabs = cutTop(body, 24);
  const bw = Math.floor(tabs.w / 2) - 3;
  for (const [i, id] of (["buy", "brew"] as const).entries()) {
    const tr = rect(tabs.x + i * (bw + 6), tabs.y, bw, 22);
    const st = focusable(f, tr);
    const on = u.alchTab === id;
    fillRect(f, tr, on ? UI.sheetEdge : UI.well);
    strokeRect(f, tr, on ? UI.gold : UI.wellEdge);
    text(f, id === "buy" ? "THE SHELF" : "BREW BOOK", tr.x + tr.w / 2, tr.y + 7, {
      size: 8,
      colour: on ? UI.gold : UI.textDim,
      align: "center",
    });
    if (st.focused) focusRing(f, tr);
    if (st.activated) u.alchTab = id;
  }
  cutTop(body, GRID);

  if (u.alchTab === "buy") {
    heading(f, cutTop(body, ROW_H), "SHELF — potions go straight to the belt");
    for (const id of POTION_STOCK) {
      const def = POTIONS[id];
      const price = PRICE_POTION[id] ?? 30;
      const r = cutTop(body, 30);
      well(f, r);
      drawIcon(f.g, itemIcon(id), r.x + 4, r.y + 3, 24);
      text(f, def.label, r.x + 34, r.y + 5, { size: 8, colour: UI.text, max: r.w - 150 });
      text(f, def.description, r.x + 34, r.y + 18, { size: 8, colour: UI.textDim, max: r.w - 150 });
      if (button(f, rect(r.x + r.w - 84, r.y + 4, 76, 22), `${price}g`, { disabled: getBalance() < price })) {
        say(u, buyPotion(id));
      }
      cutTop(body, 3);
    }
    const fr = cutTop(body, 30);
    well(f, fr);
    text(f, "Empty Flask", fr.x + GRID, fr.y + 5, { size: 8, colour: UI.text });
    text(f, "the catalyst every brew needs", fr.x + GRID, fr.y + 18, { size: 8, colour: UI.textDim });
    if (button(f, rect(fr.x + fr.w - 84, fr.y + 4, 76, 22), `${PRICE_FLASK}g`, { disabled: getBalance() < PRICE_FLASK })) {
      say(u, buyFlask());
    }
    return;
  }

  // ── BREW BOOK ──
  heading(f, cutTop(body, ROW_H), `POUCH — ${state.flasks} flask${state.flasks === 1 ? "" : "s"}`);
  const pouch = REAGENT_IDS.filter((id) => (state.reagents[id] ?? 0) > 0);
  const pr = cutTop(body, 16);
  text(
    f,
    pouch.length ? pouch.map((id) => `${REAGENTS[id].label} x${state.reagents[id]}`).join("  ") : "no reagents",
    pr.x,
    pr.y + 2,
    { size: 8, colour: pouch.length ? UI.good : UI.textFaint, max: pr.w },
  );

  heading(f, cutTop(body, ROW_H), "RECIPES");
  for (const rid of RECIPE_IDS) {
    const r = RECIPES[rid];
    const cost = craftCost(r);
    const ok = canCraft(r, state.reagents, state.flasks, getBalance());
    const row = cutTop(body, 32);
    well(f, row);
    text(f, r.label, row.x + GRID, row.y + 5, { size: 8, colour: ok ? UI.text : UI.textFaint, max: row.w - 150 });
    const needs = cost.inputs
      .map(([id, n]) => `${REAGENTS[id]?.label ?? id} ${state.reagents[id] ?? 0}/${n}`)
      .concat(cost.flasks ? [`flask ${state.flasks}/${cost.flasks}`] : [])
      .concat(cost.gold ? [`${cost.gold}g`] : [])
      .join("  ");
    text(f, needs, row.x + GRID, row.y + 19, { size: 8, colour: ok ? UI.textDim : UI.danger, max: row.w - 110 });
    if (button(f, rect(row.x + row.w - 84, row.y + 5, 76, 22), "BREW", { disabled: !ok })) say(u, brew(rid));
    cutTop(body, 3);
  }
}

// ── ARMORER ───────────────────────────────────────────────────────────────────

function armorBody(f: UiFrame, body: Rect, u: TavernUi): void {
  heading(f, cutTop(body, ROW_H), "PLATE");
  for (const s of GEAR_SLOTS) {
    const def = GEAR[s];
    const cur = state.gear[s] ?? 0;
    const base = def.absorb > 0 ? def.absorb : 1;
    const price = PRICE_GEAR[s];
    const r = cutTop(body, 34);
    well(f, r);
    drawIcon(f.g, itemIcon(s) ?? glyph("shield", 26, UI.textDim), r.x + 4, r.y + 4, 26);
    text(f, def.label, r.x + 36, r.y + 5, { size: 8, colour: UI.text });
    text(f, cur > 0 ? `${cur}/${base}` : "none", r.x + 36, r.y + 19, {
      size: 8,
      colour: cur >= base ? UI.good : cur > 0 ? UI.gold : UI.textFaint,
    });
    if (button(f, rect(r.x + r.w - 84, r.y + 6, 76, 22), `${price}g`, { disabled: getBalance() < price })) {
      say(u, buyGear(s));
    }
    cutTop(body, 3);
  }
  const rr = cutTop(body, 30);
  if (button(f, rect(rr.x, rr.y, 200, 24), `REPAIR ALL PLATE — ${PRICE_REPAIR_GEAR}g`, {
    disabled: getBalance() < PRICE_REPAIR_GEAR,
  })) {
    say(u, repairGear());
  }

  heading(f, cutTop(body, ROW_H + GRID), "ELEMENTAL SETS — permanent unlocks");
  for (const id of ELEMENTAL_STYLE_IDS) {
    const def = ARMOR_STYLES[id];
    const owned = isStyleUnlocked(id);
    const worn = activeStyle() === id;
    const r = cutTop(body, 32);
    well(f, r);
    text(f, def.label, r.x + GRID, r.y + 5, { size: 8, colour: worn ? UI.gold : UI.text });
    text(f, def.blurb, r.x + GRID, r.y + 19, { size: 8, colour: UI.textDim, max: r.w - 130 });
    const btn = rect(r.x + r.w - 100, r.y + 5, 92, 22);
    if (worn) {
      text(f, "WORN", btn.x + btn.w, btn.y + 8, { size: 8, colour: UI.gold, align: "right" });
      focusable(f, btn, { disabled: true });
    } else if (owned) {
      if (button(f, btn, "WEAR")) say(u, wearStyle(id));
    } else if (button(f, btn, `${def.price}g`, { disabled: getBalance() < def.price })) {
      say(u, buyStyleSet(id));
    }
    cutTop(body, 3);
  }
}

// ── CARD DEALER ───────────────────────────────────────────────────────────────

function cardsBody(f: UiFrame, body: Rect, u: TavernUi): void {
  heading(f, cutTop(body, ROW_H), "THE SHELF — three pulls, not your choice");
  const offers = currentOffers();
  const shelf = cutTop(body, CARD_SLOT_H + 26);
  for (const [i, id] of offers.entries()) {
    const cell = rect(shelf.x + i * (CARD_SLOT_W + GRID), shelf.y, CARD_SLOT_W, CARD_SLOT_H);
    const price = PRICE_CARD[cardDef(id)!.rarity];
    const afford = getBalance() >= price;
    const st = focusable(f, cell, { disabled: !afford });
    const face = cardFaceAt(id, cell.w);
    if (face) f.g.drawImage(face, cell.x, cell.y, cell.w, cell.h);
    else well(f, cell);
    text(f, `${price}g`, cell.x + cell.w / 2, cell.y + cell.h + 4, {
      size: 8,
      colour: afford ? UI.heading : UI.danger,
      align: "center",
    });
    if (st.focused) focusRing(f, cell);
    if (st.activated) say(u, buyCard(i));
  }
  if (!offers.length) text(f, "sold out — reroll the shelf", shelf.x, shelf.y + 8, { size: 8, colour: UI.textFaint });

  const rr = cutTop(body, 28);
  if (button(f, rect(rr.x, rr.y, 200, 24), `REROLL SHELF — ${PRICE_REROLL_BAR}g`, {
    disabled: getBalance() < PRICE_REROLL_BAR,
  })) {
    say(u, rerollBar());
  }

  heading(f, cutTop(body, ROW_H), "YOUR WEAPONS — pick a stash card, then a + slot");
  for (let wi = 0; wi < state.weaponSlots.length; wi++) {
    const w = state.weaponSlots[wi];
    if (!w) continue;
    const r = cutTop(body, CARD_SLOT_H + 24);
    well(f, r);
    text(f, WEAPONS[w.id].label.toUpperCase(), r.x + GRID, r.y + 5, { size: 8, colour: UI.gold });
    for (let ci = 0; ci < weaponSlotCount(w); ci++) {
      const cell = rect(r.x + GRID + ci * (CARD_SLOT_W + 6), r.y + 18, CARD_SLOT_W, CARD_SLOT_H);
      const id = w.cards?.[ci];
      const st = focusable(f, cell);
      if (id) {
        const face = cardFaceAt(id, cell.w);
        if (face) f.g.drawImage(face, cell.x, cell.y, cell.w, cell.h);
        if (st.activated) say(u, unsocketCard(wi, ci));
      } else {
        well(f, cell);
        text(f, "+", cell.x + cell.w / 2, cell.y + cell.h / 2 - 4, { size: 16, colour: UI.textFaint, align: "center" });
        if (st.activated) {
          if (u.picked < 0) say(u, "pick a stash card first");
          else {
            say(u, socketStashCard(u.picked, wi));
            u.picked = -1;
          }
        }
      }
      if (st.focused) focusRing(f, cell);
    }
    cutTop(body, 4);
  }

  heading(f, cutTop(body, ROW_H), `STASH (${state.cardStash.length}) — pick to socket, forge or reroll`);
  const perRow = Math.max(1, Math.floor(body.w / (CARD_SLOT_W + 6)));
  for (let i = 0; i < state.cardStash.length; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const cell = rect(body.x + col * (CARD_SLOT_W + 6), body.y + row * (CARD_SLOT_H + 18), CARD_SLOT_W, CARD_SLOT_H);
    const st = focusable(f, cell);
    const face = cardFaceAt(state.cardStash[i], cell.w);
    if (face) f.g.drawImage(face, cell.x, cell.y, cell.w, cell.h);
    else well(f, cell);
    if (i === u.picked) strokeRect(f, inset(cell, -1), UI.gold, 2);
    if (u.forgePick.includes(i)) strokeRect(f, inset(cell, -1), UI.arcane, 2);
    if (st.focused) focusRing(f, cell);
    if (st.activated) u.picked = u.picked === i ? -1 : i;
  }
  const rows = Math.ceil(state.cardStash.length / perRow);
  cutTop(body, rows * (CARD_SLOT_H + 18) + GRID);

  // Forge + reroll act on the picked card(s).
  const tools = cutTop(body, 28);
  const forgeBtn = { ...tools };
  const rerollBtn = cutRight(forgeBtn, 210);
  if (button(f, rect(forgeBtn.x, forgeBtn.y, 260, 24), `FORGE 2 COMMONS → RARE (1 ${REAGENTS[FORGE_CATALYST]?.label ?? "Grim Bone"})`, {
    disabled: !canForge(u.forgePick),
  })) {
    say(u, forge(u.forgePick));
    u.forgePick = [];
  }
  if (button(f, rect(rerollBtn.x, rerollBtn.y, 200, 24), `REROLL PICKED — ${PRICE_REROLL_CARD}g`, {
    disabled: u.picked < 0 || getBalance() < PRICE_REROLL_CARD,
  })) {
    say(u, rerollCard(u.picked));
  }
  const hint = cutTop(body, 16);
  text(f, "hold a pick and press F to add it to the forge (max 2)", hint.x, hint.y + 2, {
    size: 8,
    colour: UI.textFaint,
  });
  // The forge needs TWO cards, and the single `picked` slot cannot express
  // that — so forge selection is its own list, toggled with F on the pick.
  if (f.input.typed.includes("f") && u.picked >= 0) {
    if (u.forgePick.includes(u.picked)) u.forgePick = u.forgePick.filter((i) => i !== u.picked);
    else if (u.forgePick.length < 2) u.forgePick.push(u.picked);
  }
}

// ── WEAPONSMITH ───────────────────────────────────────────────────────────────

function weaponsBody(f: UiFrame, body: Rect, u: TavernUi): void {
  const w = state.weaponSlots[activeWeaponSlotIndex()];
  heading(f, cutTop(body, ROW_H), "THE ANVIL — works on the weapon in your hand");
  if (!w) {
    text(f, "no weapon equipped", body.x, body.y + 4, { size: 8, colour: UI.textFaint });
    return;
  }
  const def = WEAPONS[w.id];
  const head = cutTop(body, 44);
  well(f, head);
  drawIcon(f.g, itemIcon(w.id), head.x + 4, head.y + 4, 36);
  text(f, `${def.label.toUpperCase()}${w.upgrade ? ` +${w.upgrade}` : ""}`, head.x + 46, head.y + 6, {
    size: 8,
    colour: UI.gold,
  });
  const dur = Number.isFinite(w.durability) ? `${w.durability}/${def.maxDurability}` : "∞";
  text(f, `durability ${dur} · ${weaponSlotCount(w)} socket(s) · insured ${w.insured ?? 0}`, head.x + 46, head.y + 22, {
    size: 8,
    colour: UI.textDim,
  });

  const rowBtn = (label: string, price: number, disabled: boolean, run: () => void): void => {
    const r = cutTop(body, 28);
    if (button(f, rect(r.x, r.y, r.w, 24), `${label}  —  ${price}g`, { disabled })) run();
    cutTop(body, 2);
  };

  rowBtn("REPAIR", PRICE_REPAIR_WEAPON, getBalance() < PRICE_REPAIR_WEAPON, () => say(u, repairWeapon()));
  rowBtn("ADD SOCKET", PRICE_ADD_SLOT, getBalance() < PRICE_ADD_SLOT || weaponSlotCount(w) >= 3, () =>
    say(u, addSlot()),
  );

  // UPGRADE — the risk is STATED before the roll. A hidden coin-flip that eats
  // a legendary is a feel-bad; a 36% gamble you deliberately took is a story.
  const lvl = w.upgrade ?? 0;
  const risk = breakChance(lvl);
  const upCost = PRICE_UPGRADE_BASE + lvl * 25;
  const armed = u.upgradeArmed === lvl;
  const ur = cutTop(body, 30);
  if (
    button(
      f,
      rect(ur.x, ur.y, ur.w, 24),
      armed
        ? `CONFIRM — ${Math.round(risk * 100)}% TO SHATTER`
        : `UPGRADE TO +${lvl + 1}  —  ${upCost}g${risk > 0 ? `  (${Math.round(risk * 100)}% risk)` : ""}`,
      { disabled: getBalance() < upCost, danger: armed },
    )
  ) {
    const res = upgradeWeapon(u.upgradeArmed);
    u.upgradeArmed = res.armed;
    say(u, res.result);
  }
  cutTop(body, 2);

  const tier = Math.min(w.insured ?? 0, INSURANCE_MAX_TIER);
  const cards = w.cards?.length ?? 0;
  const insCost = insuranceCost(tier, w.rarity ?? "common");
  rowBtn(
    `INSURE (${tier}/${Math.min(INSURANCE_MAX_TIER, cards)} cards)`,
    insCost,
    cards === 0 || tier >= INSURANCE_MAX_TIER || tier >= cards || getBalance() < insCost,
    () => say(u, insureWeapon()),
  );

  const sr = cutTop(body, 30);
  if (button(f, rect(sr.x, sr.y, sr.w, 24), `SACRIFICE FOR ${salvageValue(w)}g — cards returned`, { danger: true })) {
    say(u, salvageWeapon());
  }

  // Any action other than the upgrade button disarms a pending confirm. Without
  // this, arming a gamble then wandering off leaves it primed, and the next
  // stray press fires a roll the player never re-read.
  if (f.consumed && u.upgradeArmed !== null && !armed) u.upgradeArmed = null;
}

const VENDOR_BODY: Record<VendorId, (f: UiFrame, body: Rect, u: TavernUi) => void> = {
  potions: potionsBody,
  cards: cardsBody,
  armor: armorBody,
  weapons: weaponsBody,
};

/**
 * Padding under the last row, so the bottom of a counter is not flush with the
 * bottom of the view.
 */
const BODY_TAIL = GRID * 2;

export function tavernScreen(d: {
  onDescend: () => void;
  stats: TavernStats;
  /** Counter mode: open straight onto one vendor, and hand back on close. */
  vendor?: VendorId;
  onClose?: () => void;
}): UiScreen {
  const u: TavernUi = {
    vendor: d.vendor ?? null,
    picked: -1,
    forgePick: [],
    upgradeArmed: null,
    alchTab: "buy",
    flash: "",
    flashUntil: 0,
  };
  /**
   * Content height per vendor, MEASURED off the previous frame's layout.
   *
   * This used to be `vendorHeight()`, a hand-written formula per vendor, and it
   * disagreed with what the bodies actually paint — badly. The Alchemist's summed
   * BOTH its tabs, so the shelf (six rows, ~284px) declared 938px and scrolled
   * into 650px of void with a scrollbar thumb sized for content that was not
   * there; the weaponsmith's `ROW_H + 44 + 5 * 30 + 80` counted five rows for a
   * body that paints six. `cutTop` already advances `body` by exactly what each
   * row consumes, so the distance it travelled IS the content height — the
   * counting and the drawing cannot disagree when there is only one of them.
   *
   * The debug console reached the same conclusion the same way; its note says a
   * formula that forgets a section "fails in exactly the same silent way the
   * constant did". Per vendor, because switching counters changes the content
   * completely, and the first frame of each runs with 0 — no scrollbar, offset
   * clamped to 0 — which is exactly right for a counter that just opened.
   */
  const measuredH: Partial<Record<VendorId, number>> = {};
  const counterMode = d.vendor !== undefined;
  rollBarOffers();

  return {
    id: "tavern",
    pauses: true,
    focus: 0,
    scroll: 0,
    // See `UiScreen.design`. 800x450 is the design floor every sheet in this
    // game now targets, so on a desktop grid they all come out at 2x and at the
    // SAME zoom as each other — a menu at 1x beside a HUD at 2x reads as two
    // different games stapled together.
    design: { w: 600, h: 338, max: 2 },
    onCancel() {
      if (u.vendor && !counterMode) {
        // Back to the room, not out of the tavern.
        u.vendor = null;
        u.picked = -1;
        u.forgePick = [];
        return true;
      }
      return false;
    },
    onClose: d.onClose,
    paint(f, self) {
      scrim(f);
      const outer = sheet(f, 584, 322);

      const head = cutTop(outer, 32);
      text(f, "THE TAVERN", head.x, head.y, { size: 16, colour: UI.gold });
      drawIcon(f.g, glyph("coin", 8, UI.gold), head.x + head.w - 80, head.y + 8, 8);
      text(f, `${getBalance()}g`, head.x + head.w, head.y + 8, { size: 8, colour: UI.gold, align: "right" });

      const flashRow = cutTop(outer, 14);
      if (u.flash && performance.now() < u.flashUntil) {
        text(f, u.flash, flashRow.x, flashRow.y + 2, { size: 8, colour: UI.gold });
      }

      const foot = rect(outer.x, outer.y + outer.h - ROW_H, outer.w, ROW_H);
      const view = rect(outer.x, outer.y, outer.w, outer.h - ROW_H - GRID);

      if (!u.vendor) {
        // ── THE ROOM ── four stations to walk up to.
        const gridTop = { ...view };
        heading(f, cutTop(gridTop, ROW_H), `FLOOR ${d.stats.floor} · ${d.stats.kills} KILLS · GRADE ${d.stats.grade}`);
        for (const [i, v] of VENDORS.entries()) {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const cell = rect(gridTop.x + col * (gridTop.w / 2), gridTop.y + row * 90, gridTop.w / 2 - GRID, 82);
          const st = focusable(f, cell);
          fillRect(f, cell, UI.well);
          strokeRect(f, cell, st.focused ? UI.focus : UI.sheetEdge);
          drawIcon(f.g, glyph(v.icon, 32, UI.gold), cell.x + GRID, cell.y + GRID, 32);
          text(f, v.name, cell.x + 52, cell.y + 14, { size: 8, colour: UI.gold });
          text(f, v.blurb, cell.x + 52, cell.y + 30, { size: 8, colour: UI.textDim, max: cell.w - 60 });
          if (st.activated) {
            u.vendor = v.id;
            u.picked = -1;
            u.forgePick = [];
          }
        }
        const descend = rect(view.x + view.w / 2 - 120, view.y + 210, 240, 30);
        if (button(f, descend, "DESCEND — NEXT FLOOR", { good: true })) {
          pop();
          d.onDescend();
          return;
        }
      } else {
        // ── A COUNTER ──
        const v = VENDORS.find((x) => x.id === u.vendor)!;
        const bar = cutTop(view, 26);
        drawIcon(f.g, glyph(v.icon, 16, UI.gold), bar.x, bar.y + 2, 16);
        text(f, v.name, bar.x + 22, bar.y + 5, { size: 8, colour: UI.gold });
        if (button(f, rect(bar.x + bar.w - 130, bar.y, 130, 22), counterMode ? "← TAVERN" : "← BACK TO ROOM")) {
          if (counterMode) {
            pop();
            return;
          }
          u.vendor = null;
          u.picked = -1;
          u.forgePick = [];
        }

        // Captured into a local so TypeScript keeps the narrowing across the
        // calls below — `u.vendor` is mutable and the compiler is right to
        // widen it again after the button handler above could have cleared it.
        const vid = v.id;
        const contentH = measuredH[vid] ?? 0;
        const sc = beginScroll(f, view, contentH, self.scroll);
        const body = { ...sc.inner };
        VENDOR_BODY[vid](f, body, u);
        // How far `cutTop` walked `body` down IS the content height — see
        // `measuredH`. Read before `endScroll` so the scrollbar it draws this
        // frame and the height measured for the next come from one number.
        measuredH[vid] = body.y - sc.inner.y + BODY_TAIL;
        endScroll(f, view, contentH, sc.offset);
        // ── THE REGION FOLLOWS THE CURSOR ──
        // `beginScroll` only advances from the mouse wheel, and only while the
        // pointer is inside the region. Every counter here is taller than the
        // view (measured: the Alchemist paints to y=380 in a 338-tall box, and a
        // real card stash takes the dealer far past that), so without this the
        // rows below the fold were mouse-only: the D-pad walked the focus ring
        // off the bottom, the highlight vanished, and Enter fired a button that
        // could not be seen. See `followFocus`.
        self.scroll = followFocus(f, view, sc.offset);
      }

      text(f, "ESC / B — BACK   ↑↓ MOVE   ENTER / A PICK", foot.x, foot.y + 8, { size: 8, colour: UI.textFaint });
      self.focus = f.focus;
    },
  };
}
