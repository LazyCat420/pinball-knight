/**
 * FOE SHEET — render a monster's cel frames at real in-game size.
 *
 * Sprites are authored on a 128×128 cel and then crushed to a pixel grid; the
 * player sees them around 40-60px tall. A body that reads fine at 128 can crush
 * to a featureless blob, so this shows BOTH: the authored cel and the crushed,
 * scaled-down version the game actually draws.
 *
 *   node scripts/foe-sheet.mjs                        → zombie variants, idle S
 *   node scripts/foe-sheet.mjs --clip walk --dir E    → a gait, in profile
 *   node scripts/foe-sheet.mjs --variants 0,3,7
 */
import { resolve } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const out = resolve(arg("out", "scratchpad/foe-sheet.png"));
const clip = arg("clip", "idle");
const dir = arg("dir", "S");
const variants = arg("variants", "0,1,2,3,4").split(",").map(Number);

const js = await bundle(`
import { makeZombiePaints, ZOMBIE_VARIANTS } from "./src/game/pinball-knight/render/cel-painter";
import { crushToGrid } from "./src/game/pinball-knight/engine/render/sprite";
import { setEnginePalette } from "./src/game/pinball-knight/engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./src/game/pinball-knight/render/palette";
// LOAD-BEARING. figure.ts (limbShaded/plateShaded — i.e. every body part) reads
// the palette through \`enginePalette\`, which DEFAULTS TO A 16-STEP GREYSCALE
// until the game installs the real one at boot (GameEngine.ts). A harness that
// skips this renders every sprite in grey and looks exactly like a bug in the
// art. It is not: it is the harness failing to boot the palette.
setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
window.__foe = { makeZombiePaints, ZOMBIE_VARIANTS, crushToGrid };
`);

const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 8px 16px}
 .row{display:flex;flex-wrap:wrap;gap:10px;padding:0 16px}
 figure{margin:0;text-align:center}
 canvas{display:block;background:#141821;border:1px solid #232833;border-radius:4px;image-rendering:pixelated}
 figcaption{padding-top:3px;font-size:10px}
</style>
<h2>CRUSHED SPRITE — 72px grid, palette-snapped (what the game draws)</h2><div class=row id=big></div>
<h2>AS PLAYED — 52px, what the player actually sees</h2><div class=row id=small></div>
<h2>AS PLAYED — 40px</h2><div class=row id=tiny></div>
<script>${js}</script>
<script>
 const { makeZombiePaints, ZOMBIE_VARIANTS, crushToGrid } = window.__foe;
 const CLIP = ${JSON.stringify(clip)}, DIR = ${JSON.stringify(dir)};
 for (const vi of ${JSON.stringify(variants)}) {
   const paints = makeZombiePaints(ZOMBIE_VARIANTS[vi]);
   const frames = paints[DIR]?.[CLIP] ?? paints[DIR]?.idle ?? [];
   frames.forEach((f, fi) => {
     // Author at 128 once, then downscale the SAME pixels for the small views,
     // so the small view shows the real crush and not a re-render.
     const raw = document.createElement("canvas");
     raw.width = 128; raw.height = 128;
     f(raw.getContext("2d"));
     // THE PIPELINE STEP THAT MATTERS: the game does not draw the authored cel,
     // it draws the palette-snapped 72x72 crush of it. Reviewing the pre-crush
     // art is reviewing something the player never sees.
     const src = crushToGrid(raw);
     for (const [host, px] of [["big",128],["small",52],["tiny",40]]) {
       const fig = document.createElement("figure");
       const cv = document.createElement("canvas");
       cv.width = px; cv.height = px;
       const c = cv.getContext("2d");
       c.imageSmoothingEnabled = false;
       c.drawImage(src, 0, 0, px, px);
       fig.appendChild(cv);
       const cap = document.createElement("figcaption");
       cap.textContent = "v" + vi + " f" + fi;
       fig.appendChild(cap);
       document.getElementById(host).appendChild(fig);
     }
   });
 }
 window.__ready = true;
</script>`;

const { browser, page } = await open(html, { width: 1400, height: 900 });
save(out, await page.screenshot({ fullPage: true }));
await browser.close();
