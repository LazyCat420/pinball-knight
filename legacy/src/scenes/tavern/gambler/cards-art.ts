/**
 * PIXEL PLAYING CARDS.
 *
 * These are the centrepiece of the blackjack table, so they are drawn as real
 * cards rather than as a letter on a rectangle: corner indices in BOTH corners
 * with the second one rotated 180°, hand-authored suit pips, the standard pip
 * LAYOUTS for 2–10, and two-headed court figures for J/Q/K.
 *
 * ── Why none of this uses a font ────────────────────────────────────────────
 * The previous version drew ranks with Press Start 2P. That works for one
 * corner and falls apart for the other, because the bottom-right index on a
 * real card is UPSIDE DOWN and the only way to rotate canvas text is
 * `ctx.rotate()` — which anti-aliases, which is the one thing this style cannot
 * have. Authoring the ranks as 3×5 bitmaps makes a 180° rotation a matter of
 * reading the grid backwards, costs nothing, and at a 36px-wide card an 8px
 * font was oversized for a corner index anyway.
 *
 * Suit pips are likewise hand-authored on 5×5 (corner) and 7×7 (centre) grids.
 * A heart or a club from a font is a smooth glyph in a pixel game, and at this
 * size the difference between a spade and a club has to be placed cell by cell
 * or the two become the same black blob.
 *
 * ── Why every mark is a fillRect ────────────────────────────────────────────
 * Canvas 2D anti-aliases all path geometry and it cannot be switched off. So:
 *   · Rounded corners are a hand-cut pixel STAIRCASE, not `arc()`.
 *   · The drop shadow is a hard offset rectangle, not `shadowBlur`.
 *   · A card sitting at an angle is SHEARED per scanline by whole pixels, not
 *     `ctx.rotate()` — a real rotation would fringe every edge of every card.
 *   · Shading is a fixed ramp of opaque tones, never `globalAlpha`.
 *
 * The ramps are hue-rotated rather than lightness-only: card stock highlights
 * go warm (toward cream), its shadows go cool (toward blue-grey), and the red
 * suits darken toward a cool maroon instead of toward grey. Lightness-only
 * ramps are what make pixel art look muddy.
 */
import { RED_SUITS, rankLabel, type Card, type Suit } from "./blackjack";

// ── Palette ──────────────────────────────────────────────────────────────────
// Card stock: warm highlight, neutral face, cool shadow. The edge tone is
// deliberately cool so a white card reads as sitting ON green felt rather than
// floating over it.
const FACE_HI = "#fffaef";
const FACE = "#ece2cd";
const FACE_LO = "#c8bfae";
const FACE_EDGE = "#8a8474";
const FACE_INSET = "#b6ac99";

const INK = "#191426";
const INK_SOFT = "#443c58";
const RED = "#b02a34";
const RED_LO = "#7a1f30";

/** Court-figure accents. */
const GOLD = "#d9a63c";
const GOLD_HI = "#f4d478";
const SKIN = "#e6c4a0";

/** Card back — indigo, so it can never be mistaken for a pale face. */
const BACK = "#2b2450";
const BACK_LO = "#1a1436";
const BACK_LINE = "#4b3f86";
const BACK_HI = "#7c69c4";

/** Hard drop shadow. Cool and dark — it lands on felt. */
const SHADOW = "#0a1a13";

export interface CardSize {
  w: number;
  h: number;
}

/** Sensible card size for a given height, at a whole-pixel aspect. */
export function cardSize(h: number): CardSize {
  return { w: Math.round(h * 0.72), h };
}

// ── Rank glyphs ──────────────────────────────────────────────────────────────
// 3×5, except "10" which gets a purpose-built 5-wide glyph. Two 3-wide digits
// plus a gap would be 7px, and a 7px index does not fit beside the pip columns
// on a 36px card — so the ten is drawn as one ligature.

const RANK_GLYPHS: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  "10": ["#.###", "#.#.#", "#.#.#", "#.#.#", "#.###"],
  J: [".##", "..#", "..#", "#.#", ".#."],
  Q: [".#.", "#.#", "#.#", "#.#", ".##"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
};

// ── Suit pips ────────────────────────────────────────────────────────────────

/**
 * 5×5 — the corner index pip, and the face pips on 9s and 10s.
 *
 * A separate, simplified drawing rather than a scaled-down PIP_BIG. Scaling
 * pixel art down does not simplify it, it destroys it: the club's lobe notches
 * are one pixel wide at 7×7 and there is no 5×5 they can survive into. So the
 * small pips keep only what distinguishes each suit at a glance — spade solid
 * to a point, club notched, heart cleft, diamond hollow-symmetric.
 */
const PIP_SMALL: Record<Suit, string[]> = {
  spades: ["..#..", ".###.", "#####", "#####", "..#.."],
  hearts: ["#.#.#", "#####", "#####", ".###.", "..#.."],
  diamonds: ["..#..", ".###.", "#####", ".###.", "..#.."],
  clubs: [".###.", ".###.", "##.##", "#####", "..#.."],
};

/**
 * 7×7 — the pips printed across the face of a number card.
 *
 * Spade and club are the pair that has to be authored against each other; they
 * are both "black lump with a stem" and the first version of this table drew
 * two shapes that were indistinguishable on the table. What separates them
 * here is deliberate and structural:
 *
 *   · the SPADE has a one-pixel apex and a base that PINCHES in to its stem;
 *   · the CLUB has a three-pixel-wide top lobe and NOTCHES at row 2 where the
 *     three lobes meet, and its base does not pinch.
 *
 * Apex width and the presence of notches are the two features that survive at
 * this size. Overall silhouette does not.
 */
const PIP_BIG: Record<Suit, string[]> = {
  spades: ["...#...", "..###..", ".#####.", "#######", "#######", ".##.##.", "..###.."],
  hearts: [".##.##.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."],
  // A clean rhombus — the one pip that must NOT be confused with a spade.
  diamonds: ["...#...", "..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."],
  clubs: ["..###..", ".#####.", "##.#.##", "#######", "#######", "..###..", "..###.."],
};

/**
 * Where the pips go on a number card, as (column, row) in 0..1.
 *
 * The real layouts, not a grid dump: 7 puts its odd pip between the top pair,
 * 8 adds a second one low, 9 and 10 use four rows down each side. Getting these
 * right is most of what makes a card read as a card from across the table —
 * an evenly-spaced blob field reads as a domino.
 *
 * Pure and exported so the layouts can be pinned by a test: the count MUST
 * equal the rank, and a 9 that prints 8 pips is the sort of thing nobody
 * notices until it has been in the game for a month.
 */
export function pipLayout(rank: number): Array<[number, number]> {
  const L = 0;
  const C = 0.5;
  const R = 1;
  switch (rank) {
    case 2:
      return [[C, 0], [C, 1]];
    case 3:
      return [[C, 0], [C, 0.5], [C, 1]];
    case 4:
      return [[L, 0], [R, 0], [L, 1], [R, 1]];
    case 5:
      return [[L, 0], [R, 0], [C, 0.5], [L, 1], [R, 1]];
    case 6:
      return [[L, 0], [R, 0], [L, 0.5], [R, 0.5], [L, 1], [R, 1]];
    case 7:
      return [[L, 0], [R, 0], [C, 0.25], [L, 0.5], [R, 0.5], [L, 1], [R, 1]];
    case 8:
      return [[L, 0], [R, 0], [C, 0.25], [L, 0.5], [R, 0.5], [C, 0.75], [L, 1], [R, 1]];
    case 9:
      return [
        [L, 0], [R, 0],
        [L, 1 / 3], [R, 1 / 3],
        [C, 0.5],
        [L, 2 / 3], [R, 2 / 3],
        [L, 1], [R, 1],
      ];
    case 10:
      return [
        [L, 0], [R, 0],
        [C, 1 / 6],
        [L, 1 / 3], [R, 1 / 3],
        [L, 2 / 3], [R, 2 / 3],
        [C, 5 / 6],
        [L, 1], [R, 1],
      ];
    default:
      return [];
  }
}

// ── Court figures ────────────────────────────────────────────────────────────
// 20 wide × 18 tall, drawn once and MIRRORED about the card's waist — which is
// how real face cards are printed, and which conveniently means half the art
// buys a whole card.
//
// A portrait does not survive at 20 pixels wide; what does survive is a
// silhouette. So each rank is distinguished by its HEADGEAR (the widest, most
// contrasty band of the figure) rather than by a face: a pointed crown for the
// king, a rounded coronet for the queen, a feathered cap for the jack.
//
//   g = gold   G = gold highlight   w = skin   i = ink   r = suit colour
const COURT: Record<string, string[]> = {
  K: [
    ".....G...G...G......",
    ".....g.g.g.g.g......",
    ".....gggggggggg.....",
    ".....gGgggggggg.....",
    "......wwwwwwww......",
    "......wwwwwwww......",
    "......wiwwwwiw......",
    "......wwwwwwww......",
    "......wwiiiiww......",
    "......iwwwwwwi......",
    "......iiiiiiii......",
    ".....riiiiiiiir.....",
    "....rrrrrgirrrrr....",
    "...rrrrrrgirrrrrr...",
    "..rrrrrrrgirrrrrrr..",
    "..riiirrrgirrriiir..",
    "..rrrrrrrgirrrrrrr..",
    "..rrrrrrrgirrrrrrr..",
  ],
  Q: [
    "......G.G.G.G.......",
    ".....gggggggggg.....",
    ".....g.gGGGg.g......",
    ".....gggggggggg.....",
    ".....iwwwwwwwwi.....",
    ".....iwwwwwwwwi.....",
    ".....iwiwwwwiwi.....",
    ".....iwwwwwwwwi.....",
    ".....iwwwiiwwwi.....",
    ".....iiwwwwwwii.....",
    "......iiwwwwii......",
    "......rriiiirr......",
    "....rrrrrgGrrrrr....",
    "...rrrrrrgGrrrrrr...",
    "..rrrrrrrgGrrrrrrr..",
    "..rriirrrgGrrriirr..",
    "..rrrrrrrgGrrrrrrr..",
    "..rrrrrrrgGrrrrrrr..",
  ],
  J: [
    "..........G.........",
    ".........Gg.........",
    ".....iiiiigg........",
    "....iiiiiiiii.......",
    "....iiiiiiiiii......",
    "......wwwwwwww......",
    "......wiwwwwiw......",
    "......wwwwwwww......",
    "......wwwiiwww......",
    "......wwwwwwww......",
    ".......iiiiii.......",
    "......rriiiirr......",
    "....rrrrrgirrrrr....",
    "...rrrrrrgirrrrrr...",
    "..rrrrrrrgirrrrrrr..",
    "..rriirrrgirrriirr..",
    "..rrrrrrrgirrrrrrr..",
    "..rrrrrrrgirrrrrrr..",
  ],
};

const COURT_W = 20;
const COURT_H = 18;

// ── The pen ──────────────────────────────────────────────────────────────────

/**
 * A drawing surface for one card, in card-local coordinates, with optional
 * SHEAR.
 *
 * Every mark on a card goes through `rect`. When `lean` is non-zero each rect
 * is split into 1px scanlines and each line is nudged by a whole number of
 * pixels — so a tilted card is a stack of offset rows, which is exactly how a
 * pixel artist would draw one and is the only way to tilt anything here
 * without `ctx.rotate()` fringing every edge.
 */
interface Pen {
  rect(x: number, y: number, w: number, h: number, col: string): void;
  /** Stamp a '#'/'.' bitmap. `flip` rotates it 180° for the second index. */
  stamp(grid: string[], x: number, y: number, col: string, flip?: boolean, scale?: number): void;
}

/** Whole-pixel shear offset for a scanline. */
function shearAt(row: number, h: number, lean: number): number {
  if (!lean) return 0;
  return Math.round(lean * (row / Math.max(1, h - 1) - 0.5));
}

function makePen(ctx: CanvasRenderingContext2D, X: number, Y: number, h: number, lean: number): Pen {
  const rect = (x: number, y: number, w: number, rh: number, col: string): void => {
    if (w <= 0 || rh <= 0) return;
    ctx.fillStyle = col;
    if (!lean) {
      ctx.fillRect(X + x, Y + y, w, rh);
      return;
    }
    for (let r = 0; r < rh; r++) {
      const yy = y + r;
      ctx.fillRect(X + x + shearAt(yy, h, lean), Y + yy, w, 1);
    }
  };
  return {
    rect,
    stamp(grid, x, y, col, flip = false, scale = 1): void {
      const rows = grid.length;
      for (let gy = 0; gy < rows; gy++) {
        const line = grid[flip ? rows - 1 - gy : gy];
        // Horizontal RUNS, not per-cell fills. A pip is ~35 lit cells and a
        // court figure is ~400; a full table redrew something like 4000
        // one-pixel rects a frame before this, which is a lot of driver calls
        // for a 520×200 canvas. Runs cut it by roughly three quarters and the
        // output is pixel-identical.
        let run = 0;
        for (let gx = 0; gx <= line.length; gx++) {
          const ch = gx < line.length ? line[flip ? line.length - 1 - gx : gx] : ".";
          const on = ch !== "." && ch !== " ";
          if (on) {
            run++;
            continue;
          }
          if (run > 0) {
            rect(x + (gx - run) * scale, y + gy * scale, run * scale, scale, col);
            run = 0;
          }
        }
      }
    },
  };
}

/** Palette for a court bitmap's colour codes. */
function courtColour(ch: string, ink: string): string | null {
  switch (ch) {
    case "g":
      return GOLD;
    case "G":
      return GOLD_HI;
    case "w":
      return SKIN;
    case "i":
      return INK;
    case "r":
      return ink;
    default:
      return null;
  }
}

export interface CardDrawOpts {
  /** False draws the back — the dealer's hole card. */
  faceUp?: boolean;
  /**
   * Horizontal shear across the card's height, in whole pixels. A dealt card
   * that has skidded slightly sits at ±2; a card squared up sits at 0.
   */
  lean?: number;
  /**
   * Width fraction, 0..1, for the hole-card FLIP. Below ~0.3 the card is drawn
   * as an edge-on slab — there is no room for any face at that width, and
   * squashing the art instead is what makes a flip look like a stretch.
   */
  squeeze?: number;
  /** Hard offset drop shadow. Off for a card mid-flight. */
  shadow?: boolean;
  /** A 1px highlight ring — used to mark a bust hand or a winning hand. */
  outline?: string | null;
}

/**
 * Draw a card with its top-left at (x, y).
 *
 * The whole card, shadow included, is rendered through one `Pen` so a leaning
 * card leans as a single object.
 */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  card: Card | null,
  x: number,
  y: number,
  size: CardSize,
  opts: CardDrawOpts = {},
): void {
  const { faceUp = true, lean = 0, squeeze = 1, shadow = true, outline = null } = opts;
  const h = size.h;
  const X = Math.round(x);
  const Y = Math.round(y);

  // The flip squashes the card about its own centre line.
  const fullW = size.w;
  const w = Math.max(2, Math.round(fullW * Math.max(0, Math.min(1, squeeze))));
  const inset = Math.round((fullW - w) / 2);
  const pen = makePen(ctx, X + inset, Y, h, lean);

  // ── Drop shadow ── a hard offset copy of the silhouette. Two pixels right and
  // three down: enough to lift the card off the felt, small enough that a fan
  // of cards doesn't turn into a dark smear.
  if (shadow) {
    const sp = makePen(ctx, X + inset + 2, Y + 3, h, lean);
    silhouette(sp, w, h, SHADOW);
  }

  // ── Body ──
  const body = faceUp ? FACE : BACK;
  silhouette(pen, w, h, body);

  // Edge: a cool line all the way round, with a warm lit top and a cool dark
  // bottom. Three tones is all it takes to make flat stock look like stock.
  const edge = faceUp ? FACE_EDGE : BACK_LO;
  outlineSilhouette(pen, w, h, edge);
  pen.rect(2, 1, w - 4, 1, faceUp ? FACE_HI : BACK_LINE);
  pen.rect(2, h - 2, w - 4, 1, faceUp ? FACE_LO : BACK_LO);

  // Edge-on during a flip: no room for anything else, so stop here with a
  // bright lip so the card still reads as a solid object turning over.
  if (w < Math.max(6, fullW * 0.3)) {
    pen.rect(0, 2, 1, h - 4, FACE_HI);
    if (outline) outlineSilhouette(pen, w, h, outline);
    return;
  }

  if (!faceUp || !card) {
    drawBack(pen, w, h);
    if (outline) outlineSilhouette(pen, w, h, outline);
    return;
  }

  const red = RED_SUITS.includes(card.suit);
  const ink = red ? RED : INK;
  const inkLo = red ? RED_LO : INK_SOFT;
  const label = rankLabel(card.rank);
  const glyph = RANK_GLYPHS[label] ?? RANK_GLYPHS.A;

  // ── Inner border ── an inset hairline, the way a printed card has one. Drawn
  // in a mid tone rather than the ink so it frames without competing with the
  // pips.
  outlineRect(pen, 2, 2, w - 4, h - 4, FACE_INSET);

  // ── Corner indices ── rank over pip, top-left and bottom-right ROTATED. The
  // rotated one is the detail that makes a hand of overlapping cards readable,
  // and it is why the ranks are bitmaps instead of text.
  const idxW = glyph[0].length;
  const gh = glyph.length;
  pen.stamp(glyph, 3, 4, ink);
  pen.stamp(PIP_SMALL[card.suit], 3, 4 + gh + 1, ink);
  pen.stamp(glyph, w - 3 - idxW, h - 4 - gh, ink, true);
  pen.stamp(PIP_SMALL[card.suit], w - 3 - 5, h - 5 - gh - 5, ink, true);

  // ── The face ──
  if (card.rank >= 11 && card.rank <= 13) {
    drawCourt(pen, w, h, label, ink, inkLo);
  } else if (card.rank === 1) {
    // The ace gets one oversized pip, centred. A 2× stamp of the same 7×7 art
    // rather than a separate drawing, so the suit can never disagree with
    // itself between the corner and the middle.
    const s = 2;
    const px = Math.round((w - 7 * s) / 2);
    const py = Math.round((h - 7 * s) / 2);
    pen.stamp(PIP_BIG[card.suit], px + 1, py + 1, inkLo);
    pen.stamp(PIP_BIG[card.suit], px, py, ink, false, s);
  } else {
    drawPips(pen, w, h, card.rank, card.suit, ink, inkLo);
  }

  if (outline) outlineSilhouette(pen, w, h, outline);
}

/**
 * The card's filled shape, with corners cut by a pixel staircase.
 *
 * Three steps of 3/2/1 pixels. A real radius would anti-alias; a single-pixel
 * notch (the previous version) is too subtle to read as rounded at all.
 */
function silhouette(pen: Pen, w: number, h: number, col: string): void {
  const cut = [3, 2, 1];
  for (let i = 0; i < cut.length; i++) {
    pen.rect(cut[i], i, w - cut[i] * 2, 1, col);
    pen.rect(cut[i], h - 1 - i, w - cut[i] * 2, 1, col);
  }
  pen.rect(0, cut.length, w, h - cut.length * 2, col);
}

/** A 1px outline that follows the staircased silhouette. */
function outlineSilhouette(pen: Pen, w: number, h: number, col: string): void {
  const cut = [3, 2, 1];
  for (let i = 0; i < cut.length; i++) {
    pen.rect(cut[i], i, w - cut[i] * 2, 1, col);
    pen.rect(cut[i], h - 1 - i, w - cut[i] * 2, 1, col);
    // The vertical part of each step.
    const step = cut[i] - (cut[i + 1] ?? 0);
    if (i < cut.length - 1) {
      pen.rect(cut[i + 1], i + 1, step, 1, col);
      pen.rect(w - cut[i + 1] - step, i + 1, step, 1, col);
      pen.rect(cut[i + 1], h - 2 - i, step, 1, col);
      pen.rect(w - cut[i + 1] - step, h - 2 - i, step, 1, col);
    }
  }
  pen.rect(0, cut.length, 1, h - cut.length * 2, col);
  pen.rect(w - 1, cut.length, 1, h - cut.length * 2, col);
}

/** A 1px rectangular outline as four fills — `strokeRect` would straddle. */
function outlineRect(pen: Pen, x: number, y: number, w: number, h: number, col: string): void {
  pen.rect(x, y, w, 1, col);
  pen.rect(x, y + h - 1, w, 1, col);
  pen.rect(x, y, 1, h, col);
  pen.rect(x + w - 1, y, 1, h, col);
}

/**
 * The back pattern — a diagonal lattice inside a double border.
 *
 * Diagonal specifically: the face of a card is all verticals and horizontals,
 * so a diagonal back is distinguishable from a face at a glance even when the
 * card is half-covered, which is the whole job of a hole card.
 */
function drawBack(pen: Pen, w: number, h: number): void {
  outlineRect(pen, 2, 2, w - 4, h - 4, BACK_LINE);
  outlineRect(pen, 4, 4, w - 8, h - 8, BACK_LO);
  for (let py = 5; py < h - 5; py++) {
    for (let px = 5; px < w - 5; px++) {
      const a = (px + py) % 6 === 0;
      const b = (px - py + 60) % 6 === 0;
      if (a && b) pen.rect(px, py, 1, 1, BACK_HI);
      else if (a || b) pen.rect(px, py, 1, 1, BACK_LINE);
    }
  }
  // A centre lozenge, so the back has a focus instead of being pure texture.
  const cy = Math.round(h / 2);
  const cx = Math.round(w / 2);
  for (let i = 0; i < 6; i++) {
    pen.rect(cx - i, cy - 5 + i, i * 2 + 1, 1, i === 5 ? BACK_HI : BACK_LINE);
    pen.rect(cx - i, cy + 5 - i, i * 2 + 1, 1, i === 5 ? BACK_HI : BACK_LINE);
  }
}

/** The printed pip field of a number card. */
function drawPips(pen: Pen, w: number, h: number, rank: number, suit: Suit, ink: string, inkLo: string): void {
  // 9s and 10s get the SMALL pip. Their layouts pack four rows down each side
  // plus one or two in the middle, and at 7px a pip those rows overlap by two
  // pixels each — the nine and the ten came out as two solid columns of ink
  // with no countable pips in them at all. Dropping to 5px is what makes them
  // countable, and a slightly smaller pip on the busiest cards is what a real
  // deck does too.
  const small = rank >= 9;
  const art = small ? PIP_SMALL[suit] : PIP_BIG[suit];
  const pipW = small ? 5 : 7;
  // The pip field clears the corner indices horizontally — the index block runs
  // to x=7, so the left column starts at 8 and the field is mirrored for the
  // rotated index at the other end.
  const left = 8;
  const right = w - 8 - pipW;
  const top = 6;
  const bottom = h - 6 - pipW;

  for (const [cx, ry] of pipLayout(rank)) {
    const px = Math.round(left + (right - left) * cx);
    const py = Math.round(top + (bottom - top) * ry);
    // Pips below the waist print upside down, as they do on a real card.
    const flip = ry > 0.5;
    // A 1px cool offset behind each pip. Not a blur — one hard displaced copy,
    // which at this size reads as ink sitting on stock.
    pen.stamp(art, px + 1, py + 1, inkLo, flip);
    pen.stamp(art, px, py, ink, flip);
  }
}

/** A court card: a framed panel with a two-headed figure mirrored at the waist. */
function drawCourt(pen: Pen, w: number, h: number, label: string, ink: string, inkLo: string): void {
  const art = COURT[label] ?? COURT.J;
  const px = Math.round((w - COURT_W) / 2);
  const waist = Math.round(h / 2);
  const top = waist - COURT_H;

  // Panel behind the figure, so the court cards read as denser than the number
  // cards — which is what they are.
  pen.rect(px - 2, top - 1, COURT_W + 4, COURT_H * 2 + 2, FACE_HI);
  outlineRect(pen, px - 2, top - 1, COURT_W + 4, COURT_H * 2 + 2, FACE_INSET);

  // Runs of one colour become one fill — a court figure is ~400 lit cells and
  // it is drawn twice per card.
  const paint = (yOff: number, flip: boolean): void => {
    for (let gy = 0; gy < COURT_H; gy++) {
      const line = art[flip ? COURT_H - 1 - gy : gy];
      let run = 0;
      let runCol: string | null = null;
      for (let gx = 0; gx <= line.length; gx++) {
        const ch = gx < line.length ? line[flip ? line.length - 1 - gx : gx] : ".";
        const col = courtColour(ch, ink);
        if (col === runCol) {
          if (col) run++;
          continue;
        }
        if (runCol && run > 0) pen.rect(px + gx - run, yOff + gy, run, 1, runCol);
        runCol = col;
        run = col ? 1 : 0;
      }
    }
  };
  paint(top, false);
  paint(waist, true);

  // The waist line itself — a real face card has one, and without it the two
  // mirrored halves read as one confusing symmetrical creature.
  pen.rect(px - 2, waist - 1, COURT_W + 4, 1, inkLo);
  pen.rect(px - 2, waist, COURT_W + 4, 1, FACE_LO);
}

/** Suits that have hand-drawn pips — used by the art coverage test. */
export function paintedSuits(): Suit[] {
  return Object.keys(PIP_BIG) as Suit[];
}

/** Ranks that have a hand-drawn index glyph — used by the art coverage test. */
export function paintedRanks(): string[] {
  return Object.keys(RANK_GLYPHS);
}
