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
 * ── WHERE THE PIPELINE ACTUALLY LIVES ──
 *
 * `render/ingest/` — slicing, labelling and registration are plain functions
 * over pixel buffers, with no filesystem and no node-canvas import. This file is
 * now only the NODE EDGE: it finds the files, decodes them, and writes the
 * output. The browser refiner at `/sprites` drives the same functions with the
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
import { installSpriteTestDom, SHIPPED_GRID, bufferFor } from "../testkit/atlas-census";
import { censusCell, declaredSet, formatNoise, paletteRgb, type NoiseRow } from "./atlas-census";
import { sliceSheet, equalCells, type Cell } from "./ingest/slice";
import { crushCell, registerCell, sheetScale } from "./ingest/register";
import { labelRows, parseName, unknownClips } from "./ingest/labels";

const ROOT = join(__dirname, "..", "..", "..", "..", "scripts", "sprites");
const INBOX = process.env.SPRITE_INBOX ?? join(ROOT, "inbox");
const WORK = process.env.SPRITE_WORK ?? join(ROOT, "work");

/** Painter roster reference, measured at the shipped rung. */
const ROSTER = { entries: 20.1, isolatedPct: 22.5, runLen: 1.82 };

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

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
      const sheet = await loadImage(join(INBOX, file));
      const sc = createCanvas(sheet.width, sheet.height);
      const sctx = sc.getContext("2d");
      sctx.drawImage(sheet, 0, 0);
      const sdata = sctx.getImageData(0, 0, sheet.width, sheet.height).data as unknown as Uint8ClampedArray;

      const rows = sliceSheet(sdata, sheet.width, sheet.height);
      // A sheet that slices into one cell is usually a solid background that was
      // never keyed out, or ruled lines this did not recognise. Say so plainly:
      // every number downstream would otherwise describe one big rectangle.
      const found = rows.flatMap((r) => r.cells).length;
      expect(found, `${file}: sliced into ${found} cell(s) — is the background transparent?`)
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
      const cells: Cell[] = rows.flatMap((r) => r.cells);
      const shape = rows.map((r) => r.cells.length).join("/");
      const labels = labelRows(rows.map((r) => r.cells.length), named);

      const k = sheetScale(cells, px);
      const outDir = join(WORK, name);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });

      const stats: NoiseRow[] = [];
      const previews: ImageData[] = [];
      for (let i = 0; i < cells.length; i++) {
        const buf = registerCell(sheet as unknown as CanvasImageSource, cells[i], k, px);
        const bctx = buf.getContext("2d");
        if (!bctx) throw new Error("[ingest] no 2D context for the cel buffer");
        const declared = declaredSet(bctx.getImageData(0, 0, px, px).data, pal);

        const img = crushCell(buf, G);
        const st = censusCell(img.data, G, pal);
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

      const mean = (f: (r: NoiseRow) => number): number => stats.reduce((a, r) => a + f(r), 0) / stats.length;
      const iso = mean((r) => r.isolatedPct);
      const run = mean((r) => r.runLen);
      const verdict =
        run > ROSTER.runLen && iso < ROSTER.isolatedPct ? "BETTER than the painted roster"
          : iso < 40 ? "COMPETITIVE — inside the roster's range"
            : "WORSE than the painted roster — too busy for this crush";
      const unknown = unknownClips(named);

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
