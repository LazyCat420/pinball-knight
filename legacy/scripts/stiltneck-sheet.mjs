/**
 * STILTNECK SHEET — every clip, every facing, rendered through the REAL
 * pipeline: paintInArtSpace (162px rasterisation, the 162/128 art transform)
 * → crushToGrid (the exact ×2 premultiplied box filter + snap the game ships).
 *
 * The first version of this file painted the 128-unit cel directly and crushed
 * THAT — a 128→81 fractional blit through a path production never takes. The
 * art it showed was measurably different from the atlas the GPU samples (the
 * live atlas censused 27% ink / 18% torch while the cel read ~35% / ~25%), and
 * the stiltneck shipped brown because review happened on the wrong picture.
 * Rule: contact sheets show `__dungeonAtlas` truth or they are concept art.
 *
 *   node scripts/stiltneck-sheet.mjs
 *   node scripts/stiltneck-sheet.mjs --dirs E --clips idle,attack
 *
 * Prints a per-clip palette census (torch/leather/ink shares) alongside the
 * cells, because "does it read gold" is a number before it is an opinion.
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const out = resolve(arg("out", "scratchpad/stiltneck-sheet.png"));
const dirs = arg("dirs", "S,N,E").split(",");
const clips = arg("clips", "idle,walk,attack,stumble,death").split(",");

const js = await bundle(`
import { makeStiltneckPaints } from "./src/game/pinball-knight/render/monsters/stiltneck";
import { paintInArtSpace, crushToGrid } from "./src/game/pinball-knight/engine/render/sprite";
import { SPRITE_PX } from "./src/game/pinball-knight/constants";
import { setEnginePalette } from "./src/game/pinball-knight/engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./src/game/pinball-knight/render/palette";
// LOAD-BEARING — see foe-sheet.mjs. Without this every body part paints in the
// engine's greyscale fallback and the sheet looks like an art bug that is not.
setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
window.__sn = { makeStiltneckPaints, paintInArtSpace, crushToGrid, SPRITE_PX, PALETTE_HEX };
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 2px 16px}
 .census{color:#7d8a99;font-size:10px;margin:0 0 6px 16px}
 .row{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px}
 figure{margin:0;text-align:center}
 canvas{display:block;background:#141821;border:1px solid #232833;border-radius:4px;image-rendering:pixelated}
 figcaption{padding-top:2px;font-size:9px}
</style>
<div id=host></div>
<script>${js}</script>
<script>
 const { makeStiltneckPaints, paintInArtSpace, crushToGrid, SPRITE_PX, PALETTE_HEX } = window.__sn;
 const paints = makeStiltneckPaints();
 const host = document.getElementById("host");

 // The real rasterisation buffer, reused like paintFrame's scratch.
 const buf = document.createElement("canvas");
 buf.width = SPRITE_PX; buf.height = SPRITE_PX;
 const bctx = buf.getContext("2d", { willReadFrequently: true });

 function atlasCell(f) {
   bctx.setTransform(1, 0, 0, 1, 0, 0);
   bctx.clearRect(0, 0, SPRITE_PX, SPRITE_PX);
   paintInArtSpace(bctx, f);
   return crushToGrid(buf); // a fresh 81px canvas of EXACT palette entries
 }

 const PAL = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
 function census(cell) {
   const g = cell.width;
   const d = cell.getContext("2d").getImageData(0, 0, g, g).data;
   const counts = new Array(PAL.length).fill(0);
   let tot = 0;
   for (let i = 0; i < d.length; i += 4) {
     if (d[i + 3] < 8) continue;
     tot++;
     for (let p = 0; p < PAL.length; p++) {
       if (d[i] === PAL[p][0] && d[i + 1] === PAL[p][1] && d[i + 2] === PAL[p][2]) { counts[p]++; break; }
     }
   }
   const pct = (idx) => (100 * idx.reduce((s, i) => s + counts[i], 0) / Math.max(1, tot)).toFixed(1);
   return \`torch(14-18) \${pct([14,15,16,17,18])}% · leather(26-28) \${pct([26,27,28])}% · ink(1) \${pct([1])}% · void(0) \${pct([0])}% · skin(23-25) \${pct([23,24,25])}%\`;
 }

 for (const dir of ${JSON.stringify(dirs)}) {
   for (const clip of ${JSON.stringify(clips)}) {
     const frames = paints[dir]?.[clip] ?? [];
     if (!frames.length) continue;
     const cells = frames.map(atlasCell);
     const h = document.createElement("h2");
     h.textContent = dir + " / " + clip + " — REAL atlas cells (81) · played 52";
     host.appendChild(h);
     const cen = document.createElement("div");
     cen.className = "census";
     cen.textContent = census(cells[0]);
     host.appendChild(cen);
     const row = document.createElement("div");
     row.className = "row";
     host.appendChild(row);
     cells.forEach((cell, fi) => {
       for (const px of [324, 81, 52]) {
         const fig = document.createElement("figure");
         const cv = document.createElement("canvas");
         cv.width = px; cv.height = px;
         const c = cv.getContext("2d");
         c.imageSmoothingEnabled = false;
         c.drawImage(cell, 0, 0, px, px);
         fig.appendChild(cv);
         const cap = document.createElement("figcaption");
         cap.textContent = "f" + fi + " @" + px;
         fig.appendChild(cap);
         row.appendChild(fig);
       }
     });
   }
 }
 window.__ready = true;
</script>`;

const { browser, page } = await open(html, { width: 1560, height: 900 });
save(out, await page.screenshot({ fullPage: true }));
await browser.close();
