/**
 * THE HUD, in the game.
 *
 * Replaces `hud-diablo.ts` (the iso strategy bar), `hud-wolf.ts` (the rampage
 * bar) and the loose readouts that lived in `ui.ts` — boss bar, plunger meter,
 * combo, FPS.
 *
 * ── THIS SCREEN DOES NOT PAUSE ──
 * Every other screen freezes the sim. The HUD is open for the whole run, so
 * `pauses: false`, and it sits at the BOTTOM of the stack: pushed once when a
 * run starts, painted under everything, and never given input. It is the one
 * screen for which "most modal first" means "not modal at all".
 *
 * ── THE FACE AND MINIMAP ARE NOT REWRITTEN ──
 * `hud-face.ts` and `hud-minimap.ts` were already canvas painters that happened
 * to be mounted in the DOM: a fixed backing store, `pixelated` rendering, and a
 * `lastSig` repaint guard. All of that still applies, so they are re-hosted
 * rather than ported — their canvases stop being DOM children and become blits
 * into the UI layer. The minimap's guard matters MORE here, not less: without
 * it the map redraws a few thousand `fillRect`s per frame for output that is
 * usually identical.
 *
 * The `hud.ts` trick of physically MOVING the face's DOM node between the two
 * HUDs (so health and expression never reset on a swap) is no longer needed:
 * the face's state was never in the node, only its pixels were, and now nothing
 * owns a node at all.
 */
import { state } from "../../state";
import { ABILITIES, abilityRank, canCast } from "../../abilities";
import { canRampage } from "../../fps";
import { bossEngaged, bossLabel } from "../../boss";
import { WEAPONS } from "../../items";
import { playerMaxHp } from "../../skill-runtime";
import { FACE_PX, createFace, renderFace, setFaceHealth } from "../../hud-face";
import { createMinimap, renderMinimap } from "../../hud-minimap";
import { UI, GRID } from "../theme";
import { bar, fillRect, rect, strokeRect, text, type Rect, type UiFrame } from "../im";
import { abilityIcon, drawIcon, itemIcon } from "../icons";
import type { UiScreen } from "../stack";

/**
 * The box this screen is authored for — see `UiScreen.design`.
 *
 * ── WHY THE HUD IS ZOOMED AND THE MENUS ARE NOT ──
 * On a 1600x900 grid this resolves to 2x, so every number, icon and meter below
 * is drawn at twice the texels it used to be. That is the whole point: the belt
 * and ability slots are the two things a player reads WHILE FIGHTING, at a
 * glance, and at 1x a potion sprite in a 44px tile was a 24px smudge that read
 * as a coloured dot. Doubling the tile without doubling the art would only have
 * made a bigger smudge, so both move together — 36px of a 72px sprite instead
 * of 24, magnified 2x, is 3x the apparent detail.
 *
 * The sheets (menu, tavern, haul) stay at 1x because they are lists: their
 * problem is fitting thirty rows, not reading one. The HUD has eight cells.
 */
export const DESIGN = { w: 600, h: 338, max: 2 };

/**
 * Panel height, in the HUD's own units.
 *
 * 76 → 61 on top of the 800x450 → 600x338 design box, which is the "20%
 * smaller" this pass was asked for: where the old and new boxes resolve to the
 * SAME zoom, the bar comes out at 0.80x its previous device height. Where they
 * do not, the new one is bigger — and those are exactly the grids where the old
 * box fell to 1x and the HUD was half size.
 */
export const PANEL_H = 61;
/** The margin `blitFace` leaves inside the face's cell, on every side. */
export const FACE_BOX_INSET = 4;
/**
 * The mugshot's cell, which is TALLER THAN THE PANEL and rises above it.
 *
 * The face is the one element here whose size is not free: `FACE_PX` is its
 * backing store and the blit must be a whole multiple of it (below), so the
 * cell has a hard floor of `FACE_PX + inset` = 76. Sizing the whole panel
 * around that floor is what the old 92px panel did, and at 2x it would have
 * eaten a fifth of the screen. Letting the portrait break the panel's top edge
 * instead is both cheaper and the older idiom — the mugshot has poked out of
 * the status bar since Doom.
 */
export const FACE_BOX = FACE_PX + FACE_BOX_INSET;
const TILE = 30;
/** Item sprites are 72px native, so 24 is an exact 3:1 — see `exactIconSize`. */
const ITEM_ICON = 24;
/**
 * The ability mark's box inside a cast tile.
 *
 * Derived from TILE rather than typed, so the two cannot drift: a glyph is
 * rasterised at exactly the size asked for, so this is a real drawing size, not
 * a scale factor, and a hardcoded 28 beside a changed TILE would silently
 * off-centre every slot.
 */
const ICON_SKILL = TILE - 12;

/**
 * How many times over the mugshot's own grid fits in a box of `w` UI pixels.
 *
 * The face is pixel art with `imageSmoothingEnabled` off, so a fractional
 * `drawImage` scale is not "slightly soft" — it is a nearest-neighbour resample
 * that DELETES rows and columns. An earlier version drew a 120px face into
 * `faceBox.w - 4` = 72px, dropping two of every five, which is why one-pixel
 * details (the eye catch-light, the nostrils, the helmet cracks) came and went.
 * `hud-face.test.ts` pins this against `FACE_BOX` so it stays exact; the
 * `max(1, …)` only exists so a future smaller panel degrades instead of drawing
 * nothing at all.
 */
export function faceBlitScale(w: number): number {
  return Math.max(1, Math.floor((w - FACE_BOX_INSET) / FACE_PX));
}

function blitFace(f: UiFrame, face: HTMLCanvasElement, box: Rect): void {
  const d = FACE_PX * faceBlitScale(box.w);
  f.g.imageSmoothingEnabled = false;
  f.g.drawImage(face, Math.round(box.x + (box.w - d) / 2), Math.round(box.y + (box.h - d) / 2), d, d);
}

/** A framed HUD cell — the bevelled stone look, in two fills. */
function cell(f: UiFrame, r: Rect, label?: string): void {
  fillRect(f, r, UI.well);
  strokeRect(f, r, UI.sheetEdge);
  if (label) text(f, label, r.x + r.w / 2, r.y + r.h - 10, { size: 8, colour: UI.textDim, align: "center" });
}

/**
 * A liquid globe. Two arcs and a fill line — the DOM version animated a ripple
 * across the surface; that survives as a sine offset on the fill line, which is
 * the part that actually reads at this size.
 */
function globe(f: UiFrame, r: Rect, t: number, colour: string, value: number, time: number): void {
  const g = f.g;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rad = Math.min(r.w, r.h) / 2 - 1;

  g.save();
  g.beginPath();
  g.arc(cx, cy, rad, 0, Math.PI * 2);
  g.clip();
  fillRect(f, r, UI.well);
  const level = cy + rad - Math.max(0, Math.min(1, t)) * rad * 2;
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(r.x, level);
  // One sine period across the globe: enough to read as liquid, cheap enough
  // that it costs nothing to do every frame.
  for (let x = 0; x <= r.w; x += 2) {
    g.lineTo(r.x + x, level + Math.sin(x / 7 + time * 3) * 1.5);
  }
  g.lineTo(r.x + r.w, r.y + r.h);
  g.lineTo(r.x, r.y + r.h);
  g.closePath();
  g.fill();
  g.restore();

  g.strokeStyle = UI.sheetEdge;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, rad, 0, Math.PI * 2);
  g.stroke();
  text(f, String(Math.round(value)), cx, cy - 4, { size: 8, colour: UI.text, align: "center" });
}

export function hudScreen(): UiScreen {
  // Re-host the two existing painters. They allocate their own fixed backing
  // stores and are idempotent, so calling create* here is safe on every run.
  const face = createFace();
  const minimap = createMinimap();
  let time = 0;

  return {
    id: "hud",
    pauses: false,
    focus: 0,
    scroll: 0,
    design: DESIGN,
    onCancel: () => true,
    paint(f) {
      // The HUD never takes input, so it never registers a focusable. That is
      // what keeps the focus cursor of whatever sheet is open above it correct.
      const p = state.player;
      if (!p) return;
      time += 1 / 60;

      // ── RAMPAGE MODE ──
      // `hud-wolf.ts` was a separate DOM panel that slid in while the other slid
      // out. Painted, it is simply a different layout for the same frame — no
      // second panel to build, park and re-parent a face between.
      if (state.hudMode === "wolf" || state.fpsActive) {
        paintWolf(f, p);
        return;
      }

      const panel = rect(0, f.h - PANEL_H, f.w, PANEL_H);
      fillRect(f, panel, UI.sheet);
      fillRect(f, rect(panel.x, panel.y, panel.w, 1), UI.sheetEdgeLit);

      const y = panel.y + GRID;
      const h = PANEL_H - GRID * 2;
      const GAP = 4;
      // Cell widths, summed so the row can be CENTRED rather than pinned to a
      // hardcoded total. The old code centred against a literal 980 and then
      // clamped to the left margin — so on any grid narrower than that the row
      // silently started overflowing the right edge instead of shrinking, which
      // is how the minimap ended up off screen.
      // `wpn` is sized for the longest weapon name at 8px Press Start 2P, whose
      // cell is exactly 8 wide — "FLAMER" is 6 glyphs, so 48px of label after
      // the icon and its gutter. Guessing narrower ellipsised the name of the
      // weapon you are holding, which is the one string on the bar that has to
      // be readable at a glance.
      // Summed so the row can be CENTRED rather than pinned to a hardcoded
      // total, and so this list is the single place the bar's width is decided.
      // It has to come in under the design box's content width (600 - 2*GRID =
      // 584) at every zoom, because below that the minimap runs off the right
      // edge — the one genuine clipping failure the old 754-unit bar had on a
      // small grid.
      const W = { skills: TILE * 2 + 10, wpn: ITEM_ICON + 26, globe: h, face: FACE_BOX, stats: 76, belt: TILE * 4 + 13, map: h };
      const total = Object.values(W).reduce((a, b) => a + b, 0) + W.globe + GAP * 5 + 8;
      let x = Math.max(GRID, Math.round((f.w - total) / 2));

      // ── SKILLS: the two ability slots, with cost and rank ──
      const skills = rect(x, y, W.skills, h);
      cell(f, skills, "SKILLS");
      for (let i = 0; i < 2; i++) {
        const id = state.abilitySlots[i];
        const tr = rect(skills.x + 4 + i * (TILE + 4), skills.y + 3, TILE, TILE);
        fillRect(f, tr, UI.sheet);
        strokeRect(f, tr, UI.wellEdge);
        if (!id || !ABILITIES[id]) continue;
        const def = ABILITIES[id];
        // "Affordable" asks the ability layer, NOT the mana bar: under the Blood
        // Price keystone an empty pool still casts, and greying out a slot the
        // player can demonstrably use is the HUD lying about the game.
        const ok = canCast(i as 0 | 1);
        // THE ABILITY'S OWN MARK, in the ability's own colour.
        //
        // Both slots used to draw `glyph("spark")`, so a player looking down mid
        // fight saw two identical symbols and had to read the mana number to
        // tell Flipper Charge from Time Crawl. The slot exists to be recognised
        // in peripheral vision; a shared glyph made that impossible.
        //
        // The mark fills the tile rather than sitting as a pip in the middle of
        // it — a glyph is rasterised at whatever size it is asked for, so this
        // is a bigger DRAWING, not a magnified small one.
        drawIcon(f.g, abilityIcon(id, ICON_SKILL, !ok), tr.x + (TILE - ICON_SKILL) / 2, tr.y + 2, ICON_SKILL);
        text(f, String(def.cost), tr.x + 3, tr.y + TILE - 11, {
          size: 8,
          colour: (p.mana ?? 0) >= def.cost ? UI.arcane : ok ? UI.danger : UI.textDim,
        });
        const rank = abilityRank(id);
        if (rank > 0) text(f, "•".repeat(rank), tr.x + TILE - 4, tr.y + 3, { size: 8, colour: UI.gold, align: "right" });
        // Cooldown sweep: a dark curtain falling as the ability comes back.
        const cd = state.abilityCd[id] ?? 0;
        if (cd > 0) {
          const frac = Math.max(0, Math.min(1, cd / (def.cooldown || 1)));
          f.g.fillStyle = "rgba(11,13,18,0.72)";
          f.g.fillRect(tr.x, tr.y, tr.w, Math.round(tr.h * frac));
        }
      }
      x += skills.w + GAP;

      // ── WEAPON + AMMO ──
      // The weapon's NAME is the cell's caption, where every other cell has a
      // fixed word. That is 52 units cheaper than a label column beside the
      // icon — enough on its own to bring the bar under the design box — and it
      // is strictly more informative, because "WEAPON" was a caption nobody
      // needed twice while the icon sat next to it.
      const wpn = rect(x, y, W.wpn, h);
      const w = state.weaponSlots[state.activeSlot];
      cell(f, wpn, w && WEAPONS[w.id] ? WEAPONS[w.id].label.toUpperCase() : "WEAPON");
      if (w && WEAPONS[w.id]) {
        drawIcon(f.g, itemIcon(w.id), wpn.x + 3, wpn.y + 3, ITEM_ICON);
        const dur = Number.isFinite(w.durability) ? `${w.durability}` : "∞";
        text(f, dur, wpn.x + ITEM_ICON + 6, wpn.y + 10, { size: 8, colour: UI.textDim });
      }
      x += wpn.w + GAP;


      // ── LIFE · FACE · MANA ──
      const maxHp = playerMaxHp();
      setFaceHealth(p.hp, maxHp);
      const life = rect(x, y, W.globe, h);
      globe(f, life, p.hp / Math.max(1, maxHp), UI.danger, p.hp, time);
      x += life.w + 4;

      // The portrait is bottom-aligned to the other cells and therefore rises
      // ABOVE the panel — see `FACE_BOX`. Its own backdrop is drawn first so the
      // part that overhangs is not a floating head on the level.
      const faceBox = rect(x, y + h - FACE_BOX, FACE_BOX, FACE_BOX);
      fillRect(f, faceBox, UI.well);
      renderFace(1 / 60);
      blitFace(f, face, faceBox);
      strokeRect(f, faceBox, UI.sheetEdge, 2);
      x += faceBox.w + 4;

      const mana = rect(x, y, W.globe, h);
      globe(f, mana, (p.mana ?? 0) / 100, UI.arcane, p.mana ?? 0, time);
      x += mana.w + GAP;

      // ── SCORE / DEPTH / KILLS / RAMPAGE ──
      const stats = rect(x, y, W.stats, h);
      cell(f, stats);
      const statRow = (label: string, value: string, row: number, colour: string): void => {
        text(f, label, stats.x + 5, stats.y + 4 + row * 13, { size: 8, colour: UI.textDim });
        text(f, value, stats.x + stats.w - 5, stats.y + 4 + row * 13, { size: 8, colour, align: "right" });
      };
      statRow("DEPTH", String(state.level), 0, UI.gold);
      statRow("KILLS", String(state.kills), 1, UI.good);
      // `ultCharge` is the ultimate meter, 0..1 — the same value `canRampage()`
      // gates on, so the number the player reads is the number the game checks.
      statRow("RAGE", `${Math.round(state.ultCharge * 100)}%`, 2, canRampage() ? UI.gold : UI.danger);
      x += stats.w + GAP;

      // ── BELT ──
      const belt = rect(x, y, W.belt, h);
      cell(f, belt, "BELT · 1-4");
      for (let i = 0; i < 4; i++) {
        const slot = state.belt[i];
        const tr = rect(belt.x + 3 + i * (TILE + 3), belt.y + 3, TILE, TILE);
        fillRect(f, tr, UI.sheet);
        strokeRect(f, tr, UI.wellEdge);
        text(f, String(i + 1), tr.x + 2, tr.y + 2, { size: 8, colour: UI.textFaint });
        if (!slot) continue;
        drawIcon(f.g, itemIcon(slot.id), tr.x + (TILE - ITEM_ICON) / 2, tr.y + (TILE - ITEM_ICON) / 2, ITEM_ICON);
        if (slot.count > 1) {
          text(f, String(slot.count), tr.x + TILE - 3, tr.y + TILE - 11, { size: 8, colour: UI.text, align: "right" });
        }
      }
      x += belt.w + GAP;

      // ── MINIMAP ──
      // Through `drawIcon`, not a raw `drawImage` fitted to the cell: the
      // backing store is 116px and the cell is 60, and 116/60 is the fractional
      // resample this file's own `blitFace` note is about. `drawIcon` takes the
      // exact 2:1 (58px) and centres the result.
      const map = rect(x, y, W.map, h);
      cell(f, map);
      renderMinimap();
      drawIcon(f.g, minimap, map.x, map.y, map.w);
      text(f, "M", map.x + map.w - 4, map.y + 2, { size: 8, colour: UI.textFaint, align: "right" });

      // ── BOSS BAR — only while a boss is actually engaged ──
      // `bossEngaged()` rather than "a boss exists": the bar appearing before
      // the fight starts spoils the reveal the antechamber is built around.
      const boss = bossEngaged() ? state.zombies.find((z) => z.boss) : undefined;
      if (boss && boss.maxHp) {
        const bb = rect(f.w / 2 - 200, 16, 400, 14);
        bar(f, bb, boss.hp / boss.maxHp, UI.danger);
        // The NAME, not "BOSS". With one boss the generic word was honest;
        // with a guardian per biome the bar was the only surface that never
        // told you which one you had walked into.
        text(f, bossLabel() ?? "BOSS", bb.x + bb.w / 2, bb.y + 3, { size: 8, colour: UI.text, align: "center" });
      }

      // ── COMBO — transient, above the panel ──
      if (p.bounceCombo > 1) {
        text(f, `x${p.bounceCombo} COMBO`, GRID * 2, panel.y - 20, { size: 8, colour: UI.gold });
      }

      // ── PLUNGER — only while parked to launch ──
      if (state.plungerArmed || state.plungerCharging) {
        const pm = rect(f.w / 2 - 150, panel.y - 22, 300, 10);
        bar(f, pm, state.plungerPower, UI.gold);
      }
    },
  };
}


/**
 * The rampage bar + crosshair — the combat layer.
 *
 * Wide, flat, and centred on the three numbers that matter while you are
 * shooting: health, the streak, and how long is left. The iso panel's belt,
 * minimap and skill slots are all deliberately absent — none of them are usable
 * in first person, and drawing them would be the HUD showing controls the
 * player cannot press.
 */
function paintWolf(f: UiFrame, p: NonNullable<typeof state.player>): void {
  const h = 64;
  const panel = rect(0, f.h - h, f.w, h);
  fillRect(f, panel, UI.sheet);
  fillRect(f, rect(panel.x, panel.y, panel.w, 1), UI.sheetEdgeLit);

  const maxHp = playerMaxHp();
  setFaceHealth(p.hp, maxHp);

  const cx = f.w / 2;
  const span = Math.min(220, Math.floor(f.w * 0.38));
  const innerSpan = Math.min(80, Math.floor(span * 0.36));
  const big = (label: string, value: string, x: number, colour: string): void => {
    text(f, value, x, panel.y + 14, { size: 16, colour, align: "center" });
    text(f, label, x, panel.y + 40, { size: 8, colour: UI.textDim, align: "center" });
  };
  big("HEALTH", String(p.hp), cx - span, UI.danger);
  big("STREAK", String(state.fpsStreak), cx - innerSpan, UI.gold);
  big("TIME", `${Math.max(0, Math.ceil(state.fpsTimer))}`, cx + innerSpan, UI.arcane);
  big("KILLS", String(state.kills), cx + span, UI.good);

  // The crosshair. Four ticks around a gap, so it never occludes what it aims
  // at — a solid dot at this scale covers an entire distant enemy.
  const yMid = (f.h - h) / 2;
  f.g.fillStyle = UI.focus;
  for (const [dx, dy, w, hh] of [
    [-9, -1, 6, 2],
    [3, -1, 6, 2],
    [-1, -9, 2, 6],
    [-1, 3, 2, 6],
  ]) {
    f.g.fillRect(Math.round(cx + dx), Math.round(yMid + dy), w, hh);
  }
}
