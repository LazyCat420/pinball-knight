/**
 * SCORE A CANDIDATE SPRITE against the painter roster — the A/B judge.
 *
 * Generated art (or any imported image) has to survive the SAME pipeline the
 * painters do: rasterised into the art box, area-downscaled to the atlas grid,
 * and snapped to the 32-colour palette. This scores a candidate PNG on exactly
 * the metrics the roster is gated on, so "AI sprites vs painted sprites" is
 * settled by measurement rather than by which one looks better in a preview at
 * 8x zoom.
 *
 *   SPRITE_IN=/abs/candidate.png npx vitest run src/game/pinball-knight/render/sprite-score
 *   SPRITE_IN=/abs/dir_of_pngs   ... (scores every .png in the directory)
 *   SPRITE_OUT=/abs/preview.png  ... (also writes a before/after contact sheet)
 *
 * ── WHY THE CANDIDATE MUST BE JUDGED HERE AND NOT IN AN IMAGE VIEWER ──
 *
 * A 1024px generated sprite has tens of thousands of colours and looks great.
 * The product is 63 texels in 32 colours. The census on the roster measured the
 * gap directly: the older `cel-painter.ts` monsters, which paint in free
 * rgba()/hex rather than palette indices, declare almost NO exact-palette pixels
 * (spider declares zero), so every colour in their atlas is one the quantizer
 * chose for them. Imported art starts in exactly that position, only more so.
 *
 * The reference numbers to beat, measured 2026-07-29 over 20 painted actors at
 * the shipped rung (grid 63), after the unsharp mask was retired:
 *
 *     roster mean   entries 20.1   isolated 22.5%   runLen 1.82
 *     cleanest      golem     15          6.9%             2.64
 *     busiest       jester    32         34.9%             1.50
 *
 * A candidate is COMPETITIVE if it lands inside the roster's range, and BETTER
 * only if it beats the mean on runLen and isolated% at the same time — a sprite
 * can always score well on one by being duller.
 *
 * ⚠️ FEED IT THE SOURCE ART, NOT SOMETHING ALREADY PIXELATED. Handing this a
 * nearest-upscaled atlas cell scored runLen 4.98 against the roster's 1.82 and
 * reported "BETTER" — of course it did: the input was already 32-colour, already
 * flat, already blocky, and the crush had nothing left to destroy. The metrics
 * measure WHAT THE CRUSH DOES TO ART, so a candidate that has been through a
 * crush (or was drawn at the target resolution by hand) is not being compared on
 * the same terms as a painter's smooth vector cel. The `runLen > 3` case is the
 * tell; treat it as "input was pre-pixelated", not as a win.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas, loadImage } from "canvas";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crushToGrid } from "../engine/render/sprite";
import { installSpriteTestDom, SHIPPED_GRID, bufferFor } from "../testkit/atlas-census";
import { censusCell, declaredSet, formatNoise, paletteRgb, type NoiseRow } from "./atlas-census";

const IN = process.env.SPRITE_IN;
const OUT = process.env.SPRITE_OUT;

/** Painter roster reference, measured 2026-07-29 at grid 63. */
const ROSTER = { entries: 20.1, isolatedPct: 22.5, runLen: 1.82 };

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

function pngsUnder(path: string): string[] {
  return statSync(path).isDirectory()
    ? readdirSync(path).filter((f) => f.endsWith(".png")).sort().map((f) => join(path, f))
    : [path];
}

describe.skipIf(!IN)("candidate sprite score", () => {
  it("scores every candidate through the production crush", async () => {
    const files = pngsUnder(IN!);
    expect(files.length, `no PNGs under ${IN}`).toBeGreaterThan(0);

    const G = SHIPPED_GRID;
    const px = bufferFor(G);
    const pal = paletteRgb();
    const rows: NoiseRow[] = [];
    const cells: { name: string; img: ImageData }[] = [];

    for (const file of files) {
      const src = await loadImage(file);
      // Fit the candidate into the art box preserving aspect, feet to the
      // bottom, centred — the painters' registration contract (CX 64, GROUND
      // 118 of 128), expressed at buffer scale. A candidate that is not
      // registered the same way is not being compared on the same terms.
      const buf = createCanvas(px, px);
      const ctx = buf.getContext("2d");
      ctx.clearRect(0, 0, px, px);
      const groundY = px * (118 / 128);
      const maxH = px * (110 / 128);
      const maxW = px * (108 / 128);
      const k = Math.min(maxW / src.width, maxH / src.height);
      const w = src.width * k;
      const h = src.height * k;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(src, (px - w) / 2, groundY - h, w, h);

      const declared = declaredSet(ctx.getImageData(0, 0, px, px).data as unknown as Uint8ClampedArray, pal);
      const cell = crushToGrid(buf as unknown as HTMLCanvasElement, G);
      const img = (cell.getContext("2d") as unknown as CanvasRenderingContext2D).getImageData(0, 0, G, G);
      const st = censusCell(img.data, G, pal);

      // ANTI-VACUITY: a fully transparent or failed load scores as a perfect
      // sprite on every metric here.
      expect(st.opaque, `${file}: crushed to an EMPTY cell`).toBeGreaterThan(300);
      expect(st.unmatched, `${file}: off-palette texels after the snap`).toBe(0);

      const invented = st.counts.reduce((n, c, i) => n + (c > 0 && !declared.has(i) ? 1 : 0), 0);
      rows.push({
        key: file.split("/").pop()!.replace(/\.png$/, ""),
        entries: st.entries, isolatedPct: st.isolatedPct, runLen: st.runLen, invented,
      });
      cells.push({ name: file, img });
    }

    const mean = (f: (r: NoiseRow) => number): number => rows.reduce((a, r) => a + f(r), 0) / rows.length;
    const verdict =
      mean((r) => r.runLen) > ROSTER.runLen && mean((r) => r.isolatedPct) < ROSTER.isolatedPct
        ? "BETTER than the painter roster"
        : mean((r) => r.entries) <= 32 && mean((r) => r.isolatedPct) < 40
          ? "COMPETITIVE — inside the roster's range, not ahead of its mean"
          : "WORSE than the painter roster";

    console.log(
      `\n${formatNoise(rows)}\n\n` +
        `CANDIDATE mean  entries ${mean((r) => r.entries).toFixed(1)}  ` +
        `isolated ${mean((r) => r.isolatedPct).toFixed(1)}%  runLen ${mean((r) => r.runLen).toFixed(2)}\n` +
        `PAINTERS  mean  entries ${ROSTER.entries}  isolated ${ROSTER.isolatedPct}%  runLen ${ROSTER.runLen}\n` +
        `VERDICT: ${verdict}\n`,
    );

    if (OUT) {
      const Z = 6;
      const sheet = createCanvas(cells.length * (G * Z + 8) + 8, G * Z + 16);
      const c = sheet.getContext("2d");
      c.fillStyle = "#14161c";
      c.fillRect(0, 0, sheet.width, sheet.height);
      c.imageSmoothingEnabled = false;
      cells.forEach((cell, i) => {
        const tmp = createCanvas(G, G);
        (tmp.getContext("2d") as unknown as CanvasRenderingContext2D).putImageData(cell.img, 0, 0);
        c.drawImage(tmp, 8 + i * (G * Z + 8), 8, G * Z, G * Z);
      });
      writeFileSync(OUT, sheet.toBuffer("image/png"));
      console.log(`wrote ${OUT}`);
    }
  }, 300_000);
});
