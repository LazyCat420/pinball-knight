/**
 * The HUD minimap — a small always-on view of the floor around the knight.
 *
 * Follows `hud-face.ts` exactly, because that is the established pattern for a
 * pixel canvas living inside the DOM HUD: a fixed backing store, `pixelated`
 * rendering, smoothing off, and — critically — a `lastSig` repaint guard.
 *
 * The guard is not a micro-optimisation here. The panel is `pointer-events:
 * none` and the map redraws every tile in its window; without a guard that is
 * a few thousand `fillRect` calls per frame for output that is usually
 * identical to the last one.
 */
import { state } from "./state";
import { drawFloorMap, mapSignature } from "./map-render";

/** Backing store, in device pixels. Square, so the window is symmetric. */
const PX = 116;
/** Tiles either side of the player to show. 11 → a 23×23 window. */
const WINDOW = 11;
/** Whole pixels per tile: PX / (WINDOW*2+1) = 5.04 → 5. */
const TILE_PX = Math.floor(PX / (WINDOW * 2 + 1));

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let lastSig = "";

/** Create (once) the minimap canvas and return it. */
export function createMinimap(): HTMLCanvasElement {
  if (canvas) return canvas;
  const c = document.createElement("canvas");
  c.width = PX;
  c.height = PX;
  c.id = "dungeon-hud-minimap";
  c.style.cssText = `image-rendering: pixelated; width: 100%; height: 100%; display: block;`;
  const context = c.getContext("2d");
  if (context) context.imageSmoothingEnabled = false;
  canvas = c;
  ctx = context;
  lastSig = "";
  return c;
}

/** Repaint if anything the map shows has actually changed. */
export function renderMinimap(): void {
  if (!canvas || !ctx) return;
  const g = state.grid;
  const fog = state.fog;
  if (!g || !fog) return;

  const sig = mapSignature(fog);
  if (sig === lastSig) return;
  lastSig = sig;

  drawFloorMap(ctx, g, fog, PX, PX, { scale: TILE_PX, detail: "mini", window: WINDOW });

  // A 1px frame, so the map reads as an instrument rather than a hole in the bar.
  ctx.strokeStyle = "#5a4a2c";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, PX - 1, PX - 1);
}

export function disposeMinimap(): void {
  canvas = null;
  ctx = null;
  lastSig = "";
}
