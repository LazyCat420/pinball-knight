/**
 * THE MATRIX BENCH — {how the texels are decided} × {whose palette they land on}.
 *
 * Two levers were named as the remaining ceiling on imported art:
 *
 *   · a PER-SPRITE palette, because RO and Golden Sun sprites carry their own
 *     and ours spend 20 of the dungeon's 32 (`palette-derive.ts`)
 *   · art at FINAL RESOLUTION, because no downsampler places pixels
 *     (`synth.ts` synthesises it, `commit.native` imports it)
 *
 * They are independent, so the honest question is not "which one" but which
 * CELL of the matrix, and whether they compose. Six arms, every one through the
 * real commit and the real crush, scored and rendered:
 *
 *      texels \ palette   shared 32      derived 20
 *      vote (shipped)     A  control     B
 *      synth              C              D
 *      native             —              E  (round-trip of D)
 *      painted roster     F  — the absolute oracle, not an arm
 *
 * ⚠️ THE NUMBERS DO NOT DECIDE THIS ALONE, and that is not a hedge — it is the
 * standing lesson of this bench's predecessor. `snap-metric.test.ts`'s
 * best-scoring arm (ban `stone`: on-ramp 63→86%, saturation 77→86%) was
 * REJECTED BY LOOKING at it, because it had moved the armour onto `arcane` and
 * come back speckled blue. So this writes PNGs as well as a table, and the PNGs
 * are nearest-upscaled atlas truth rather than a flattering smooth preview.
 *
 *     RUN_MATRIX=1 npx vitest run matrix
 *
 * Output in `work/matrix/`: one strip per arm, one head crop per arm, and
 * `stats.json` for the write-up.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas, loadImage, type Canvas } from "canvas";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installSpriteTestDom, SHIPPED_GRID, bufferFor, paintAtlas } from "../../testkit/atlas-census";
import { censusCell } from "../../render/atlas-census";
import { PALETTE_HEX } from "../../render/palette";
import { makeKnightPaints } from "../../render/cel-painter";
import { commitToGrid, type CommitOptions, type CommitResult, type RawImage } from "./commit";
import { hexOf } from "./palette-derive";
import { ART_BOX, oneToOneScale, type ManifestRow } from "./manifest";
import { registerCell, crushCell } from "./register";
import type { Cell } from "./slice";

const HERE = __dirname;
/**
 * ⚠️ THE RAW PREP OUTPUT, NOT `inbox/`.
 *
 * `inbox/pinball_knight-*.png` are the sheets that ALREADY SHIPPED: promoted
 * committed art, 20 colours on a ×8 lattice. Running commit arms over those
 * measures each arm against a flattened, palette-snapped input — and the first
 * run of this bench did exactly that, reporting the SOURCE at 20 distinct
 * colours and a painted-roster oracle apparently 4× noisier than every arm.
 * Every number was a re-commit of the shipped answer.
 *
 * The raw sheet is the prep's own output, 100-217k colours. Regenerate it with:
 *
 *     SPRITE_INBOX=<forge>/work/raw node prep/prep-knight.mjs build
 */
const RAW = join(HERE, "work", "raw");
const OUT = join(HERE, "work", "matrix");
const RUN = process.env.RUN_MATRIX === "1";

const G = SHIPPED_GRID;
const PX = bufferFor(G);
const PAL = (): number[][] => PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

// ── the sheets ──────────────────────────────────────────────────────────────

interface Sheet { img: RawImage; rows: ManifestRow[] }

async function sheet(dir: string): Promise<Sheet> {
  const png = join(RAW, `pinball_knight-${dir}.png`);
  if (!existsSync(png)) {
    throw new Error(
      `[matrix] no raw sheet at ${png}. The bench must not read inbox/ — those are the COMMITTED ` +
        `sheets. Build the raw ones first:\n    SPRITE_INBOX=${RAW} node ${join(HERE, "prep", "prep-knight.mjs")} build`,
    );
  }
  const side = JSON.parse(readFileSync(join(RAW, `pinball_knight-${dir}.json`), "utf8")) as {
    rows: string[];
    rects: number[][][];
  };
  const image = await loadImage(png);
  const c = createCanvas(image.width, image.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(image as never, 0, 0);
  const d = ctx.getImageData(0, 0, image.width, image.height);
  return {
    img: { width: image.width, height: image.height, data: d.data as unknown as Uint8ClampedArray },
    rows: side.rows.map((clip, i) => ({ clip, cells: side.rects[i] as Cell[] })),
  };
}

// ── metrics ─────────────────────────────────────────────────────────────────

/**
 * The metric `isolated%` is blind to, and the one this whole round is about.
 *
 * A 3-texel blob has neighbours of its own colour, so every texel in it passes
 * the orphan test — which is why a sheet could measure clean and still read as
 * melting. Connected components of one colour, 4-connected, over the OPAQUE
 * texels of a crushed cell:
 *
 *   meanRegion   mean component size in texels, weighted BY TEXEL (so it
 *                answers "how big is the region the average texel sits in",
 *                not "how big is the average region", which a hundred orphans
 *                would dominate)
 *   mosaicPct    share of opaque texels sitting in a component under 6 texels.
 *                This is the melting, named and counted.
 */
function regionStats(d: Uint8ClampedArray, g: number): { meanRegion: number; mosaicPct: number; regions: number } {
  const key = new Int32Array(g * g).fill(-1);
  for (let p = 0; p < g * g; p++) {
    if (d[p * 4 + 3] <= 127) continue;
    key[p] = (d[p * 4] << 16) | (d[p * 4 + 1] << 8) | d[p * 4 + 2];
  }
  const comp = new Int32Array(g * g).fill(-1);
  const sizes: number[] = [];
  for (let p = 0; p < g * g; p++) {
    if (key[p] < 0 || comp[p] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [p];
    comp[p] = id;
    while (stack.length) {
      const q = stack.pop()!;
      n++;
      const qx = q % g, qy = (q / g) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= g || ny >= g) continue;
        const nn = ny * g + nx;
        if (comp[nn] >= 0 || key[nn] !== key[q]) continue;
        comp[nn] = id;
        stack.push(nn);
      }
    }
    sizes.push(n);
  }
  const opaque = sizes.reduce((a, b) => a + b, 0);
  if (!opaque) return { meanRegion: 0, mosaicPct: 0, regions: 0 };
  const weighted = sizes.reduce((a, b) => a + b * b, 0) / opaque;
  const small = sizes.filter((n) => n < 6).reduce((a, b) => a + b, 0);
  return { meanRegion: weighted, mosaicPct: (100 * small) / opaque, regions: sizes.length };
}

function satOf(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  return mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
}

/** Mean saturation and luma spread over opaque pixels of any RGBA buffer. */
function colourStats(d: Uint8ClampedArray): { sat: number; lumaSd: number; distinct: number } {
  let s = 0, n = 0, l = 0, l2 = 0;
  const seen = new Set<number>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 127) continue;
    s += satOf(d[i], d[i + 1], d[i + 2]);
    const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    l += lum; l2 += lum * lum;
    seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    n++;
  }
  if (!n) return { sat: 0, lumaSd: 0, distinct: 0 };
  const mean = l / n;
  return { sat: s / n, lumaSd: Math.sqrt(Math.max(0, l2 / n - mean * mean)), distinct: seen.size };
}

// ── the arms ────────────────────────────────────────────────────────────────

interface Arm {
  key: string;
  label: string;
  /** Which cell of the matrix, for the report. */
  texels: "vote" | "synth" | "native";
  palette: "shared" | "derived";
  opts: CommitOptions;
}

/** The knight bans the rot ramp — a MATERIAL decision, and only meaningful shared. */
const ROT = [6, 7, 8, 9];

const ARMS: Arm[] = [
  {
    key: "A", label: "vote + shared (SHIPPED)", texels: "vote", palette: "shared",
    opts: { ban: ROT },
  },
  {
    key: "B", label: "vote + per-sprite", texels: "vote", palette: "derived",
    opts: { derive: 20 },
  },
  {
    key: "C", label: "synth + shared", texels: "synth", palette: "shared",
    opts: { mode: "synth", ban: ROT },
  },
  {
    key: "D", label: "synth + per-sprite", texels: "synth", palette: "derived",
    opts: { mode: "synth", derive: 20 },
  },
];

/** Render a committed sheet into a canvas the register/crush path can read. */
function toCanvas(img: RawImage): Canvas {
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  const im = ctx.createImageData(img.width, img.height);
  im.data.set(img.data as unknown as Uint8ClampedArray);
  ctx.putImageData(im, 0, 0);
  return c;
}

/**
 * A committed sheet through THE GAME'S OWN PATH, per cell.
 *
 * `oneToOneScale` + `registerCell(align, gridN)` + `crushCell` is exactly what
 * `imported-paints.ts` does at runtime — including the sheet's own palette,
 * appended to the shared one the same way `SheetBuildOptions.sheetPalette` is.
 * Anything less would be measuring a path the player does not take, which this
 * pipeline has already shipped twice.
 */
function crushCommitted(c: CommitResult, ownPal: number[][] | null): ImageData[] {
  const canvas = toCanvas(c.image);
  const k = oneToOneScale(c.report.factor, G) * (PX / ART_BOX);
  return c.rows.flatMap((r) =>
    r.cells.map((cell) => {
      const buf = registerCell(canvas as unknown as CanvasImageSource, cell, k, PX, PX / G, c.report.factor);
      return crushCell(buf, G, ownPal ?? undefined);
    }),
  );
}

/** Clip name per crushed frame, in the same flattened order. */
function clipsOf(c: CommitResult): string[] {
  return c.rows.flatMap((r) => r.cells.map(() => r.clip));
}

/**
 * A committed sheet, read back as NATIVE art: one pixel per texel.
 *
 * The commit's last step replicates each texel into a `factor`×`factor` block
 * on a shared lattice, so taking the top-left pixel of every block is the exact
 * inverse — no filtering, no rounding, the same bytes. That makes the result
 * genuinely "art authored at final resolution", which is the input the native
 * path claims to import untouched.
 */
function asNative(c: CommitResult): [RawImage, ManifestRow[]] {
  const f = c.report.factor;
  const src = c.image;
  const w = Math.floor(src.width / f);
  const h = Math.floor(src.height / f);
  const out: RawImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * f * src.width + x * f) * 4;
      out.data.set(src.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  const rows: ManifestRow[] = c.rows.map((r) => ({
    clip: r.clip,
    cells: r.cells.map(
      ([x0, y0, x1, y1]) =>
        [Math.round(x0 / f), Math.round(y0 / f), Math.round((x1 + 1) / f) - 1, Math.round((y1 + 1) / f) - 1] as Cell,
    ),
  }));
  return [out, rows];
}

// ── pictures ────────────────────────────────────────────────────────────────

const BG = "#14161c";

/** Nearest-upscaled contact strip. Atlas truth, never a smoothed preview. */
function strip(frames: ImageData[], zoom: number): Canvas {
  const pad = 4;
  const out = createCanvas(frames.length * (G * zoom + pad) + pad, G * zoom + pad * 2);
  const ctx = out.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = false;
  frames.forEach((f, i) => {
    const t = createCanvas(G, G);
    (t.getContext("2d") as unknown as CanvasRenderingContext2D).putImageData(f, 0, 0);
    ctx.drawImage(t, pad + i * (G * zoom + pad), pad, G * zoom, G * zoom);
  });
  return out;
}

/**
 * The HEAD, blown up — because the eye is the test case for every pass here.
 *
 * Crops the top `frac` of the figure's own opaque bbox rather than a fixed
 * rect: the arms produce figures of slightly different heights, and a fixed
 * crop would compare a face against a chestplate and call it a difference.
 */
function headCrop(f: ImageData, zoom: number, frac = 0.42): Canvas {
  let x0 = G, y0 = G, x1 = -1, y1 = -1;
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      if (f.data[(y * G + x) * 4 + 3] <= 127) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) { x0 = y0 = 0; x1 = y1 = G - 1; }
  const h = Math.max(4, Math.round((y1 - y0 + 1) * frac));
  const w = x1 - x0 + 1;
  const out = createCanvas(w * zoom, h * zoom);
  const ctx = out.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = false;
  const t = createCanvas(G, G);
  (t.getContext("2d") as unknown as CanvasRenderingContext2D).putImageData(f, 0, 0);
  ctx.drawImage(t, x0, y0, w, h, 0, 0, w * zoom, h * zoom);
  return out;
}

/** A palette swatch bar, so the report can show what each arm is spending. */
function swatches(pal: readonly (readonly number[])[], cell = 26): Canvas {
  const cols = Math.min(10, pal.length);
  const rows = Math.ceil(pal.length / cols);
  const out = createCanvas(cols * cell, rows * cell);
  const ctx = out.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, out.width, out.height);
  pal.forEach((c, i) => {
    ctx.fillStyle = hexOf(c);
    ctx.fillRect((i % cols) * cell, Math.floor(i / cols) * cell, cell - 1, cell - 1);
  });
  return out;
}

interface Metrics {
  entries: number;
  isolatedPct: number;
  runLen: number;
  meanRegion: number;
  mosaicPct: number;
  sat: number;
  lumaSd: number;
}

interface Score extends Metrics {
  key: string;
  label: string;
  texels: string;
  palette: string;
  /** The SAME numbers over the S facing alone, so arms with different facing
   *  counts can still be compared like for like. */
  sOnly: Metrics;
  texelH: number;
  verdict: string;
}

/**
 * Score a bag of crushed frames, weighted by opaque texels.
 *
 * ⚠️ WEIGHTED, because a mostly-empty frame has as many texels of opinion as a
 * standing pose has and a plain mean would let a stumble decide the sheet. Same
 * rule `censusFrames` applies for the same reason.
 */
function score(frames: readonly ImageData[], pal: number[][]): Metrics {
  let iso = 0, run = 0, mean = 0, mosaic = 0, sat = 0, sd = 0, w = 0;
  const entries = new Set<number>();
  for (const f of frames) {
    const st = censusCell(f.data, G, pal);
    if (!st.opaque) continue;
    const rg = regionStats(f.data, G);
    const cs = colourStats(f.data);
    iso += st.isolatedPct * st.opaque;
    run += st.runLen * st.opaque;
    mean += rg.meanRegion * st.opaque;
    mosaic += rg.mosaicPct * st.opaque;
    sat += cs.sat * st.opaque;
    sd += cs.lumaSd * st.opaque;
    w += st.opaque;
    for (let i = 0; i < f.data.length; i += 4) {
      if (f.data[i + 3] > 127) entries.add((f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2]);
    }
  }
  if (!w) return { entries: 0, isolatedPct: 0, runLen: 0, meanRegion: 0, mosaicPct: 0, sat: 0, lumaSd: 0 };
  return {
    entries: entries.size,
    isolatedPct: iso / w, runLen: run / w,
    meanRegion: mean / w, mosaicPct: mosaic / w,
    sat: sat / w, lumaSd: sd / w,
  };
}

describe("sprite matrix — texel decision × palette", () => {
  it.runIf(RUN)("scores every cell of the matrix and writes the pictures", async () => {
    mkdirSync(OUT, { recursive: true });
    const pal = PAL();
    const dirs = ["S", "E", "N"];
    const sheets = new Map<string, Sheet>();
    for (const d of dirs) sheets.set(d, await sheet(d));

    // The SOURCE's own colour statistics, for the saturation ratio. Measured
    // over the same cells the arms are measured over, so it is a like-for-like
    // denominator and not the whole sheet including its empty field.
    const srcS = sheets.get("S")!;
    const srcPixels: number[] = [];
    for (const r of srcS.rows) {
      for (const [x0, y0, x1, y1] of r.cells) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const i = (y * srcS.img.width + x) * 4;
            srcPixels.push(srcS.img.data[i], srcS.img.data[i + 1], srcS.img.data[i + 2], srcS.img.data[i + 3]);
          }
        }
      }
    }
    const srcStats = colourStats(Uint8ClampedArray.from(srcPixels));

    const scores: Score[] = [];
    const palettes: Record<string, string[]> = {};

    for (const arm of ARMS) {
      // Every facing is committed, because a per-sprite palette derived from
      // ONE facing and applied to three is exactly the cross-facing defect this
      // repo has already shipped on the size axis.
      const perDir = new Map<string, { c: CommitResult; frames: ImageData[]; clips: string[] }>();
      for (const d of dirs) {
        const s = sheets.get(d)!;
        const c = commitToGrid(s.img, s.rows, pal, arm.opts);
        const ownPal = c.derived ? c.palette : null;
        perDir.set(d, { c, frames: crushCommitted(c, ownPal), clips: clipsOf(c) });
      }

      // Scored across all three facings — a per-sprite palette derived from one
      // facing and judged on that facing alone would hide exactly the disagree-
      // ment `sheetPalette()` exists to reconcile. `sOnly` is carried too so
      // arm E, which only has an S sheet to round-trip, is comparable.
      const S = perDir.get("S")!;
      const allFrames = dirs.flatMap((d) => perDir.get(d)!.frames);
      const allPal = [...pal, ...dirs.flatMap((d) => (perDir.get(d)!.c.derived ? perDir.get(d)!.c.palette : []))];
      const m = score(allFrames, allPal);
      scores.push({
        key: arm.key, label: arm.label, texels: arm.texels, palette: arm.palette,
        ...m, sat: m.sat / srcStats.sat,
        sOnly: (() => {
          const sm = score(S.frames, [...pal, ...(S.c.derived ? S.c.palette : [])]);
          return { ...sm, sat: sm.sat / srcStats.sat };
        })(),
        texelH: S.c.report.texelH,
        verdict: S.c.report.verdict,
      });
      palettes[arm.key] = S.c.palette.map(hexOf);

      // Pictures from the S facing — the one the player looks at most.
      const idle = S.frames.filter((_, i) => S.clips[i] === "idle");
      const walk = S.frames.filter((_, i) => S.clips[i] === "walk");
      writeFileSync(join(OUT, `${arm.key}-strip.png`), strip([...idle.slice(0, 2), ...walk.slice(0, 4)], 4).toBuffer("image/png"));
      writeFileSync(join(OUT, `${arm.key}-head.png`), headCrop(idle[0] ?? S.frames[0], 10).toBuffer("image/png"));
      writeFileSync(join(OUT, `${arm.key}-palette.png`), swatches(S.c.palette).toBuffer("image/png"));

      // ── ARM E, THE ROUND TRIP: is a committed sheet importable as NATIVE? ──
      //
      // This is the property "generate at final resolution" actually needs. If
      // the pipeline cannot take art that is ALREADY at final resolution and
      // leave it alone, then nothing authored at 70px could survive it either,
      // and the best generator in the world would not help. Arm D's own output
      // is the closest thing to authored-at-final-resolution art this repo has,
      // so it is what the property gets tested with.
      if (arm.key === "D") {
        const nc = commitToGrid(...asNative(S.c), pal, { native: true, derive: 20, factor: S.c.report.factor });
        const nFrames = crushCommitted(nc, nc.palette);
        const nClips = clipsOf(nc);
        const nm = score(nFrames, [...pal, ...nc.palette]);
        scores.push({
          key: "E", label: "native (round-trip of D)", texels: "native", palette: "derived",
          ...nm, sat: nm.sat / srcStats.sat,
          sOnly: { ...nm, sat: nm.sat / srcStats.sat },
          texelH: nc.report.texelH, verdict: nc.report.verdict,
        });
        palettes.E = nc.palette.map(hexOf);
        const nIdle = nFrames.filter((_, i) => nClips[i] === "idle");
        const nWalk = nFrames.filter((_, i) => nClips[i] === "walk");
        writeFileSync(join(OUT, "E-strip.png"), strip([...nIdle.slice(0, 2), ...nWalk.slice(0, 4)], 4).toBuffer("image/png"));
        writeFileSync(join(OUT, "E-head.png"), headCrop(nIdle[0] ?? nFrames[0], 10).toBuffer("image/png"));
        writeFileSync(join(OUT, "E-palette.png"), swatches(nc.palette).toBuffer("image/png"));

        // THE PROPERTIES, ASSERTED rather than eyeballed off the strip.
        expect(nc.report.texelH, "native round-trip changed the figure's height").toBe(S.c.report.texelH);
        expect(nc.palette.map(hexOf), "native round-trip re-derived a DIFFERENT palette")
          .toEqual(S.c.palette.map(hexOf));
      }
    }

    // ── F: THE PAINTED ROSTER, the absolute oracle ────────────────────────────
    //
    // Not an arm — it is what an actor authored AT final resolution by code
    // rather than reduced into it looks like through the same crush. Every
    // number above is only meaningful against this row.
    const painted = makeKnightPaints("sword");
    const pIdle = (painted.S.idle ?? []).map((f) => paintAtlas(f, G));
    const pWalk = (painted.S.walk ?? []).map((f) => paintAtlas(f, G));
    {
      const pm = score([...pIdle, ...pWalk], pal);
      const row = { ...pm, sat: pm.sat / srcStats.sat };
      scores.push({
        key: "F", label: "painted roster (oracle)", texels: "painted", palette: "shared",
        ...row, sOnly: row, texelH: 0,
        verdict: "the procedural knight, painted at final resolution by code",
      });
      writeFileSync(join(OUT, "F-strip.png"), strip([...pIdle.slice(0, 2), ...pWalk.slice(0, 4)], 4).toBuffer("image/png"));
      writeFileSync(join(OUT, "F-head.png"), headCrop(pIdle[0], 10).toBuffer("image/png"));
    }

    writeFileSync(
      join(OUT, "stats.json"),
      JSON.stringify({ grid: G, source: srcStats, scores, palettes }, null, 2) + "\n",
    );

    // The bench must produce something to look at, or it is a table pretending
    // to be evidence.
    for (const a of [...ARMS.map((a) => a.key), "E", "F"]) {
      expect(existsSync(join(OUT, `${a}-strip.png`)), `${a}: no strip written`).toBe(true);
    }
    expect(scores.length).toBe(6);
  }, 600_000);

  /**
   * THE SYNTH TUNING SURFACE, swept rather than asserted.
   *
   * `synth.ts`'s header claims compactness is the whole tuning surface and that
   * both ends fail in a specific way — too high gives square regions (a lattice
   * by another name), too low lets one region snake across the figure. That is
   * a falsifiable claim and it is worth exactly nothing until it is measured,
   * so this sweeps both knobs and writes the pictures to look at.
   */
  it.runIf(RUN)("sweeps the synth knobs and writes the strips", async () => {
    mkdirSync(OUT, { recursive: true });
    const pal = PAL();
    const s = await sheet("S");
    const rows: { regionTexels: number; compactness: number; m: Metrics }[] = [];
    for (const regionTexels of [3, 5, 7, 12, 20]) {
      for (const compactness of [0.2, 0.55, 1.5]) {
        const c = commitToGrid(s.img, s.rows, pal, {
          mode: "synth", derive: 20, synth: { regionTexels, compactness },
        });
        const frames = crushCommitted(c, c.palette);
        const clips = clipsOf(c);
        const m = score(frames, [...pal, ...c.palette]);
        rows.push({ regionTexels, compactness, m });
        const idle = frames.filter((_, i) => clips[i] === "idle");
        writeFileSync(
          join(OUT, `sweep-r${regionTexels}-c${String(compactness).replace(".", "p")}.png`),
          headCrop(idle[0] ?? frames[0], 8).toBuffer("image/png"),
        );
      }
    }
    writeFileSync(join(OUT, "sweep.json"), JSON.stringify(rows, null, 2) + "\n");
    expect(rows.length).toBe(15);
  }, 900_000);
});
