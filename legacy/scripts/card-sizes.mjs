/**
 * CARD SIZES — does the face still read when it is 74px wide?
 *
 * The face is painted at 512×716 and then CSS-scaled down. `hc-sm` (74px) is
 * what the stash rows and every weapon socket cell use, so it is the size most
 * cards are actually seen at — and it is the size that punishes fine detail:
 * the previous face's "Lv 4" plate downscaled into mush there, which is why the
 * level pip exists as separate DOM at all.
 *
 * This shoots all three display sizes side by side so a detail that only works
 * at hc-lg gets caught here rather than in the tavern.
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const out = resolve(arg("out", "scratchpad/card-sizes.png"));
const ids = ["shamblerhide", "goblintooth", "crystalshard", "grimscythe", "worldbreaker", "bloodpact#4s"];

const js = await bundle(`
import { holoCard, paintHoloCards, injectCardStyles } from "./src/game/pinball-knight/ui-cards";
window.__ui = { holoCard, paintHoloCards, injectCardStyles };
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0a0b0f;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 section{padding:16px 20px}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:4px 0 10px}
 .row{display:flex;align-items:flex-end;gap:16px}
</style>
<section><h2>hc-sm — 74px, the stash and socket-cell size</h2><div class=row id=sm></div></section>
<section><h2>hc-md — 124px</h2><div class=row id=md></div></section>
<section><h2>hc-lg — 186px</h2><div class=row id=lg></div></section>
<script>${js}</script>
<script>
 const { holoCard, paintHoloCards, injectCardStyles } = window.__ui;
 injectCardStyles();
 const IDS = ${JSON.stringify(ids)};
 for (const size of ["sm","md","lg"]) {
   const host = document.getElementById(size);
   host.innerHTML = IDS.map((id) => holoCard(id, { size })).join("");
   paintHoloCards(host);
 }
 window.__ready = true;
</script>`;

const { browser, page } = await open(html, { width: 1400, height: 760 });
save(out, await page.screenshot({ fullPage: true }));
await browser.close();
