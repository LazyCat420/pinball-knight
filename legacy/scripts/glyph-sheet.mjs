/**
 * GLYPH SHEET — render render/card-glyphs.ts as a contact sheet.
 *
 * The whole point of the glyph library is that it replaces font-dependent
 * emoji, so it has to be LOOKED AT: a path that reads as a bolt in the author's
 * head can render as a smear. Emblems are shot at emblem size (17px) AND large,
 * because a mark that only works at 300px is useless on a move bullet.
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const out = resolve(arg("out", "scratchpad/glyph-sheet.png"));

const js = await bundle(`
import * as G from "./src/game/pinball-knight/render/card-glyphs";
window.__G = G;
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0e0f13;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 section{padding:14px}
 h2{color:#c9bfa4;font-size:12px;margin:6px 0;letter-spacing:2px}
 .row{display:flex;flex-wrap:wrap;gap:12px}
 figure{margin:0;text-align:center}
 canvas{display:block;background:#16171d;border:1px solid #2a2c36;border-radius:6px}
 figcaption{padding-top:3px}
</style>
<section><h2>EMBLEMS — at 300px, and at real emblem size (17px / 14px)</h2><div class=row id=big></div></section>
<section><h2>SIGILS — mythic art windows, engraved at 300px</h2><div class=row id=sig></div></section>
<script>${js}</script>
<script>
 const G = window.__G;
 const EMB = ["glyphBolt","glyphFlame","glyphFrost","glyphShield","glyphBlades","glyphMomentum","glyphSwift","glyphFang","glyphSparkle","glyphPip"];
 const SIG = ["sigilWorldBreaker","sigilTimeRipper","sigilTempestCrown","sigilGlassCannon","sigilBloodPact","sigilSeal"];

 function cell(parent, name, draw, w, h) {
   const fig = document.createElement("figure");
   const cv = document.createElement("canvas");
   cv.width = w; cv.height = h;
   const ctx = cv.getContext("2d");
   draw(ctx);
   fig.appendChild(cv);
   const cap = document.createElement("figcaption"); cap.textContent = name;
   fig.appendChild(cap);
   parent.appendChild(fig);
 }

 for (const n of EMB) {
   cell(document.getElementById("big"), n, (ctx) => {
     ctx.fillStyle = "#e6dcc4"; ctx.strokeStyle = "#e6dcc4"; ctx.lineWidth = 6;
     G.drawGlyph(ctx, G[n], 70, 70, 52);
     // real sizes, on the same tile
     ctx.lineWidth = 2;
     G.drawGlyph(ctx, G[n], 30, 132, 8.5);
     ctx.lineWidth = 2;
     G.drawGlyph(ctx, G[n], 70, 132, 7);
     ctx.lineWidth = 1.5;
     G.drawGlyph(ctx, G[n], 105, 132, 5);
   }, 140, 152);
 }
 for (const n of SIG) {
   cell(document.getElementById("sig"), n, (ctx) => {
     ctx.strokeStyle = "#cfc6ad"; ctx.fillStyle = "#cfc6ad"; ctx.lineWidth = 3.4;
     G.drawGlyph(ctx, G[n], 130, 130, 100);
   }, 260, 260);
 }
 window.__ready = true;
</script>`;

const { browser, page } = await open(html, { width: 1180, height: 900 });
save(out, await page.screenshot({ fullPage: true }));
await browser.close();
