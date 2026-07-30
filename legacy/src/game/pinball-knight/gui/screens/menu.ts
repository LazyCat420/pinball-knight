/**
 * 🎒 THE KNIGHT MENU, in the game.
 *
 * A port of `menu.ts` — the Esc/I sheet, six tabs — off the DOM and onto the UI
 * layer. The RULES are untouched: skills, cards, legacy perks, the bestiary and
 * settings all still live in their own modules and are called exactly as the
 * DOM version called them. What changed is layout, painting and input.
 *
 * ── WHAT THE PORT FIXES, STRUCTURALLY ──
 *
 * The DOM menu addressed widgets by string attributes (`data-act` suffix plus
 * `data-idx`), and its own `resolveAct` comment records what that cost: an
 * empty `data-idx=""` SHADOWED the act suffix, so `spendSkillPoint("")` looked
 * up an unknown node and failed silently while the re-render repainted every
 * affordance — the skill tree appeared to "select everything then nothing".
 * Here a widget is identified by its position in the call order. There is no
 * string to shadow and no separate render pass to fall out of step.
 *
 * It also gains a whole input device: every row is `focusable()`, so the menu
 * is fully navigable from a gamepad, which the DOM version never was.
 *
 * ── WHAT THE PORT COSTS ──
 *
 * Density. The DOM sheet used 9-13px text against the window; this is 8px on
 * the pixel-pass grid (1280x720 at common sizes). Fewer rows fit, so SKILLS and
 * BESTIARY scroll rather than laying everything out at once. That is a real
 * change to how those two tabs read, not a neutral re-skin.
 */
import { state, activeWeapon, WEAPON_SLOTS } from "../../state";
import { WEAPONS, GEAR, GEAR_SLOTS, weaponSlotCount } from "../../items";
import { cardDef, cardFitsKind, socketCard, lowerRarity, cardsOfRarity, reKeyCard } from "../../cards";
import { ABILITIES, ABILITY_IDS, abilityRank, abilityRankCost, type AbilityId } from "../../abilities";
import { ABILITY_RANK_MAX, ABILITY_RANK_STEP, ABILITY_RANK_RULE } from "../../constants";
import { getBalance, spendGold } from "../../../../utils/gold-wallet";
import { loadBestDepth } from "../../best-depth";
import { SKILLS, SKILL_IDS, SKILL_BRANCHES, canLearn, xpForLevel, type SkillBranch } from "../../skills";
import { REAGENTS, REAGENT_IDS } from "../../reagents";
import { buildBestiary, bestiaryProgress } from "../../bestiary";
import { spendSkillPoint, spendAbilityRank, unlockedAbilities, invalidateSkillAgg } from "../../skill-runtime";
import { LEGACY_PERKS, PERK_IDS, perkRank, addPerkRank } from "../../legacy";
import { UI, GRID, ROW_H } from "../theme";
import {
  bar,
  beginScroll,
  button,
  cutLeft,
  cutRight,
  cutTop,
  endScroll,
  fillRect,
  focusable,
  focusRing,
  key,
  heading,
  inset,
  pips,
  rect,
  scrim,
  sheet,
  strokeRect,
  text,
  toggle,
  wrap,
  well,
  type Rect,
  type UiFrame,
} from "../im";
import { drawIcon, glyph, itemIcon, type GlyphId } from "../icons";
import { cardFaceAt, CARD_W, CARD_H } from "../card-face";
import { pop, push, type UiScreen } from "../stack";
import { settingsScreen } from "./settings";

/**
 * What each ability GAINS at rank 2, printed on its row.
 *
 * Carried over verbatim from the DOM menu, including its reasoning: a rule the
 * player cannot see before buying it may as well not exist, and this repo has
 * already lost a mechanic exactly that way (secret walls with no supply and no
 * tell).
 */
const ABILITY_RANK_RULE_TEXT: Record<AbilityId, string> = {
  flippercharge: "invulnerable for the whole ride",
  arcanepulse: "plants a lightning rod",
  magnetaura: "the field drags the horde in",
  timecrawl: "lays a ring of frost runes",
  bladestorm: "the blades shred enemy shots",
  slickfield: "adds a tar core",
};

type MenuTab = "equipment" | "cards" | "skills" | "bestiary" | "stats";
const TABS: Array<{ id: MenuTab; label: string; icon: GlyphId }> = [
  { id: "equipment", label: "GEAR", icon: "sword" },
  { id: "cards", label: "CARDS", icon: "card" },
  { id: "skills", label: "SKILLS", icon: "spark" },
  { id: "bestiary", label: "BEAST", icon: "book" },
  { id: "stats", label: "STATS", icon: "scroll" },
];

const BRANCH_META: Record<SkillBranch, { label: string; colour: string; icon: GlyphId }> = {
  steel: { label: "STEEL", colour: UI.text, icon: "steel" },
  flipper: { label: "FLIPPER", colour: UI.arcane, icon: "flipper" },
  arcana: { label: "ARCANA", colour: UI.arcane, icon: "spark" },
};

/** Per-screen state that must outlive a frame but not the screen. */
interface MenuState {
  tab: MenuTab;
  /** A stash card picked up, waiting for a socket to be clicked. */
  picked: number;
  /** Two-step confirm on ABANDON — a reflexive Esc must not end a good run. */
  abandonArmed: boolean;
  flash: string;
  flashUntil: number;
  /** One scroll offset PER TAB. A shared one would jump when you switch. */
  scrolls: Record<MenuTab, number>;
  /** Focus is also per-tab, for the same reason. */
  focuses: Record<MenuTab, number>;
}

function newMenuState(): MenuState {
  return {
    tab: "equipment",
    picked: -1,
    abandonArmed: false,
    flash: "",
    flashUntil: 0,
    scrolls: { equipment: 0, cards: 0, skills: 0, bestiary: 0, stats: 0 },
    focuses: { equipment: 0, cards: 0, skills: 0, bestiary: 0, stats: 0 },
  };
}

function flash(m: MenuState, msg: string): void {
  m.flash = msg;
  m.flashUntil = performance.now() + 1800;
}

// ── EQUIPMENT ─────────────────────────────────────────────────────────────────

function equipmentTab(f: UiFrame, body: Rect, m: MenuState): number {
  let y = 0;
  const line = (h: number): Rect => cutTop(body, h);

  heading(f, line(ROW_H), "HANDS — TAB swaps in the field");
  for (let i = 0; i < WEAPON_SLOTS; i++) {
    const w = state.weaponSlots[i];
    const r = line(40);
    y += 40;
    if (!w) {
      well(f, r);
      text(f, "empty hand slot — weapons drop in the maze", r.x + GRID, r.y + 14, { size: 8, colour: UI.textFaint });
      // An empty slot still registers, so the focus order does not renumber
      // when a weapon is picked up mid-run.
      focusable(f, r, { disabled: true });
      continue;
    }
    const def = WEAPONS[w.id];
    well(f, r);
    const row = { ...r };
    const iconBox = cutLeft(row, 40);
    drawIcon(f.g, itemIcon(w.id), iconBox.x + 4, iconBox.y + 4, 32);

    const equipBox = cutRight(row, 88);
    text(f, def.label.toUpperCase(), row.x + 4, row.y + 6, { size: 8, colour: UI.text, max: row.w - 8 });
    // FILLED of TOTAL. Printing only the filled count reads as "this weapon
    // has no sockets" on every fresh drop, which is the opposite of true and
    // hides the whole card system from a new player.
    const filled = (w.cards ?? []).filter(Boolean).length;
    const total = weaponSlotCount(w);
    text(f, `${def.kind} · ${filled}/${total} socket${total === 1 ? "" : "s"}`, row.x + 4, row.y + 20, {
      size: 8,
      colour: UI.textDim,
      max: row.w - 8,
    });

    if (i === state.activeSlot) {
      text(f, "IN HAND", equipBox.x + 4, equipBox.y + 14, { size: 8, colour: UI.gold });
      focusable(f, equipBox, { disabled: true });
    } else if (button(f, { x: equipBox.x, y: equipBox.y + 8, w: 80, h: 22 }, "EQUIP")) {
      state.activeSlot = i;
      state.hudDirty = true; // applyWeaponArt picks the new hand up next frame
    }
    cutTop(body, 4);
  }

  heading(f, line(ROW_H), "PLATE");
  for (const slot of GEAR_SLOTS) {
    const def = GEAR[slot];
    const cur = state.gear[slot] ?? 0;
    const base = def.absorb > 0 ? def.absorb : 1;
    const r = line(36);
    well(f, r);
    const row = { ...r };
    const iconBox = cutLeft(row, 36);
    // 28px, not 16. These are 72px native sprites; at 16 the minification is
    // 4.5x and a helmet reduces to a two-pixel speck that reads as a bullet
    // point rather than as armour.
    drawIcon(f.g, itemIcon(slot) ?? glyph("shield", 28, UI.textDim), iconBox.x + 4, iconBox.y + 4, 28);
    text(f, def.label.toUpperCase(), row.x + 4, row.y + 4, { size: 8, colour: UI.text });
    text(f, def.absorb > 0 ? `soaks ${def.absorb}` : "+move speed", row.x + 4, row.y + 18, {
      size: 8,
      colour: UI.textDim,
    });
    const status =
      cur <= 0 ? "none — buy at the Tavern" : cur < base ? `worn ${cur}/${base}` : `sound ${cur}/${base}`;
    const colour = cur <= 0 ? UI.textFaint : cur < base ? UI.gold : UI.good;
    text(f, status, r.x + r.w - GRID, r.y + 12, { size: 8, colour, align: "right" });
    focusable(f, r, { disabled: true });
    cutTop(body, 3);
  }

  heading(f, line(ROW_H), "BELT — keys 1-4");
  const beltRow = line(28);
  for (let i = 0; i < 4; i++) {
    const b = state.belt[i];
    const cell = rect(beltRow.x + i * 88, beltRow.y, 80, 24);
    well(f, cell);
    text(f, String(i + 1), cell.x + 5, cell.y + 8, { size: 8, colour: UI.textFaint });
    if (b) {
      drawIcon(f.g, itemIcon(b.id ?? "") , cell.x + 18, cell.y + 4, 16);
      text(f, `x${b.count}`, cell.x + cell.w - 6, cell.y + 8, { size: 8, colour: UI.text, align: "right" });
    } else {
      text(f, "·", cell.x + cell.w / 2, cell.y + 8, { size: 8, colour: UI.textFaint, align: "center" });
    }
  }
  return y;
}

// ── CARDS ─────────────────────────────────────────────────────────────────────

/** A card at a readable size in a menu: the face, scaled to fit its slot. */
const CARD_SLOT_W = 56;
const CARD_SLOT_H = Math.round((CARD_H / CARD_W) * CARD_SLOT_W);

function cardsTab(f: UiFrame, body: Rect, m: MenuState): void {
  heading(f, cutTop(body, ROW_H), "YOUR WEAPONS — pick a stash card, then a ＋ slot");
  text(f, "un-socketing drops the card one rarity tier, same as the armory", body.x, body.y, {
    size: 8,
    colour: UI.textDim,
  });
  cutTop(body, 14);

  for (let wi = 0; wi < WEAPON_SLOTS; wi++) {
    const w = state.weaponSlots[wi];
    if (!w) continue;
    const def = WEAPONS[w.id];
    const r = cutTop(body, CARD_SLOT_H + 24);
    well(f, r);
    text(f, def.label.toUpperCase(), r.x + GRID, r.y + 5, { size: 8, colour: UI.gold });

    // Socket COUNT comes from the weapon's rarity plus any bonus slots, not
    // from the static def — an upgraded weapon has more sockets than its base.
    const slots = weaponSlotCount(w);
    for (let ci = 0; ci < slots; ci++) {
      const cell = rect(r.x + GRID + ci * (CARD_SLOT_W + 6), r.y + 18, CARD_SLOT_W, CARD_SLOT_H);
      const id = w.cards?.[ci];
      const st = focusable(f, cell);
      if (id) {
        const face = cardFaceAt(id, cell.w);
        if (face) f.g.drawImage(face, cell.x, cell.y, cell.w, cell.h);
        else well(f, cell);
        // Clicking a socketed card un-sockets it, at the armory's price.
        if (st.activated) unsocket(m, wi, ci);
      } else {
        well(f, cell);
        text(f, "+", cell.x + cell.w / 2, cell.y + cell.h / 2 - 4, { size: 16, colour: UI.textFaint, align: "center" });
        if (st.activated) socketPicked(m, wi);
      }
      if (st.focused) focusRing(f, cell);
    }
    cutTop(body, 6);
  }

  const stash = state.cardStash;
  heading(f, cutTop(body, ROW_H), `STASH (${stash.length})`);
  if (!stash.length) {
    text(f, "no stashed cards — kill enemies to find them", body.x, body.y + 4, { size: 8, colour: UI.textFaint });
    return;
  }
  const perRow = Math.max(1, Math.floor(body.w / (CARD_SLOT_W + 6)));
  for (let i = 0; i < stash.length; i++) {
    const col = i % perRow;
    const rowIdx = Math.floor(i / perRow);
    const cell = rect(body.x + col * (CARD_SLOT_W + 6), body.y + rowIdx * (CARD_SLOT_H + 6), CARD_SLOT_W, CARD_SLOT_H);
    const st = focusable(f, cell);
    const face = cardFaceAt(stash[i], cell.w);
    if (face) f.g.drawImage(face, cell.x, cell.y, cell.w, cell.h);
    else well(f, cell);
    if (i === m.picked) strokeRect(f, inset(cell, -1), UI.gold, 2);
    if (st.focused) focusRing(f, cell);
    if (st.activated) m.picked = m.picked === i ? -1 : i;
  }
}

function socketPicked(m: MenuState, wIdx: number): void {
  if (m.picked < 0) {
    flash(m, "pick a stash card first");
    return;
  }
  const w = state.weaponSlots[wIdx];
  const id = state.cardStash[m.picked];
  if (!w || !id) return;
  if (!cardFitsKind(id, WEAPONS[w.id].kind)) {
    flash(m, "this card doesn't fit that weapon");
    return;
  }
  if (socketCard(w, id)) {
    state.cardStash.splice(m.picked, 1);
    m.picked = -1;
    state.hudDirty = true;
  } else {
    flash(m, "no free slot on that weapon");
  }
}

function unsocket(m: MenuState, wIdx: number, ci: number): void {
  const w = state.weaponSlots[wIdx];
  if (!w?.cards?.[ci]) return;
  const removed = w.cards.splice(ci, 1)[0];
  // Same respec cost as the tavern: one rarity tier down, commons crumble. The
  // menu must not be a free respec that the armory charges for.
  const lower = lowerRarity(cardDef(removed)!.rarity);
  if (lower) {
    const bag = cardsOfRarity(lower);
    state.cardStash.push(reKeyCard(removed, bag[Math.floor(Math.random() * bag.length)]));
    flash(m, `un-socketed → dropped to ${lower}`);
  } else {
    flash(m, "common card crumbled to dust");
  }
  state.hudDirty = true;
}

// ── SKILLS ────────────────────────────────────────────────────────────────────

function skillsTab(f: UiFrame, body: Rect, m: MenuState): void {
  // Header: level, XP, points.
  const head = cutTop(body, 28);
  well(f, head);
  const need = xpForLevel(state.charLevel);
  text(f, `LEVEL ${state.charLevel}`, head.x + GRID, head.y + 10, { size: 8, colour: UI.gold });
  bar(f, rect(head.x + 96, head.y + 10, head.w - 260, 8), state.charXp / need);
  text(f, `${state.charXp}/${need} xp`, head.x + head.w - 120, head.y + 10, { size: 8, colour: UI.textDim });
  text(f, `${state.skillPoints} pt`, head.x + head.w - GRID, head.y + 10, {
    size: 8,
    colour: state.skillPoints > 0 ? UI.good : UI.textDim,
    align: "right",
  });
  cutTop(body, 6);

  // The tree, as three columns.
  const colW = Math.floor(body.w / 3);
  for (const [bi, branch] of SKILL_BRANCHES.entries()) {
    const meta = BRANCH_META[branch];
    const ids = SKILL_IDS.filter((id) => SKILLS[id].branch === branch).sort((x, y) => SKILLS[x].row - SKILLS[y].row);
    const colX = body.x + bi * colW;
    drawIcon(f.g, glyph(meta.icon, 8, meta.colour), colX, body.y + 1, 8);
    text(f, meta.label, colX + 12, body.y + 2, { size: 8, colour: meta.colour });
    for (const [ni, id] of ids.entries()) {
      const def = SKILLS[id];
      const rank = state.skillRanks[id] ?? 0;
      const gate = canLearn(id, state.skillRanks, state.skillPoints);
      const maxed = rank >= def.maxRank;
      const r = rect(colX, body.y + 14 + ni * 40, colW - 6, 36);
      const st = focusable(f, r, { disabled: maxed });

      // Four states, not three — "reachable" (prereqs met, cannot afford yet)
      // is its own quiet look so the tree does not flip from all-green to
      // all-dark on every spend. That flicker is what read as broken selection.
      const edge = maxed ? UI.gold : gate.ok ? UI.good : gate.reachable ? UI.textDim : UI.wellEdge;
      fillRect(f, r, UI.well);
      strokeRect(f, r, edge);
      text(f, def.label, r.x + 4, r.y + 4, { size: 8, colour: maxed ? UI.gold : UI.text, max: r.w - 40 });
      const sub = maxed ? "MAXED" : gate.ok ? `+1 rank · ${def.cost}pt` : gate.why ?? "";
      text(f, sub, r.x + 4, r.y + 24, { size: 8, colour: edge, max: r.w - 8 });
      pips(f, rect(r.x + r.w - 34, r.y + 2, 30, 12), rank, def.maxRank);
      if (st.focused) focusRing(f, r);
      if (st.activated) {
        const res = spendSkillPoint(id);
        flash(m, res.ok ? `${def.label} — rank ${state.skillRanks[id]}` : res.why ?? "can't learn that yet");
      }
    }
  }

  const tallest = Math.max(...SKILL_BRANCHES.map((b) => SKILL_IDS.filter((id) => SKILLS[id].branch === b).length));
  cutTop(body, 14 + tallest * 40 + GRID);

  // Legacy perks — permanent, wallet gold, survive death.
  heading(f, cutTop(body, ROW_H), "LEGACY — permanent, banked gold, survives death", UI.gold);
  for (const id of PERK_IDS) {
    const def = LEGACY_PERKS[id];
    const rank = perkRank(id);
    const maxed = rank >= def.maxRank;
    const afford = getBalance() >= def.cost;
    const r = cutTop(body, 30);
    well(f, r);
    text(f, def.label, r.x + GRID, r.y + 4, { size: 8, colour: UI.text });
    text(f, def.description, r.x + GRID, r.y + 17, { size: 8, colour: UI.textDim, max: r.w - 140 });
    const btn = rect(r.x + r.w - 104, r.y + 4, 96, 22);
    if (maxed) {
      text(f, `OWNED${def.maxRank > 1 ? ` ${rank}/${def.maxRank}` : ""}`, btn.x + btn.w, btn.y + 8, {
        size: 8,
        colour: UI.gold,
        align: "right",
      });
      focusable(f, btn, { disabled: true });
    } else if (button(f, btn, rank > 0 ? `RANK ${rank + 1} ${def.cost}g` : `BUY ${def.cost}g`, { disabled: !afford })) {
      if (getBalance() < def.cost || !spendGold(def.cost)) flash(m, "not enough banked gold");
      else {
        // Same honesty rule as the tavern: banked spend shows in the run total.
        state.goldRun = Math.max(0, state.goldRun - def.cost);
        addPerkRank(id);
        invalidateSkillAgg();
        state.hudDirty = true;
        flash(m, `${def.label} — yours forever`);
      }
    }
    cutTop(body, 3);
  }

  // Active abilities — Q/E assignment and ranks.
  heading(f, cutTop(body, ROW_H), "ABILITIES — assign to Q / E, or invest points");
  const unlocked = unlockedAbilities();
  for (const id of ABILITY_IDS) {
    const a = ABILITIES[id];
    const has = unlocked.includes(id);
    const rank = abilityRank(id);
    const maxed = rank >= ABILITY_RANK_MAX;
    const cost = abilityRankCost(rank);
    const r = cutTop(body, 34);
    well(f, r);
    const row = { ...r };
    const qBox = cutRight(row, 30);
    const eBox = cutRight(row, 30);
    const rankBox = cutRight(row, 44);
    const pipBox = cutRight(row, 40);

    text(f, `${a.label}${rank > 0 ? `  +${Math.round(ABILITY_RANK_STEP * rank * 100)}%` : ""}`, row.x + GRID, row.y + 4, {
      size: 8,
      colour: has ? UI.text : UI.textFaint,
      max: row.w - GRID,
    });
    const ruleAt = has && rank < ABILITY_RANK_RULE ? ` · rank ${ABILITY_RANK_RULE}: ${ABILITY_RANK_RULE_TEXT[id]}` : "";
    text(f, `${a.detail} · ${a.cost} mana · ${a.cooldown}s cd${ruleAt}`, row.x + GRID, row.y + 19, {
      size: 8,
      colour: UI.textDim,
      max: row.w - GRID,
    });

    if (!has) {
      text(f, "LOCKED — unlock in ARCANA", r.x + r.w - GRID, r.y + 12, { size: 8, colour: UI.textFaint, align: "right" });
      // Three disabled registrations keep the focus order identical whether or
      // not an ability is unlocked; otherwise unlocking one renumbers the rest.
      focusable(f, rankBox, { disabled: true });
      focusable(f, qBox, { disabled: true });
      focusable(f, eBox, { disabled: true });
      cutTop(body, 3);
      continue;
    }

    pips(f, rect(pipBox.x, pipBox.y + 11, 36, 12), rank, ABILITY_RANK_MAX);
    if (maxed) {
      text(f, "MAX", rankBox.x + 4, rankBox.y + 12, { size: 8, colour: UI.gold });
      focusable(f, rankBox, { disabled: true });
    } else if (
      button(f, { x: rankBox.x, y: rankBox.y + 6, w: 40, h: 22 }, `+${cost}pt`, { disabled: state.skillPoints < cost })
    ) {
      const res = spendAbilityRank(id);
      flash(m, res.ok ? `${a.label} — rank ${abilityRank(id)}` : res.why ?? "can't rank that yet");
    }
    if (toggle(f, { x: eBox.x, y: eBox.y + 6, w: 26, h: 22 }, state.abilitySlots[1] === id, ["E", "E"])) assign(id, 1);
    if (toggle(f, { x: qBox.x, y: qBox.y + 6, w: 26, h: 22 }, state.abilitySlots[0] === id, ["Q", "Q"])) assign(id, 0);
    cutTop(body, 3);
  }
}

function assign(id: AbilityId, slot: 0 | 1): void {
  const other = slot === 0 ? 1 : 0;
  // Assigning an ability that is on the other key SWAPS them rather than
  // duplicating it onto both.
  if (state.abilitySlots[other] === id) state.abilitySlots[other] = state.abilitySlots[slot];
  state.abilitySlots[slot] = id;
  state.hudDirty = true;
}

// ── BESTIARY ──────────────────────────────────────────────────────────────────

function bestiaryTab(f: UiFrame, body: Rect): void {
  const entries = buildBestiary(state.killsByKind);
  const p = bestiaryProgress(state.killsByKind);
  heading(f, cutTop(body, ROW_H), `BESTIARY — ${p.seen}/${p.total} monsters met`, UI.gold);
  text(f, "materials brew at the Tavern Alchemist; a monster's card is its power.", body.x, body.y, {
    size: 8,
    colour: UI.textDim,
  });
  cutTop(body, 14);

  for (const e of entries) {
    const drops = e.seen ? e.drops.map((d) => `${d.label} ${Math.round(d.chance * 100)}%`).join("  ") : "";
    const lines = e.seen ? wrap(f, drops || "carries no materials", body.w - GRID * 2) : [];
    const h = 26 + lines.length * 11 + (e.seen && e.mechanics.length ? e.mechanics.length * 11 : 0);
    const r = cutTop(body, h);
    well(f, r);
    text(f, e.label, r.x + GRID, r.y + 4, { size: 8, colour: e.seen ? UI.text : UI.textFaint });
    if (!e.seen) {
      // An unfought monster shows its name but MASKS its drops. Handing over
      // the full table on floor 1 makes the screen a wiki; earning each row is
      // what makes it a bestiary.
      text(f, "??? — slay one to learn what it carries", r.x + r.w - GRID, r.y + 4, {
        size: 8,
        colour: UI.textFaint,
        align: "right",
      });
      cutTop(body, 3);
      continue;
    }
    const m = e.milestone;
    text(f, `x${e.kills}${m.affinity > 1 ? ` · ${m.affinity.toFixed(2)}x card` : ""}`, r.x + r.w - GRID, r.y + 4, {
      size: 8,
      colour: UI.textDim,
      align: "right",
    });
    let ly = r.y + 16;
    for (const mech of e.mechanics) {
      text(f, `· ${mech}`, r.x + GRID, ly, { size: 8, colour: UI.textDim, max: r.w - GRID * 2 });
      ly += 11;
    }
    for (const l of lines) {
      text(f, l, r.x + GRID, ly, { size: 8, colour: UI.good, max: r.w - GRID * 2 });
      ly += 11;
    }
    cutTop(body, 3);
  }
}

// ── STATS ─────────────────────────────────────────────────────────────────────

function statsTab(f: UiFrame, body: Rect): void {
  const runS = state.runStartMs > 0 ? Math.max(0, (performance.now() - state.runStartMs) / 1000 - state.pausedRunS) : 0;
  const mm = Math.floor(runS / 60);
  const ss = Math.floor(runS % 60).toString().padStart(2, "0");
  const w = activeWeapon();
  const rows: Array<[string, string]> = [
    ["Floor", `${state.level}`],
    ["Deepest this run", `${state.runDeepestFloor}`],
    ["Best depth ever", `${Math.max(loadBestDepth(), state.runDeepestFloor)}`],
    ["Kills", `${state.kills}`],
    ["Best combo", `x${state.runBestCombo}`],
    ["Gold this run", `${state.goldRun}g`],
    ["Purse (banked)", `${getBalance()}g`],
    ["In hand", WEAPONS[w.id].label],
    ["Run time", `${mm}:${ss} (pauses don't count)`],
  ];
  heading(f, cutTop(body, ROW_H), "THE RUN SO FAR");
  for (const [k, v] of rows) {
    const r = cutTop(body, 18);
    text(f, k, r.x + 4, r.y + 4, { size: 8, colour: UI.textDim });
    text(f, v, r.x + r.w - 4, r.y + 4, { size: 8, colour: UI.gold, align: "right" });
    fillRect(f, rect(r.x, r.y + 16, r.w, 1), UI.wellEdge);
  }

  heading(f, cutTop(body, ROW_H + GRID), "ALCHEMY POUCH");
  const flaskRow = cutTop(body, 18);
  text(f, "Empty Flasks", flaskRow.x + 4, flaskRow.y + 4, { size: 8, colour: UI.textDim });
  text(f, String(state.flasks), flaskRow.x + flaskRow.w - 4, flaskRow.y + 4, { size: 8, colour: UI.gold, align: "right" });

  const held = REAGENT_IDS.filter((id) => (state.reagents[id] ?? 0) > 0);
  if (!held.length) {
    text(f, "no reagents — slay monsters to gather them", body.x + 4, body.y + 4, { size: 8, colour: UI.textFaint });
    return;
  }
  for (const id of held) {
    const r = cutTop(body, 16);
    text(f, REAGENTS[id].label, r.x + 4, r.y + 3, { size: 8, colour: UI.text });
    text(f, `x${state.reagents[id]}`, r.x + r.w - 4, r.y + 3, { size: 8, colour: UI.textDim, align: "right" });
  }
}

// ── The screen ────────────────────────────────────────────────────────────────

/** Rough content heights per tab, for the scroll region. */
function contentHeight(tab: MenuTab): number {
  switch (tab) {
    case "equipment":
      return ROW_H * 3 + WEAPON_SLOTS * 44 + GEAR_SLOTS.length * 39 + 60;
    case "cards":
      return ROW_H * 2 + WEAPON_SLOTS * (CARD_SLOT_H + 30) + Math.ceil(state.cardStash.length / 8) * (CARD_SLOT_H + 6) + 60;
    case "skills": {
      const tallest = Math.max(...SKILL_BRANCHES.map((b) => SKILL_IDS.filter((id) => SKILLS[id].branch === b).length));
      return 40 + tallest * 40 + ROW_H * 2 + PERK_IDS.length * 33 + ABILITY_IDS.length * 37 + 60;
    }
    case "bestiary":
      return ROW_H + 14 + buildBestiary(state.killsByKind).length * 52 + 40;
    case "stats":
      return ROW_H * 2 + 9 * 18 + REAGENT_IDS.length * 16 + 60;
  }
}

export function menuScreen(onAbandon: () => void): UiScreen {
  const m = newMenuState();

  return {
    id: "menu",
    pauses: true,
    focus: 0,
    scroll: 0,
    // See `UiScreen.design`. 800x450 is the design floor every sheet in this
    // game now targets, so on a desktop grid they all come out at 2x and at the
    // SAME zoom as each other — a menu at 1x next to a HUD at 2x reads as two
    // different games stapled together.
    design: { w: 800, h: 450 },
    onCancel(self) {
      // An armed ABANDON disarms on Esc rather than closing — otherwise the
      // key that armed it could also dismiss the warning it raised.
      if (m.abandonArmed) {
        m.abandonArmed = false;
        return true;
      }
      void self;
      return false;
    },
    paint(f, self) {
      scrim(f);
      const outer = sheet(f, 780, 424);

      // Header: title, purse, tabs.
      const head = cutTop(outer, 34);
      text(f, "KNIGHT", head.x, head.y + 4, { size: 16, colour: UI.gold });
      drawIcon(f.g, glyph("coin", 8, UI.gold), head.x + 132, head.y + 10, 8);
      text(f, `${getBalance()}g`, head.x + 146, head.y + 10, { size: 8, colour: UI.gold });

      // Tab focus/scroll are per-tab, so restore this tab's cursor before the
      // body paints and stash it again after.
      const prevTab = m.tab;
      f.focus = m.focuses[prevTab];

      const tabBar = cutTop(outer, 22);
      const nextTab = tabStrip(f, tabBar, m.tab);
      cutTop(outer, 6);

      // Flash line — transient feedback, same role as the DOM `#gmenu-flash`.
      const flashRow = cutTop(outer, 12);
      if (m.flash && performance.now() < m.flashUntil) {
        text(f, m.flash, flashRow.x, flashRow.y + 2, { size: 8, colour: UI.gold });
      }

      // Footer first, so the scroll region gets the space that is actually left.
      const foot = rect(outer.x, outer.y + outer.h - ROW_H, outer.w, ROW_H);
      const view = rect(outer.x, outer.y, outer.w, outer.h - ROW_H - GRID);

      const contentH = contentHeight(m.tab);
      const scrolled = beginScroll(f, view, contentH, m.scrolls[m.tab]);
      const body = { ...scrolled.inner };
      switch (m.tab) {
        case "equipment":
          equipmentTab(f, body, m);
          break;
        case "cards":
          cardsTab(f, body, m);
          break;
        case "skills":
          skillsTab(f, body, m);
          break;
        case "bestiary":
          bestiaryTab(f, body);
          break;
        case "stats":
          statsTab(f, body);
          break;
      }
      endScroll(f, view, contentH, scrolled.offset);
      m.scrolls[m.tab] = scrolled.offset;

      // Footer: hints + the two-step ABANDON.
      text(f, "ESC/B CLOSE   TAB CYCLE   1-5 JUMP   ↑↓ MOVE   ENTER/A PICK", foot.x, foot.y + 8, {
        size: 8,
        colour: UI.textFaint,
      });
      const abandonBox = rect(foot.x + foot.w - 176, foot.y, 176, ROW_H);
      if (button(f, abandonBox, m.abandonArmed ? "CONFIRM — LEAVE RUN?" : "ABANDON RUN", { danger: true })) {
        if (!m.abandonArmed) m.abandonArmed = true;
        else {
          pop();
          onAbandon();
          return;
        }
      }

      m.focuses[prevTab] = f.focus;
      if (nextTab !== m.tab) {
        m.tab = nextTab;
        m.picked = -1;
        // Restore the incoming tab's cursor rather than carrying this one's
        // across — index N of GEAR means nothing in BESTIARY.
        f.focus = m.focuses[nextTab];
      }
      // Any interaction that is not the abandon button disarms it.
      if (f.consumed && !m.abandonArmed) m.abandonArmed = false;
      self.focus = f.focus;
    },
  };
}

/** The tab strip, with its glyph marks. */
function tabStrip(f: UiFrame, r: Rect, active: MenuTab): MenuTab {
  let next = active;
  const tw = Math.floor(r.w / TABS.length);
  for (const [i, t] of TABS.entries()) {
    const tr = rect(r.x + i * tw, r.y, tw - 3, r.h);
    const st = focusable(f, tr);
    const on = t.id === active;
    // Same physical vocabulary as `im.tabs()` — this strip hand-rolls its paint
    // only so it can carry a per-tab glyph, and it must not become the one
    // control in the game that is still flat. The active tab is PRESSED IN.
    if (on) key(f, tr, { face: UI.selectFace, edge: UI.gold, sunken: true });
    else key(f, tr, { edge: UI.wellEdge });
    drawIcon(f.g, glyph(t.icon, 12, on ? UI.focus : UI.text), tr.x + 6, tr.y + 5, 12);
    text(f, t.label, tr.x + 22, tr.y + 7, { size: 8, colour: on ? UI.focus : UI.textDim, max: tr.w - 26 });
    if (st.focused) focusRing(f, tr);
    if (st.activated) next = t.id;
  }
  const i = TABS.findIndex((t) => t.id === active);
  if (f.input.nextTab) next = TABS[(i + f.input.nextTab) % TABS.length].id;
  if (f.input.prevTab) next = TABS[(i - f.input.prevTab + TABS.length * (f.input.prevTab + 1)) % TABS.length].id;
  if (f.input.digit >= 1 && f.input.digit <= TABS.length) next = TABS[f.input.digit - 1].id;
  return next;
}

/** Open the menu, or the settings sheet layered over it. */
export function openMenu(onAbandon: () => void): void {
  push(menuScreen(onAbandon));
}

/** SETTINGS is its own screen, layered over the menu — see gui/screens/settings.ts. */
export function openMenuSettings(): void {
  push(settingsScreen());
}
