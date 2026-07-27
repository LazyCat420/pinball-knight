/**
 * INTRO TITLE MAZE — a hand-built Grid whose walls literally spell
 * "PINBALL / KNIGHT", plus the tiny self-contained ricochet sim that flings
 * the knight around it during the intro.
 *
 * Pure and three-free on purpose (same contract as maze/generator.ts): the
 * intro's visual layer feeds this Grid to buildMaze() unchanged, and the
 * collision it bounces on is the game's REAL moveCircle — so the intro's
 * physics can never drift from gameplay's.
 */
import { T_WALL, T_FLOOR, type Grid } from "../maze/generator";
import { moveCircle } from "../engine/collision";

/**
 * 5-row pixel glyphs for the ten letters the title needs. Strokes are 1 tile —
 * the same thickness as every real maze wall, so the letters render with the
 * standard wall boxes and read as dungeon architecture, not signage.
 */
export const TITLE_FONT: Record<string, readonly string[]> = {
  P: ["###.", "#..#", "###.", "#...", "#..."],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  B: ["###.", "#..#", "###.", "#..#", "###."],
  A: [".##.", "#..#", "####", "#..#", "#..#"],
  L: ["#...", "#...", "#...", "#...", "####"],
  K: ["#..#", "#.#.", "##..", "#.#.", "#..#"],
  G: [".###", "#...", "#.##", "#..#", ".##."],
  H: ["#..#", "#..#", "####", "#..#", "#..#"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
};

const WORD_TOP = "PINBALL";
const WORD_BOTTOM = "KNIGHT";
const LETTER_GAP = 1; // tiles between letters
const WORD_GAP = 3; // floor rows between the two words — the bounce lane
const PAD = 3; // open floor between letters and the border wall
export const GLYPH_H = 5;

function wordWidth(word: string): number {
  let w = 0;
  for (const ch of word) w += TITLE_FONT[ch][0].length + LETTER_GAP;
  return w - LETTER_GAP;
}

export interface TitleLayout {
  grid: Grid;
  /** Where the knight materialises after the 2D world shatters. */
  spawn: { x: number; z: number };
  /** World-space centre of the title block — the camera's final target. */
  center: { x: number; z: number };
  /** Tile origin (top-left) of each word, for tests and framing. */
  topWordOrigin: { i: number; j: number };
  bottomWordOrigin: { i: number; j: number };
}

/** Stamp one glyph's wall tiles at tile origin (i0, j0). */
function stampGlyph(g: Grid, glyph: readonly string[], i0: number, j0: number): void {
  for (let r = 0; r < glyph.length; r++) {
    for (let c = 0; c < glyph[r].length; c++) {
      if (glyph[r][c] === "#") g.t[(j0 + r) * g.w + (i0 + c)] = T_WALL;
    }
  }
}

function stampWord(g: Grid, word: string, i0: number, j0: number): void {
  let i = i0;
  for (const ch of word) {
    const glyph = TITLE_FONT[ch];
    stampGlyph(g, glyph, i, j0);
    i += glyph[0].length + LETTER_GAP;
  }
}

/**
 * Build the title maze: a sealed floor arena with the two words standing as
 * wall strokes. Everything outside the letters is open floor, so the ricochet
 * threads between and around the letterforms.
 */
export function buildTitleGrid(): TitleLayout {
  const topW = wordWidth(WORD_TOP);
  const bottomW = wordWidth(WORD_BOTTOM);
  const w = topW + 2 * PAD + 2; // +2 = the border walls themselves
  const h = GLYPH_H * 2 + WORD_GAP + 2 * PAD + 2;

  const grid: Grid = {
    w,
    h,
    t: new Uint8Array(w * h).fill(T_FLOOR),
    shapes: new Uint8Array(w * h), // all SHAPE_FULL
  };

  // Sealed border ring.
  for (let i = 0; i < w; i++) {
    grid.t[i] = T_WALL;
    grid.t[(h - 1) * w + i] = T_WALL;
  }
  for (let j = 0; j < h; j++) {
    grid.t[j * w] = T_WALL;
    grid.t[j * w + (w - 1)] = T_WALL;
  }

  const topWordOrigin = { i: 1 + PAD, j: 1 + PAD };
  // Bottom word centred under the top one.
  const bottomWordOrigin = {
    i: 1 + PAD + Math.floor((topW - bottomW) / 2),
    j: 1 + PAD + GLYPH_H + WORD_GAP,
  };
  stampWord(grid, WORD_TOP, topWordOrigin.i, topWordOrigin.j);
  stampWord(grid, WORD_BOTTOM, bottomWordOrigin.i, bottomWordOrigin.j);

  // Spawn in the open lane between the words, left of centre — tile centres
  // (maze world space puts tile (i,j) centre at i+0.5-w/2).
  const spawnI = 1 + PAD;
  const spawnJ = 1 + PAD + GLYPH_H + Math.floor(WORD_GAP / 2);
  return {
    grid,
    spawn: { x: spawnI + 0.5 - w / 2, z: spawnJ + 0.5 - h / 2 },
    center: { x: 0, z: 0 },
    topWordOrigin,
    bottomWordOrigin,
  };
}

// ── Ricochet sim ─────────────────────────────────────────────────

export interface IntroBall {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export const INTRO_BALL_R = 0.3; // PLAYER_R — same footprint as the knight
export const INTRO_BALL_SPEED = 15; // u/s — pinball-fast, still trackable

/**
 * Advance the ball one step against the REAL collision sweep. Reflection
 * follows entities/player.ts precedence: a slant contact normal wins
 * (v − 2(v·n)n), else the blocked axis flips. Speed is re-normalised every
 * step — the intro ball never bleeds energy; it careens until told to stop.
 *
 * Returns true when a wall was struck this step (for the bumper sting).
 */
export function stepIntroBall(g: Grid, b: IntroBall, dt: number): boolean {
  const dx = b.vx * dt;
  const dz = b.vz * dt;
  const res = moveCircle(g, b.x, b.z, INTRO_BALL_R, dx, dz);
  let bounced = false;

  if (res.hitN) {
    const { nx, nz } = res.hitN;
    const dot = b.vx * nx + b.vz * nz;
    if (dot < 0) {
      b.vx -= 2 * dot * nx;
      b.vz -= 2 * dot * nz;
      bounced = true;
    }
  } else {
    // Axis clamp: the sweep resolved short of the requested move → that axis
    // hit a square wall face. Flip it.
    if (Math.abs(res.x - (b.x + dx)) > 1e-6) {
      b.vx = -b.vx;
      bounced = true;
    }
    if (Math.abs(res.z - (b.z + dz)) > 1e-6) {
      b.vz = -b.vz;
      bounced = true;
    }
  }

  b.x = res.x;
  b.z = res.z;

  // Constant energy, and a guard against ever settling into a pure-axis path
  // that could shuttle in a 1-tile slot forever: keep both components alive.
  const speed = Math.hypot(b.vx, b.vz) || 1;
  b.vx = (b.vx / speed) * INTRO_BALL_SPEED;
  b.vz = (b.vz / speed) * INTRO_BALL_SPEED;
  if (Math.abs(b.vx) < INTRO_BALL_SPEED * 0.08) b.vx = Math.sign(b.vx || 1) * INTRO_BALL_SPEED * 0.08;
  if (Math.abs(b.vz) < INTRO_BALL_SPEED * 0.08) b.vz = Math.sign(b.vz || 1) * INTRO_BALL_SPEED * 0.08;
  return bounced;
}
