/**
 * PER-SURFACE TIMINGS for the maze bake.
 *
 * Written when `bake-maze-textures.mjs` looked like "one biome exceeds thirteen
 * minutes of painting" and the suspects were all inside the painters —
 * `fillStyle` re-parsed inside a 262k-iteration loop, `toDataURL` readback on a
 * software-GL surface, a canvas scale that is not 1 at this rung.
 *
 * All three suspects were wrong. The painters were never the cost: Playwright's
 * bundled Chromium on this box hangs on the FIRST raster op of any canvas, and
 * everything downstream of it inherited that. See `lib/card-harness.mjs` for
 * the measurement. This script now runs through the shared harness, on the
 * host's Chrome, where the whole four-biome bake finishes in ~5 s — so it is
 * kept as the instrument that answers "which surface got expensive" the next
 * time someone asks, rather than as an open investigation.
 */
import { bundle, open } from "./lib/card-harness.mjs";

const js = await bundle(`
import { bakeMazeSurfaces, setMazeBiome, __bakeParts } from "./src/game/pinball-knight/maze/build";
window.__bake = { bakeMazeSurfaces, setMazeBiome, parts: __bakeParts };
`);

const html = `<!doctype html><meta charset=utf8><title>bake-profile</title>
<body style="background:#0b0d12;color:#8a8272;font:12px ui-monospace,monospace">
<script>${js}</script>
<script>
(() => {
 try {
  const P = window.__bake.parts;
  const out = {};
  const t = (name, fn) => {
    const t0 = performance.now();
    const v = fn();
    out[name] = Math.round((performance.now() - t0) * 100) / 100;
    return v;
  };
  // The cache in build.ts is keyed by biome and OUTLIVES a floor, so a second
  // call to the same painter would time a Map lookup. Each name below is
  // painted exactly once.
  t("cap", () => P.cap());
  t("wall-plain", () => P.wall(false, false, false));
  t("wall-moss", () => P.wall(true, false, false));
  t("wall-low", () => P.wall(false, true, false));
  t("wall-cracked", () => P.wall(false, false, true));
  t("normal-cap", () => P.normalCap());
  t("normal-wall", () => P.normalWall());
  const f = t("floor", () => P.floor());
  t("floor-toDataURL", () => f.image.toDataURL("image/png").length);
  t("normal-floor", () => P.normalFloor());
  window.__out = out;
 } catch (e) {
  window.__out = { error: String((e && e.stack) || e) };
 }
})();
</script>`;

const { page, browser } = await open(html, { width: 600, height: 400, scale: 1, ready: "__out", timeout: 180_000 });
const r = await page.evaluate(() => window.__out);
if (r.error) {
  console.error(r.error);
  await browser.close();
  process.exit(1);
}
const w = Math.max(...Object.keys(r).map((k) => k.length));
let total = 0;
for (const [k, ms] of Object.entries(r)) {
  total += ms;
  console.log(`${k.padEnd(w)}  ${String(ms).padStart(8)} ms`);
}
console.log(`${"TOTAL (one biome)".padEnd(w)}  ${String(Math.round(total * 100) / 100).padStart(8)} ms`);
await browser.close();
process.exit(0);
