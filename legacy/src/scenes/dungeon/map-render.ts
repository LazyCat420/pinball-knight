/**
 * FLOOR MAP RENDERER — draws the current floor into a 2D canvas.
 *
 * One renderer, two surfaces: the small always-on HUD minimap and the
 * full-screen map on M. They differ only in scale and in how much detail is
 * worth drawing, so both call `drawFloorMap` with a different `detail` level
 * rather than duplicating the tile loop.
 *
 * Everything it draws already exists on `state` — the grid, pinball parts (which
 * conveniently carry BOTH tile and world coords), still-hidden secrets, stairs,
 * enemies, the player. The only new input is the fog buffer.
 *
 * Deliberately blocky: one tile is one or more WHOLE pixels, nothing is
 * anti-aliased, and colours come from the game's Cold Crypt ramp. At minimap
 * scale a tile is 1–2px, so anything subtler than a flat fill is wasted.
 */
import { state } from "./state";
import { at, worldToTile, T_WALL, T_STAIRS, T_CRACKED, type Grid } from "./maze/generator";
import { fogAt, FOG_HIDDEN, FOG_DIM, type Fog } from "./fog";
import { PALETTE_HEX } from "./render/palette";
import { clamp } from "../../utils/math";

/** `#rrggbb` for a Cold Crypt palette index. */
function pal(i: number): string {
  return `#${(PALETTE_HEX[i] ?? 0).toString(16).padStart(6, "0")}`;
}

// Floor/wall read as the room; everything else is a signal colour.
const C_VOID = "#05070b";
const C_FLOOR = pal(2);
const C_FLOOR_DIM = pal(1);
const C_WALL = pal(4);
const C_WALL_DIM = pal(1);
/** Breakable walls are the shortcut layer — the core pinball loop. */
const C_CRACKED = pal(11);
const C_STAIRS = "#6fd0e8";
const C_PLAYER = "#f0c040";
const C_ENEMY = pal(10);
const C_PART = "#55e0c0";
const C_SECRET = "#a46fe8";
const C_ITEM = "#f0a63c";

export type MapDetail = "mini" | "full";

export interface FloorMapOptions {
  /** Whole pixels per tile. Fractional values fringe; callers must floor it. */
  scale: number;
  detail: MapDetail;
  /** Draw only this radius of tiles around the player (minimap framing). */
  window?: number;
}

/** How big a tile can be drawn to fit `g` into `w × h` device pixels. */
export function fitScale(g: Grid, w: number, h: number, max = 6): number {
  return clamp(Math.floor(Math.min(w / g.w, h / g.h)), 1, max);
}

/**
 * Draw the floor.
 *
 * Returns the transform used, so callers can place their own overlays (a legend,
 * a cursor) in the same space.
 */
export function drawFloorMap(
  ctx: CanvasRenderingContext2D,
  g: Grid,
  fog: Fog,
  cw: number,
  ch: number,
  opts: FloorMapOptions,
): { scale: number; ox: number; oy: number; i0: number; j0: number; i1: number; j1: number } {
  const s = Math.max(1, Math.floor(opts.scale));
  const p = state.player;

  // Which slice of the grid to draw. The minimap follows the player; the
  // full-screen map shows the whole floor.
  let i0 = 0;
  let j0 = 0;
  let i1 = g.w;
  let j1 = g.h;
  if (opts.window && p) {
    const pt = worldToTile(g, p.x, p.z);
    i0 = Math.max(0, pt.i - opts.window);
    j0 = Math.max(0, pt.j - opts.window);
    i1 = Math.min(g.w, pt.i + opts.window + 1);
    j1 = Math.min(g.h, pt.j + opts.window + 1);
  }

  const spanW = (i1 - i0) * s;
  const spanH = (j1 - j0) * s;
  const ox = Math.floor((cw - spanW) / 2);
  const oy = Math.floor((ch - spanH) / 2);

  ctx.fillStyle = C_VOID;
  ctx.fillRect(0, 0, cw, ch);

  // ── Floor extent ──
  // A faint outline of the WHOLE grid, so unexplored floor reads as "not yet"
  // rather than as the edge of the world. Without it a 5%-explored map gives no
  // sense of how much is left. Full map only; the minimap is windowed.
  if (opts.detail === "full") {
    ctx.strokeStyle = "#141a24";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, spanW - 1, spanH - 1);
  }

  // ── Tiles ──
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const seen = fogAt(fog, i, j);
      if (seen === FOG_HIDDEN) continue; // unexplored stays void

      const t = at(g, i, j);
      const dim = seen === FOG_DIM;
      let color: string;
      if (t === T_WALL) color = dim ? C_WALL_DIM : C_WALL;
      else if (t === T_CRACKED) color = dim ? C_WALL_DIM : C_CRACKED;
      else if (t === T_STAIRS) color = C_STAIRS;
      else color = dim ? C_FLOOR_DIM : C_FLOOR;

      ctx.fillStyle = color;
      ctx.fillRect(ox + (i - i0) * s, oy + (j - j0) * s, s, s);
    }
  }

  /** True if a tile is inside the drawn window AND discovered. */
  const visible = (i: number, j: number): boolean =>
    i >= i0 && i < i1 && j >= j0 && j < j1 && fogAt(fog, i, j) !== FOG_HIDDEN;

  /** Plot a marker at tile coords, sized so it stays visible at scale 1. */
  const mark = (i: number, j: number, color: string, grow = 0): void => {
    const size = Math.max(1, s + grow);
    const cx = ox + (i - i0) * s + Math.floor((s - size) / 2);
    const cy = oy + (j - j0) * s + Math.floor((s - size) / 2);
    ctx.fillStyle = color;
    ctx.fillRect(cx, cy, size, size);
  };

  // ── Still-hidden secrets ──
  // `state.maze.secrets` is spliced when one is smashed, so the array IS the
  // set of intact secrets. Only shown where the player has already been — this
  // marks "there is something here", not "here is every secret on the floor".
  if (opts.detail === "full" && state.maze) {
    for (const sec of state.maze.secrets) {
      if (!visible(sec.i, sec.j)) continue;
      mark(sec.i, sec.j, C_SECRET, 1);
    }
  }

  // ── Pinball parts ── they carry tile coords already.
  for (const part of state.pinballParts) {
    if (!visible(part.i, part.j)) continue;
    // A spent target/bumper is drawn dim so the map shows what's LEFT to hit.
    const spent = part.done === true;
    mark(part.i, part.j, spent ? C_WALL : C_PART, opts.detail === "full" ? 1 : 0);
  }

  // ── Ground items ──
  if (opts.detail === "full") {
    for (const it of state.groundItems) {
      const t = worldToTile(g, it.x, it.z);
      if (!visible(t.i, t.j)) continue;
      mark(t.i, t.j, C_ITEM);
    }
  }

  // ── Stairs ── always shown once found; it is the objective.
  if (state.stairs && visible(state.stairs.i, state.stairs.j)) {
    mark(state.stairs.i, state.stairs.j, C_STAIRS, 2);
  }

  // ── Enemies ── only the ones that have noticed you. Drawing every sleeping
  // zombie would turn the map into an aimbot and delete the tension.
  for (const z of state.zombies) {
    if (z.mode === "dead" || !z.aggro) continue;
    const t = worldToTile(g, z.x, z.z);
    if (!visible(t.i, t.j)) continue;
    mark(t.i, t.j, C_ENEMY, 1);
  }

  // ── Player ── drawn last so nothing can cover it.
  if (p) {
    const t = worldToTile(g, p.x, p.z);
    mark(t.i, t.j, C_PLAYER, 2);
    // A one-pixel nub in the heading direction: on a blocky map that reads as
    // facing far better than trying to rotate anything.
    const len = Math.hypot(p.momX, p.momZ);
    if (len > 0.01) {
      const nx = Math.round(p.momX / len);
      const nz = Math.round(p.momZ / len);
      mark(t.i + nx, t.j + nz, C_PLAYER);
    }
  }

  return { scale: s, ox, oy, i0, j0, i1, j1 };
}

/**
 * A cheap signature of everything the map draws.
 *
 * The HUD minimap repaints only when this changes. Without it the minimap
 * redraws ~10k tiles every frame inside a `pointer-events: none` DOM panel,
 * which is pure waste — the same `lastSig` trick `hud-face.ts` uses.
 */
export function mapSignature(fog: Fog): string {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return "";
  const t = worldToTile(g, p.x, p.z);
  // fog.rev covers every reveal exactly and in O(1); the player tile covers
  // movement; the rest catch smashes, pickups and aggro changes.
  const aggro = state.zombies.reduce((n, z) => n + (z.aggro && z.mode !== "dead" ? 1 : 0), 0);
  return `${t.i},${t.j},${fog.rev},${aggro},${state.groundItems.length},${state.maze?.secrets.length ?? 0}`;
}
