/**
 * MARBLE SHEET — render the six marble bodies (and the two ricochet forms) at
 * real in-game size.
 *
 * Same reasoning as foe-sheet.mjs: a body is authored on a 128×128 cel and then
 * crushed to a pixel grid and palette-snapped, and the player sees it around
 * 40-60px. Reviewing the pre-crush art is reviewing something nobody sees — a
 * facet pattern or a lightning filament that looks sharp at 128 can crush to
 * mush, and the only way to know is to look at the crushed version.
 *
 *   node scripts/marble-sheet.mjs
 *   node scripts/marble-sheet.mjs --out scratchpad/marbles.png
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const out = resolve(arg("out", "scratchpad/marble-sheet.png"));

const js = await bundle(`
import { marbleBallFrames, ricochetFormFrames, MARBLE_SKINS } from "./src/game/pinball-knight/render/cel-painter";
import { crushToGrid } from "./src/game/pinball-knight/engine/render/sprite";
import { setEnginePalette } from "./src/game/pinball-knight/engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./src/game/pinball-knight/render/palette";
// LOAD-BEARING — see foe-sheet.mjs. Without the real palette installed every
// sprite renders in the default 16-step greyscale and looks like an art bug.
setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
window.__marble = { marbleBallFrames, ricochetFormFrames, MARBLE_SKINS, crushToGrid };
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 8px 16px}
 .mat{margin:0 0 4px 16px;color:#f0a63c;font-size:11px;letter-spacing:1px}
 .row{display:flex;flex-wrap:wrap;gap:10px;padding:0 16px 8px}
 figure{margin:0;text-align:center}
 canvas{display:block;background:#141821;border:1px solid #232833;border-radius:4px;image-rendering:pixelated}
 figcaption{padding-top:3px;font-size:10px}
</style>
<div id=host></div>
<script>${js}</script>
<script>
 const { marbleBallFrames, ricochetFormFrames, MARBLE_SKINS, crushToGrid } = window.__marble;
 const host = document.getElementById("host");
 const MATERIALS = Object.keys(MARBLE_SKINS);

 function block(title, frames) {
   const h = document.createElement("div");
   h.className = "mat";
   h.textContent = title;
   host.appendChild(h);
   const row = document.createElement("div");
   row.className = "row";
   host.appendChild(row);
   frames.forEach((f, fi) => {
     const raw = document.createElement("canvas");
     raw.width = 128; raw.height = 128;
     f(raw.getContext("2d"));
     // The game draws the palette-snapped crush, not the authored cel.
     const src = crushToGrid(raw);
     for (const px of [128, 52, 40]) {
       const fig = document.createElement("figure");
       const cv = document.createElement("canvas");
       cv.width = px; cv.height = px;
       const c = cv.getContext("2d");
       c.imageSmoothingEnabled = false;
       c.drawImage(src, 0, 0, px, px);
       fig.appendChild(cv);
       const cap = document.createElement("figcaption");
       cap.textContent = "f" + fi + " @" + px;
       fig.appendChild(cap);
       row.appendChild(fig);
     }
   });
 }

 const t = document.createElement("h2");
 t.textContent = "MARBLE BODIES — authored 128, crushed, and as played (52 / 40)";
 host.appendChild(t);
 for (const m of MATERIALS) block(m.toUpperCase() + "  ·  " + MARBLE_SKINS[m].treatment, marbleBallFrames(m));

 const t2 = document.createElement("h2");
 t2.textContent = "RICOCHET FORMS";
 host.appendChild(t2);
 for (const k of ["bolt", "laser"]) block(k.toUpperCase(), ricochetFormFrames(k));

 window.__ready = true;
</script>`;

const { browser, page } = await open(html, { width: 1500, height: 1000 });
save(out, await page.screenshot({ fullPage: true }));
await browser.close();
