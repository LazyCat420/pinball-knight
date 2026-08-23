/**
 * THE TABLE FURNITURE — chips, the betting circle, the shoe, the chip rack.
 *
 * Split out of `blackjack-game.ts` because two things in here are actually pure
 * and worth pinning with tests: the chip DENOMINATION breakdown (a bet drawn as
 * the wrong colours is a lie about how much is on the table) and the circle
 * RASTERISER.
 *
 * ── The circle ──────────────────────────────────────────────────────────────
 * The betting circle is the only genuinely curved thing on this canvas, and
 * `arc()` is unavailable: Canvas 2D anti-aliases path geometry and there is no
 * flag to turn it off, so an `arc()` here would be the one soft, fringed shape
 * on a table of hard pixels. It is therefore rasterised by hand with the
 * midpoint circle algorithm and drawn as 1×1 fills, which is exactly how the
 * curve would be drawn in an actual pixel editor.
 *
 * The points come back sorted by angle so the caller can dash around the
 * perimeter and get a STITCHED circle — the painted-then-stitched inlay a real
 * felt betting spot has. Dashing an unsorted point set produces a random
 * speckle, which was the first thing that went wrong here.
 */

// ── Chips ────────────────────────────────────────────────────────────────────

export interface ChipInk {
  /** Denomination in gold. */
  value: number;
  /** Top face. */
  base: string;
  /** Lit top edge — warmer than base. */
  hi: string;
  /** The chip's side, in shadow — cooler than base. */
  lo: string;
  /** The edge spots. */
  spot: string;
}

/**
 * Casino colours, largest first.
 *
 * Real denominations on purpose (white 1 / red 5 / blue 10 / green 25 /
 * black 100): a player who has ever seen a chip reads the value off the colour
 * without being told, which is the entire reason the bet is drawn as chips
 * rather than as a number.
 *
 * Each ramp is hue-rotated, not lightness-only — every `lo` is pushed toward
 * blue and every `hi` toward yellow. A red chip shaded with darker red and
 * lighter red looks like a flat red circle.
 */
export const CHIP_INKS: ChipInk[] = [
  { value: 100, base: "#23252e", hi: "#4a4a52", lo: "#101219", spot: "#d9c47a" },
  { value: 25, base: "#1f7a48", hi: "#48b06e", lo: "#0d3a29", spot: "#e8f0d8" },
  { value: 10, base: "#2a4f96", hi: "#5a83c8", lo: "#152a58", spot: "#e0e6f4" },
  { value: 5, base: "#a32a35", hi: "#d85a52", lo: "#5a1626", spot: "#f0dcc8" },
  { value: 1, base: "#c9c0aa", hi: "#f0e8d0", lo: "#7a7466", spot: "#8a3540" },
];

/** Chips a stack can show before it stops being legible. */
export const MAX_STACK = 8;

/**
 * Break `amount` into chip denominations, largest first.
 *
 * Greedy, which is exact for this denomination set. If the greedy answer needs
 * more than `cap` chips the SMALLEST ones are dropped rather than the largest —
 * the stack is a visual impression of the bet, and losing the 1g chips off a
 * 137g bet misrepresents it far less than losing the 100.
 *
 * Returns denominations, not counts, because the caller draws one chip per
 * entry and the order it draws them in is the order they stack.
 */
export function chipStack(amount: number, cap = MAX_STACK): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(amount));
  for (const ink of CHIP_INKS) {
    while (left >= ink.value) {
      out.push(ink.value);
      left -= ink.value;
    }
  }
  return out.slice(0, cap);
}

/** The ink for a denomination, or the 1g chip if it isn't one we mint. */
export function chipInk(value: number): ChipInk {
  return CHIP_INKS.find((c) => c.value === value) ?? CHIP_INKS[CHIP_INKS.length - 1];
}

/**
 * Per-row half-widths of a chip's top face, top row first.
 *
 * A hand-authored 5-row ellipse rather than a rasterised one. At 13×5 a real
 * ellipse equation rounds to something lumpy and asymmetric; five numbers
 * chosen by eye read as a disc seen at a shallow angle, which is what a chip on
 * a table actually looks like.
 */
const CHIP_ROWS = [4, 7, 8, 7, 4];
export const CHIP_W = 17;
/** Vertical pitch in a stack — how much of each chip's edge shows below it. */
export const CHIP_PITCH = 3;

/**
 * Draw one chip, centred on `cx`, with the TOP of its face at `yTop`.
 *
 * The side of the chip is drawn first and one pixel taller than the pitch, so a
 * stacked chip occludes the one below it and the stack reads as solid rather
 * than as a column of floating lozenges.
 */
export function drawChip(ctx: CanvasRenderingContext2D, cx: number, yTop: number, value: number): void {
  const ink = chipInk(value);
  const X = Math.round(cx);
  const Y = Math.round(yTop);

  // A hard dark contact shadow one row wider than the chip. Green chips on
  // green felt vanished without it — the first stack drawn here read as a
  // smudge rather than as money.
  for (let i = 0; i < CHIP_ROWS.length; i++) {
    const half = CHIP_ROWS[i];
    ctx.fillStyle = "#0a2418";
    ctx.fillRect(X - half - 1, Y + i + CHIP_PITCH + 1, half * 2 + 3, 1);
  }

  // The side, in shadow.
  for (let i = 0; i < CHIP_ROWS.length; i++) {
    const half = CHIP_ROWS[i];
    ctx.fillStyle = ink.lo;
    ctx.fillRect(X - half, Y + i + CHIP_PITCH, half * 2 + 1, 1);
  }

  // The top face.
  for (let i = 0; i < CHIP_ROWS.length; i++) {
    const half = CHIP_ROWS[i];
    ctx.fillStyle = i === 0 ? ink.hi : i === CHIP_ROWS.length - 1 ? ink.lo : ink.base;
    ctx.fillRect(X - half, Y + i, half * 2 + 1, 1);
  }
  // Lit front-top edge.
  ctx.fillStyle = ink.hi;
  ctx.fillRect(X - CHIP_ROWS[1], Y + 1, CHIP_ROWS[1] * 2 + 1, 1);

  // Edge spots — the dashes round a real chip's rim, at the three positions
  // that survive at this width.
  ctx.fillStyle = ink.spot;
  ctx.fillRect(X - 8, Y + 2, 3, 1);
  ctx.fillRect(X + 6, Y + 2, 3, 1);
  ctx.fillRect(X - 2, Y, 4, 1);
}

/**
 * Draw a stack of chips for `amount`, growing UPWARD from `yBase`.
 *
 * Bottom-up, so the largest denomination — pushed first — ends up at the
 * bottom of the pile, which is how a dealer stacks them.
 */
export function drawChipStack(ctx: CanvasRenderingContext2D, cx: number, yBase: number, amount: number): void {
  const stack = chipStack(amount);
  for (let i = 0; i < stack.length; i++) {
    drawChip(ctx, cx, yBase - i * CHIP_PITCH - CHIP_ROWS.length, stack[i]);
  }
}

// ── The betting circle ───────────────────────────────────────────────────────

/**
 * Midpoint circle rasterisation, returned as offsets sorted by angle.
 *
 * Sorted because the caller dashes along the perimeter to get the stitched
 * look; an unsorted point set dashes into speckle. Deduped because the eight-
 * way symmetry emits the diagonal points twice, and a doubled point in a dash
 * pattern shows up as a visible hiccup in the stitching.
 *
 * Pure and exported so a test can pin it: no duplicates, a plausible point
 * count, and every point actually on the circle.
 */
export function circleOutline(r: number): Array<[number, number]> {
  const seen = new Set<string>();
  const pts: Array<[number, number]> = [];
  const put = (x: number, y: number): void => {
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    pts.push([x, y]);
  };

  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    put(x, y);
    put(y, x);
    put(-y, x);
    put(-x, y);
    put(-x, -y);
    put(-y, -x);
    put(y, -x);
    put(x, -y);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }

  pts.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  return pts;
}

/**
 * The betting spot: a painted ring with a stitched ring just outside it.
 *
 * Two radii rather than one thick line — a felt betting circle is a painted
 * band with the stitching sitting proud of it, and drawing only the band makes
 * the spot look printed on rather than sewn in.
 */
export function drawBettingCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  paint: string,
  stitch: string,
): void {
  const X = Math.round(cx);
  const Y = Math.round(cy);

  ctx.fillStyle = paint;
  for (const [dx, dy] of circleOutline(r)) ctx.fillRect(X + dx, Y + dy, 1, 1);

  // Stitching: two pixels on, three off, around a slightly larger circle.
  const outer = circleOutline(r + 3);
  ctx.fillStyle = stitch;
  outer.forEach(([dx, dy], i) => {
    if (i % 5 >= 2) return;
    ctx.fillRect(X + dx, Y + dy, 1, 1);
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * THE SHOE — the box the cards come out of, top-left.
 *
 * Worth drawing because the dealing animation slides cards out of it: a card
 * that flies in from an empty corner reads as a glitch, and the same card
 * coming out of a shoe reads as a deal. The angled front lip is a pixel
 * staircase, since that is the only way to get a diagonal here.
 */
export function drawShoe(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  const box = (bx: number, by: number, bw: number, bh: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(X + bx, Y + by, bw, bh);
  };

  // Body — dark lacquered wood, lit on the top and left.
  box(0, 0, w, h, "#3a2a1e");
  box(0, 0, w, 2, "#6b5236");
  box(0, 0, 2, h, "#5a4530");
  box(0, h - 2, w, 2, "#1c1410");
  box(w - 2, 0, 2, h, "#241a12");

  // The mouth: a dark slot with a pale card edge showing, so the shoe is
  // visibly LOADED. An empty shoe beside a table mid-hand looks broken.
  box(3, 5, w - 6, h - 12, "#120c09");
  box(4, 6, w - 8, h - 15, "#d8cfba");
  box(4, 6, w - 8, 1, "#fffaef");
  for (let i = 8; i < h - 10; i += 3) box(4, i, w - 8, 1, "#9a9280");

  // The angled delivery lip along the bottom — a three-step staircase.
  for (let i = 0; i < 3; i++) {
    box(2 + i, h - 5 + i, w - 4 - i * 2, 1, i === 0 ? "#8a6c46" : "#4a3624");
  }

  // A brass rivet each side. Small, warm, and the only saturated thing on the
  // fixture — it gives the eye somewhere to land.
  box(2, 3, 2, 2, "#c8a04a");
  box(w - 4, 3, 2, 2, "#c8a04a");
}

/**
 * THE CHIP RACK — the dealer's tray, with rows of chips in it.
 *
 * Static furniture. Its job is to say "this is a table with a bank behind it"
 * rather than to track anything; the player's own money is the stack in the
 * betting circle.
 */
export function drawChipTray(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  const box = (bx: number, by: number, bw: number, bh: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.fillRect(X + bx, Y + by, bw, bh);
  };

  box(0, 0, w, h, "#2a2018");
  box(0, 0, w, 1, "#5e4a32");
  box(0, h - 2, w, 2, "#150f0b");
  box(0, 0, 1, h, "#4a3a28");
  box(w - 1, 0, 1, h, "#180f0a");

  // Four grooves of chips seen edge-on: each groove is a stack of 1px bands in
  // one denomination's colours, which at this size is all a rack of chips is.
  const denoms = [100, 25, 10, 5];
  const grooveW = Math.floor((w - 6) / denoms.length);
  denoms.forEach((v, i) => {
    const ink = chipInk(v);
    const gx = 3 + i * grooveW;
    box(gx, 3, grooveW - 2, h - 7, "#0e0a07");
    for (let row = 0; row < Math.floor((h - 9) / 2); row++) {
      box(gx + 1, 4 + row * 2, grooveW - 4, 1, ink.base);
      box(gx + 1, 5 + row * 2, grooveW - 4, 1, ink.lo);
    }
    // Top chip catches the light.
    box(gx + 1, 4, grooveW - 4, 1, ink.hi);
  });
}
