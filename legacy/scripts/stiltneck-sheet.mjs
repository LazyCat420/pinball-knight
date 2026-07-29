/**
 * STILTNECK SHEET — every clip, every facing, at authored and played size.
 *
 * Same job as foe-sheet.mjs, pinned to one painter and showing the whole clip
 * table at once: the point of this creature is a NECK THAT MOVES, and a single
 * frame cannot show whether the sling reads. The crush is applied before the
 * small views so what is on screen is what the game draws, not a re-render.
 *
 *   node scripts/stiltneck-sheet.mjs
 *   node scripts/stiltneck-sheet.mjs --dirs E --clips attack,death
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const out = resolve(arg("out", "scratchpad/stiltneck-sheet.png"));
const dirs = arg("dirs", "S,N,E").split(",");
const clips = arg("clips", "idle,walk,attack,stumble,death").split(",");

const js = await bundle(`
import { makeStiltneckPaints } from "./src/game/pinball-knight/render/monsters/stiltneck";
import { crushToGrid } from "./src/game/pinball-knight/engine/render/sprite";
import { setEnginePalette } from "./src/game/pinball-knight/engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./src/game/pinball-knight/render/palette";
// LOAD-BEARING — see foe-sheet.mjs. Without this every body part paints in the
// engine's greyscale fallback and the sheet looks like an art bug that is not.
setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
window.__sn = { makeStiltneckPaints, crushToGrid };
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 6px 16px}
 .row{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px}
 figure{margin:0;text-align:center}
 canvas{display:block;background:#141821;border:1px solid #232833;border-radius:4px;image-rendering:pixelated}
 figcaption{padding-top:2px;font-size:9px}
</style>
<div id=host></div>
<script>${js}</script>
<script>
 const { makeStiltneckPaints, crushToGrid } = window.__sn;
 const paints = makeStiltneckPaints();
 const host = document.getElementById("host");
 for (const dir of ${JSON.stringify(dirs)}) {
   for (const clip of ${JSON.stringify(clips)}) {
     const frames = paints[dir]?.[clip] ?? [];
     if (!frames.length) continue;
     const h = document.createElement("h2");
     h.textContent = dir + " / " + clip + " — cel 128 · crush 72 · played 52";
     host.appendChild(h);
     const row = document.createElement("div");
     row.className = "row";
     host.appendChild(row);
     frames.forEach((f, fi) => {
       const raw = document.createElement("canvas");
       raw.width = 128; raw.height = 128;
       f(raw.getContext("2d"));
       const src = crushToGrid(raw);
       for (const px of [128, 72, 52]) {
         const fig = document.createElement("figure");
         const cv = document.createElement("canvas");
         cv.width = px; cv.height = px;
         const c = cv.getContext("2d");
         c.imageSmoothingEnabled = false;
         // The 128 column shows the AUTHORED cel; the rest show the crush.
         c.drawImage(px === 128 ? raw : src, 0, 0, px, px);
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

const { browser, page } = await open(html, { width: 1500, height: 900 });
save(out, await page.screenshot({ fullPage: true }));
await browser.close();
