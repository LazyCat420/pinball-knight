/**
 * BAKE TAVERN — export the hub's canvas-painted art as PNGs for the Rust port.
 *
 *   node scripts/bake-tavern.mjs                       → ../assets/tavern/
 *   node scripts/bake-tavern.mjs --out /abs/path       → somewhere else
 *   node scripts/bake-tavern.mjs --sheet /tmp/rev.png  → + a review contact sheet
 *
 * ── WHY A BAKE AND NOT A PORT (docs/src/art/bake.md) ──────────────────────
 * The painters are ~15k lines of Canvas2D. They are not translated to Rust;
 * they are RUN, once, in the browser they were authored against, and the
 * resulting pixels ship as PNGs. This script is the tavern's slice of that:
 * five keeper sprites and the ENTER MAZE sign. Nothing here re-implements a
 * painter — every pixel comes from `cel-painter.ts` / `props.ts` through the
 * same two functions the game itself calls.
 *
 * ── THE PIPELINE, AND WHY IT IS NOT "JUST CALL THE PAINTER" ───────────────
 * `sprite.ts:staticTexture()` is the production path for a single-frame actor,
 * and it is TWO steps, not one:
 *
 *   1. `paintInArtSpace(ctx, paint, 168)` — the painter draws in a 128-unit ART
 *      space that is scaled onto a 168px raster buffer. Calling `paint(ctx)`
 *      directly on a 168px canvas gets you 128px of art in the corner.
 *   2. `crushToGrid(canvas, 84)`   — an alpha-weighted separable box downscale,
 *      a hard alpha cutout, and a snap to the 32-entry palette. THIS is what
 *      the player sees. Reviewing the pre-crush cel is reviewing something that
 *      never reaches a screen.
 *
 * Both are exported for exactly this reason ("a harness that re-implements the
 * code it checks only tests itself"), and both take an explicit size seam. We
 * pass the sizes EXPLICITLY and also ASSERT the ambient config matches: `PPU`
 * is resolved from localStorage at module load, so an ambient-only bake would
 * silently change rung if a settings blob ever landed in the browser profile.
 *
 * ── PALETTE (the known blank-looking failure) ─────────────────────────────
 * `figure.ts` reads colour through `enginePalette`, which DEFAULTS TO 16-STEP
 * GREYSCALE until the game installs the real palette at boot. A bake that skips
 * `setEnginePalette` produces five grey statues that look exactly like broken
 * art. They are not: they are an unbooted palette. See foe-sheet.mjs.
 *
 * ── FONT ──────────────────────────────────────────────────────────────────
 * The sign measures-then-fits in `'Press Start 2P', monospace`, so without the
 * real face the bake is host-dependent (whatever `monospace` resolves to). The
 * face is ALREADY VENDORED IN-REPO — `src/pixel/pixel-font.ts` carries it as a
 * base64 woff2 data URI, SIL OFL, self-hosted precisely so nothing needs the
 * network. We install it from there rather than adding a second copy under
 * scripts/assets/: two copies of a font is two things to keep in sync, and this
 * one is the same face the running game uses. `@font-face` alone is not enough
 * for canvas — canvas is not "DOM use" and will not trigger the lazy load — so
 * we `document.fonts.load()` at the sizes we draw and hard-fail if it misses.
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────
 * Nothing here is seeded because nothing here is random: the NPC painters have
 * no `Math.random`, the crush is a fixed kernel (a box filter, chosen over the
 * host's `imageSmoothingQuality:"high"` so the bytes do not depend on Skia vs
 * Cairo), and Chromium's PNG encoder writes no timestamp. Run it twice and
 * `sha256sum` the PNGs — that is the gate. Only `bake.json` moves, because it
 * stamps the wall clock on purpose.
 */
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY = resolve(HERE, "..");

// Resolve paths against the CALLER's cwd, then move to legacy/ — esbuild's
// `resolveDir` in card-harness is `process.cwd()`, so the bundle's "./src/…"
// specifiers only resolve from here. `cargo xtask bake --tavern` already sets
// current_dir, but a human running this from the repo root should not have to.
const out = resolve(arg("out", resolve(LEGACY, "..", "assets", "tavern")));
const sheet = arg("sheet", "");
const sheetPath = sheet ? resolve(sheet) : "";
process.chdir(LEGACY);

/** The camera rung this bake targets: PPU 56 ⇒ 168px raster, 84px grid. */
const RASTER_PX = 168;
const GRID_PX = 84;

/** Filename suffix → `NPC_PAINTS` key. The five tavern station keepers. */
const KEEPERS = {
  merchant: "merchant", // forge
  witch: "witch", // bar
  magician: "magician", // card table
  frog: "frog", // armory
  tout: "tout", // casino cabinet
};

const SIGN_TEXT = "ENTER MAZE";

const js = await bundle(`
import { NPC_PAINTS } from "./src/game/pinball-knight/render/cel-painter";
import { paintInArtSpace, crushToGrid } from "./src/game/pinball-knight/engine/render/sprite";
import { engineConfig } from "./src/game/pinball-knight/engine/config";
import { setEnginePalette } from "./src/game/pinball-knight/engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./src/game/pinball-knight/render/palette";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "./src/pixel/pixel-font";
import { makeSignTexture } from "./src/scenes/tavern/props";
// LOAD-BEARING. figure.ts (limbShaded/plateShaded — i.e. every body part) reads
// the palette through \`enginePalette\`, which DEFAULTS TO A 16-STEP GREYSCALE
// until the game installs the real one at boot (GameEngine.ts). A harness that
// skips this renders every sprite in grey and looks exactly like a bug in the
// art. It is not: it is the harness failing to boot the palette.
setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
window.__bake = { NPC_PAINTS, paintInArtSpace, crushToGrid, engineConfig, ensurePixelFonts, PIXEL_FONT_LABEL, makeSignTexture };
`);

const html = `<!doctype html><meta charset=utf8>
<title>bake-tavern</title>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 8px 16px}
 .row{display:flex;flex-wrap:wrap;gap:12px;padding:0 16px;align-items:flex-end}
 figure{margin:0;text-align:center}
 img{display:block;background:#141821;border:1px solid #232833;image-rendering:pixelated}
 figcaption{padding-top:3px;font-size:10px}
</style>
<h2>KEEPERS — baked 84x84, shown at 4x (what the Rust port will draw)</h2><div class=row id=keepers></div>
<h2>SIGN — baked 1024x220, shown at 1:1</h2><div class=row id=sign></div>
<script>${js}</script>
<script>
(async () => {
 try {
  const B = window.__bake;
  const RASTER = ${RASTER_PX}, GRID = ${GRID_PX};

  // The ambient config must AGREE with what we ask for. It is derived from PPU,
  // which is read out of localStorage at module load, so a settings blob in the
  // profile would otherwise re-rung the bake with no visible signal.
  const sc = B.engineConfig.sprite;
  if (sc.px !== RASTER || sc.pixelGrid !== GRID) {
    throw new Error("engineConfig.sprite is px=" + sc.px + "/grid=" + sc.pixelGrid +
                    ", expected " + RASTER + "/" + GRID + " — the bake would be off-rung");
  }

  // Canvas does not count as "font use", so the face must be loaded explicitly
  // before the sign painter MEASURES with it. 100px is the painter's reference
  // size; the fitted size is rounded from it.
  B.ensurePixelFonts();
  await document.fonts.load("100px " + B.PIXEL_FONT_LABEL);
  await document.fonts.ready;
  const fontOk = document.fonts.check("100px " + B.PIXEL_FONT_LABEL);

  const png = {};

  for (const [name, key] of Object.entries(${JSON.stringify(KEEPERS)})) {
    const paint = B.NPC_PAINTS[key];
    if (!paint) throw new Error("NPC_PAINTS has no '" + key + "'");
    // Mirrors sprite.ts:staticTexture — raster buffer, art-space paint, crush.
    const raw = document.createElement("canvas");
    raw.width = RASTER; raw.height = RASTER;
    const ctx = raw.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2D context for " + name);
    B.paintInArtSpace(ctx, paint, RASTER);
    const crushed = B.crushToGrid(raw, GRID);
    png["keeper-" + name] = crushed.toDataURL("image/png");
  }

  const tex = B.makeSignTexture(${JSON.stringify(SIGN_TEXT)});
  if (!tex) throw new Error("makeSignTexture returned null — no 2D context");
  const signCanvas = tex.image;
  png["sign-enter-maze"] = signCanvas.toDataURL("image/png");

  // Contact sheet, for a human to LOOK at. A blank or greyscale bake is the
  // known failure mode and it is invisible in a byte count.
  for (const [id, host, scale] of [["keepers", "keepers", 4], ["sign", "sign", 1]]) {
    for (const [nm, url] of Object.entries(png)) {
      const isSign = nm.startsWith("sign");
      if ((id === "sign") !== isSign) continue;
      const fig = document.createElement("figure");
      const im = document.createElement("img");
      im.src = url;
      im.style.width = (isSign ? 1024 : ${GRID_PX} * 4) + "px";
      fig.appendChild(im);
      const cap = document.createElement("figcaption");
      cap.textContent = nm + (isSign ? "" : "  " + scale + "x");
      fig.appendChild(cap);
      document.getElementById(host).appendChild(fig);
    }
  }

  window.__out = { png, fontOk, spriteConfig: { px: sc.px, pixelGrid: sc.pixelGrid, artPx: sc.artPx } };
 } catch (e) {
  window.__err = String(e && e.stack || e);
 }
 window.__ready = true;
})();
</script>`;

const { browser, page } = await open(html, { width: 1120, height: 900 });
const err = await page.evaluate(() => window.__err);
if (err) {
  await browser.close();
  console.error("[bake:tavern] page failed:\n" + err);
  process.exit(1);
}
const result = await page.evaluate(() => window.__out);
if (sheetPath) save(sheetPath, await page.screenshot({ fullPage: true }));
await browser.close();

if (!result.fontOk) {
  // Not fatal — the sign is measure-then-fit, so it stays legible in the
  // fallback face. But the bytes then depend on the host's `monospace`, which
  // is the whole reason the font is vendored, so it must not pass quietly.
  console.error("[bake:tavern] WARNING: 'Press Start 2P' did NOT load — the sign");
  console.error("              baked in the host's monospace fallback and is NOT portable.");
}

mkdirSync(out, { recursive: true });

/** PNG dimensions straight out of IHDR — no image library for two integers. */
function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const EXPECT = {
  "keeper-merchant": [GRID_PX, GRID_PX],
  "keeper-witch": [GRID_PX, GRID_PX],
  "keeper-magician": [GRID_PX, GRID_PX],
  "keeper-frog": [GRID_PX, GRID_PX],
  "keeper-tout": [GRID_PX, GRID_PX],
  "sign-enter-maze": [1024, 220],
};

const outputs = {};
for (const [name, dataUrl] of Object.entries(result.png)) {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { w, h } = pngSize(buf);
  const [ew, eh] = EXPECT[name] ?? [];
  if (ew && (w !== ew || h !== eh)) {
    console.error(`[bake:tavern] ${name}: got ${w}x${h}, expected ${ew}x${eh}`);
    process.exit(1);
  }
  const file = `${name}.png`;
  writeFileSync(join(out, file), buf);
  outputs[file] = { w, h, bytes: buf.length };
}

// `-dirty` is not decoration. A bare rev is a claim that checking out that
// commit reproduces these bytes, and the very first bake was taken against a
// tree whose painter edits were still uncommitted — a stamp that cannot be
// falsified is worse than no stamp.
let legacyRev = execFileSync("git", ["rev-parse", "HEAD"], { cwd: LEGACY, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain", "--", "src", "scripts"], { cwd: LEGACY, encoding: "utf8" }).trim()) {
  legacyRev += "-dirty";
}

// `bakedAt` is the one non-reproducible field, and it is deliberate: it answers
// "is this older than the painter change I just made". The PNGs beside it are
// byte-stable, which is what a determinism check should be run against.
const stamp = {
  bakedAt: new Date().toISOString(),
  legacyRev,
  spriteConfig: result.spriteConfig,
  font: result.fontOk ? "Press Start 2P (vendored, src/pixel/pixel-font.ts)" : "monospace fallback — NOT PORTABLE",
  outputs,
};
writeFileSync(join(out, "bake.json"), JSON.stringify(stamp, null, 2) + "\n");

const total = Object.values(outputs).reduce((n, o) => n + o.bytes, 0);
console.log(
  `[bake:tavern] ${Object.keys(outputs).length} PNGs → ${out}\n` +
    Object.entries(outputs)
      .map(([f, o]) => `              ${f.padEnd(22)} ${o.w}x${o.h}  ${(o.bytes / 1024).toFixed(1)} KB`)
      .join("\n") +
    `\n              ${(total / 1024).toFixed(1)} KB total · rev ${legacyRev.slice(0, 9)}${legacyRev.endsWith("-dirty") ? "-dirty" : ""}` +
    `\n              font: ${stamp.font}`,
);
