/**
 * THE FLOOR HAUL — every card the floor gave you, read at the end of it.
 *
 * Ports `card-reader.ts`'s haul screen. The two decisions worth carrying over
 * are both in that file's comments and both survive intact:
 *
 *   · Rows are STACKS, not cards. Sizing off the number of distinct cards
 *     rather than the number of copies is what buys a big-haul floor readable
 *     faces instead of 92px thumbnails whose stat lines nobody can read.
 *   · It is skippable and OPTIONAL — `settings.haulReveal` turns it off, and
 *     nothing interrupts the fight either way.
 *
 * `stackHaul()` does the folding and stays exactly where it was; this only
 * paints the result.
 */
import { stackHaul, type HaulEntry } from "../../card-reader";
import { isShinyCard } from "../../cards";
import { UI, GRID, ROW_H } from "../theme";
import { beginScroll, button, cutTop, endScroll, focusRing, focusable, rect, scrim, sheet, strokeRect, text } from "../im";
import { cardFaceAt, CARD_W, CARD_H } from "../card-face";
import { pop, type UiScreen } from "../stack";

// 140, not 88. This screen exists to be READ — the whole point of it is the
// disposition note under each card and the card's own title and stat lines —
// and at 88 the 512px face was downscaled 5.8x, which left the type as texture.
// Five of these plus their gutters is 740 of the 748 available, and the screen
// had an empty lower half to spend.
const FACE_W = 140;
const FACE_H = Math.round((CARD_H / CARD_W) * FACE_W);

export function haulScreen(entries: readonly HaulEntry[], floor: number, onDone: () => void): UiScreen {
  const stacks = stackHaul(entries);
  const total = stacks.reduce((n, s) => n + s.count, 0);
  const newCount = stacks.filter((s) => s.fresh).length;
  const shinyCount = stacks.filter((s) => isShinyCard(s.id)).reduce((n, s) => n + s.count, 0);

  return {
    id: "haul",
    pauses: true,
    focus: 0,
    scroll: 0,
    // See `UiScreen.design`. 800x450 is the design floor every sheet in this
    // game now targets, so on a desktop grid they all come out at 2x and at the
    // SAME zoom as each other — a menu at 1x beside a HUD at 2x reads as two
    // different games stapled together.
    design: { w: 800, h: 450 },
    onClose: onDone,
    paint(f, self) {
      scrim(f);
      const body = sheet(f, 780, 424);

      const head = cutTop(body, 30);
      text(f, `FLOOR ${floor} HAUL`, head.x + head.w / 2, head.y, { size: 16, colour: UI.gold, align: "center" });

      const sub = cutTop(body, 20);
      const parts = [`${total} CARD${total === 1 ? "" : "S"}`];
      if (stacks.length !== total) parts.push(`${stacks.length} KIND${stacks.length === 1 ? "" : "S"}`);
      if (newCount) parts.push(`${newCount} NEW`);
      if (shinyCount) parts.push(`${shinyCount} SHINY`);
      text(f, parts.join(" · "), sub.x + sub.w / 2, sub.y + 4, { size: 8, colour: UI.textDim, align: "center" });

      const foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
      const view = rect(body.x, body.y, body.w, body.h - ROW_H - GRID);

      const perRow = Math.max(1, Math.floor(view.w / (FACE_W + GRID)));
      const rows = Math.ceil(stacks.length / perRow);
      const contentH = rows * (FACE_H + 34) + GRID;
      const sc = beginScroll(f, view, contentH, self.scroll);

      for (const [i, s] of stacks.entries()) {
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        const cell = rect(sc.inner.x + col * (FACE_W + GRID), sc.inner.y + row * (FACE_H + 34), FACE_W, FACE_H);
        const st = focusable(f, cell);
        const face = cardFaceAt(s.id, cell.w);
        if (face) f.g.drawImage(face, cell.x, cell.y, cell.w, cell.h);
        // A fresh card and a shiny both deserve a frame, and a shiny that is
        // also fresh should read as the rarer of the two — so shiny wins.
        if (isShinyCard(s.id)) strokeRect(f, cell, UI.heading, 2);
        else if (s.fresh) strokeRect(f, cell, UI.good, 2);
        if (st.focused) focusRing(f, cell);

        if (s.count > 1) {
          text(f, `x${s.count}`, cell.x + cell.w - 3, cell.y + 3, { size: 8, colour: UI.heading, align: "right" });
        }
        // The disposition note ("SOCKETED INTO SWORD", "STASHED") is the whole
        // reason the screen is not just a trophy wall — it says where each card
        // actually went.
        text(f, s.notes[0] ?? "", cell.x, cell.y + cell.h + 4, { size: 8, colour: UI.textDim, max: FACE_W });
        if (s.notes.length > 1) {
          text(f, s.notes[1], cell.x, cell.y + cell.h + 15, { size: 8, colour: UI.textFaint, max: FACE_W });
        }
      }
      endScroll(f, view, contentH, sc.offset);
      self.scroll = sc.offset;

      text(f, "SPACE / ENTER / ESC — CONTINUE", foot.x, foot.y + 8, { size: 8, colour: UI.textFaint });
      if (button(f, rect(foot.x + foot.w - 120, foot.y, 120, ROW_H), "CONTINUE")) pop();
      // Any accept anywhere continues, matching the DOM version where a click
      // ANYWHERE on the scrim advanced the reader.
      if (f.input.accept && !f.consumed) pop();
      self.focus = f.focus;
    },
  };
}
