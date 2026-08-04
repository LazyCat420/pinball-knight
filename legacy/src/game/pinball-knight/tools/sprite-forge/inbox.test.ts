/**
 * SPRITE INBOX — drop sheets in a folder, get scored game-ready frames.
 *
 *     cp mysheet.png tools/sprite-forge/inbox/ratking-E.png
 *     npm run sprites
 *
 * Reads every PNG in `tools/sprite-forge/inbox/`, slices each into frames, puts
 * them on the painters' registration contract, runs them through the REAL crush,
 * censuses the result against the painted roster, and writes both the frames and
 * a nearest-upscaled preview to `tools/sprite-forge/work/<name>/`.
 *
 * Nothing here talks to a network. There is no generation step and no API key.
 *
 * ── WHERE THE PIPELINE ACTUALLY LIVES ──
 *
 * Slicing (`slice.ts`), matting (`matte.ts`), labelling and registration are
 * plain functions over pixel buffers, with no filesystem and no node-canvas
 * import. This file is only the NODE EDGE: it finds the files, decodes them,
 * and writes the output. A browser refiner drives the same functions with the
 * same arguments, which is the only way "what the tool shows" and "what CI
 * scores" can be guaranteed to agree.
 *
 * ── FILE NAMING ──
 *
 *   ratking-E.png   → creature "ratking", facing E (true side profile)
 *   ratking-S.png   → facing S (toward camera).  N = away.
 *   ratking.png     → creature "ratking", facing E, the default
 *
 * W is never authored: the engine draws it as E with a negative texture repeat.
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
import { installSpriteTestDom, SHIPPED_GRID, bufferFor } from "../../testkit/atlas-census";
import { censusCell, declaredSet, formatNoise, paletteRgb, type NoiseRow } from "../../render/atlas-census";
import { sliceSheet, equalCells, type Cell } from "./slice";
import { cellScalePx, crushCell, registerCell, sheetScale } from "./register";
import { labelRows, parseName, unknownClips } from "./labels";
import { detectPixelGrid } from "./grid";
import { commitToGrid, type CommitOptions } from "./commit";
import { matte, rgbHex, type MatteOptions } from "./matte";
import { ART_BOX, fitsArtBox, oneToOneScale, type SheetManifest } from "./manifest";
import { PALETTE_FAMILIES } from "../../render/palette";
import { hexOf, rgbOfHex } from "./palette-derive";

const ROOT = __dirname;
const INBOX = process.env.SPRITE_INBOX ?? join(ROOT, "inbox");
const WORK = process.env.SPRITE_WORK ?? join(ROOT, "work");
/**
 * Where the GAME reads imported art from.
 *
 * `work/` is a review directory — it holds crushed frames at one rung and a
 * contact sheet, both for looking at. What ships is the MATTED SOURCE plus its
 * cell rects, because the crush has to happen at runtime against whatever
 * camera rung the player is on. See `manifest.ts`.
 */
const PUBLIC = process.env.SPRITE_PUBLIC ?? join(ROOT, "..", "..", "..", "..", "..", "public", "sprites");
/** Authoring run (`npm run sprites`) rather than a measurement run. */
const PUBLISH = !!process.env.FORGE_PUBLISH;

/** Painter roster reference, measured at the shipped rung. */
const ROSTER = { entries: 20.1, isolatedPct: 22.5, runLen: 1.82 };

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

/**
 * Row → clip names, from an optional sidecar beside the sheet.
 *
 *     tools/sprite-forge/inbox/ratking-E.png
 *     tools/sprite-forge/inbox/ratking-E.json   { "rows": ["idle","attack","walk","stumble","death"] }
 *
 * A sidecar rather than reading the sheet's own captions, because the captions
 * are pixels — OCR'ing "SPRING ATTACK" to guess a ClipName would be a guess
 * dressed as a feature, and it would fail silently the first time a sheet used a
 * font this code had never seen. Rows are reported when the sidecar is missing,
 * so writing one takes a few seconds and is checkable.
 */
function readSidecar(dir: string, base: string): Sidecar | null {
  const file = join(dir, `${base}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Sidecar;
}

interface Sidecar {
  rows?: string[];
  /**
   * Per-SLICED-BAND cell counts. A plain number re-cuts that band into N equal
   * columns; an array splits it into consecutive clips of those sizes, and
   * `rows` then names one clip per resulting group rather than per band.
   */
  cells?: (number | number[])[];
  /**
   * EXACT cell rects per row, `[x0, y0, x1, y1]` inclusive — the slicer is
   * skipped entirely when this is present.
   *
   * `cells` (above) is a COUNT, and a count can only ever ask the slicer to try
   * again differently. This is the answer itself, and it exists because there
   * are sheets whose frame boundaries are not recoverable from the pixels at
   * all: the slicer separates poses at blank columns, so a pose holding a sword
   * out from the body — the knight's E sheet — splits into a body and a bare
   * blade, and publishes the blade as an animation frame. Measured on that
   * layout, an intra-pose gap (118-322 px) is INSIDE the range of a real frame
   * boundary (241-463 px); there is no threshold, and no merge-the-closest-pair
   * rule, that separates them.
   *
   * The producer of a sheet always knows this. `prep-knight.mjs` composes each
   * pose at a computed `(px, py, dw, dh)` and used to throw it away; it now
   * writes it here, and `commit.ts`'s repack writes its own rects the same way,
   * so both slices in the chain are exact rather than re-derived.
   *
   * Rects are trusted as given — they are ink-tight and, on a committed sheet,
   * lattice-aligned by construction. Re-deriving them is exactly the step this
   * removes.
   */
  rects?: number[][][];
  /**
   * Render-scale multiplier, copied into the shipped manifest. When absent, a
   * `scale` already present in the published manifest is carried forward —
   * these used to be hand-edits to `public/sprites/*.json`, and every re-run
   * of the forge silently deleted all of them (measured: beaver 1.21 → gone,
   * frog 1.55 → gone, stiltneck 0.91 → gone).
   */
  scale?: number;
  /** Background keying options — see matte.ts. */
  matte?: MatteOptions;
  /**
   * Write a GRID-COMMITTED copy of this sheet beside the frames — see commit.ts.
   *
   * Opt-in rather than automatic, and it does not touch `inbox/`. A commit
   * decides which 20 of 32 colours the creature keeps; that is an art decision
   * and it has to be looked at before it becomes the sheet. The run prints the
   * one command that promotes it.
   *
   * `bans` names palette FAMILIES (see `PALETTE_FAMILIES`) this creature's
   * materials must not use — e.g. the knight bans "rot" so its grey armor
   * cannot be snapped zombie-green. Translated to entry indices here, because
   * the sidecar is authored by a human and the family names are the vocabulary
   * the palette documents.
   */
  commit?: boolean | (CommitOptions & { bans?: string[] });
  /**
   * THIS SHEET'S OWN PALETTE, `#rrggbb` — written by a `derive` commit and
   * carried on the promoted sheet.
   *
   * ⚠️ IT MUST TRAVEL WITH THE PNG. A committed sheet's texels sit on these
   * colours and on nothing else; a promoted sheet that lost this field is
   * measured against the shared 32, every texel reads as off-palette, and the
   * run fails on `unmatched` with nothing pointing at the missing field. That
   * is the same promotion trap the `commit` block already documents.
   */
  palette?: string[];
}

/** Sidecar commit options with family names resolved to palette entries. */
function commitOpts(side: Sidecar): CommitOptions {
  if (typeof side.commit !== "object") return {};
  const { bans, ...rest } = side.commit;
  if (!bans?.length) return rest;
  const ban = bans.flatMap((f) => {
    const fam = PALETTE_FAMILIES[f];
    if (!fam) throw new Error(`sidecar bans unknown family "${f}" — known: ${Object.keys(PALETTE_FAMILIES).join(", ")}`);
    return [...fam];
  });
  return { ...rest, ban: [...new Set([...(rest.ban ?? []), ...ban])] };
}

/**
 * The `scale` the shipped manifest should carry: the sidecar's if set, else
 * whatever the already-published manifest carries. Returns a spread-ready
 * fragment so an absent scale stays ABSENT rather than becoming `scale: null`.
 */
function scaleFor(side: Sidecar | null, publishedPath: string): { scale: number } | null {
  if (typeof side?.scale === "number") return { scale: side.scale };
  try {
    const prev = JSON.parse(readFileSync(publishedPath, "utf8")) as SheetManifest;
    if (typeof prev.scale === "number") return { scale: prev.scale };
  } catch {
    /* first publish — nothing to carry */
  }
  return null;
}

/** Share of the sheet that is already transparent. */
function clearShare(data: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) n++;
  return n / (data.length / 4);
}

/**
 * Below this much transparency the sheet has no usable alpha and is matted.
 *
 * Not zero: a generator sometimes emits a few stray transparent pixels, and a
 * hand-keyed sheet always has a large clear field. 5% separates "someone keyed
 * this" from "this arrived as a flat JPEG-alike with an opaque background",
 * which is every sheet a diffusion model produces.
 */
const OPAQUE_BELOW = 0.05;

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
    const pal = paletteRgb();
    const summary: string[] = [];

    for (const file of sheets) {
      const { name, dir } = parseName(file);
      const side = readSidecar(INBOX, file.replace(/\.png$/i, ""));
      const sheet = await loadImage(join(INBOX, file));
      const sc = createCanvas(sheet.width, sheet.height);
      const sctx = sc.getContext("2d");
      sctx.drawImage(sheet, 0, 0);
      const img = sctx.getImageData(0, 0, sheet.width, sheet.height);
      let sdata = img.data as unknown as Uint8ClampedArray;

      // ── MATTE FIRST, if the sheet arrived opaque.
      //
      // Every sheet an image generator produces does: diffusion models have no
      // alpha channel to write, so the background is a flat white or cream
      // field. Slicing finds cells by alpha, so without this the sheet returns
      // one cell and the run aborts before anything else is measured.
      let matteLine = "";
      if (clearShare(sdata) < OPAQUE_BELOW) {
        const res = matte(sdata, sheet.width, sheet.height, side?.matte);
        const r = res.report;
        expect(r.failures, `${file}: ${r.failures.join(" / ")}`).toEqual([]);
        sdata = res.data;
        // Put the keyed pixels back on the canvas — `registerCell` blits from
        // this, so the source it samples has to be the matted one.
        img.data.set(sdata as unknown as Uint8ClampedArray);
        sctx.putImageData(img, 0, 0);
        matteLine =
          `MATTE  bg ${rgbHex(r.bg)} (${(r.bgConfidence * 100).toFixed(0)}% of the border) — ` +
          `keyed ${(r.keyedPct * 100).toFixed(1)}%` +
          (r.autoKeyed.length ? `, ${r.autoKeyed.length} sealed pocket(s) opened` : "") +
          (r.enclosed.length ? `, ${r.enclosed.length} pocket(s) LEFT OPAQUE` : "") + "\n" +
          r.warnings.map((x) => `⚠ ${x}`).join("\n") + (r.warnings.length ? "\n" : "");
      }

      // DECLARED rects skip the slicer outright — see `Sidecar.rects`.
      const declared = side?.rects?.map((cells) => ({ cells: cells.map((c) => [...c] as Cell) }));
      const sliced = declared ?? sliceSheet(sdata, sheet.width, sheet.height);
      if (declared) {
        // A declared rect that has no ink under it means the sidecar and the
        // PNG came from different runs — a stale `rects` block silently
        // publishes empty frames, which is the same disappearing-sprite failure
        // it was written to remove, just from the other direction.
        const empty: string[] = [];
        declared.forEach((r, ri) =>
          r.cells.forEach((c, ci) => {
            let ink = 0;
            for (let y = Math.max(0, c[1]); y <= Math.min(sheet.height - 1, c[3]); y++)
              for (let x = Math.max(0, c[0]); x <= Math.min(sheet.width - 1, c[2]); x++)
                if (sdata[(y * sheet.width + x) * 4 + 3] > 8) ink++;
            if (ink === 0) empty.push(`row ${ri} cell ${ci} [${c.join(",")}]`);
          }),
        );
        expect(empty, `${file}: declared rects with no ink under them — is the sidecar stale?`).toEqual([]);
      }
      // A sheet that slices into one cell is usually a solid background that was
      // never keyed out, or ruled lines this did not recognise. Say so plainly:
      // every number downstream would otherwise describe one big rectangle.
      const found = sliced.flatMap((r) => r.cells).length;
      expect(found, `${file}: sliced into ${found} cell(s) — is the background transparent?`)
        .toBeGreaterThan(1);

      const named = side?.rows;
      // An explicit per-row cell count OVERRIDES the auto-slice. On a ruled
      // sheet it is the difference between right and roughly-right.
      //
      // A NESTED count splits one sliced band into consecutive clips —
      // `"cells": [[5, 5], 5, 2, 3]` says the first band holds two animations
      // of five. Sheets do that whenever two short clips fit side by side, and
      // a band is a band to the slicer: stiltneck's idle and walk shared one,
      // so the pair could only be named `walk`, which left it with no `idle`
      // and therefore no imported art at all.
      let rows = sliced;
      if (side?.cells) {
        expect(side.cells.length, `${file}: sidecar lists ${side.cells.length} row counts but ${sliced.length} rows were found`)
          .toBe(sliced.length);
        rows = sliced.flatMap((r, i) => {
          const spec = side.cells![i];
          if (!Array.isArray(spec)) return [{ ...r, cells: equalCells(r, spec) }];
          const total = spec.reduce((a, b) => a + b, 0);
          // Regroup the AUTO-SLICED cells when the counts already agree: those
          // rects are ink-tight, and re-cutting the band into equal columns
          // would straddle the gap the two clips are separated by.
          const all = r.cells.length === total ? r.cells : equalCells(r, total);
          let at = 0;
          return spec.map((n) => ({ ...r, cells: all.slice(at, (at += n)) }));
        });
      }
      const cells: Cell[] = rows.flatMap((r) => r.cells);
      const shape = rows.map((r) => r.cells.length).join("/");
      const labels = labelRows(rows.map((r) => r.cells.length), named);

      // The LIVING rows vote on the scale; a death sprawl only clamps itself.
      // Without sidecar names every row is "alive" — same rule as aliveScale.
      const aliveCells: Cell[] = named
        ? rows.flatMap((r, i) => (named[i] === "death" ? [] : r.cells))
        : cells;
      // THE GATE — is this art reducible, or only resamplable? Measured on the
      // MATTED pixels (`img.data` was written back above), over the sliced
      // cells so the flat background cannot dilute the sample.
      const grid = detectPixelGrid(
        { width: sheet.width, height: sheet.height, data: sdata },
        cells as unknown as number[][],
      );

      // ── THE SCALE, MIRRORING `importedPaints` EXACTLY.
      //
      // ⚠️ This used to be `sheetScale` unconditionally, and that made the whole
      // report describe a path the game no longer takes. A committed sheet is
      // built so one authored pixel lands on one atlas texel; measuring it at
      // the FITTED scale re-introduced the fractional resample the commit exists
      // to remove, and censused a 20-entry sheet at 29.4 entries. The forge has
      // to run the shipped decision, not a differently-shaped one.
      //
      // `oneToOneScale` is in ART UNITS per source pixel; `sheetScale` is in
      // DEVICE px per source pixel, so the conversion is the same `px/ART_BOX`
      // unit `cellPaint` applies.
      const gridN = grid.gridded ? grid.factor : 1;
      const oneToOne = gridN > 1 ? oneToOneScale(gridN, G) : 0;
      const fitCells = aliveCells.length ? aliveCells : cells;
      const exact = oneToOne > 0 && fitsArtBox(fitCells, oneToOne);
      if (oneToOne > 0 && !exact) {
        summary.push(
          `⚠ ${file}: has a ×${gridN} grid but is too large to import 1:1 at atlas ${G} — ` +
            `measured on the fitted resample instead. Re-commit it smaller to keep 1:1.`,
        );
      }
      const k = exact ? oneToOne * (px / ART_BOX) : sheetScale(fitCells, px);
      // ⚠️ PER FACING, NOT PER CREATURE. This `rmSync` clears the run's own
      // stale output, and while the directory was `work/<name>` the two facings
      // of a two-sheet creature shared it: `pinball_knight-N` was processed
      // first (readdir order), then `pinball_knight-S` deleted everything N had
      // just written. The committed sheet the run tells you to promote is
      // written here, so only one of the two ever existed to promote — and the
      // frame dumps carry a `<dir>-` prefix, which made the survivor look like
      // a complete creature rather than half of one.
      // ── THIS SHEET'S OWN COLOURS, if it declared any ──────────────────────
      //
      // Appended to the shared palette rather than replacing it, exactly as the
      // runtime does (`SheetBuildOptions.sheetPalette`) — the forge has to
      // measure the decision the game makes, not a differently-shaped one.
      const ownPal = side?.palette?.length ? side.palette.map(rgbOfHex) : null;
      const snapPal = ownPal ? [...pal, ...ownPal] : pal;

      const outDir = join(WORK, `${name}-${dir}`);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });

      const stats: NoiseRow[] = [];
      const previews: ImageData[] = [];
      for (let i = 0; i < cells.length; i++) {
        // Blit from the CANVAS, not the decoded image: after matting they
        // differ, and the image still has its opaque background.
        const buf = registerCell(
          sc as unknown as CanvasImageSource,
          cells[i],
          exact ? k : cellScalePx(cells[i], k, px),
          px,
          exact ? px / G : 1,
          exact ? gridN : 0,
        );
        const bctx = buf.getContext("2d");
        if (!bctx) throw new Error("[ingest] no 2D context for the cel buffer");
        const declared = declaredSet(bctx.getImageData(0, 0, px, px).data, snapPal);

        const img = crushCell(buf, G, ownPal ?? undefined);
        const st = censusCell(img.data, G, snapPal);
        expect(st.opaque, `${file} ${labels[i]}: crushed to an EMPTY cell`).toBeGreaterThan(20);
        expect(st.unmatched, `${file} ${labels[i]}: off-palette texels after the snap`).toBe(0);

        const cel = createCanvas(G, G);
        (cel.getContext("2d") as unknown as CanvasRenderingContext2D).putImageData(img, 0, 0);
        writeFileSync(join(outDir, `${dir}-${labels[i]}.png`), cel.toBuffer("image/png"));
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
      writeFileSync(join(outDir, "preview.png"), pv.toBuffer("image/png"));

      // ── SHIP THE MATTED SOURCE, not the crushed frames.
      //
      // `sc` is the sheet after keying. Written at full resolution with the cell
      // rects beside it, so the game can scale each cell into the art box and
      // crush it at the rung the player is actually on — all five of them.
      //
      // ⚠️ ONLY WHEN ASKED. Publishing is an AUTHORING action and this is a
      // TEST FILE, so a plain `vitest run` used to rewrite tracked art under
      // `public/sprites/` as a side effect of measuring it. Two costs, both
      // paid for real:
      //
      //   · a green run left a dirty tree that looked like someone's unfinished
      //     art, and `deploy.sh` ships the WORKING TREE.
      //   · it RACED the rest of the suite. `published.test.ts` reads the same
      //     PNGs, vitest shards run in parallel, and a reader landing mid-write
      //     gets `error while reading from input stream` from node-canvas. It
      //     aborted two deploys of this very change, and the first time it was
      //     dismissed as flaky because a retry passed.
      //
      // `npm run sprites` sets FORGE_PUBLISH; the deploy gate does not, and
      // then this file only MEASURES the art that is already committed.
      if (PUBLISH) {
        mkdirSync(PUBLIC, { recursive: true });
        writeFileSync(join(PUBLIC, `${name}-${dir}.png`), sc.toBuffer("image/png"));
      }
      const manifest: SheetManifest = {
        name, dir: dir as SheetManifest["dir"],
        image: `/sprites/${name}-${dir}.png`,
        source: [sheet.width, sheet.height],
        // The measured lattice, so the RUNTIME can choose between an exact
        // block reduce and a resample without re-measuring 1.6M pixels on every
        // boot. Omitted when there is none, so the field's presence means
        // "this sheet can import 1:1" and nothing weaker.
        ...(grid.gridded ? { grid: grid.factor } : {}),
        // Sidecar wins; otherwise a scale someone already shipped survives the
        // re-run. Building this object fresh every run is what used to delete
        // every hand-set scale in public/sprites (see the Sidecar docs above).
        ...(scaleFor(side, join(PUBLIC, `${name}-${dir}.json`)) ?? {}),
        // The sheet's own palette, so the runtime can append it to the shared
        // one for this actor's atlas. Absent means "shared palette", which is
        // every sheet committed before 2026-08-04.
        ...(side?.palette?.length ? { palette: side.palette } : {}),
        rows: rows.map((r, ri) => ({ clip: named?.[ri] ?? `row${ri}`, cells: r.cells })),
      };
      if (PUBLISH) {
        writeFileSync(join(PUBLIC, `${name}-${dir}.json`), JSON.stringify(manifest, null, 1) + "\n");
      }

      // ── THE GRID COMMIT, when the sidecar asks for one.
      //
      // Written to `work/`, never to `inbox/`. Promoting it is one copy the
      // artist makes after LOOKING at it, because the commit evicts colours and
      // an eviction nobody saw is how a creature quietly loses its costume.
      let commitLine = "";
      if (side?.commit) {
        const copts = commitOpts(side);
        const c = commitToGrid(
          { width: sheet.width, height: sheet.height, data: sdata },
          manifest.rows,
          pal,
          copts,
        );
        // Prove the claim rather than printing it: a committed sheet that does
        // not pass the gate it was built to pass is a bug, and it must stop the
        // run here rather than be discovered on load.
        const cg = detectPixelGrid(c.image, c.rows.flatMap((r) => r.cells) as unknown as number[][]);
        expect(cg.gridded, `${file}: the COMMITTED sheet still fails the gate — ${cg.verdict}`).toBe(true);
        expect(cg.factor, `${file}: committed at ×${c.report.factor} but the gate reads ×${cg.factor}`)
          .toBe(c.report.factor);

        const cc = createCanvas(c.image.width, c.image.height);
        const cctx = cc.getContext("2d");
        const cimg = cctx.createImageData(c.image.width, c.image.height);
        cimg.data.set(c.image.data as unknown as Uint8ClampedArray);
        cctx.putImageData(cimg, 0, 0);
        const cname = `${name}-${dir}.png`;
        writeFileSync(join(outDir, cname), cc.toBuffer("image/png"));
        // ⚠️ NO `cells` OVERRIDE on a committed sheet, deliberately — but the
        // exact `rects` ARE written, and they are not the same thing.
        //
        // `equalCells` divides a row into N EQUAL columns, which is right for a
        // ruled sheet and destroys a committed one: the cell stops being ink-
        // tight, so its width stops being a whole number of blocks (measured,
        // 195px against a ×8 lattice) and the 1:1 reduce degrades to a
        // fractional resample — the exact defect the commit removes.
        //
        // `rects` are the repack's OWN output, ink-tight and lattice-aligned by
        // construction, so declaring them re-derives nothing and loses nothing.
        // Without them the promoted sheet is sliced from scratch a second time
        // and hits the same blank-column defect the first slice did: the
        // knight's E sheet came back with a bare sword blade as a frame both
        // times. The `commit` block is carried too — a promoted sheet that lost
        // it re-publishes UNCOMMITTED on the next run, 43,000 colours deep and
        // with no `grid`, which is exactly how the player's sprite silently
        // reverted to soft art once already.
        writeFileSync(
          join(outDir, `${name}-${dir}.json`),
          JSON.stringify(
            {
              rows: manifest.rows.map((r) => r.clip),
              rects: c.rows.map((r) => r.cells),
              ...(side.commit !== undefined ? { commit: side.commit } : {}),
              // Without this the promoted sheet is measured against the shared
              // palette it is no longer on — see `Sidecar.palette`.
              ...(c.derived ? { palette: c.palette.map(hexOf) } : {}),
              ...(side.matte ? { matte: side.matte } : {}),
              ...(side.scale !== undefined ? { scale: side.scale } : {}),
            },
            null,
            1,
          ) + "\n",
        );
        commitLine =
          `COMMIT ${c.report.verdict}\n` +
          `       GATE re-measured on the committed sheet: ${cg.verdict}\n` +
          `       promote with:  cp ${join(outDir, cname)} ${join(INBOX, cname)} && ` +
          `cp ${join(outDir, `${name}-${dir}.json`)} ${join(INBOX, `${name}-${dir}.json`)}\n`;
      }

      const mean = (f: (r: NoiseRow) => number): number => stats.reduce((a, r) => a + f(r), 0) / stats.length;
      const iso = mean((r) => r.isolatedPct);
      const run = mean((r) => r.runLen);
      const verdict =
        run > ROSTER.runLen && iso < ROSTER.isolatedPct ? "BETTER than the painted roster"
          : iso < 40 ? "COMPETITIVE — inside the roster's range"
            : "WORSE than the painted roster — too busy for this crush";
      const unknown = unknownClips(named);
      // ── THE GATE THAT SHIPS A PERFECT REPORT AND NO ART ──
      //
      // `importedPaints` returns null when the facing it falls back to has no
      // `idle` — that is where `withRecoil` derives stagger and wake from, and
      // where the animator lands for any clip the actor does not author. The
      // whole sheet is then dropped and the monster keeps its painter, with a
      // COMPETITIVE verdict sitting in this report saying it shipped. That is
      // exactly what happened to the zombie: six rows, 24 frames, published to
      // public/sprites, and never once drawn.
      const noIdle = named && !named.includes("idle");

      summary.push(
        `\n═══ ${name} (${dir}) — ${rows.length} rows [${shape}], ${cells.length} frames\n` +
          `GRID   ${grid.verdict}\n` +
          commitLine +
          matteLine +
          (named
            ? unknown.length
              ? `⚠ not ClipNames the animator packs: ${unknown.join(", ")}\n`
              : ""
            : `⚠ no row names. Write ${file.replace(/\.png$/i, ".json")}:\n` +
              `    { "rows": [${rows.map((_, i) => `"row${i}"`).join(", ")}] }\n`) +
          (noIdle
            ? `⚠ NO "idle" ROW — unless another facing of ${name} authors one, the game will\n` +
              `  DROP this whole sheet and keep the painter. Name the calmest cycle "idle".\n`
            : "") +
          `${formatNoise(stats)}\n` +
          `MEAN   entries ${mean((r) => r.entries).toFixed(1)}  isolated ${iso.toFixed(1)}%  runLen ${run.toFixed(2)}\n` +
          `ROSTER entries ${ROSTER.entries}  isolated ${ROSTER.isolatedPct}%  runLen ${ROSTER.runLen}\n` +
          `VERDICT: ${verdict}\n` +
          `→ ${outDir}  (frames + preview.png)`,
      );
    }
    // Written as well as logged: vitest swallows console output unless a test
    // fails, so the one artifact you actually want to read after a run was the
    // one you could not see.
    writeFileSync(join(WORK, "report.txt"), summary.join("\n").replace(/\[[0-9;]*m/g, ""));
    console.log(summary.join("\n"));
  }, 600_000);
});
