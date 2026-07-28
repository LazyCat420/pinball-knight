/**
 * CARD HOVER — drive the real hover handler with a real pointer and screenshot
 * what a player would actually see.
 *
 * The hover effects are pointer-driven CSS: tilt, parallax, tracked glare,
 * hue-rotated foil, drifting motes, each gated by rarity tier. None of that is
 * visible in source review, and a unit test can only assert the CONTRACT (see
 * ui-cards.test.ts), never the look. The only way to know a mythic reads
 * differently from a common on hover is to hover both and look — this mounts
 * the real markup, runs the real wiring, then moves a real mouse.
 *
 *   node scripts/card-hover.mjs [--ids a,b,c] [--out foo.png]
 *
 * Writes one frame per card (`foo-0.png` …) plus a wide contact shot, because
 * one pointer can only hover one card at a time.
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const ids = arg("ids", "spidersilk,goblintooth,crystalshard,grimscythe,worldbreaker,bloodpact#4s").split(",");
const out = resolve(arg("out", "scratchpad/card-hover.png"));

const js = await bundle(`
import { holoCard, paintHoloCards, injectCardStyles } from "./src/game/pinball-knight/ui-cards";
window.__ui = { holoCard, paintHoloCards, injectCardStyles };
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0a0b0f;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 #row{display:flex;gap:34px;padding:60px 40px 70px}
 .wrap{text-align:center}
 figcaption{padding-top:10px}
</style>
<div id=row></div>
<script>${js}</script>
<script>
 const { holoCard, paintHoloCards, injectCardStyles } = window.__ui;
 injectCardStyles();
 const row = document.getElementById("row");
 row.innerHTML = ${JSON.stringify(ids)}.map((id) =>
   '<div class=wrap>' + holoCard(id, { size: "lg" }) + '<figcaption>' + id + '</figcaption></div>'
 ).join("");
 paintHoloCards(row);
 window.__ready = true;
</script>`;

const { browser, page } = await open(html, { width: 1500, height: 460 });

// Hold the pointer OFF-CENTRE so the tilt and the tracked glare are both
// non-zero — dead centre is the one position where every effect reads as
// disabled.
async function hover(i) {
  const box = await page.locator(".hcard").nth(i).boundingBox();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.3);
  await page.waitForTimeout(420);
}

for (let i = 0; i < ids.length; i++) {
  await hover(i);
  save(out.replace(/\.png$/, `-${i}.png`), await page.locator(".wrap").nth(i).screenshot());
}
await hover(Math.floor(ids.length / 2));
save(out, await page.screenshot());
await browser.close();
