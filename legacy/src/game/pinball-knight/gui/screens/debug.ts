/**
 * THE ` DEBUG PANEL, in the game.
 *
 * Session-only god-mode tooling. It is the ONE screen where DOM was arguably
 * the better host — it never ships to a player, and an element tree is cheaper
 * to extend than a painted list. It is ported anyway because the goal was zero
 * DOM, and because a debug panel that renders through a DIFFERENT path from the
 * game it debugs is a debug panel that can lie: the DOM version sat outside the
 * pixel pass, so it could not be used to judge anything about the pass.
 *
 * ── IT IS A LEFT DOCK, NOT A CENTRED SHEET ──
 * The first port was a 760x600 sheet in the middle of the screen, which is the
 * wrong shape for what this thing is for. Every button here changes the WORLD —
 * spawn a horde, jump a floor, hand yourself a flamer — and the whole point is
 * to watch what that does. A centred sheet covers the knight, the horde and the
 * arena, so the loop becomes press, close, look, reopen, press. Docked to one
 * edge the arena stays visible and the console is a control surface rather than
 * a modal interruption.
 *
 * ── EVERY ROW CARRIES ITS MARK ──
 * Weapons and materials use the GAME'S OWN sprite for the thing they hand you,
 * and monsters use the creature's own cel (`monsterIcon`). That is not
 * decoration: a spawn list of thirty ALL-CAPS names is thirty identical chips,
 * and "which one is the Croaker" gets answered by reading rather than looking.
 * With the art on the row the roster is scannable — and because these are the
 * same painters the horde is drawn from, the panel doubles as the art-QA
 * contact sheet it was already being used as.
 *
 * ── THE ROSTER IS DERIVED, NOT WRITTEN ──
 * Carried over intact from `debug-panel.ts`, including why: the spawn list used
 * to be hand-written and drifted twice — `reaper` was never in it, and
 * `sporeling` was missing on the day it shipped. A debug panel that cannot
 * spawn the newest monster is worse than no panel, because the one kind you
 * most need to look at is the one it hides. So the roster comes from
 * `bestiary.ts`'s `KIND_IDS`, which is compile-enforced exhaustive over
 * `EnemyKind`, and a new kind appears here automatically.
 */
import { KIND_IDS, KIND_INFO } from "../../bestiary";
import type { EnemyKind } from "../../state";
import type { DebugActions } from "../../debug-panel";
import { UI, GRID, ROW_H } from "../theme";
import {
  beginScroll,
  button,
  cutTop,
  endScroll,
  fillRect,
  rect,
  strokeRect,
  text,
  type Rect,
  type UiFrame,
} from "../im";
import { glyph, itemIcon, monsterIcon, type GlyphId } from "../icons";
import { pop, type UiScreen } from "../stack";

/**
 * The box this screen is authored for — see `UiScreen.design`.
 *
 * 560x360 buys 2x on a 1600x900 grid and 3x on a 4K one. The dock is a fixed
 * 232 of that width; the rest is deliberately EMPTY, because it is the arena
 * this panel exists to let you watch, and reserving it in the design box is
 * what stops a future row from creeping across the screen.
 */
export const DESIGN = { w: 560, h: 360 };

/** How wide the dock is, in UI pixels. */
const DOCK_W = 232;
/**
 * One row of the console.
 *
 * 26 rather than 22 because of `exactIconSize`: sprites are 72px native, so the
 * icon sizes that divide exactly are 24, 18, 12, 9… A 22px row leaves 16px of
 * icon box, which snaps DOWN to 12 — and a weapon sprite at 12px is a smudge
 * with a few lit pixels in it, which is exactly the "the icons are just dots"
 * complaint this pass exists to fix. 26 leaves 20, which snaps to 18.
 */
const ROW = 26;
const GAP = 3;
/** Explicit rather than derived, so the divisor above is stated where it is chosen. */
const ROW_ICON = 18;

/** Chip names that deliberately differ from the bestiary label — space is tight. */
const LABEL_OVERRIDE: Partial<Record<EnemyKind, string>> = {
  magnet: "Crawler",
  webspinner: "Spinner",
  necromancer: "Necro",
  crystalback: "Crystal",
  pin: "Pin",
};

const MATERIALS = ["diamond", "water", "stone", "storm", "shadow", "lava"];
const WEAPONS_DBG = ["sword", "axe", "bow", "gun", "flamer", "katana"];
const FLOOR_JUMPS = [1, 3, 5, 10, 15, 20];
const SPAWN_COUNTS = [1, 3, 5, 8];

/** A knight/floor action: label, mark, and what it does. */
interface Act {
  label: string;
  icon: GlyphId;
  colour?: string;
  run(a: DebugActions): void;
}

const KNIGHT_ACTS: Act[] = [
  { label: "HEAL", icon: "heart", colour: UI.good, run: (a) => a.heal() },
  { label: "+500 GOLD", icon: "coin", run: (a) => a.addGold(500) },
  { label: "+1000 XP", icon: "spark", run: (a) => a.grantXp(1000) },
  { label: "+5 SKILL", icon: "plus", run: (a) => a.grantSkillPoints(5) },
  { label: "FILL RAGE", icon: "flame", run: (a) => a.fillRampage() },
  { label: "KILL ALL", icon: "burst", colour: UI.danger, run: (a) => a.killAll() },
  { label: "CLEAR ROOM", icon: "erase", run: (a) => a.clearEnemies() },
  { label: "TO STAIRS", icon: "stairs", run: (a) => a.teleportStairs() },
];

const FLOOR_ACTS: Act[] = [
  { label: "NEXT FLOOR", icon: "descend", run: (a) => a.nextFloor() },
  { label: "BOSS FLOOR", icon: "crown", run: (a) => a.nextBoss() },
  { label: "REAPER", icon: "scythe", colour: UI.danger, run: (a) => a.spawnReaper() },
  { label: "MONSTER RING", icon: "circle", run: (a) => a.spawnRing() },
];

/** Section rule + caption, cut off the top of the running body rect. */
function section(f: UiFrame, body: Rect, label: string): void {
  const r = cutTop(body, ROW_H);
  fillRect(f, rect(r.x, r.y + 2, r.w, 1), UI.sheetEdge);
  text(f, label, r.x, r.y + 10, { size: 8, colour: UI.heading });
}

export function debugScreen(actions: DebugActions): UiScreen {
  let spawnCount = 1;

  return {
    id: "debug",
    pauses: true,
    focus: 0,
    scroll: 0,
    design: DESIGN,
    paint(f: UiFrame, self) {
      // ── The dock ──
      const dock = rect(0, 0, DOCK_W, f.h);
      fillRect(f, dock, UI.sheet);
      // One lit edge down the RIGHT side only: the panel is flush against the
      // window's left edge, so a full frame would draw a border where there is
      // no gap for it to separate anything from.
      fillRect(f, rect(dock.x + dock.w - 1, 0, 1, f.h), UI.sheetEdgeLit);

      const head = rect(GRID, GRID, DOCK_W - GRID * 2, 24);
      text(f, "DEBUG", head.x, head.y, { size: 16, colour: UI.danger });
      text(f, "` CLOSES", head.x + head.w, head.y + 4, { size: 8, colour: UI.textFaint, align: "right" });

      const foot = rect(GRID, f.h - ROW_H - GRID, DOCK_W - GRID * 2, ROW_H);
      const viewTop = head.y + head.h + 4;
      const view = rect(0, viewTop, DOCK_W - 2, foot.y - viewTop - GRID);

      // Content height, DERIVED from what is actually laid out below. A
      // hand-tuned constant is a scrollbar that lies the moment a row is added,
      // and the previous version's 900 was already short of its own list — the
      // bottom two monster rows could not be reached at all.
      const actRows = KNIGHT_ACTS.length + FLOOR_ACTS.length;
      const gridRows =
        Math.ceil(FLOOR_JUMPS.length / 3) +
        Math.ceil(WEAPONS_DBG.length / 2) +
        Math.ceil(MATERIALS.length / 2) +
        Math.ceil(KIND_IDS.length / 2) +
        1; // the spawn-count row
      const contentH = 6 * ROW_H + (actRows + gridRows) * (ROW + GAP) + GRID * 5;

      const sc = beginScroll(f, view, contentH, self.scroll);
      const body: Rect = { x: sc.inner.x + GRID, y: sc.inner.y, w: DOCK_W - GRID * 2 - 4, h: sc.inner.h };

      /** One full-width action row. */
      const act = (a: Act): void => {
        const r = cutTop(body, ROW + GAP);
        if (button(f, rect(r.x, r.y, r.w, ROW), a.label, { icon: glyph(a.icon, ROW_ICON, a.colour ?? UI.gold), iconSize: ROW_ICON })) {
          a.run(actions);
        }
      };

      /** A grid of icon chips, `cols` across. */
      const chips = (
        items: readonly string[],
        cols: number,
        iconOf: (id: string) => HTMLCanvasElement | null,
        nameOf: (id: string) => string,
        run: (id: string) => void,
      ): void => {
        const lines = Math.ceil(items.length / cols);
        const cw = Math.floor((body.w + GAP) / cols);
        for (let line = 0; line < lines; line++) {
          const r = cutTop(body, ROW + GAP);
          for (let c = 0; c < cols; c++) {
            const i = line * cols + c;
            if (i >= items.length) continue;
            const id = items[i];
            if (button(f, rect(r.x + c * cw, r.y, cw - GAP, ROW), nameOf(id), { icon: iconOf(id), iconSize: ROW_ICON })) run(id);
          }
        }
      };

      section(f, body, "KNIGHT");
      for (const a of KNIGHT_ACTS) act(a);
      cutTop(body, GRID);

      section(f, body, "FLOOR");
      for (const a of FLOOR_ACTS) act(a);
      chips(
        FLOOR_JUMPS.map(String),
        3,
        () => glyph("layers", ROW_ICON, UI.textDim),
        (n) => `F${n}`,
        (n) => actions.gotoFloor(Number(n)),
      );
      cutTop(body, GRID);

      section(f, body, "WEAPONS");
      chips(
        WEAPONS_DBG,
        2,
        itemIcon,
        (id) => id.toUpperCase(),
        (id) => actions.giveWeapon(id),
      );
      cutTop(body, GRID);

      section(f, body, "MATERIALS");
      chips(
        MATERIALS,
        2,
        itemIcon,
        (id) => id.toUpperCase(),
        (id) => actions.applyMaterial(id),
      );
      cutTop(body, GRID);

      section(f, body, `SPAWN — x${spawnCount}`);
      {
        const r = cutTop(body, ROW + GAP);
        const cw = Math.floor((body.w + GAP) / SPAWN_COUNTS.length);
        for (const [i, n] of SPAWN_COUNTS.entries()) {
          if (button(f, rect(r.x + i * cw, r.y, cw - GAP, ROW), `x${n}`, { good: spawnCount === n })) spawnCount = n;
        }
      }

      section(f, body, "MONSTERS");
      chips(
        KIND_IDS as readonly string[],
        2,
        (id) => monsterIcon(id as EnemyKind),
        // Bestiary label, with the narrow-dock override where one exists —
        // "Crawler" fits where "Magnet Crawler" does not.
        (id) => (LABEL_OVERRIDE[id as EnemyKind] ?? KIND_INFO[id as EnemyKind]?.label ?? id).toUpperCase(),
        (id) => actions.spawnEnemy(id, spawnCount),
      );

      endScroll(f, view, contentH, sc.offset);
      self.scroll = sc.offset;

      // ── The foot, outside the scroll region so it never scrolls away ──
      fillRect(f, rect(0, foot.y - GRID / 2, DOCK_W - 1, 1), UI.sheetEdge);
      if (button(f, rect(foot.x, foot.y, foot.w, ROW_H), "CLOSE", { danger: true })) pop();
      strokeRect(f, rect(0, 0, DOCK_W, f.h), UI.sheetEdge, 1);

      self.focus = f.focus;
    },
  };
}
