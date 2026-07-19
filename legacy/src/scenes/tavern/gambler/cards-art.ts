/**
 * Pixel playing cards. There were none anywhere in this repo, so all of it is new.
 *
 * Ranks use Press Start 2P — legitimately, because the font actually HAS digits
 * and A/J/Q/K. (The slot symbols had to be hand-drawn precisely because the font
 * does NOT have ●◉⌒◆★☠ and silently fell back to a smooth system face.)
 *
 * Suit pips ARE hand-drawn, on an 8×8 grid: a heart or a club rendered from a
 * font would be a smooth glyph in a pixel game, and at this size the shapes have
 * to be authored cell by cell to read at all.
 *
 * Face cards get a crown rather than portrait art. A court figure does not
 * survive at 30 pixels wide — it turns into noise — and a crown reads instantly
 * as "this one's a face card", which is the only information needed.
 */
import { RED_SUITS, rankLabel, type Card, type Suit } from "./blackjack";

/** Pips are authored on this grid. */
const PIP_GRID = 8;

type PipPainter = (px: (x: number, y: number, w?: number, h?: number) => void) => void;

const PIPS: Record<Suit, PipPainter> = {
  // ♠ Spade: a rounded point over a stem.
  spades: (px) => {
    px(3, 0, 2, 1);
    px(2, 1, 4, 1);
    px(1, 2, 6, 2);
    px(0, 4, 8, 1);
    px(1, 5, 6, 1);
    px(3, 5, 2, 3); // stem
  },
  // ♥ Heart: two lobes over a point.
  hearts: (px) => {
    px(1, 1, 2, 1);
    px(5, 1, 2, 1);
    px(0, 2, 8, 2);
    px(1, 4, 6, 1);
    px(2, 5, 4, 1);
    px(3, 6, 2, 1);
    px(3, 7, 2, 1);
  },
  // ♦ Diamond: a simple rhombus.
  diamonds: (px) => {
    px(3, 0, 2, 1);
    px(2, 1, 4, 1);
    px(1, 2, 6, 2);
    px(2, 4, 4, 1);
    px(3, 5, 2, 1);
    px(3, 6, 2, 1);
  },
  // ♣ Club: three lobes and a stem.
  clubs: (px) => {
    px(3, 0, 2, 2);
    px(1, 2, 2, 2);
    px(5, 2, 2, 2);
    px(3, 2, 2, 2);
    px(2, 4, 4, 1);
    px(3, 5, 2, 3); // stem
  },
};

/** A crown, for face cards. */
function crown(px: (x: number, y: number, w?: number, h?: number) => void): void {
  px(0, 3, 8, 3); // band
  px(0, 0, 1, 3);
  px(3, 1, 2, 2);
  px(7, 0, 1, 3);
  px(1, 2, 2, 1);
  px(5, 2, 2, 1);
}

const FACE = "#e8e2d0";
const FACE_EDGE = "#9a917c";
const BACK = "#2a2440";
const BACK_LINE = "#4a4270";
const INK = "#15100c";
const RED = "#a8323c";

export interface CardSize {
  w: number;
  h: number;
}

/** Sensible card size for a given height, at a whole-pixel aspect. */
export function cardSize(h: number): CardSize {
  return { w: Math.round(h * 0.7), h };
}

/**
 * Draw a card with its top-left at (x, y).
 *
 * `faceUp: false` draws the back — needed for the dealer's hole card, which is
 * the whole tension of the hand.
 */
export function drawCard(ctx: CanvasRenderingContext2D, card: Card | null, x: number, y: number, size: CardSize, faceUp = true): void {
  const { w, h } = size;
  const X = Math.round(x);
  const Y = Math.round(y);

  // Body. Corners are notched by a single pixel rather than rounded — a real
  // radius would anti-alias, which is the one thing this style can't have.
  ctx.fillStyle = faceUp ? FACE : BACK;
  ctx.fillRect(X + 1, Y, w - 2, h);
  ctx.fillRect(X, Y + 1, w, h - 2);

  ctx.fillStyle = faceUp ? FACE_EDGE : BACK_LINE;
  ctx.fillRect(X + 1, Y, w - 2, 1);
  ctx.fillRect(X + 1, Y + h - 1, w - 2, 1);
  ctx.fillRect(X, Y + 1, 1, h - 2);
  ctx.fillRect(X + w - 1, Y + 1, 1, h - 2);

  if (!faceUp || !card) {
    // Back pattern: a simple lattice, chunky enough to survive the scale.
    ctx.fillStyle = BACK_LINE;
    for (let py = 3; py < h - 3; py += 4) {
      for (let pxx = 3; pxx < w - 3; pxx += 4) ctx.fillRect(X + pxx, Y + py, 2, 2);
    }
    return;
  }

  const red = RED_SUITS.includes(card.suit);
  const ink = red ? RED : INK;

  // Rank, top-left.
  ctx.fillStyle = ink;
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(rankLabel(card.rank), X + 3, Y + 3);

  // Centre motif: a crown for faces, otherwise the suit pip, scaled to the card.
  const scale = Math.max(1, Math.floor(Math.min(w / 14, h / 20)) + 1);
  const artW = PIP_GRID * scale;
  const ox = X + Math.round((w - artW) / 2);
  const oy = Y + Math.round((h - artW) / 2) + 2;
  const px = (gx: number, gy: number, gw = 1, gh = 1): void => {
    ctx.fillRect(ox + gx * scale, oy + gy * scale, gw * scale, gh * scale);
  };

  ctx.fillStyle = ink;
  if (card.rank >= 11 && card.rank <= 13) {
    crown(px);
    // A small pip beside the crown, so suit is still readable on a face card.
    const sx = X + w - 3 - PIP_GRID;
    const sy = Y + h - 3 - PIP_GRID;
    const spx = (gx: number, gy: number, gw = 1, gh = 1): void => ctx.fillRect(sx + gx, sy + gy, gw, gh);
    PIPS[card.suit](spx);
  } else {
    PIPS[card.suit](px);
  }
}

/** Suits that have hand-drawn pips — used by the art coverage test. */
export function paintedSuits(): Suit[] {
  return Object.keys(PIPS) as Suit[];
}
