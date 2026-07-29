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
import { beginScroll, button, cutTop, endScroll, heading, rect, sheet, text, type Rect, type UiFrame } from "../im";
import { pop, type UiScreen } from "../stack";

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

export function debugScreen(actions: DebugActions): UiScreen {
  let spawnCount = 1;

  return {
    id: "debug",
    pauses: true,
    focus: 0,
    scroll: 0,
    paint(f: UiFrame, self) {
      const outer = sheet(f, 760, 600);
      const head = cutTop(outer, 30);
      text(f, "DEBUG", head.x, head.y, { size: 16, colour: UI.danger });
      text(f, "` closes · session only", head.x + head.w, head.y + 8, {
        size: 8,
        colour: UI.textFaint,
        align: "right",
      });

      const foot = rect(outer.x, outer.y + outer.h - ROW_H, outer.w, ROW_H);
      const view = rect(outer.x, outer.y, outer.w, outer.h - ROW_H - GRID);
      const contentH = 900;
      const sc = beginScroll(f, view, contentH, self.scroll);
      const body: Rect = { ...sc.inner };

      const chips = (
        label: string,
        items: readonly string[],
        run: (id: string) => void,
        cols = 4,
        nameOf: (id: string) => string = (id) => id.toUpperCase(),
      ): void => {
        heading(f, cutTop(body, ROW_H), label);
        const rows = Math.ceil(items.length / cols);
        for (let r = 0; r < rows; r++) {
          const line = cutTop(body, 26);
          const cw = Math.floor(line.w / cols);
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            if (i >= items.length) {
              continue;
            }
            if (button(f, rect(line.x + c * cw, line.y, cw - 4, 22), nameOf(items[i]))) run(items[i]);
          }
        }
        cutTop(body, GRID);
      };

      heading(f, cutTop(body, ROW_H), "KNIGHT");
      const row1 = cutTop(body, 26);
      const bw = Math.floor(row1.w / 4) - 4;
      if (button(f, rect(row1.x, row1.y, bw, 22), "HEAL")) actions.heal();
      if (button(f, rect(row1.x + bw + 4, row1.y, bw, 22), "+500g")) actions.addGold(500);
      if (button(f, rect(row1.x + (bw + 4) * 2, row1.y, bw, 22), "+1000 XP")) actions.grantXp(1000);
      if (button(f, rect(row1.x + (bw + 4) * 3, row1.y, bw, 22), "+5 PTS")) actions.grantSkillPoints(5);
      const row2 = cutTop(body, 26);
      if (button(f, rect(row2.x, row2.y, bw, 22), "FILL RAGE")) actions.fillRampage();
      if (button(f, rect(row2.x + bw + 4, row2.y, bw, 22), "KILL ALL")) actions.killAll();
      if (button(f, rect(row2.x + (bw + 4) * 2, row2.y, bw, 22), "CLEAR")) actions.clearEnemies();
      if (button(f, rect(row2.x + (bw + 4) * 3, row2.y, bw, 22), "STAIRS")) actions.teleportStairs();
      cutTop(body, GRID);

      heading(f, cutTop(body, ROW_H), "FLOOR");
      const row3 = cutTop(body, 26);
      if (button(f, rect(row3.x, row3.y, bw, 22), "NEXT FLOOR")) actions.nextFloor();
      if (button(f, rect(row3.x + bw + 4, row3.y, bw, 22), "BOSS")) actions.nextBoss();
      if (button(f, rect(row3.x + (bw + 4) * 2, row3.y, bw, 22), "REAPER")) actions.spawnReaper();
      if (button(f, rect(row3.x + (bw + 4) * 3, row3.y, bw, 22), "RING")) actions.spawnRing();
      const row4 = cutTop(body, 26);
      for (let i = 0; i < 6; i++) {
        const n = [1, 3, 5, 10, 15, 20][i];
        if (button(f, rect(row4.x + i * 70, row4.y, 66, 22), `F${n}`)) actions.gotoFloor(n);
      }
      cutTop(body, GRID);

      chips("WEAPONS", WEAPONS_DBG, (id) => actions.giveWeapon(id));
      chips("MATERIALS", MATERIALS, (id) => actions.applyMaterial(id), 6);

      heading(f, cutTop(body, ROW_H), `SPAWN — x${spawnCount}`);
      const countRow = cutTop(body, 26);
      for (const [i, n] of [1, 3, 5, 8].entries()) {
        if (button(f, rect(countRow.x + i * 70, countRow.y, 66, 22), `x${n}`, { good: spawnCount === n })) {
          spawnCount = n;
        }
      }
      cutTop(body, 4);
      chips(
        "MONSTERS",
        KIND_IDS as readonly string[],
        (kind) => actions.spawnEnemy(kind, spawnCount),
        5,
        // Bestiary label, with the narrow-panel override where one exists —
        // "Crawler" fits where "Magnet Crawler" does not.
        (id) => (LABEL_OVERRIDE[id as EnemyKind] ?? KIND_INFO[id as EnemyKind]?.label ?? id).toUpperCase(),
      );

      endScroll(f, view, contentH, sc.offset);
      self.scroll = sc.offset;

      text(f, "` OR ESC — CLOSE", foot.x, foot.y + 8, { size: 8, colour: UI.textFaint });
      if (button(f, rect(foot.x + foot.w - 96, foot.y, 96, ROW_H), "CLOSE")) pop();
      self.focus = f.focus;
    },
  };
}
