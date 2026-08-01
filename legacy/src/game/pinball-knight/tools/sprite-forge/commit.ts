/**
 * THE GRID COMMIT — the step that makes a generated sheet importable at all.
 *
 * `grid.ts` can only report. It measured every sheet this project has received
 * as NOT PIXEL ART, and the obvious response — ask the generator for pixel art —
 * was tried and MEASURED. Round 2 asked in capitals for no anti-aliasing, flat
 * fills and at most 16 colours, and returned:
 *
 *     distinct colours   204,201 -> 301,541    (16 were requested)
 *     flat neighbours         11% -> 15%       (55% to pass the gate)
 *     census entries        26.6 -> 30.7       (the atlas locks 20)
 *     census isolated%     41.5% -> 47.8%      (painted roster 22.5%)
 *
 * Every number moved the wrong way while the art got visibly better, because a
 * generator emits a continuous-tone RENDERING of flat pixel art: each
 * apparently-flat block is a gradient of hundreds of near-identical values, and
 * the luma-weighted snap sends each of them to a DIFFERENT palette index. Not a
 * transport artifact either — JPEG blockiness measured 1.022, where >1.15 would
 * mean recompression.
 *
 * So neither property can be requested. Both are IMPOSED here, once, offline:
 *
 *   1. reduce each cell to the texel count it will actually occupy
 *   2. snap to the real palette and evict down to the atlas lock
 *   3. nearest-upscale by `factor`, on a lattice the whole SHEET agrees about
 *
 * After step 3 the sheet passes `detectPixelGrid`, and `blockReduce` recovers
 * step 2's texels EXACTLY — which is what "1:1 import" means. The pixels the
 * artist reviews here are the pixels the player sees, at every camera rung.
 *
 * ── WHY OFFLINE AND NOT AT RUNTIME ─────────────────────────────────────────
 *
 * The runtime already resamples, so this could in principle happen on load. It
 * must not. A commit is a destructive, opinionated decision — which 20 of 32
 * colours survive — and the artist has to be able to LOOK at the result and
 * repair it. Doing it per-boot also redoes the same work forever and hides the
 * eviction inside a frame budget. Committing once writes an artifact that can
 * be diffed, censused and rejected.
 *
 * Pure: pixels in, pixels out. No filesystem, no node-canvas. `snapColor` comes
 * from the engine on purpose — re-implementing the metric is how a tool starts
 * measuring something the game does not do (`register.ts` imports the real
 * crush for the same reason).
 */
import { snapColor } from "../../engine/render/sprite";
import { resampleCell, type RawImage } from "./resample";
import { ART_BOX, ART_FIT_H, ART_FIT_W, ART_GROUND, type ManifestRow } from "./manifest";
import { sliceSheet, type Cell } from "./slice";

export type { RawImage };

/**
 * Alpha at or below which a committed texel is CLEAR.
 *
 * Mirrors `atlas-census.OPAQUE_CUTOFF`. Alpha is binarised rather than carried:
 * a block whose alpha varies is not flat, and a sheet whose alpha is not flat
 * fails its own gate on the alpha channel even when every RGB block is perfect.
 */
const OPAQUE_CUTOFF = 127;

/**
 * The camera rung a commit sizes for, in atlas texels.
 *
 * The WIDEST rung (54), not the default (63), because the fit constraint is the
 * tightest rung and a figure that overflows there would have to be shrunk on
 * load — silently handing back the 1:1 property this whole module exists to
 * establish. `CAMERA_ZOOMS` runs {90, 81, 72, 63, 54}; sizing for 54 fits all
 * five. See `oneToOneScale` — the TEXEL count is rung-independent, so this only
 * decides how much of the cel the figure fills.
 */
export const FIT_GRID = 54;

/** The atlas entry lock every monster sheet is held to. Mirrors `boot/sheets.ts`. */
export const MAX_ENTRIES = 20;

/** Default block size. ×8 is the authoring factor `PROMPTS.md` asks for. */
export const DEFAULT_FACTOR = 8;

export interface CommitOptions {
  /** Source pixels per committed texel. */
  factor?: number;
  /** Atlas grid to size the fit against. See `FIT_GRID`. */
  fitGrid?: number;
  /** Distinct palette entries the sheet may keep. See `MAX_ENTRIES`. */
  maxEntries?: number;
  /** Blank texels between cells. ≥1 so the slicer can separate them again. */
  gutter?: number;
}

export interface CommitReport {
  factor: number;
  /** Texel height of the tallest LIVING cell — what the player sees. */
  texelH: number;
  /** Texel width of the widest living cell. */
  texelW: number;
  /** Distinct palette entries in the committed sheet. Never above the lock. */
  entries: number;
  /** Entries the lock evicted, remapped to their nearest survivor. */
  evicted: number;
  /** Share of opaque texels whose index CHANGED because of the eviction. */
  evictedShare: number;
  /** One line for the forge report. */
  verdict: string;
}

export interface CommitResult {
  image: RawImage;
  rows: ManifestRow[];
  report: CommitReport;
}

/** Luma-weighted distance between two palette entries — the snap's own metric. */
function palDist(a: readonly number[], b: readonly number[]): number {
  const dr = (a[0] - b[0]) * 0.3;
  const dg = (a[1] - b[1]) * 0.59;
  const db = (a[2] - b[2]) * 0.11;
  return dr * dr + dg * dg + db * db;
}

/** Copy one cell's rect out of the sheet into its own buffer. */
function cutCell(src: RawImage, cell: Cell): RawImage {
  const [x0, y0, x1, y1] = cell;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out: RawImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * src.width + x0) * 4;
    out.data.set(src.data.subarray(s, s + w * 4), y * w * 4);
  }
  return out;
}

/**
 * Reduce, snap, evict and re-up a whole sheet onto one lattice.
 *
 * `rows` carries the clip names because the LIVING clips set the scale and a
 * death sprawl only clamps itself — the same rule as `aliveScale`, and for the
 * same reason: letting a flat sprawl vote shrinks the walking creature.
 */
export function commitToGrid(
  src: RawImage,
  rows: readonly ManifestRow[],
  pal: readonly (readonly number[])[],
  opts: CommitOptions = {},
): CommitResult {
  const factor = opts.factor ?? DEFAULT_FACTOR;
  const fitGrid = opts.fitGrid ?? FIT_GRID;
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
  const gutter = Math.max(1, opts.gutter ?? 1);

  const all: Cell[] = rows.flatMap((r) => r.cells);
  if (!all.length) throw new Error("[commit] no cells");

  // ── 1. TEXEL SIZE ────────────────────────────────────────────────────────
  //
  // The living clips vote. `ART_FIT_*` are art units out of `ART_BOX`, so the
  // texel budget at this rung is that fraction of the grid.
  const alive = rows.filter((r) => r.clip !== "death").flatMap((r) => r.cells);
  const vote = alive.length ? alive : all;
  const fitW = (ART_FIT_W * fitGrid) / ART_BOX;
  const fitH = (ART_FIT_H * fitGrid) / ART_BOX;
  const maxW = Math.max(...vote.map(([x0, , x1]) => x1 - x0 + 1));
  const maxH = Math.max(...vote.map(([, y0, , y1]) => y1 - y0 + 1));
  /** Committed texels per source pixel. */
  const s = Math.min(fitW / maxW, fitH / maxH);

  // A death cell may genuinely be wider than the living box; it clamps to the
  // HARD cel limits alone, exactly as `cellScale` does at runtime.
  const hardW = fitGrid;
  const hardH = (ART_GROUND * fitGrid) / ART_BOX;
  const sized: [number, number][] = all.map((c): [number, number] => {
    const w = c[2] - c[0] + 1;
    const h = c[3] - c[1] + 1;
    const k = Math.min(s, hardW / w, hardH / h);
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  });

  // ── 2. REDUCE, then SNAP ─────────────────────────────────────────────────
  //
  // k-centroid rather than a box average: an average of a soft edge invents a
  // colour in neither side, and the snap downstream then has to guess which was
  // meant. See `resample.ts`.
  const texels = all.map((c, i) => resampleCell(cutCell(src, c), sized[i][0], sized[i][1], "kcentroid"));

  const counts = new Map<number, number>();
  const idx: Int16Array[] = [];
  for (const t of texels) {
    const m = new Int16Array(t.width * t.height).fill(-1);
    for (let p = 0; p < m.length; p++) {
      if (t.data[p * 4 + 3] <= OPAQUE_CUTOFF) continue;
      const q = snapColor(t.data[p * 4], t.data[p * 4 + 1], t.data[p * 4 + 2]);
      m[p] = q;
      counts.set(q, (counts.get(q) ?? 0) + 1);
    }
    idx.push(m);
  }

  // ── 3. EVICT to the lock ─────────────────────────────────────────────────
  //
  // Keep the entries with the most COVERAGE and remap the rest to their nearest
  // survivor under the snap's own metric. Coverage, not spread: a colour holding
  // 4% of the sprite is load-bearing and one holding 0.01% is a resample
  // artifact wearing a palette index. This is the step that makes `entries`
  // satisfy the lock BY CONSTRUCTION instead of by hoping — the crush would
  // otherwise evict for us, at load, picking by a rule the artist never sees.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const keep = ranked.slice(0, maxEntries).map(([i]) => i);
  const drop = ranked.slice(maxEntries).map(([i]) => i);
  const remap = new Map<number, number>();
  for (const d of drop) {
    let best = keep[0];
    let bd = Infinity;
    for (const k of keep) {
      const dist = palDist(pal[d], pal[k]);
      if (dist < bd) {
        bd = dist;
        best = k;
      }
    }
    remap.set(d, best);
  }
  let moved = 0;
  let opaque = 0;
  for (const m of idx) {
    for (let p = 0; p < m.length; p++) {
      if (m[p] < 0) continue;
      opaque++;
      const r = remap.get(m[p]);
      if (r !== undefined) {
        m[p] = r;
        moved++;
      }
    }
  }

  // ── 3b. TRIM EACH CELL TO ITS INK ────────────────────────────────────────
  //
  // ⚠️ THE COMMITTED CELL MUST BE A WHOLE NUMBER OF BLOCKS WIDE AND TALL, and a
  // rect with transparent margin is not. Nothing downstream reads the rects
  // written here: the forge and the game both RE-SLICE the sheet, and the
  // slicer trims to the opaque bounding box. So a cell padded out to its
  // resample rect came back 183 px wide against a ×8 lattice — 22.875 blocks —
  // and the 1:1 reduce silently degraded to a 3.98:1 fractional resample that
  // invented colours all over again. Measured: 25.7 entries where the source
  // held 20. Trimming here is what makes the slicer's answer land on the
  // lattice, and it must happen BEFORE the layout uses the sizes.
  const trimmed = idx.map((m, i) => {
    const [w, h] = sized[i];
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (m[y * w + x] < 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { w: 1, h: 1, m: new Int16Array(1).fill(-1) }; // empty cell
    const tw = x1 - x0 + 1;
    const th = y1 - y0 + 1;
    const t = new Int16Array(tw * th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) t[y * tw + x] = m[(y0 + y) * w + x0 + x];
    return { w: tw, h: th, m: t };
  });
  trimmed.forEach((t, i) => { sized[i] = [t.w, t.h]; idx[i] = t.m; });

  // ── 4. RE-UP onto ONE lattice ────────────────────────────────────────────
  //
  // Cell origins are multiples of `factor`, so every colour change in every
  // cell lands on the same lattice lines. `grid.ts` scores PHASE over absolute
  // sheet coordinates — cells that each gridded to their own origin would score
  // as no lattice at all, which is the trap this loop exists to avoid.
  /** Index into `sized`/`idx` of each row's first cell. */
  const rowStart: number[] = [];
  for (let ri = 0, o = 0; ri < rows.length; o += rows[ri].cells.length, ri++) rowStart.push(o);
  const rowSized = (ri: number): [number, number][] =>
    rows[ri].cells.map((_, i) => sized[rowStart[ri] + i]);

  const rowH = rows.map((_, ri) => Math.max(...rowSized(ri).map(([, h]) => h)));

  /**
   * Upper bound on the ink in any one scanline: a row's cells all at full width.
   *
   * `slice.ts` measures its ruled-line test against the SHEET width, so the
   * sheet is padded until even that worst case stays under the threshold. This
   * is what rescues a row holding ONE very wide cell (a death sprawl), which no
   * gutter can help — a lone cell spans its row whatever sits beside it.
   */
  const inkW = Math.max(...rows.map((_, ri) => rowSized(ri).reduce((a, [w]) => a + w, 0)));
  /** Below `RULE_FILL`, with margin for the threshold moving. */
  const COVER = 0.62;

  const layout = (g: number): { image: RawImage; rows: ManifestRow[] } => {
    const rowW = rows.map((_, ri) => rowSized(ri).reduce((a, [w]) => a + w + g, g));
    const W = Math.max(Math.max(...rowW), Math.ceil(inkW / COVER)) * factor;
    const H = rowH.reduce((a, h) => a + h + g, g) * factor;
    const image: RawImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    const outRows: ManifestRow[] = [];
    let ty = g;
    let n = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      let tx = g;
      const cellsOut: Cell[] = [];
      for (let ci = 0; ci < rows[ri].cells.length; ci++, n++) {
        const [tw, th] = sized[n];
        const m = idx[n];
        // Feet on the row's baseline, so a crouched pose does not float.
        const oy = ty + (rowH[ri] - th);
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const q = m[y * tw + x];
            if (q < 0) continue;
            const [r, gg, b] = pal[q];
            for (let by = 0; by < factor; by++) {
              let o = (((oy + y) * factor + by) * W + (tx + x) * factor) * 4;
              for (let bx = 0; bx < factor; bx++, o += 4) {
                image.data[o] = r;
                image.data[o + 1] = gg;
                image.data[o + 2] = b;
                image.data[o + 3] = 255;
              }
            }
          }
        }
        cellsOut.push([tx * factor, oy * factor, (tx + tw) * factor - 1, (oy + th) * factor - 1]);
        tx += tw + g;
      }
      outRows.push({ clip: rows[ri].clip, cells: cellsOut });
      ty += rowH[ri] + g;
    }
    return { image, rows: outRows };
  };

  // ── 5. WIDEN THE GUTTER UNTIL THE SHEET RE-SLICES TO THE SHAPE IT HAS ────
  //
  // ⚠️ NOTHING READS THE RECTS RETURNED HERE. The forge and the game both
  // re-slice the committed PNG, so the only rects that matter are the ones
  // `sliceSheet` will find — and a tightly packed sheet defeats it. `slice.ts`
  // erases any row whose ink spans ≥70% of the sheet width as a RULED LINE, and
  // eight trimmed figures at a 1-texel gutter do exactly that across their
  // ruffs: measured, the 2-row committed jester re-sliced as FOUR rows and the
  // run aborted on the sidecar mismatch.
  //
  // A constant gutter cannot fix this — the coverage depends on the figure
  // count and the silhouette — so the commit checks its own work instead:
  // lay out, re-slice, and widen until the answer agrees. Verifying beats
  // tuning, because the threshold belongs to `slice.ts` and may move.
  const want = rows.map((r) => r.cells.length);
  let built: { image: RawImage; rows: ManifestRow[] } | null = null;
  const tried: number[] = [];
  for (let g = gutter; g <= gutter + Math.max(8, Math.ceil(Math.max(...sized.map(([w]) => w)))); g++) {
    const cand = layout(g);
    const got = sliceSheet(cand.image.data, cand.image.width, cand.image.height);
    tried.push(g);
    if (got.length === want.length && got.every((r, i) => r.cells.length === want[i])) {
      built = cand;
      break;
    }
  }
  // A capped loop that gives up quietly would hand back a sheet the pipeline
  // rejects three steps later, with nothing pointing here. Fail loudly instead.
  if (!built) {
    throw new Error(
      `[commit] laid out ${want.length} rows [${want.join("/")}] but no gutter in ` +
        `${tried[0]}..${tried[tried.length - 1]} re-slices to that shape. Most likely a row is ` +
        `too SHORT to survive slice.ts's caption filter — a band under CAPTION_RATIO (25%) of ` +
        `the median band height is read as a caption and dropped. Row texel heights: ` +
        `[${rowH.join("/")}]. Otherwise the figures may be touching.`,
    );
  }
  const out = built.image;
  const outRows = built.rows;

  const entries = new Set<number>();
  for (const m of idx) for (const q of m) if (q >= 0) entries.add(q);

  const aliveSized = rows.flatMap((r, ri) => (r.clip === "death" ? [] : rowSized(ri)));
  const useSized = aliveSized.length ? aliveSized : sized;
  const texelH = Math.max(...useSized.map(([, h]) => h));
  const texelW = Math.max(...useSized.map(([w]) => w));
  const evictedShare = opaque ? moved / opaque : 0;

  return {
    image: out,
    rows: outRows,
    report: {
      factor,
      texelH,
      texelW,
      entries: entries.size,
      evicted: drop.length,
      evictedShare,
      verdict:
        `COMMITTED ×${factor} — figure ${texelW}×${texelH} texels, ${entries.size} palette entries` +
        (drop.length
          ? ` (${drop.length} evicted to meet the ${maxEntries} lock, ${(evictedShare * 100).toFixed(2)}% of opaque texels moved)`
          : ` (under the ${maxEntries} lock with room to spare)`) +
        `. This sheet imports 1:1 at every camera rung.`,
    },
  };
}
