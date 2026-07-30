/**
 * SLICING — a matted sheet into rows of cells.
 *
 * Extracted verbatim from `render/sprite-ingest.test.ts`, where it lived inside
 * the vitest file and therefore could only ever run in node. The browser refiner
 * (`/sprites`) needs the same code, and a re-implementation would drift the first
 * time a threshold moved — the same reasoning that killed the Python importer's
 * private copy of the palette.
 *
 * Everything here is pure: `Uint8ClampedArray` in, plain coordinates out. No
 * canvas, no filesystem, no DOM. That is what lets it run in vitest AND in the
 * browser without a shim.
 *
 * ⚠️ THIS FINDS CELLS BY ALPHA. It assumes matting already happened — see
 * `matte.ts`. Handed a sheet on an opaque background it returns ONE cell, which
 * is what the caller's guard is for.
 */

/** Transparent columns/rows narrower than this do not separate two cells. */
export const MIN_GAP = 6;
/** A run of opaque pixels smaller than this is a smudge, not a pose. */
export const MIN_CELL = 12;

/**
 * A row or column this full of opaque pixels is a RULED GRID LINE, not art.
 *
 * Real sheets are drawn with cell borders. They are opaque, so a naive
 * alpha-slice sees the whole sheet as ONE connected region and returns a single
 * cell — which is why this exists rather than being defensive programming.
 * Art never spans a whole sheet dimension; a ruled line always does.
 *
 * ⚠️ THE SECOND SENTENCE IS FALSE AS APPLIED, and it is the bug. Measured on
 * `fixtures.ts` (see slice.test.ts):
 *
 *   · FILL IS NOT ENOUGH — a rule is also THIN. A figure's own solid core is a
 *     column of opaque pixels spanning the whole band, so this test erases it.
 *     On an unruled sheet, 176 of 176 opaque columns were stripped: the figures
 *     vanished and the sheet sliced to NOTHING. The shipped comments blame the
 *     art for "splitting inside a figure wherever a pose leaves a transparent
 *     column"; the slicer manufactures that column itself.
 *
 *   · THE DENOMINATOR IS WRONG — fill is measured against the SHEET width, but
 *     a ragged sheet's short rows are nowhere near it. A 4-cell row inside a
 *     6-cell sheet fills 56%, so its borders survive and weld the row into one
 *     cell. That is the documented "1/6/1/1/1", and it reproduces exactly.
 *
 * Requiring a rule to be tall AND ≤3px wide, and measuring fill against the
 * row's own extent, slices the unruled fixture to exactly 4/6/4/2/3. `grid.ts`
 * carries that fix; this constant is left as-is so the characterisation tests
 * keep describing what shipped.
 */
export const RULE_FILL = 0.7;

/**
 * Bands shorter than this fraction of the median band are CAPTIONS.
 *
 * Sheets label their rows ("IDLE", "SPRING ATTACK", "DEATH"). The lettering
 * sits on the background between rows, so it slices as its own short band and
 * would otherwise be imported as a pose. A caption is an order of magnitude
 * shorter than a figure; 0.25 separates them with room to spare.
 *
 * ⚠️ THIS ONLY CATCHES CAPTIONS THAT SIT IN THEIR OWN BAND — i.e. above or below
 * a row. A caption in a LEFT GUTTER shares the row's band, so its height is the
 * row's height and this test never sees it; it then survives the width filter in
 * `sliceSheet` (a 6-letter word is well over a quarter of a cell) and imports as
 * a frame. Gutter labels have to be stripped before ingest, or declared as a
 * left margin in the recipe.
 */
export const CAPTION_RATIO = 0.25;

/** One cell, as `[x0, y0, x1, y1]` inclusive. */
export type Cell = [number, number, number, number];

export interface SheetRow {
  cells: Cell[];
}

/** Contiguous true runs, merging gaps under MIN_GAP and dropping tiny runs. */
export function bands(profile: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i]) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0 && ++gap > MIN_GAP) {
      if (i - gap - start >= MIN_CELL) out.push([start, i - gap]);
      start = -1;
    }
  }
  if (start >= 0 && profile.length - start >= MIN_CELL) out.push([start, profile.length - 1]);
  return out;
}

/**
 * Slice a sheet into ROWS of cells, discarding ruled grid lines and captions.
 *
 * Returns rows rather than a flat list because real sheets are ragged — one
 * observed sheet runs 4 / 6 / 4 / 2 / 3 across its five clips, and a row that
 * does not start at column 1. Flattening first would make "which frame belongs
 * to which clip" unrecoverable.
 */
export function sliceSheet(data: Uint8ClampedArray, w: number, h: number): SheetRow[] {
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] > 8 ? 1 : 0;

  // ── Strip ruled lines. A full-width row or full-height column of opaque
  // pixels is a border; art never spans the sheet.
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += solid[y * w + x];
    if (n >= w * RULE_FILL) for (let x = 0; x < w; x++) solid[y * w + x] = 0;
  }
  // ⚠️ VERTICAL RULES ARE STRIPPED PER-BAND, NOT SHEET-WIDE, and that is the
  // whole difference between this working and not. A cell border is only as
  // tall as ITS ROW, so against the full sheet height a 5-row sheet's border
  // fills about 18% — nowhere near any sensible threshold — and survives. It
  // then bridges the gap between neighbouring cells and the entire row slices as
  // ONE frame. Measured on a fixture with ruled cells: sheet-wide stripping gave
  // rows of 1/6/1/1/1 where the truth was 4/6/4/2/3.

  const at = (x: number, y: number): boolean => solid[y * w + x] === 1;
  const rowProfile: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let any = false;
    for (let x = 0; x < w && !any; x++) any = at(x, y);
    rowProfile.push(any);
  }

  // ── Drop caption bands, by height against the median band.
  const raw = bands(rowProfile);
  const heights = raw.map(([a, b]) => b - a + 1).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  const keep = raw.filter(([a, b]) => b - a + 1 >= median * CAPTION_RATIO);

  const out: SheetRow[] = [];
  for (const [y0, y1] of keep) {
    const bandH = y1 - y0 + 1;
    // Band-local copy with rules stripped on BOTH axes. A cell's top and bottom
    // edges span its full width, so leaving them in makes every column look like
    // content and welds the row back together.
    const band = new Uint8Array(w * bandH);
    for (let y = 0; y < bandH; y++) for (let x = 0; x < w; x++) band[y * w + x] = at(x, y0 + y) ? 1 : 0;
    for (let y = 0; y < bandH; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) n += band[y * w + x];
      if (n >= w * RULE_FILL) for (let x = 0; x < w; x++) band[y * w + x] = 0;
    }
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = 0; y < bandH; y++) n += band[y * w + x];
      if (n >= bandH * RULE_FILL) for (let y = 0; y < bandH; y++) band[y * w + x] = 0;
    }
    const inBand = (x: number, y: number): boolean => band[(y - y0) * w + x] === 1;
    const colProfile: boolean[] = [];
    for (let x = 0; x < w; x++) {
      let any = false;
      for (let y = y0; y <= y1 && !any; y++) any = inBand(x, y);
      colProfile.push(any);
    }
    const cells: [number, number, number, number, number][] = [];
    for (const [x0, x1] of bands(colProfile)) {
      // Tighten vertically to this cell's own ink — the band is the union
      // across the row, and a crouched pose is shorter than its neighbours.
      let ty = y1, by = y0, mass = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!inBand(x, y)) continue;
          mass++;
          ty = Math.min(ty, y);
          by = Math.max(by, y);
        }
      }
      if (by >= ty) cells.push([x0, ty, x1, by, mass]);
    }
    // Reject FRAGMENTS by WIDTH against the row's median cell.
    //
    // Mass is the wrong test and was tried first: a leftover ruled border is
    // long, so it carries real mass (a 2x260 edge is 520 px) and survived a 2%
    // threshold, then crushed to 8 texels and tripped the empty-cell guard.
    // Width is the discriminator — a border remnant is a couple of pixels wide
    // where a pose is a couple of hundred — and it stays correct for a small
    // pose, which a mass test does not: a death sprawl is legitimately light.
    const widths = cells.map((c) => c[2] - c[0] + 1).sort((a, b) => a - b);
    const medianW = widths[Math.floor(widths.length / 2)];
    const real = cells
      .filter((c) => c[2] - c[0] + 1 >= medianW * 0.25 && c[4] > 0)
      .map((c) => [c[0], c[1], c[2], c[3]] as Cell);
    if (real.length) out.push({ cells: real });
  }
  return out;
}

/**
 * Re-cut a band into exactly `n` equal columns across its own opaque extent.
 *
 * ⚠️ THIS EXISTS BECAUSE AUTO-SLICING A RULED SHEET DOES NOT WORK, and pretending
 * otherwise would be worse than asking for one number. Measured on a fixture
 * built to match a real supplied sheet (ruled cells, ragged rows 4/6/4/2/3, one
 * row indented), alpha-slicing returned 5/12/5/2/1: it splits on the border
 * remnants, splits AGAIN inside a figure wherever a pose leaves a transparent
 * column — between the legs, either side of a spring — and merges neighbours
 * whose art touches. Those three failure modes pull in opposite directions, so
 * no gap threshold fixes all of them.
 *
 * Cells on a real sheet are laid out on a regular pitch, so given the count, an
 * equal division across the band's extent is exact. An indented row divides
 * correctly too, because the extent is the row's own bounding box, not the
 * sheet's.
 *
 * ⚠️ IT DIVIDES THE INK EXTENT, NOT THE CELL EXTENT. A row whose first pose is
 * narrow and inset, or whose last pose stops short of its cell, has an ink
 * extent smaller than its true grid extent — so the pitch is slightly wrong and
 * the error ACCUMULATES across the row. `grid.ts` exists to remove this: the
 * ruled borders are the true pitch, and the ink is not.
 */
export function equalCells(band: SheetRow, n: number): Cell[] {
  const x0 = Math.min(...band.cells.map((c) => c[0]));
  const x1 = Math.max(...band.cells.map((c) => c[2]));
  const y0 = Math.min(...band.cells.map((c) => c[1]));
  const y1 = Math.max(...band.cells.map((c) => c[3]));
  const pitch = (x1 - x0 + 1) / n;
  return Array.from({ length: n }, (_, i) => [
    Math.round(x0 + i * pitch), y0, Math.round(x0 + (i + 1) * pitch) - 1, y1,
  ] as Cell);
}
