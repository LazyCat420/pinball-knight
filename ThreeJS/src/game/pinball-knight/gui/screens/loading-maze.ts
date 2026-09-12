/**
 * THE DESCENT SCREEN'S LABYRINTH — woven once, painted once, blitted per frame.
 *
 * Two things live here and they are deliberately together: the pure weave (a
 * maze as WALLS, plus the one route through it) and the two pre-rendered canvas
 * layers the screen blits. Neither is useful without the other, and keeping the
 * geometry beside the paint is what stops the art and the solve drifting into
 * two different coordinate conventions — the failure that makes a thread float
 * beside its corridor instead of down the middle of it.
 *
 * ── WHY WALLS AND NOT CELLS ──
 * The first version of this screen carved corridors on odd cells and FILLED the
 * carved cells. On a 32-colour snap that reads as a field of blobs, not as a
 * maze: the thing the eye recognises as a labyrinth is the WALL — a continuous
 * line that turns. So the weave stores four wall bits per cell and the art
 * strokes those lines. Same generator family, completely different read.
 *
 * ── WHY THE COLOURS ARE PALETTE ENTRIES AND THE DIM IS BAKED ──
 * The UI composites BEFORE the pass's palette snap (see gui/theme.ts), so a
 * translucent fill does not arrive on screen as "a dim version of itself" — it
 * arrives as whichever of 32 entries it lands nearest. The old labyrinth drew
 * unlit stone as `rgba(26,31,43,0.34)` over black, which resolves to about
 * #090b0f: nearer VOID than anything else. Half the screen was repainted every
 * frame and none of it survived to the display. That is measured, not reasoned
 * about — it is what a quantized screenshot of the old screen shows.
 *
 * Every colour here is therefore an exact entry, and the "dim" that used to be
 * a full-screen 50% black rect every frame is baked into the choice of entry
 * instead. It costs nothing per frame and the quantizer cannot eat it.
 *
 * ── WHY IT IS PRE-RENDERED ──
 * This screen is on display precisely while the thread is blocked building a
 * floor, so its per-frame cost comes straight out of the budget it exists to
 * cover. The old paint walked every cell every frame — ~2,400 `fillRect`s, each
 * preceded by a template-literal `rgba(...)` string the canvas then had to
 * re-parse. Here the labyrinth is two opaque canvases painted once per size
 * change, and a frame is two `drawImage`s plus the parts that actually move.
 */
import { paletteCss } from "../../render/palette";

// ── Wall bits. A cell knows its own four walls; neighbours agree because the
//    carve knocks both sides down at once, so "whose wall is it" never arises. ──
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

const OPPOSITE: Record<number, number> = { [N]: S, [S]: N, [E]: W, [W]: E };
const STEP: ReadonlyArray<{ bit: number; dx: number; dy: number }> = [
  { bit: N, dx: 0, dy: -1 },
  { bit: E, dx: 1, dy: 0 },
  { bit: S, dx: 0, dy: 1 },
  { bit: W, dx: -1, dy: 0 },
];

export interface Weave {
  cols: number;
  rows: number;
  /** Four wall bits per cell, row-major. A SET bit is a wall that is present. */
  walls: Uint8Array;
  /** The one route from the left edge to the right edge, as cell indices. */
  path: Int32Array;
  /** Cells carrying a wall torch, as cell indices. Decoration with a job. */
  sconces: Int32Array;
}

/**
 * Weave a perfect maze and solve it.
 *
 * Growing-tree with a strong depth-first bias: mostly "take the newest cell"
 * (long, committed corridors) with a minority of random picks (junctions). Pure
 * DFS reads as one enormous snake and a pure random pick reads as gravel; this
 * mix is the one that looks hand-drawn.
 *
 * Deliberately unseeded by default — a different labyrinth every descent reads
 * as a different place. `rand` is injectable ONLY so the shape can be asserted
 * from a test without a renderer.
 */
export function weaveMaze(cols: number, rows: number, rand: () => number = Math.random): Weave {
  const n = Math.max(0, cols * rows);
  const walls = new Uint8Array(n).fill(N | E | S | W);
  if (cols < 2 || rows < 2) return { cols, rows, walls, path: new Int32Array(0), sconces: new Int32Array(0) };

  const at = (x: number, y: number): number => y * cols + x;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const startY = rows >> 1;
  seen[at(0, startY)] = 1;
  stack.push(at(0, startY));

  while (stack.length) {
    const i = rand() < 0.82 ? stack.length - 1 : (rand() * stack.length) | 0;
    const cell = stack[i];
    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    const opts = STEP.filter((s) => {
      const nx = cx + s.dx;
      const ny = cy + s.dy;
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[at(nx, ny)];
    });
    if (!opts.length) {
      stack.splice(i, 1);
      continue;
    }
    const pick = opts[(rand() * opts.length) | 0];
    const next = at(cx + pick.dx, cy + pick.dy);
    walls[cell] &= ~pick.bit;
    walls[next] &= ~OPPOSITE[pick.bit];
    seen[next] = 1;
    stack.push(next);
  }

  // ── CHAMBERS ──
  // A perfect maze on its own reads as a puzzle-book page: every corridor one
  // cell wide, every junction the same weight, nowhere for the eye to rest.
  // This dungeon's floors are rooms joined by corridors, so a handful of the
  // maze's cells are knocked open into chambers. They are punched AFTER the
  // carve, which is what makes them cheap and safe: removing a wall can only
  // ADD a connection, so the maze stays fully connected and simply grows a few
  // loops. `solve` is breadth-first precisely so a loop cannot fool it.
  const chambers = punchChambers(cols, rows, walls, rand);

  // The way in and the way down. Both on the mid row, so the route crosses the
  // screen WITH the light sweep rather than against it.
  const entry = at(0, startY);
  const exit = at(cols - 1, startY);
  walls[entry] &= ~W;
  walls[exit] &= ~E;

  return {
    cols,
    rows,
    walls,
    path: solve(cols, rows, walls, entry, exit),
    sconces: pickSconces(cols, rows, rand, chambers),
  };
}

/**
 * Breadth-first, so the route is the SHORTEST one. In a perfect maze that is
 * also the only one; the search is what keeps this honest if the weave ever
 * grows a loop.
 */
export function solve(cols: number, rows: number, walls: Uint8Array, from: number, to: number): Int32Array {
  const prev = new Int32Array(cols * rows).fill(-1);
  const queue: number[] = [from];
  prev[from] = from;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell === to) break;
    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    for (const s of STEP) {
      if (walls[cell] & s.bit) continue;
      const nx = cx + s.dx;
      const ny = cy + s.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      if (prev[next] !== -1) continue;
      prev[next] = cell;
      queue.push(next);
    }
  }
  if (prev[to] === -1) return new Int32Array(0);
  const out: number[] = [];
  for (let c = to; c !== from; c = prev[c]) out.push(c);
  out.push(from);
  return Int32Array.from(out.reverse());
}

/**
 * Knock a few rooms out of the finished maze. Returns each chamber's centre
 * cell, so the torches can favour them.
 *
 * One room per ~80 cells, none of them touching the field's edge — a chamber
 * hanging half off the screen reads as a rendering fault rather than as a room.
 */
function punchChambers(cols: number, rows: number, walls: Uint8Array, rand: () => number): number[] {
  const centres: number[] = [];
  const wanted = Math.max(2, Math.round((cols * rows) / 80));
  for (let i = 0; i < wanted; i++) {
    const w = 2 + ((rand() * 3) | 0);
    const h = 2 + ((rand() * 2) | 0);
    if (cols - w - 2 < 1 || rows - h - 2 < 1) break;
    const x0 = 1 + ((rand() * (cols - w - 2)) | 0);
    const y0 = 1 + ((rand() * (rows - h - 2)) | 0);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const c = y * cols + x;
        if (x > x0) walls[c] &= ~W;
        if (x < x0 + w - 1) walls[c] &= ~E;
        if (y > y0) walls[c] &= ~N;
        if (y < y0 + h - 1) walls[c] &= ~S;
      }
    }
    centres.push((y0 + (h >> 1)) * cols + x0 + (w >> 1));
  }
  return centres;
}

/**
 * A torch every couple of dozen cells, spread over a coarse grid so they never
 * clump — plus one in every chamber, because a room lit by nothing reads as a
 * hole in the maze rather than as a place.
 */
function pickSconces(cols: number, rows: number, rand: () => number, chambers: number[]): Int32Array {
  const out: number[] = [...chambers];
  const step = 5;
  for (let by = 0; by < rows; by += step) {
    for (let bx = 0; bx < cols; bx += step) {
      if (rand() < 0.45) continue;
      const x = Math.min(cols - 1, bx + ((rand() * step) | 0));
      const y = Math.min(rows - 1, by + ((rand() * step) | 0));
      out.push(y * cols + x);
    }
  }
  return Int32Array.from(out);
}

// ── The paint ─────────────────────────────────────────────────────────────────

/** Cold stone, not yet reached. Etched dark on the void so it reads without glowing. */
const COLD_WALL = paletteCss(2); // stone dark
const COLD_EDGE = paletteCss(1); // outline — the wall's own shadow side
/** Torchlit stone, behind the sweep. A ramp step brighter, on a floor you can see. */
const LIT_FLOOR = paletteCss(1); // outline — the floor reads as a surface, not a hole
const LIT_WALL = paletteCss(3); // stone mid
const LIT_TOP = paletteCss(5); // stone highlight — the lit face, always up and left
const SCONCE_HALO = paletteCss(14); // ember
const SCONCE_CORE = paletteCss(15); // flame dark
const VOID = paletteCss(0);

export interface MazeArt {
  /** The whole labyrinth, cold. Opaque, so one blit covers the field. */
  cold: HTMLCanvasElement;
  /** The same labyrinth, torchlit. Opaque, so the sweep is a clipped blit. */
  lit: HTMLCanvasElement;
  w: number;
  h: number;
  cell: number;
  /** The route, as device-pixel x,y pairs down the middle of the corridors. */
  path: Int32Array;
  /** Cumulative run along `path`, so a fraction maps to a DISTANCE in one search. */
  run: Float64Array;
  /** Torch positions, as device-pixel x,y pairs. */
  sconces: Int32Array;
}

/**
 * Paint both layers at DEVICE resolution.
 *
 * Device, not the screen's zoomed UI units, for one reason: the backdrop is
 * blitted under an identity transform, so one texel of these canvases is one
 * texel of the pixel grid. Painting at UI units and letting `drawImage` scale by
 * the screen's fractional zoom (2.7 at 1600x900) would nearest-neighbour a 2px
 * wall into alternating 5px and 6px runs — a labyrinth whose lines change
 * thickness as they cross the screen.
 */
export function paintMazeArt(w: number, h: number, cellPx: number, rand: () => number = Math.random): MazeArt {
  // Even cells and even line weights keep every stroke on whole pixels: the
  // thread runs down cell CENTRES, and an odd cell puts those centres on a half
  // pixel, where antialiasing turns one gold line into two brown ones.
  const cell = Math.max(8, cellPx - (cellPx % 2));
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const weave = weaveMaze(cols, rows, rand);
  const t = Math.max(2, Math.round(cell / 14) * 2); // wall thickness, even

  const cold = surface(w, h);
  const lit = surface(w, h);
  const cg = cold.getContext("2d");
  const lg = lit.getContext("2d");
  const empty = { cold, lit, w, h, cell, path: new Int32Array(0), run: new Float64Array(1), sconces: new Int32Array(0) };
  if (!cg || !lg) return empty;

  cg.fillStyle = VOID;
  cg.fillRect(0, 0, w, h);
  lg.fillStyle = LIT_FLOOR;
  lg.fillRect(0, 0, w, h);

  // Walls are drawn as each cell's OWN north and west edge. Every shared edge is
  // therefore drawn exactly once, and the south/east boundary of the field falls
  // to the extra row and column the grid is oversized by.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const bits = weave.walls[y * cols + x];
      const px = x * cell;
      const py = y * cell;
      // The `+ t` on each length closes the corner where two walls meet. Without
      // it every junction shows a t×t hole and the maze looks stitched together.
      if (bits & N) {
        cg.fillStyle = COLD_WALL;
        cg.fillRect(px, py, cell + t, t);
        cg.fillStyle = COLD_EDGE;
        cg.fillRect(px, py + t, cell + t, 1);
        lg.fillStyle = LIT_WALL;
        lg.fillRect(px, py, cell + t, t);
        lg.fillStyle = LIT_TOP;
        lg.fillRect(px, py, cell + t, 1);
      }
      if (bits & W) {
        cg.fillStyle = COLD_WALL;
        cg.fillRect(px, py, t, cell + t);
        lg.fillStyle = LIT_WALL;
        lg.fillRect(px, py, t, cell + t);
        lg.fillStyle = LIT_TOP;
        lg.fillRect(px, py, 1, cell + t);
      }
    }
  }

  // Torches, baked into the lit layer only — they are what the sweep is
  // LIGHTING. Their flicker is painted on top, per frame, by the screen.
  //
  // Each one is MOUNTED ON A WALL rather than floating in the middle of its
  // cell. A glow in open floor reads as an item lying there — a pickup, in a
  // game that has those — where the same glow tucked under a wall reads as a
  // sconce, which is what it is meant to be.
  const sconces: number[] = [];
  const r = Math.max(2, ((cell / 8) | 0) & ~1); // halo arm, even
  for (const c of weave.sconces) {
    const bits = weave.walls[c];
    const cx = (c % cols) * cell + (cell >> 1);
    const cy = ((c / cols) | 0) * cell + (cell >> 1);
    let x = cx;
    let y = cy;
    if (bits & N) y = ((c / cols) | 0) * cell + t + r;
    else if (bits & W) x = (c % cols) * cell + t + r;
    else if (bits & S) y = ((c / cols) | 0) * cell + cell - r;
    // A cross rather than a block: a square of ember is a crate, and the arms
    // are what make it read as light spilling rather than as an object.
    lg.fillStyle = SCONCE_HALO;
    lg.fillRect(x - r * 2, y - 1, r * 4, 2);
    lg.fillRect(x - 1, y - r * 2, 2, r * 4);
    lg.fillRect(x - r, y - r, r * 2, r * 2);
    lg.fillStyle = SCONCE_CORE;
    lg.fillRect(x - (r >> 1), y - (r >> 1), r, r);
    sconces.push(x, y);
  }

  // The route in pixels, plus the cumulative run, so `frac` maps to a distance
  // along the thread rather than to a count of corners — which would crawl
  // through the twisty stretches and sprint down the straights.
  const pts: number[] = [];
  for (const c of weave.path) {
    pts.push((c % cols) * cell + (cell >> 1), ((c / cols) | 0) * cell + (cell >> 1));
  }
  const count = pts.length / 2;
  const run = new Float64Array(Math.max(1, count));
  for (let i = 1; i < count; i++) {
    const dx = pts[i * 2] - pts[i * 2 - 2];
    const dy = pts[i * 2 + 1] - pts[i * 2 - 1];
    run[i] = run[i - 1] + Math.abs(dx) + Math.abs(dy); // axis-aligned: no sqrt needed
  }

  return { cold, lit, w, h, cell, path: Int32Array.from(pts), run, sconces: Int32Array.from(sconces) };
}

/** A never-parented canvas. A pixel buffer, not interface — see gui/no-dom.test.ts. */
function surface(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}
