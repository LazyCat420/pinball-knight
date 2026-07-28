/**
 * CARD SHEET — render real card faces in real Chrome and screenshot them.
 *
 *   node scripts/card-sheet.mjs                 → one card per rarity
 *   node scripts/card-sheet.mjs --ids a,b,c     → specific cards
 *   node scripts/card-sheet.mjs --out foo.png
 *
 * See scripts/lib/card-harness.mjs for why this renders in a browser rather
 * than through node-canvas.
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const ids = arg(
  "ids",
  "shamblerhide,spidersilk,goblintooth,wispspark,hulkknuckle,crystalshard,grimscythe,brutecleaver,worldbreaker,timeripper,gladeath,bloodpact#4s",
).split(",");
const out = resolve(arg("out", "scratchpad/card-sheet.png"));

const js = await bundle(`
import { paintCard, CARD_W, CARD_H } from "./src/game/pinball-knight/render/holo-card";
window.__paint = (cv, id) => paintCard(cv, id);
window.__dims = [CARD_W, CARD_H];
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0b0c10;font:12px ui-monospace,Menlo,monospace;color:#8a8272}
 #sheet{display:flex;flex-wrap:wrap;gap:14px;padding:16px}
 figure{margin:0}
 canvas{width:260px;display:block;border-radius:10px}
 figcaption{text-align:center;padding-top:4px}
</style>
<div id=sheet></div>
<script>${js}</script>
<script>
 const [W,H] = window.__dims;
 const sheet = document.getElementById("sheet");
 for (const id of ${JSON.stringify(ids)}) {
   const fig = document.createElement("figure");
   const cv = document.createElement("canvas");
   cv.width = W; cv.height = H;
   fig.appendChild(cv);
   const cap = document.createElement("figcaption"); cap.textContent = id;
   fig.appendChild(cap);
   sheet.appendChild(fig);
   window.__paint(cv, id);
 }
 window.__ready = true;
</script>`;

const { browser, page } = await open(html, { width: 1200, height: 900 });
save(out, await page.locator("#sheet").screenshot());
await browser.close();
