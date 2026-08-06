/**
 * WHO ARE YOU PLAYING — the lobby's first question.
 *
 * The engine has been able to wear another creature's sheet for a while:
 * `resolvePaints` merges imported clips over the painter's, so any published
 * sheet can be the player. What was missing was a way to SAY so. The only route
 * was `__lab.playAs("frog")` followed by a page reload, which is a console
 * incantation and a refresh — not a choice.
 *
 * ── WHY IT SITS ON TOP OF THE TAVERN, NOT BEFORE IT ─────────────────────────
 *
 * Nothing paints between the intro and the lobby. The GUI stack is drawn by
 * whoever owns the frame loop, and between `runPinballIntro`'s last frame and
 * `enterTavern`'s first there is no such owner — a screen pushed in that gap
 * would be open, correct, and invisible. The tavern calls `drawUiFrame`, so the
 * select is pushed WITH the lobby and paints over it. That also matches what the
 * lobby is for: it is the room you stand in before you descend.
 *
 * ── PREVIEWS ARE THE REAL SHEET ─────────────────────────────────────────────
 *
 * Each card draws the candidate's own `idle` frame, cut from its published PNG
 * by the rects in its sidecar. Not an icon: an icon is a second asset that can
 * disagree with the art, and the one question this screen answers is "what will
 * I look like". A candidate whose sheet fails to load draws no preview and is
 * marked unavailable rather than silently offered — `loadImportedSheet` returns
 * null on ANY failure, and an offer the atlas cannot honour is how the stiltneck
 * shipped invisible for weeks.
 */
import { UI, GRID, ROW_H } from "../theme";
import { button, focusRing, focusable, rect, scrim, sheet, strokeRect, text } from "../im";
import { pop, type UiScreen } from "../stack";
import { DEFAULT_PLAYER_SHEET, PLAYABLE, playerSheetName, switchPlayerSheet } from "../../render/knight-sheets";
import { loadImportedSheet } from "../../render/imported-paints";

const CARD_W = 150;
const CARD_H = 150;

/** A candidate's idle frame, once its sheet has arrived. */
interface Preview {
  image: CanvasImageSource;
  cell: readonly number[];
}

export function characterSelectScreen(onDone: () => void): UiScreen {
  const previews = new Map<string, Preview | null>();
  let chosen = playerSheetName();
  let busy = false;

  // Kick the loads off once, at construction. `paint` runs every frame and must
  // stay synchronous — starting a fetch from inside it would open one per frame.
  for (const c of PLAYABLE) {
    void loadImportedSheet(c.sheet, "S").then((s) => {
      const idle = s?.manifest.rows.find((r) => r.clip === "idle");
      previews.set(c.sheet, s && idle?.cells.length ? { image: s.image, cell: idle.cells[0] } : null);
    });
  }

  return {
    id: "character-select",
    pauses: true,
    focus: 0,
    scroll: 0,
    design: { w: 600, h: 338, max: 2 },
    onClose: onDone,
    paint(f, self) {
      scrim(f);
      const body = sheet(f, 584, 322);

      text(f, "CHOOSE YOUR CHARACTER", body.x + body.w / 2, body.y + 6, {
        size: 16,
        colour: UI.gold,
        align: "center",
      });
      text(f, "THE PAINTER STILL DRAWS THE BALL FORMS — ONLY THE ON-FOOT CLIPS CHANGE", body.x + body.w / 2, body.y + 28, {
        size: 8,
        colour: UI.textDim,
        align: "center",
      });

      const foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
      const top = body.y + 48;
      const span = PLAYABLE.length * CARD_W + (PLAYABLE.length - 1) * GRID;
      let x = body.x + (body.w - span) / 2;

      for (const c of PLAYABLE) {
        const cell = rect(x, top, CARD_W, CARD_H);
        const st = focusable(f, cell);
        const preview = previews.get(c.sheet);
        // THE DEFAULT CHARACTER NEEDS NO SHEET. He is the painter's, and
        // `resolvePaints` draws him whether an imported sheet exists or not — so
        // gating him on one makes the fallback character the one you cannot
        // pick. It is not hypothetical: `pinball_knight-S` is currently stale
        // against its own manifest (2440x3384 vs 3256x4520), the loader rejects
        // it, and this screen would have offered Mario or nothing.
        const painted = c.sheet === DEFAULT_PLAYER_SHEET;
        const ready = painted || preview !== null; // undefined = still loading

        if (st.activated && ready && !busy) chosen = c.sheet;

        strokeRect(f, cell, chosen === c.sheet ? UI.gold : UI.textFaint, chosen === c.sheet ? 2 : 1);
        if (st.focused) focusRing(f, cell);

        if (preview) {
          const [cx0, cy0, cx1, cy1] = preview.cell;
          const sw = cx1 - cx0 + 1;
          const sh = cy1 - cy0 + 1;
          // WHOLE-NUMBER RATIOS BOTH WAYS. This layer is nearest-sampled pixel
          // art and a fractional zoom makes every source pixel alternately 1 or
          // 2 texels wide — the same mush the renderer's integer-scale rule
          // kills. But the ratio has to be allowed BELOW 1, and clamping it to
          // `Math.max(1, …)` is what made the knight's preview flood the whole
          // screen: his cells are ~500px against a 150px card, the fit came out
          // at 0, the clamp forced 1:1, and 500px of knight drew from the card's
          // corner over everything else on it.
          const boxW = CARD_W - 24;
          const boxH = CARD_H - 52;
          const up = Math.floor(Math.min(boxW / sw, boxH / sh));
          // Reduce by 1/N rather than by an arbitrary fraction, so a source texel
          // still maps to a whole number of destination texels.
          const down = Math.ceil(Math.max(sw / boxW, sh / boxH));
          const dw = up >= 1 ? sw * up : Math.round(sw / down);
          const dh = up >= 1 ? sh * up : Math.round(sh / down);
          f.g.imageSmoothingEnabled = false;
          f.g.drawImage(
            preview.image as CanvasImageSource,
            cx0, cy0, sw, sh,
            Math.round(cell.x + (cell.w - dw) / 2),
            Math.round(cell.y + 34 + (CARD_H - 52 - dh) / 2),
            dw, dh,
          );
        } else {
          // Three different silences, and they must not read alike: the painted
          // default has nothing to preview and that is correct; an imported
          // character with no sheet is broken; anything else is still in flight.
          const note = painted ? "PAINTED" : preview === null ? "SHEET MISSING" : "LOADING…";
          text(f, note, cell.x + cell.w / 2, cell.y + CARD_H / 2, {
            size: 8,
            colour: preview === null && !painted ? UI.danger : UI.textFaint,
            align: "center",
          });
        }

        text(f, c.label, cell.x + cell.w / 2, cell.y + 10, {
          size: 8,
          colour: ready ? UI.heading : UI.textFaint,
          align: "center",
          max: CARD_W - 8,
        });
        text(f, c.blurb, cell.x + cell.w / 2, cell.y + CARD_H - 14, {
          size: 8,
          colour: UI.textDim,
          align: "center",
          max: CARD_W - 8,
        });

        x += CARD_W + GRID;
      }

      text(f, busy ? "SWITCHING…" : "CLICK A CHARACTER, THEN CONFIRM", foot.x, foot.y + 8, {
        size: 8,
        colour: UI.textFaint,
      });

      if (button(f, rect(foot.x + foot.w - 120, foot.y, 120, ROW_H), "CONFIRM") && !busy) {
        busy = true;
        // Pop only once the atlas actually has the art. Closing first would drop
        // the player into the lobby as whoever they were, with the swap landing
        // a frame or two later — which reads as the choice being ignored.
        void switchPlayerSheet(chosen).finally(() => pop());
      }
      self.focus = f.focus;
    },
  };
}
