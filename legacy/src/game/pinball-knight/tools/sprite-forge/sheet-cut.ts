/**
 * SHEET PIXELS → NAMED CELLS, the one implementation.
 *
 * Getting from a decoded sheet to "here are the frames and what clip each one
 * plays as" is four decisions — matte the background, slice the bands, honour a
 * sidecar's cell counts, name the rows — and every one of them has already been
 * a bug with a postmortem in `inbox.test.ts`. It lived there, inline, which was
 * fine while the importer was the only caller.
 *
 * It is not the only caller any more. The benchmark (`bench.test.ts`) has to
 * feed the SAME cells to every arm it compares, and a second copy of this would
 * be a second copy of four decisions each one edit away from disagreeing. That
 * is the `tool-schema-split-build` failure in miniature: two copies that pass
 * their own tests and describe different art.
 *
 * So it lives here and both import it.
 *
 * ⚠️ PIXELS IN, NOT A FILENAME — no `canvas`, no `node:fs`, nothing that only
 * exists under node. `testkit-boundary.test.ts` scans every non-test module for
 * exactly those imports, because this directory sits inside the GAME'S OWN
 * source tree and a stray `from "canvas"` gets pulled into the client bundle by
 * anything that ever imports this. The first version of this file took a
 * directory and a filename and tripped that scan on the run it was written.
 * Decoding and writing are the callers' jobs; the four decisions are this one's.
 */
import { sliceSheet, equalCells, type Cell } from "./slice";
import { matte, type MatteOptions } from "./matte";
import { labelRows } from "./labels";
import type { ManifestRow } from "./manifest";
import type { CommitOptions } from "./commit";

/** The sidecar shape both callers read. */
export interface Sidecar {
  rows?: string[];
  /**
   * Per-SLICED-BAND cell counts. A plain number re-cuts that band into N equal
   * columns; an array splits it into consecutive clips of those sizes, and
   * `rows` then names one clip per resulting group rather than per band.
   */
  cells?: (number | number[])[];
  /** EXACT cell rects per row — the slicer is skipped entirely when present. */
  rects?: number[][][];
  scale?: number;
  matte?: MatteOptions;
  commit?: boolean | (CommitOptions & { bans?: string[] });
  palette?: string[];
}

/**
 * Below this much transparency the sheet has no usable alpha and is matted.
 *
 * Not zero: a generator sometimes emits a few stray transparent pixels, and a
 * hand-keyed sheet always has a large clear field. 5% separates "someone keyed
 * this" from "this arrived as a flat JPEG-alike with an opaque background",
 * which is every sheet a diffusion model produces.
 */
export const OPAQUE_BELOW = 0.05;

/** Share of the sheet that is already transparent. */
export function clearShare(data: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) n++;
  return n / (data.length / 4);
}

export interface CutSheet {
  /**
   * The MATTED pixels. A caller that blits from a canvas must write these back
   * to it — `registerCell` samples the canvas, so the source it reads has to be
   * the keyed one and not the opaque original.
   */
  data: Uint8ClampedArray;
  rows: ManifestRow[];
  /** Per-frame labels in flattened order — `idle0`, `walk1`, … */
  labels: string[];
  /** The rows BEFORE any sidecar cell-count override — what the slicer found. */
  slicedRows: number;
  /** The matte report, when one ran. `null` means the sheet arrived keyed. */
  matte: ReturnType<typeof matte>["report"] | null;
  /**
   * Problems worth surfacing. Empty on a clean load.
   *
   * ⚠️ RETURNED, NOT THROWN, and that is the seam that lets one loader serve
   * both callers. The importer turns these into `expect` failures because a bad
   * sheet must stop a publish; the bench prints them and carries on, because a
   * creature that will not load is one cell of a comparison and not a reason to
   * abandon the other fifty-three.
   */
  notes: string[];
}

/**
 * Cut one decoded sheet into named rows.
 *
 * ⚠️ MATTE FIRST, ALWAYS BEFORE SLICING. Slicing finds cells by ALPHA, and
 * every sheet an image generator produces is fully opaque — diffusion models
 * have no alpha channel to write, so the background arrives as a flat cream
 * field. Without the matte the whole sheet slices into ONE cell and everything
 * downstream describes one big rectangle.
 */
export function cutSheet(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  side: Sidecar | null,
): CutSheet {
  const sheet = { width, height };
  let data = pixels;
  const notes: string[] = [];
  let matteReport: ReturnType<typeof matte>["report"] | null = null;

  if (clearShare(data) < OPAQUE_BELOW) {
    const res = matte(data, width, height, side?.matte);
    matteReport = res.report;
    if (res.report.failures.length) notes.push(...res.report.failures);
    data = res.data;
  }

  // DECLARED rects skip the slicer outright — a producer that composed the
  // sheet knows where it put things, and re-deriving that is how the knight's
  // E sheet published a bare sword blade as an animation frame.
  const declared = side?.rects?.map((cells) => ({ cells: cells.map((c) => [...c] as Cell) }));
  const sliced = declared ?? sliceSheet(data, sheet.width, sheet.height);
  const found = sliced.flatMap((r) => r.cells).length;
  if (found <= 1) notes.push(`sliced into ${found} cell(s) — is the background transparent?`);

  // An explicit per-row cell count OVERRIDES the auto-slice; a NESTED count
  // splits one sliced band into consecutive clips, because two short clips
  // routinely share a band and a band is a band to the slicer.
  let rows = sliced;
  if (side?.cells) {
    if (side.cells.length !== sliced.length) {
      notes.push(`sidecar lists ${side.cells.length} row counts but ${sliced.length} rows were found`);
    } else {
      rows = sliced.flatMap((r, i) => {
        const spec = side.cells![i];
        if (!Array.isArray(spec)) return [{ ...r, cells: equalCells(r, spec) }];
        const total = spec.reduce((a, b) => a + b, 0);
        // Regroup the AUTO-SLICED cells when the counts already agree: those
        // rects are ink-tight, and re-cutting the band into equal columns would
        // straddle the gap the two clips are separated by.
        const all = r.cells.length === total ? r.cells : equalCells(r, total);
        let at = 0;
        return spec.map((n) => ({ ...r, cells: all.slice(at, (at += n)) }));
      });
    }
  }

  const named = side?.rows;
  return {
    data,
    rows: rows.map((r, ri) => ({ clip: named?.[ri] ?? `row${ri}`, cells: r.cells as Cell[] })),
    labels: labelRows(rows.map((r) => r.cells.length), named),
    slicedRows: sliced.length,
    matte: matteReport,
    notes,
  };
}
