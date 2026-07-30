/**
 * SPRITE INBOX — drop sheets in a folder, get scored game-ready frames.
 *
 *     cp mysheet.png scripts/sprites/inbox/ratking-E.png
 *     npm run sprites
 *
 * Reads every PNG in `scripts/sprites/inbox/`, slices each into frames, puts
 * them on the painters' registration contract, runs them through the REAL crush,
 * censuses the result against the painted roster, and writes both the frames and
 * a nearest-upscaled preview to `scripts/sprites/work/<name>/`.
 *
 * Nothing here talks to a network. There is no generation step and no API key.
 *
 * ── FILE NAMING ──
 *
 *   ratking-E.png   → creature "ratking", facing E (true side profile)
 *   ratking-S.png   → facing S (toward camera).  N = away.
 *   ratking.png     → facing E, the default
 *
 * W is never authored: the engine draws it as E with a negative texture repeat.
 *
 * ── WHAT A SHEET SHOULD LOOK LIKE ──
 *
 * A grid of cells on TRANSPARENCY, one pose per cell, the creature at the same
 * scale in every cell with a clear gap between them (cells are found by alpha,
 * not by assuming a grid, so the gap only has to beat MIN_GAP). Frames are read
 * in reading order and named from the clip table below when the count matches,
 * or `f00…` when it does not — a mismatch is reported, never fatal.
 *
 * ── WHY IT IS IN TYPESCRIPT AND NOT THE PYTHON SCRIPT IT REPLACES ──
 *
 * The Python importer needed a venv (PEP 668 blocks system installs here), PIL,
 * numpy and scipy, and it carried its OWN COPY of the 32-colour palette — which
 * would go stale the first time the palette moved and report confident nonsense.
 * This shares the game's real palette, the real crush and the real census, so
 * what it measures is what will ship.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas, loadImage } from "canvas";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crushToGrid } from "../engine/render/sprite";
import { installSpriteTestDom, SHIPPED_GRID, bufferFor } from "../testkit/atlas-census";
import { censusCell, declaredSet, formatNoise, paletteRgb, type NoiseRow } from "./atlas-census";

const ROOT = join(__dirname, "..", "..", "..", "..", "scripts", "sprites");
const INBOX = process.env.SPRITE_INBOX ?? join(ROOT, "inbox");
const WORK = process.env.SPRITE_WORK ?? join(ROOT, "work");

/** Painter roster reference, measured at the shipped rung. */
const ROSTER = { entries: 20.1, isolatedPct: 22.5, runLen: 1.82 };

/** The clip table the animator packs, and the frame counts the roster ships. */
const CLIPS: [string, number][] = [["idle", 2], ["walk", 4], ["attack", 3], ["death", 4]];

/** Transparent columns/rows narrower than this do not separate two cells. */
const MIN_GAP = 6;
/** A run of opaque pixels smaller than this is a smudge, not a pose. */
const MIN_CELL = 12;

/**
 * A row or column this full of opaque pixels is a RULED GRID LINE, not art.
 *
 * Real sheets are drawn with cell borders. They are opaque, so a naive
 * alpha-slice sees the whole sheet as ONE connected region and returns a single
 * cell — which is why this exists rather than being defensive programming.
 * Art never spans a whole sheet dimension; a ruled line always does.
 */
const RULE_FILL = 0.7;

/**
 * Bands shorter than this fraction of the median band are CAPTIONS.
 *
 * Sheets label their rows ("IDLE", "SPRING ATTACK", "DEATH"). The lettering
 * sits on the background between rows, so it slices as its own short band and
 * would otherwise be imported as a pose. A caption is an order of magnitude
 * shorter than a figure; 0.25 separates them with room to spare.
 */
const CAPTION_RATIO = 0.25;

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

/** Contiguous true runs, merging gaps under MIN_GAP and dropping tiny runs. */
function bands(profile: boolean[]): [number, number][] {
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

export interface SheetRow {
  cells: [number, number, number, number][];
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
      .map((c) => [c[0], c[1], c[2], c[3]] as [number, number, number, number]);
    if (real.length) out.push({ cells: real });
  }
  return out;
}

/** `ratking-E.png` → { name: "ratking", dir: "E" }. */
function parseName(file: string): { name: string; dir: string } {
  const base = file.replace(/\.png$/i, "");
  const m = /^(.*)-([SNE])$/.exec(base);
  return m ? { name: m[1], dir: m[2] } : { name: base, dir: "E" };
}

function labelsFor(count: number): string[] {
  const named = CLIPS.flatMap(([clip, n]) => Array.from({ length: n }, (_, i) => `${clip}${i}`));
  return count === named.length ? named : Array.from({ length: count }, (_, i) => `f${String(i).padStart(2, "0")}`);
}

/** Clip names the animator actually packs. Anything else is reported, not used. */
const KNOWN_CLIPS = new Set(["idle", "walk", "attack", "death", "run", "crouch", "wait", "wake", "stumble", "roll"]);

/**
 * Row → clip names, from an optional sidecar beside the sheet.
 *
 *     scripts/sprites/inbox/ratking-E.png
 *     scripts/sprites/inbox/ratking-E.json   { "rows": ["idle","attack","walk","stumble","death"] }
 *
 * A sidecar rather than reading the sheet's own captions, because the captions
 * are pixels — OCR'ing "SPRING ATTACK" to guess a ClipName would be a guess
 * dressed as a feature, and it would fail silently the first time a sheet used a
 * font this code had never seen. Rows are reported when the sidecar is missing,
 * so writing one takes a few seconds and is checkable.
 */
function readSidecar(dir: string, base: string): { rows?: string[]; cells?: number[] } | null {
  const file = join(dir, `${base}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as { rows?: string[]; cells?: number[] };
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
 */
function equalCells(band: SheetRow, n: number): [number, number, number, number][] {
  const x0 = Math.min(...band.cells.map((c) => c[0]));
  const x1 = Math.max(...band.cells.map((c) => c[2]));
  const y0 = Math.min(...band.cells.map((c) => c[1]));
  const y1 = Math.max(...band.cells.map((c) => c[3]));
  const pitch = (x1 - x0 + 1) / n;
  return Array.from({ length: n }, (_, i) => [
    Math.round(x0 + i * pitch), y0, Math.round(x0 + (i + 1) * pitch) - 1, y1,
  ]);
}

describe("sprite inbox", () => {
  it("processes every sheet in the inbox", async () => {
    if (!existsSync(INBOX)) mkdirSync(INBOX, { recursive: true });
    const sheets = readdirSync(INBOX).filter((f) => /\.png$/i.test(f)).sort();

    if (sheets.length === 0) {
      console.log(
        `\nInbox is empty (${INBOX}).\n` +
          `Drop sheets in as <name>-<S|N|E>.png — e.g. ratking-E.png — and run again.\n`,
      );
      return;
    }

    const G = SHIPPED_GRID;
    const px = bufferFor(G);
    const unit = px / 128;
    const pal = paletteRgb();
    const summary: string[] = [];

    for (const file of sheets) {
      const { name, dir } = parseName(file);
      const sheet = await loadImage(join(INBOX, file));
      const sc = createCanvas(sheet.width, sheet.height);
      const sctx = sc.getContext("2d");
      sctx.drawImage(sheet, 0, 0);
      const sdata = sctx.getImageData(0, 0, sheet.width, sheet.height).data as unknown as Uint8ClampedArray;

      const rows = sliceSheet(sdata, sheet.width, sheet.height);
      const cells: [number, number, number, number][] = rows.flatMap((r) => r.cells);
      // A sheet that slices into one cell is usually a solid background that was
      // never keyed out, or ruled lines this did not recognise. Say so plainly:
      // every number downstream would otherwise describe one big rectangle.
      expect(cells.length, `${file}: sliced into ${cells.length} cell(s) — is the background transparent?`)
        .toBeGreaterThan(1);

      const side = readSidecar(INBOX, file.replace(/\.png$/i, ""));
      const named = side?.rows;
      // An explicit per-row cell count OVERRIDES the auto-slice. On a ruled
      // sheet it is the difference between right and roughly-right.
      if (side?.cells) {
        expect(side.cells.length, `${file}: sidecar lists ${side.cells.length} row counts but ${rows.length} rows were found`)
          .toBe(rows.length);
        rows.forEach((r, i) => { r.cells = equalCells(r, side.cells![i]); });
      }
      const cellsNow = rows.flatMap((r) => r.cells);
      cells.length = 0;
      cells.push(...cellsNow);
      const shape = rows.map((r) => r.cells.length).join("/");
      const labels: string[] = [];
      rows.forEach((r, ri) => {
        const clip = named?.[ri] ?? `row${ri}`;
        r.cells.forEach((_, ci) => labels.push(`${clip}${ci}`));
      });

      // ONE uniform scale across the sheet, so the flipbook holds size, and ONE
      // resample per frame: the source cell goes straight into the crush buffer.
      // The measured cost of resampling twice was isolated 34.9% → 42.7%.
      const maxW = Math.max(...cells.map(([x0, , x1]) => x1 - x0 + 1));
      const maxH = Math.max(...cells.map(([, y0, , y1]) => y1 - y0 + 1));
      const k = Math.min((108 * unit) / maxW, (110 * unit) / maxH);

      const outDir = join(WORK, name);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });

      const stats: NoiseRow[] = [];
      const previews: ImageData[] = [];
      for (let i = 0; i < cells.length; i++) {
        const [x0, y0, x1, y1] = cells[i];
        const cw = x1 - x0 + 1;
        const ch = y1 - y0 + 1;
        const buf = createCanvas(px, px);
        const ctx = buf.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(sheet, x0, y0, cw, ch, (px - cw * k) / 2, 118 * unit - ch * k, cw * k, ch * k);

        const declared = declaredSet(ctx.getImageData(0, 0, px, px).data as unknown as Uint8ClampedArray, pal);
        const cell = crushToGrid(buf as unknown as HTMLCanvasElement, G);
        const img = (cell.getContext("2d") as unknown as CanvasRenderingContext2D).getImageData(0, 0, G, G);
        const st = censusCell(img.data, G, pal);
        expect(st.opaque, `${file} ${labels[i]}: crushed to an EMPTY cell`).toBeGreaterThan(20);
        expect(st.unmatched, `${file} ${labels[i]}: off-palette texels after the snap`).toBe(0);

        writeFileSync(
          join(outDir, `${dir}-${labels[i]}.png`),
          (cell as unknown as { toBuffer: (m: string) => Buffer }).toBuffer("image/png"),
        );
        previews.push(img);
        stats.push({
          key: labels[i], entries: st.entries, isolatedPct: st.isolatedPct, runLen: st.runLen,
          invented: st.counts.reduce((n, c, j) => n + (c > 0 && !declared.has(j) ? 1 : 0), 0),
        });
      }

      // Nearest-upscaled contact sheet — atlas truth, never a smoothed preview.
      const Z = 5;
      const cols = Math.min(8, previews.length);
      const pv = createCanvas(cols * (G * Z + 6) + 6, Math.ceil(previews.length / cols) * (G * Z + 6) + 6);
      const pctx = pv.getContext("2d");
      pctx.fillStyle = "#14161c";
      pctx.fillRect(0, 0, pv.width, pv.height);
      pctx.imageSmoothingEnabled = false;
      previews.forEach((img, i) => {
        const t = createCanvas(G, G);
        (t.getContext("2d") as unknown as CanvasRenderingContext2D).putImageData(img, 0, 0);
        pctx.drawImage(t, 6 + (i % cols) * (G * Z + 6), 6 + Math.floor(i / cols) * (G * Z + 6), G * Z, G * Z);
      });
      writeFileSync(join(outDir, "preview.png"), (pv as unknown as { toBuffer: (m: string) => Buffer }).toBuffer("image/png"));

      const mean = (f: (r: NoiseRow) => number): number => stats.reduce((a, r) => a + f(r), 0) / stats.length;
      const iso = mean((r) => r.isolatedPct);
      const run = mean((r) => r.runLen);
      const verdict =
        run > ROSTER.runLen && iso < ROSTER.isolatedPct ? "BETTER than the painted roster"
          : iso < 40 ? "COMPETITIVE — inside the roster's range"
            : "WORSE than the painted roster — too busy for this crush";
      const unknown = named?.filter((c) => !KNOWN_CLIPS.has(c)) ?? [];

      summary.push(
        `\n═══ ${name} (${dir}) — ${rows.length} rows [${shape}], ${cells.length} frames\n` +
          (named
            ? unknown.length
              ? `⚠ not ClipNames the animator packs: ${unknown.join(", ")}\n`
              : ""
            : `⚠ no row names. Write ${file.replace(/\.png$/i, ".json")}:\n` +
              `    { "rows": [${rows.map((_, i) => `"row${i}"`).join(", ")}] }\n`) +
          `${formatNoise(stats)}\n` +
          `MEAN   entries ${mean((r) => r.entries).toFixed(1)}  isolated ${iso.toFixed(1)}%  runLen ${run.toFixed(2)}\n` +
          `ROSTER entries ${ROSTER.entries}  isolated ${ROSTER.isolatedPct}%  runLen ${ROSTER.runLen}\n` +
          `VERDICT: ${verdict}\n` +
          `→ ${outDir}  (frames + preview.png)`,
      );
    }
    console.log(summary.join("\n"));
  }, 600_000);
});
