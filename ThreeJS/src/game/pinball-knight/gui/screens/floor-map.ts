/**
 * THE FLOOR MAP, on M.
 *
 * `map-render.ts`'s 431-line `drawFloorMap(ctx, …)` painter is UNCHANGED and
 * does all the work — this only gives it a rect and a legend. That is the
 * cleanest port in the whole migration precisely because the DOM version had
 * already separated painting from chrome.
 *
 * ── IT STILL DOES NOT PAUSE ──
 * Carried over deliberately, with the original reasoning: a floor map you have
 * to be safe to read is a floor map you never read. Leaving the sim running
 * makes checking it mid-run a decision with a cost, which is the interesting
 * version. So `pauses: false` — and that in turn means it must not swallow
 * gameplay input either, so it registers no focusables and closes on its own
 * key rather than on `cancel`.
 */
import { state } from "../../state";
import { drawFloorMap, fitScale } from "../../map-render";
import { exploredFraction } from "../../fog";
import { UI, GRID, ROW_H } from "../theme";
import { fillRect, rect, strokeRect, text, type UiFrame } from "../im";
import { close, type UiScreen } from "../stack";
import { screenZoom } from "../root";
import { DESIGN as HUD_DESIGN, PANEL_H as HUD_PANEL_H } from "./hud";

/** Legend rows: colour + what it means. Order matches drawing priority. */
const LEGEND: Array<[string, string]> = [
  [UI.gold, "YOU"],
  [UI.arcane, "STAIRS"],
  [UI.good, "PARTS"],
  ["#a46fe8", "SECRET"],
];

export function floorMapScreen(): UiScreen {
  return {
    id: "floor-map",
    pauses: false,
    focus: 0,
    scroll: 0,
    paint(f: UiFrame) {
      const g = state.grid;
      const fog = state.fog;
      if (!g || !fog) {
        close("floor-map");
        return;
      }

      // A dim, not a blackout: the map does not pause, so the world behind it
      // has to stay readable enough to react to.
      fillRect(f, rect(0, 0, f.w, f.h), "rgba(11,13,18,0.62)");

      const pad = GRID * 4;
      // Leave the HUD panel's height clear at the bottom. The map does not
      // pause, so the HUD stays up and readable underneath — a legend printed
      // over the belt tiles is two instruments fighting for the same pixels.
      // The HUD's height IN THIS SCREEN'S UNITS. The map paints at 1x — a
      // half-resolution floor plan magnified back up is a worse map — while the
      // HUD takes the 2x design zoom, so its 76 UI pixels are `PANEL_H *
      // hudZoom` here. Hardcoding 108 was already only correct at one zoom, and
      // silently wrong the moment either screen moved.
      const HUD_CLEAR = HUD_PANEL_H * screenZoom(HUD_DESIGN, f.w, f.h) + GRID * 2;
      const avail = rect(pad, pad + ROW_H, f.w - pad * 2, f.h - pad - ROW_H - HUD_CLEAR);
      const scale = fitScale(g, avail.w, avail.h);
      const mapW = g.w * scale;
      const mapH = g.h * scale;
      const box = rect(avail.x + (avail.w - mapW) / 2, avail.y + (avail.h - mapH) / 2, mapW, mapH);

      fillRect(f, box, UI.well);
      strokeRect(f, box, UI.sheetEdge, 2);

      // The painter draws from (0,0), so translate rather than pass an offset —
      // `drawFloorMap` has no origin parameter and inventing one here would
      // fork a function the minimap also uses.
      f.g.save();
      f.g.translate(Math.round(box.x), Math.round(box.y));
      drawFloorMap(f.g, g, fog, mapW, mapH, { scale, detail: "full" });
      f.g.restore();

      text(f, `FLOOR ${state.level}`, pad, pad, { size: 16, colour: UI.gold });
      text(f, `${Math.round(exploredFraction(fog, g) * 100)}% EXPLORED`, f.w - pad, pad + 6, {
        size: 8,
        colour: UI.textDim,
        align: "right",
      });

      const legendY = avail.y + avail.h + GRID;
      let lx = pad;
      for (const [colour, label] of LEGEND) {
        fillRect(f, rect(lx, legendY, 8, 8), colour);
        const w = text(f, label, lx + 12, legendY, { size: 8, colour: UI.textDim });
        lx += w + 28;
      }
      text(f, "M — CLOSE", f.w - pad, legendY, { size: 8, colour: UI.textFaint, align: "right" });
    },
  };
}
