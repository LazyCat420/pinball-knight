#!/usr/bin/env node
/**
 * POTION SHEET — every flask at real in-game size.
 *
 * Written for the ✨ laser flask (2026-07-29), which is the first potion with its
 * own painter rather than `potionItem(liquid)`, and which has exactly one job
 * beyond existing: NOT looking like the health potion. That is a claim about
 * crushed, palette-snapped pixels at 40px, so it cannot be settled by reading
 * the painter — same reasoning as foe-sheet.mjs and marble-sheet.mjs.
 *
 * Health is rendered next to it deliberately: the comparison is the test.
 *
 *   node scripts/potion-sheet.mjs
 *   node scripts/potion-sheet.mjs --out scratchpad/potions.png
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const out = resolve(arg("out", "scratchpad/potion-sheet.png"));

const js = await bundle(`
import { ITEM_PAINTS } from "./src/game/pinball-knight/render/cel-painter";
import { crushToGrid } from "./src/game/pinball-knight/engine/render/sprite";
import { setEnginePalette } from "./src/game/pinball-knight/engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./src/game/pinball-knight/render/palette";
import { POTION_IDS } from "./src/game/pinball-knight/items";
// LOAD-BEARING — see foe-sheet.mjs. Without the real palette every sprite
// renders in the default 16-step greyscale and looks like an art bug.
setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
window.__potions = { ITEM_PAINTS, crushToGrid, POTION_IDS };
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 8px 16px}
 .row{display:flex;flex-wrap:wrap;gap:12px;padding:0 16px 10px}
 figure{margin:0;text-align:center}
 canvas{display:block;background:#141821;border:1px solid #232833;border-radius:4px;image-rendering:pixelated}
 figcaption{padding-top:3px;font-size:10px;color:#f0a63c}
</style>
<div id=host></div>
<!--
  localStorage SHIM, and it is load-bearing here in a way it is not for
  foe-sheet/marble-sheet. setContent() gives the page an OPAQUE origin, where
  touching window.localStorage throws - and importing ITEM_PAINTS pulls in the
  card/reagent graph, which reads a saved profile at module scope. The other
  sheets import narrower symbols and esbuild tree-shakes that graph away, so
  they never hit it.
-->
<script>
 try { window.localStorage.getItem("probe"); } catch (e) {
   const mem = new Map();
   Object.defineProperty(window, "localStorage", {
     value: {
       getItem: (k) => (mem.has(k) ? mem.get(k) : null),
       setItem: (k, v) => mem.set(k, String(v)),
       removeItem: (k) => mem.delete(k),
       clear: () => mem.clear(),
     },
   });
 }
</script>
<script>${js}</script>
<script>
 const { ITEM_PAINTS, crushToGrid, POTION_IDS } = window.__potions;
 const host = document.getElementById("host");

 function sheet(title, ids, sizes) {
   const h = document.createElement("h2");
   h.textContent = title;
   host.appendChild(h);
   const row = document.createElement("div");
   row.className = "row";
   host.appendChild(row);
   for (const id of ids) {
     const paint = ITEM_PAINTS[id];
     if (!paint) { const f = document.createElement("figure"); f.textContent = id + " MISSING"; row.appendChild(f); continue; }
     const raw = document.createElement("canvas");
     raw.width = 128; raw.height = 128;
     paint(raw.getContext("2d"));
     const src = crushToGrid(raw);
     const fig = document.createElement("figure");
     // 40 is roughly what a ground flask covers; 18 is the debug console's chip.
     for (const px of sizes) {
       const cv = document.createElement("canvas");
       cv.width = px; cv.height = px;
       const c = cv.getContext("2d");
       c.imageSmoothingEnabled = false;
       c.drawImage(src, 0, 0, px, px);
       fig.appendChild(cv);
     }
     const cap = document.createElement("figcaption");
     cap.textContent = id;
     fig.appendChild(cap);
     row.appendChild(fig);
   }
 }

 // The comparison that matters first, at the top and side by side.
 // 384 is a nearest-neighbour magnification of the CRUSHED cel — every pixel the
 // game actually ships, 3x up, so the two can be told apart by eye at all.
 sheet("LASER vs HEALTH — the crushed cel magnified 3x, then 40 (ground) and 18 (chip)", ["laser", "health"], [384, 40, 18]);
 sheet("EVERY POTION — 64 / 40 / 18", POTION_IDS, [64, 40, 18]);

 window.__ready = true;
</script>`;

const { browser, page } = await open(html, { width: 1500, height: 1000 });
save(out, await page.screenshot({ fullPage: true }));
await browser.close();
