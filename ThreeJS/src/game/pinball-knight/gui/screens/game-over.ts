/**
 * YOU ARE DEAD — the death screen, in the game.
 *
 * The DOM version's structure is kept because each block earns its place, and
 * its comments say why:
 *
 *   · BEST DEPTH is called out as a record explicitly, or sits there as the
 *     target to beat.
 *   · WHAT YOU DROPPED is stated HERE, because that is what makes the tavern's
 *     "return to floor N" legible a moment later — without it a player reads an
 *     empty inventory as a bug and the corpse-run mechanic as a loss.
 *   · The button says BACK TO THE TAVERN, not "retry": death sends you to the
 *     tavern, and "descend again" would read as a restart when it is the
 *     opposite of one.
 *
 * What the DOM version never had is the PORTRAIT. `YOU ARE DEAD` was two words
 * over a stat line, and the game already owns the picture those words describe:
 * the HUD mugshot at zero health, helm gone, x-ed out eyes. It is the same face
 * the player watched come apart over the whole run, so it closes that thread
 * instead of opening a new one. See `deadFace` in `hud-face.ts` for why it is a
 * copy of that canvas rather than the canvas.
 *
 * The one genuinely new problem is the BOARD NAME field. In DOM it was an
 * `<input>` with a `keydown` stopPropagation so that typing a name did not walk
 * the knight around behind the death screen. Here there is no input element, so
 * it is `textField()` — and the leak it was guarding against cannot happen at
 * all, because the UI owns the keyboard whenever a screen is open.
 */
import { state } from "../../state";
import { loadBestDepth } from "../../best-depth";
import { getPlayerName, setPlayerName, NAME_MAX } from "../../../../services/player-name";
import { deadFace, FACE_PX } from "../../hud-face";
import { UI, GRID, ROW_H } from "../theme";
import { button, cutTop, drawIcon, fillRect, rect, scrim, strokeRect, text, textField } from "../im";
import { loadUnlockedDepth } from "../../unlocked-depths";
import { depthSelectScreen } from "./depth-select";
import { push, pop, type UiScreen } from "../stack";

/**
 * The portrait's plate: the mugshot's own 72px grid plus the 4px margin the HUD
 * leaves around it, so the two read as the same object in the same frame.
 *
 * `drawIcon` will only blit at a whole multiple of the source, so 80 draws the
 * face at 1:1 and centres it — the margin is the leftover, not a scale.
 */
const PORTRAIT = FACE_PX + 8;

/**
 * Every row's height, named ONCE.
 *
 * The block is measured before it is painted (see `paint`), so each of these
 * numbers is spent twice — once summing the total, once cutting the row. Typed
 * out at both sites they drift, and the drift is silent: the screen measures
 * one height, paints another, and centres itself against a total it does not
 * have. One table, two readers.
 *
 * The paddings are TIGHT and that is deliberate. With the portrait in it the
 * block comes to 320 of the 338 the design box declares, and the driver may
 * hand this screen a frame exactly that tall — `game-over.test.ts` paints at
 * precisely that size and fails if anything lands past the bottom edge.
 */
const H = {
  title: 88, // two 32px lines, the second at +44 — ends at 76
  portrait: PORTRAIT + GRID,
  stats: 28,
  best: 22,
  drop: 28, // two 8px lines, the second at +14 — ends at 22
  name: 30, // a 22px field with its caption under it — ends at 30
  gap: GRID,
  buttons: ROW_H + 4,
} as const;

export function gameOverScreen(opts: {
  /** Back to the hub with an empty pack — the kit is on the floor above. */
  onTavern: () => void;
  /** Straight back down to the floor you died on, or a chosen unlocked floor. */
  onRetry: (floor?: number) => void;
  onExit: () => void;
  droppedCount?: number;
}): UiScreen {
  let name = getPlayerName();

  return {
    id: "game-over",
    pauses: true,
    focus: 0,
    scroll: 0,
    // See `UiScreen.design`. The sheet is 560 wide and this is the one screen a
    // player reads while not doing anything else, so it takes the zoom: on a
    // desktop grid the run summary and the three buttons come out at 2x.
    //
    // ⚠️ THE HEIGHT IS NEARLY SPENT. With the portrait and the drop notice both
    // showing, `contentH` comes to 320 of these 338, and the block's top margin
    // eats the rest — so a new row does not just make the sheet taller, it
    // overflows the box this screen declares, and the driver's zoom is chosen
    // from the DECLARATION. Raising the number is the honest fix and it is not
    // free: 338 is what puts the 2x step at a 676-tall grid, and every notch up
    // moves that threshold, dropping short windows to 1x where the whole screen
    // halves. Trim padding first. `game-over.test.ts` fails either way.
    design: { w: 600, h: 338, max: 2 },
    // Death is not dismissable. Esc must not drop you back into a dungeon you
    // are dead in — the buttons are the only ways out.
    onCancel: () => true,
    paint(f, self) {
      scrim(f);
      const w = Math.min(560, f.w - GRID * 4);

      // The block is MEASURED and then centred, rather than top-aligned inside a
      // fixed 380 box as it was when the rows were a known quantity. Two of them
      // are now conditional — the drop notice, and the portrait on any host
      // without a canvas — and a fixed box either strands the block high or
      // pushes the buttons off the bottom of the design box depending on which
      // way the total moved that run.
      const face = deadFace();
      const faceH = face ? H.portrait : 0;
      const dropH = opts.droppedCount ? H.drop : 0;
      const contentH = H.title + faceH + H.stats + H.best + dropH + H.name + H.gap + H.buttons;
      // Floored, not left fractional: every row below is cut from this origin,
      // so half a pixel here is half a pixel under the portrait's 1:1 blit.
      const col = rect((f.w - w) / 2, Math.max(GRID * 2, Math.floor((f.h - contentH) / 2)), w, contentH);

      const title = cutTop(col, H.title);
      text(f, "YOU ARE", title.x + title.w / 2, title.y, { size: 32, colour: UI.danger, align: "center" });
      text(f, "DEAD", title.x + title.w / 2, title.y + 44, { size: 32, colour: UI.danger, align: "center" });

      // …and here he is. The same plate the HUD frames him in — sunken fill, a
      // 2px edge — so the portrait reads as the status bar's mugshot brought up
      // to full size, which is what it literally is.
      if (face) {
        const row = cutTop(col, faceH);
        const box = rect(Math.round(row.x + (row.w - PORTRAIT) / 2), row.y, PORTRAIT, PORTRAIT);
        fillRect(f, box, UI.well);
        drawIcon(f.g, face, box.x, box.y, PORTRAIT);
        strokeRect(f, box, UI.sheetEdge, 2);
      }

      const line = cutTop(col, H.stats);
      text(f, `DEPTH ${state.level}   KILLS ${state.kills}   GOLD ${state.goldRun}`, line.x + line.w / 2, line.y + 8, {
        size: 8,
        colour: UI.text,
        align: "center",
      });

      const best = loadBestDepth();
      const isRecord = state.level >= best && state.level > 1;
      const bestRow = cutTop(col, H.best);
      text(
        f,
        isRecord ? `* DEEPEST YET — FLOOR ${best}` : `BEST DEPTH · FLOOR ${best}`,
        bestRow.x + bestRow.w / 2,
        bestRow.y + 4,
        { size: 8, colour: isRecord ? UI.heading : UI.textDim, align: "center" },
      );

      if (opts.droppedCount) {
        const drop = cutTop(col, H.drop);
        text(
          f,
          `${opts.droppedCount} ITEM${opts.droppedCount === 1 ? "" : "S"} DROPPED ON FLOOR ${state.level}`,
          drop.x + drop.w / 2,
          drop.y,
          { size: 8, colour: UI.good, align: "center" },
        );
        text(f, "GO BACK FOR THEM — THEY KEEP", drop.x + drop.w / 2, drop.y + 14, {
          size: 8,
          colour: UI.textDim,
          align: "center",
        });
      }

      // The run has ALREADY been posted under the stored name by the time this
      // shows, so an edit here applies to future runs. Say so rather than imply
      // the score just submitted gets renamed.
      const nameRow = cutTop(col, H.name);
      text(f, "BOARD NAME", nameRow.x + nameRow.w / 2 - 150, nameRow.y + 8, { size: 8, colour: UI.textDim });
      const typed = textField(f, rect(nameRow.x + nameRow.w / 2 - 40, nameRow.y, 190, 22), name, {
        max: NAME_MAX,
        upper: true,
      });
      if (typed !== name) {
        name = typed;
        // Persist on every keystroke. The DOM version saved on `change`, which
        // needed a blur — and nothing here can blur.
        setPlayerName(name);
      }
      text(f, "applies to future runs", nameRow.x + nameRow.w / 2 - 150, nameRow.y + 22, {
        size: 8,
        colour: UI.textFaint,
      });

      cutTop(col, H.gap);
      const buttons = cutTop(col, H.buttons);
      const unlocked = loadUnlockedDepth();
      const hasMultiple = unlocked > 1;

      if (hasMultiple) {
        // Four buttons: TAVERN, DEPTHS, RETRY, EXIT
        const bw = Math.floor((buttons.w - 24) / 4);
        if (button(f, rect(buttons.x, buttons.y, bw, ROW_H), "TAVERN", { good: true })) {
          pop();
          opts.onTavern();
          return;
        }
        if (button(f, rect(buttons.x + bw + 8, buttons.y, bw, ROW_H), "DEPTHS")) {
          push(
            depthSelectScreen({
              onSelect: (floor) => {
                pop(); // close game-over screen
                opts.onRetry(floor);
              },
            }),
          );
          return;
        }
        if (button(f, rect(buttons.x + (bw + 8) * 2, buttons.y, bw, ROW_H), "RETRY")) {
          pop();
          opts.onRetry();
          return;
        }
        if (button(f, rect(buttons.x + (bw + 8) * 3, buttons.y, bw, ROW_H), "EXIT", { danger: true })) {
          pop();
          opts.onExit();
          return;
        }
      } else {
        // Three buttons: TAVERN, RETRY MAZE, EXIT GAME
        const bw = Math.floor((buttons.w - 16) / 3);
        if (button(f, rect(buttons.x, buttons.y, bw, ROW_H), "TAVERN", { good: true })) {
          pop();
          opts.onTavern();
          return;
        }
        if (button(f, rect(buttons.x + bw + 8, buttons.y, bw, ROW_H), "RETRY MAZE")) {
          pop();
          opts.onRetry();
          return;
        }
        if (button(f, rect(buttons.x + (bw + 8) * 2, buttons.y, bw, ROW_H), "EXIT GAME", { danger: true })) {
          pop();
          opts.onExit();
          return;
        }
      }
      self.focus = f.focus;
    },
  };
}
