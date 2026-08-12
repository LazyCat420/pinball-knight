/**
 * BAKE GUI FONT — rasterise the vendored UI faces into glyph atlases for pk-gui.
 *
 *   node scripts/bake-gui-font.mjs                 → ../assets/gui/font/
 *   node scripts/bake-gui-font.mjs --out /abs/path → somewhere else
 *
 * ── WHY A BAKE AND NOT ab_glyph ───────────────────────────────────────────
 * The legacy GUI draws text with `ctx.fillText` at INTEGER positions (im.ts
 * `px()` rounds x for every alignment — the "half-pixel when centring" comment
 * in that file is stale). That means a glyph's pixels depend only on
 * (face, size), never on position — so the browser's own raster, captured once
 * per (face, size), makes the Rust painter's text BIT-EXACT against the legacy
 * canvas. A Rust rasteriser (ab_glyph/fontdue) would re-hint and re-AA the
 * outlines and never match Skia byte-for-byte. Same doctrine as bake-tavern:
 * run the original, ship the pixels.
 *
 * ── WHICH BROWSER ─────────────────────────────────────────────────────────
 * This bakes in the harness's Playwright chromium (deterministic, headless,
 * same browser that bakes the GUI golden fixtures — so the painter-level
 * pixel-compare is exact by construction). The live A/B against host Chrome
 * may show ±1 AA fringe on text if the host rasteriser hints differently;
 * Press Start 2P at multiples of 8 is authored on the pixel grid precisely so
 * that fringe is ~zero. If the heatmap ever disagrees, re-bake there.
 *
 * ── ALPHA ─────────────────────────────────────────────────────────────────
 * Glyphs are baked WHITE on transparent. Canvas stores premultiplied 8-bit;
 * for white, premult (a,a,a,a) → un-premult (255,255,255,a) is lossless, so
 * the PNG readback carries the exact coverage. The Rust blit tints:
 * out = tint*a + dst*(1-a).
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────
 * Nothing here is random. Run twice, `sha256sum` the PNGs — that is the gate.
 * Only bake.json moves (wall-clock stamp, on purpose).
 */
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { arg, bundle, open } from "./lib/card-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY = resolve(HERE, "..");
const out = resolve(arg("out", resolve(LEGACY, "..", "assets", "gui", "font")));
process.chdir(LEGACY);

/**
 * The pinned charset. ASCII 0x20–0x7E plus the non-ASCII the GUI actually
 * draws: … (ellipsize), · (blurbs), ’ — × (copy). Pinned as a constant so the
 * metrics JSON and the Rust loader agree on the exact set forever.
 *
 * ⚠️ **DO NOT ADD U+2212 MINUS SIGN HERE.** `cards.ts`'s `pct()` prints every
 * negative stat with it, so it looks like an omission. It is not: Press Start
 * 2P has no such glyph, and baking it makes the browser substitute a
 * PROPORTIONAL system face — measured at advance 4.51 against this atlas's
 * monospace 8, which breaks every screen's layout arithmetic and desyncs the
 * cell packing enough that the raster bleeds into its neighbour. Tried,
 * rendered, reverted. `pk_gui::font::substitute` maps it to the ASCII hyphen
 * at draw time instead, which is where a decision about a FACE belongs.
 */
const EXTRAS = ["…", "·", "’", "—", "×"];
const CHARSET = [];
for (let c = 0x20; c <= 0x7e; c++) CHARSET.push(String.fromCharCode(c));
CHARSET.push(...EXTRAS);

/** face key → { css family (quoted as the game quotes it), sizes to bake }. */
const FACES = {
  // 8|16|24|32 are the sizes text() accepts; a screen paints at its SCREEN
  // ZOOM, so the device size is size×zoom and ×2 covers every `max: 2` sheet.
  //
  // ── 72 AND 96 ARE DELIBERATELY NOT BAKED ────────────────────────────────
  // The intro chrome declares `max: 3` ("a title card takes the largest zoom
  // the grid allows"), so it asks for 24|48|72|96 and the last two were
  // missing. The failure was SILENT: `Fonts::draw` returns early on a missing
  // atlas, so the 32pt "PINBALL KNIGHT" drew NOTHING while the 8pt "PRESS ANY
  // KEY" beside it (8×3 = 24, which existed) rendered perfectly — an empty
  // title next to the oracle's on the pk-ab-intro sheet.
  //
  // They are not added here because they do not have to be, and that is a
  // MEASURED claim rather than an assumption: Press Start 2P at multiples of 8
  // is authored on the pixel grid, so a larger raster is the smaller one
  // upscaled by an integer, exactly. Checked over the whole charset's alpha:
  //   8×2 vs 16 → 0/38,400 samples differ     8×3 vs 24 → 0/86,400
  //   16×2 vs 32 → 0/153,600                  32×2 vs 64 → 0/614,400
  // So `Fonts::load_embedded` derives any missing multiple by nearest upscale
  // and `derived_sizes_are_byte_identical_to_the_baked_ones` re-proves it on
  // every test run. Deriving beats baking here: the pixels are identical, and
  // two more PNGs in the binary would be two more things to keep in step.
  ps2p: { family: "'Press Start 2P'", sizes: [8, 16, 24, 32, 48, 64] },
  // Numerals face; barely used by the GUI today (damage text is P3 scope).
  vt323: { family: "VT323", sizes: [16, 32] },
};

const COLS = 16;
const PAD = 2;

const js = await bundle(`
import { ensurePixelFonts, PIXEL_FONT_LABEL, PIXEL_FONT_NUM } from "./src/pixel/pixel-font";
window.__bakeFont = { ensurePixelFonts, PIXEL_FONT_LABEL, PIXEL_FONT_NUM };
`);

const html = `<!doctype html><meta charset=utf8>
<title>bake-gui-font</title>
<style>body{margin:0;background:#0b0d12}</style>
<script>${js}</script>
<script>
(async () => {
 try {
  const B = window.__bakeFont;
  const FACES = ${JSON.stringify(FACES)};
  const CHARSET = ${JSON.stringify(CHARSET)};
  const COLS = ${COLS}, PAD = ${PAD};

  B.ensurePixelFonts();
  // Canvas is not "DOM use": the face must be loaded explicitly, per size is
  // unnecessary but per family is mandatory. Hard-fail on a miss — a fallback
  // bake here is not "legible but unportable" like the sign, it is garbage.
  for (const f of Object.values(FACES)) {
    await document.fonts.load("16px " + f.family);
  }
  await document.fonts.ready;
  for (const [key, f] of Object.entries(FACES)) {
    if (!document.fonts.check("16px " + f.family)) {
      throw new Error("font '" + f.family + "' (" + key + ") did not load — refusing to bake a fallback face");
    }
  }

  const atlases = {};

  for (const [key, f] of Object.entries(FACES)) {
    for (const size of f.sizes) {
      const font = size + "px " + f.family;
      // Measure pass — advances come from the SAME context state that draws.
      const m = document.createElement("canvas");
      m.width = 64; m.height = 64;
      const mc = m.getContext("2d");
      mc.font = font;
      mc.textBaseline = "top";
      const advances = CHARSET.map((ch) => mc.measureText(ch).width);
      const maxAdv = Math.max(...advances);

      const cellW = Math.ceil(maxAdv) + PAD * 2;
      const cellH = Math.ceil(size * 1.5) + PAD * 2;
      const rows = Math.ceil(CHARSET.length / COLS);
      const cv = document.createElement("canvas");
      cv.width = COLS * cellW;
      cv.height = rows * cellH;
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.font = font;
      g.textBaseline = "top";
      g.fillStyle = "#ffffff";
      // No smoothing flags: fillText AA is glyph rasterisation, not image
      // smoothing, and the legacy game ships it as-is.
      const glyphs = {};
      CHARSET.forEach((ch, i) => {
        const cx = (i % COLS) * cellW;
        const cy = Math.floor(i / COLS) * cellH;
        g.fillText(ch, cx + PAD, cy + PAD);
        glyphs[ch] = { i, advance: advances[i] };
      });

      atlases[key + "-" + size] = {
        face: f.family,
        px: size,
        cellW, cellH, pad: PAD, cols: COLS,
        count: CHARSET.length,
        maxAdvance: maxAdv,
        glyphs,
        png: cv.toDataURL("image/png"),
      };
    }
  }

  window.__out = atlases;
 } catch (e) {
  window.__err = String(e && e.stack || e);
 }
 window.__ready = true;
})();
</script>`;

const { browser, page } = await open(html, { width: 800, height: 600, scale: 1 });
const err = await page.evaluate(() => window.__err);
if (err) {
  await browser.close();
  console.error("[bake:gui-font] page failed:\n" + err);
  process.exit(1);
}
const atlases = await page.evaluate(() => window.__out);
await browser.close();

mkdirSync(out, { recursive: true });

/** PNG dimensions straight out of IHDR — no image library for two integers. */
function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const metrics = { charset: CHARSET, cols: COLS, pad: PAD, atlases: {} };
const outputs = {};
let advanceWarnings = 0;

for (const [name, a] of Object.entries(atlases)) {
  const buf = Buffer.from(a.png.slice(a.png.indexOf(",") + 1), "base64");
  const { w, h } = pngSize(buf);
  const expectW = a.cols * a.cellW;
  if (w !== expectW) {
    console.error(`[bake:gui-font] ${name}: got ${w}px wide, expected ${expectW}`);
    process.exit(1);
  }
  writeFileSync(join(out, `${name}.png`), buf);
  outputs[`${name}.png`] = { w, h, bytes: buf.length };

  // Press Start 2P is authored as a uniform 8px-cell face: every advance
  // should equal the point size exactly. The Rust `measure()` sums recorded
  // advances either way, but a deviation here means the layout heuristics
  // that assume 9px/char at size 8 (station prompt width) drift — say so.
  if (name.startsWith("ps2p")) {
    for (const [ch, gm] of Object.entries(a.glyphs)) {
      if (Math.abs(gm.advance - a.px) > 0.001) {
        if (advanceWarnings++ < 8) {
          console.error(`[bake:gui-font] WARNING ${name} '${ch}': advance ${gm.advance} ≠ ${a.px}`);
        }
      }
    }
  }

  metrics.atlases[name] = {
    face: a.face, px: a.px,
    cellW: a.cellW, cellH: a.cellH, pad: a.pad, cols: a.cols,
    maxAdvance: a.maxAdvance,
    glyphs: a.glyphs,
  };
}
if (advanceWarnings > 8) {
  console.error(`[bake:gui-font] …and ${advanceWarnings - 8} more advance warnings`);
}

writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics) + "\n");

// `-dirty` is not decoration — a bare rev claims these bytes reproduce from
// that commit (same rule as bake-tavern).
let legacyRev = execFileSync("git", ["rev-parse", "HEAD"], { cwd: LEGACY, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain", "--", "src", "scripts"], { cwd: LEGACY, encoding: "utf8" }).trim()) {
  legacyRev += "-dirty";
}
const stamp = {
  bakedAt: new Date().toISOString(),
  legacyRev,
  charsetLen: CHARSET.length,
  outputs,
};
writeFileSync(join(out, "bake.json"), JSON.stringify(stamp, null, 2) + "\n");

const total = Object.values(outputs).reduce((n, o) => n + o.bytes, 0);
console.log(
  `[bake:gui-font] ${Object.keys(outputs).length} atlases → ${out}\n` +
    Object.entries(outputs)
      .map(([f, o]) => `                ${f.padEnd(16)} ${String(o.w).padStart(4)}x${String(o.h).padStart(3)}  ${(o.bytes / 1024).toFixed(1)} KB`)
      .join("\n") +
    `\n                ${(total / 1024).toFixed(1)} KB total · ${CHARSET.length} glyphs/atlas · rev ${legacyRev.slice(0, 9)}` +
    (advanceWarnings ? `\n                ⚠ ${advanceWarnings} PS2P advance deviations — check metrics.json` : ""),
);
