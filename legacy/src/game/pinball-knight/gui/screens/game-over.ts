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
 * The one genuinely new problem is the BOARD NAME field. In DOM it was an
 * `<input>` with a `keydown` stopPropagation so that typing a name did not walk
 * the knight around behind the death screen. Here there is no input element, so
 * it is `textField()` — and the leak it was guarding against cannot happen at
 * all, because the UI owns the keyboard whenever a screen is open.
 */
import { state } from "../../state";
import { loadBestDepth } from "../../best-depth";
import { getPlayerName, setPlayerName, NAME_MAX } from "../../../../services/player-name";
import { UI, GRID, ROW_H } from "../theme";
import { button, cutTop, rect, scrim, text, textField } from "../im";
import { pop, type UiScreen } from "../stack";

export function gameOverScreen(opts: {
  /** Back to the hub with an empty pack — the kit is on the floor above. */
  onTavern: () => void;
  /** Straight back down to the floor you died on, where your pile is. */
  onRetry: () => void;
  onExit: () => void;
  droppedCount?: number;
}): UiScreen {
  let name = getPlayerName();

  return {
    id: "game-over",
    pauses: true,
    focus: 0,
    scroll: 0,
    // Death is not dismissable. Esc must not drop you back into a dungeon you
    // are dead in — the three buttons are the only ways out.
    onCancel: () => true,
    paint(f, self) {
      scrim(f);
      const w = Math.min(560, f.w - GRID * 4);
      const col = rect((f.w - w) / 2, Math.max(GRID * 2, f.h / 2 - 190), w, 380);

      const title = cutTop(col, 96);
      text(f, "YOU ARE", title.x + title.w / 2, title.y, { size: 32, colour: UI.danger, align: "center" });
      text(f, "DEAD", title.x + title.w / 2, title.y + 44, { size: 32, colour: UI.danger, align: "center" });

      const line = cutTop(col, 28);
      text(f, `DEPTH ${state.level}   KILLS ${state.kills}   GOLD ${state.goldRun}`, line.x + line.w / 2, line.y + 8, {
        size: 8,
        colour: UI.text,
        align: "center",
      });

      const best = loadBestDepth();
      const isRecord = state.level >= best && state.level > 1;
      const bestRow = cutTop(col, 22);
      text(
        f,
        isRecord ? `* DEEPEST YET — FLOOR ${best}` : `BEST DEPTH · FLOOR ${best}`,
        bestRow.x + bestRow.w / 2,
        bestRow.y + 4,
        { size: 8, colour: isRecord ? UI.heading : UI.textDim, align: "center" },
      );

      if (opts.droppedCount) {
        const drop = cutTop(col, 34);
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
      const nameRow = cutTop(col, 30);
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

      cutTop(col, GRID);
      // THREE ways out, laid in one row. RETRY MAZE is the same reset minus the
      // hub: the floor is regenerated from the run seed, so it is a fresh maze
      // at the same depth — a retry, not a rewind.
      const buttons = cutTop(col, ROW_H + 6);
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
      self.focus = f.focus;
    },
  };
}
