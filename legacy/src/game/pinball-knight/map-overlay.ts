/**
 * The full-screen floor map, on M.
 *
 * The minimap answers "what's around me"; this answers "where haven't I been,
 * and where are the stairs". So it shows the WHOLE grid at whatever scale fits,
 * with the extra detail the minimap has no room for — secrets, ground items,
 * a legend and an explored percentage.
 *
 * Does NOT pause the game. A floor map you have to be safe to read is a floor
 * map you never read; leaving the sim running means checking it mid-run is a
 * decision with a cost, which is the interesting version.
 */
import { inGameUiEnabled } from "./gui/flag";
import { floorMapScreen } from "./gui/screens/floor-map";
import { close as closeUiScreen, isOpen as uiIsOpen, push as pushUiScreen } from "./gui/stack";
import { state } from "./state";
import { drawFloorMap, fitScale } from "./map-render";
import { exploredFraction } from "./fog";
import { ensurePixelFonts } from "./pixel-fonts";

let el: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;

const LABEL = "'Press Start 2P', monospace";

/** Legend rows: colour + what it means. Order matches drawing priority. */
const LEGEND: Array<[string, string]> = [
  ["#f0c040", "YOU"],
  ["#6fd0e8", "STAIRS"],
  ["#55e0c0", "PARTS"],
  ["#a46fe8", "SECRET"],
  ["#f0a63c", "LOOT"],
  ["#8f1f2a", "AGGRO"],
];

export function isFloorMapOpen(): boolean {
  if (inGameUiEnabled()) return uiIsOpen("floor-map");
  return el !== null;
}

function paint(): void {
  if (!ctx || !canvas) return;
  const g = state.grid;
  const fog = state.fog;
  if (!g || !fog) return;

  const cw = canvas.width;
  const ch = canvas.height;
  // Leave room for the legend strip down the right.
  const mapW = cw - 150;

  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, cw, ch);

  drawFloorMap(ctx, g, fog, mapW, ch - 60, {
    scale: fitScale(g, mapW - 40, ch - 100, 8),
    detail: "full",
  });

  // ── Header ──
  ctx.font = `12px ${LABEL}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f0c040";
  ctx.fillText(`DEPTH ${state.level}`, 20, 18);

  const pct = Math.round(exploredFraction(fog, g) * 100);
  ctx.fillStyle = "#9aa4b4";
  ctx.fillText(`${pct}% EXPLORED`, 20, 38);

  // ── Legend ──
  const lx = cw - 130;
  let ly = 24;
  ctx.font = `9px ${LABEL}`;
  for (const [color, label] of LEGEND) {
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly + 1, 8, 8);
    ctx.fillStyle = "#c9d1e0";
    ctx.fillText(label, lx + 14, ly);
    ly += 18;
  }

  // Only a found stairs is called out — this is a map, not a solution.
  ctx.fillStyle = "#6b7488";
  ctx.font = `9px ${LABEL}`;
  ctx.textAlign = "center";
  ctx.fillText("[M] CLOSE", cw / 2, ch - 24);
}

function loop(): void {
  if (!el) return;
  paint();
  raf = requestAnimationFrame(loop);
}

function sizeCanvas(): void {
  if (!canvas || !ctx) return;
  // 1:1 with CSS pixels — the map is drawn in whole tile-blocks, so a fractional
  // devicePixelRatio would fringe every one of them.
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.imageSmoothingEnabled = false;
}

export function openFloorMap(container: HTMLElement): void {
  if (el || !state.grid || !state.fog) return;
  ensurePixelFonts();

  el = document.createElement("div");
  el.id = "dungeon-floor-map";
  el.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:10006",
    "background:rgba(5,7,11,0.92)",
    // The sim keeps running underneath, so the map must never eat input.
    "pointer-events:none",
  ].join(";");

  canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;image-rendering:pixelated";
  el.appendChild(canvas);
  ctx = canvas.getContext("2d");
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);

  container.appendChild(el);
  raf = requestAnimationFrame(loop);
}

export function closeFloorMap(): void {
  if (inGameUiEnabled()) return closeUiScreen("floor-map");
  if (!el) return;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener("resize", sizeCanvas);
  el.remove();
  el = null;
  canvas = null;
  ctx = null;
}

/** Toggle. Returns true if the map is open afterwards. */
export function toggleFloorMap(container: HTMLElement): boolean {
  if (inGameUiEnabled()) {
    if (uiIsOpen("floor-map")) {
      closeUiScreen("floor-map");
      return false;
    }
    pushUiScreen(floorMapScreen());
    return true;
  }
  if (el) {
    closeFloorMap();
    return false;
  }
  openFloorMap(container);
  return el !== null;
}
