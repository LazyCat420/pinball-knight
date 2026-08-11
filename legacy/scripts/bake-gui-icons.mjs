/**
 * BAKE GUI ICONS — export the game's own item sprites as PNGs for the port.
 *
 *   node scripts/bake-gui-icons.mjs                      → ../assets/gui/icons/
 *   node scripts/bake-gui-icons.mjs --out /abs/path
 *   node scripts/bake-gui-icons.mjs --sheet /tmp/i.png       + a review sheet
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The ported armorer painted a flat 16px square where the oracle draws the
 * helmet, and the player's report was exactly that: *"we still don't see all
 * the armors."* The rows were all there; the GEAR was not. Every vendor counter
 * in the tavern has the same hole — the alchemist draws `itemIcon(id)` at 24,
 * the weapons vendor at 36 — so this bakes the whole item set once rather than
 * three screens each inventing a placeholder.
 *
 * ── WHY A BAKE AND NOT A PORT (docs/src/art/bake.md) ──────────────────────
 * `gui/icons.ts itemIcon()` is not a lookup. It runs the item's `FramePaint`
 * from `render/cel-painter.ts` through `renderPaintCanvas` (the same palette
 * crush the in-world sprites get), then REFRAMES it: find the opaque bounding
 * box, square it around the subject's centre, pad, and resample into a 72px
 * chip with smoothing ON. That chain is Canvas2D compositing plus Skia's
 * filtered resample; transcribing it into Rust would be a second implementation
 * of the art, drifting forever. So it is run once, in the browser it was
 * authored against, and the pixels ship — the same decision the maze textures
 * and the glyph atlases already carry.
 *
 * ── WHAT COMES OUT ────────────────────────────────────────────────────────
 * One `<id>.png` per non-card entry of `ITEM_PAINTS`: the three gear pieces,
 * every potion and brew, every weapon, the coins and idols, the reagent gems
 * and the marble materials. CARD ids are excluded — a card in the UI is not an
 * icon, it is `cardFaceAt()`, a whole different renderer at a whole different
 * aspect, and the card dealer's counter will need its own bake.
 *
 * Every icon is `ICON_PX` (72) square, which is not arbitrary on the reading
 * side: `exactIconSize` only ever blits at an integer ratio, and 72 divides
 * exactly by 4 and 3 and 2 — so a 36px header chip, a 24px row chip and an 18px
 * compact chip are all EXACT downscales, and nothing in the UI ever resamples
 * an icon at runtime.
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────
 * The painters are pure geometry over a fixed palette — no rng, no time, no
 * device pixel ratio — and Chromium's PNG encoder writes no timestamp. Run it
 * twice and `sha256sum` the output: only `icons.json`'s `bakedAt` moves.
 */
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY = resolve(HERE, "..");

const out = resolve(arg("out", resolve(LEGACY, "..", "assets", "gui", "icons")));
const sheet = arg("sheet", "");
const sheetPath = sheet ? resolve(sheet) : "";
process.chdir(LEGACY);

/**
 * The ids the ported counters draw TODAY. A bake that quietly lost one of
 * these would show up as a hole in a menu, days later, in a screenshot — so the
 * page fails on the spot instead. The rest of the set is baked because it is
 * free once the harness is up, not because anything reads it yet.
 */
const REQUIRED = ["helmet", "armor", "boots"];

/**
 * COLOUR PROBES — the gate that caught the first run of this bake.
 *
 * `engine/palette-source.ts` DEFAULTS TO A 16-STEP GREYSCALE and the game
 * installs the real Cold Crypt at dungeon boot. A harness that paints without
 * booting gets grey art and no error — the module's own comment calls it "a bug
 * that renders, so it would not announce itself", and `render/palette.ts` says
 * it already cost a full debugging pass once, on a sprite that was declared
 * broken and nearly rewritten.
 *
 * The first run of this script shipped 51 grey icons: white diamonds for every
 * gem, grey flasks for every potion. Nothing failed. So `installPalette()` is
 * called below, and these three probes are the positive control — one red, one
 * cyan, one gold — each asserted to carry a channel spread no greyscale image
 * can have.
 */
const COLOUR_PROBES = [
  { id: "health", channel: "r", note: "#d95763 liquid" },
  { id: "haste", channel: "b", note: "#6fd0e8 liquid" },
  { id: "coin", channel: "r", note: "flame gold" },
];
/** Max |channel − mean| a pure greyscale image can reach. */
const GREY_SPREAD = 12;

const js = await bundle(`
import { itemIcon, ICON_PX } from "./src/game/pinball-knight/gui/icons";
import { ITEM_PAINTS } from "./src/game/pinball-knight/render/cel-painter";
import { CARD_IDS } from "./src/game/pinball-knight/cards";
import { installPalette } from "./src/game/pinball-knight/render/palette";
// BEFORE any painter runs, and before anything memoises a palette derivation.
installPalette();
const cards = new Set(CARD_IDS);
window.__bake = {
  itemIcon,
  ICON_PX,
  ids: Object.keys(ITEM_PAINTS).filter((id) => !cards.has(id)).sort(),
};
`);

const html = `<!doctype html><meta charset=utf8>
<title>bake-gui-icons</title>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 8px 16px}
 .row{display:flex;flex-wrap:wrap;gap:10px;padding:0 16px;align-items:flex-end}
 figure{margin:0;text-align:center;width:78px}
 img{display:block;width:72px;height:72px;background:#141821;border:1px solid #232833;image-rendering:pixelated}
 figcaption{padding-top:3px;font-size:9px;word-break:break-all}
</style>
<h2>GUI ICONS — itemIcon(id), 72px, as the port will blit them</h2>
<div class=row id=sheet></div>
<script>${js}</script>
<script>
(async () => {
 try {
  const B = window.__bake;
  const png = {};
  const missing = [];
  for (const id of B.ids) {
    const c = B.itemIcon(id);
    if (!c) { missing.push(id); continue; }
    if (c.width !== B.ICON_PX || c.height !== B.ICON_PX) {
      throw new Error(id + " is " + c.width + "x" + c.height + ", not ICON_PX (" + B.ICON_PX + ")" +
                      " — every exact-ratio blit downstream is derived from that number");
    }
    png[id] = c.toDataURL("image/png");
  }
  for (const id of ${JSON.stringify(REQUIRED)}) {
    if (!png[id]) throw new Error("REQUIRED icon '" + id + "' did not paint — a counter would show a hole");
  }
  // ── THE PALETTE GATE ──
  // Read the pixels back and prove they are not grey. See COLOUR_PROBES.
  const spread = (id) => {
    const c = B.itemIcon(id);
    const g = c.getContext("2d", { willReadFrequently: true });
    const { data } = g.getImageData(0, 0, c.width, c.height);
    let best = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const [r, gr, b] = [data[i], data[i + 1], data[i + 2]];
      best = Math.max(best, Math.max(r, gr, b) - Math.min(r, gr, b));
    }
    return best;
  };
  for (const p of ${JSON.stringify(COLOUR_PROBES)}) {
    const s = spread(p.id);
    if (s <= ${GREY_SPREAD}) {
      throw new Error(
        p.id + " (" + p.note + ") has a channel spread of " + s + " — that is GREYSCALE. " +
        "The Cold Crypt palette is not installed, and every icon in this bake is quantized " +
        "against engine/palette-source.ts's 16-step fallback.");
    }
  }
  // Contact sheet, for a human to LOOK at. A silhouette that came out as a
  // black square or an empty chip is invisible in a byte count.
  const host = document.getElementById("sheet");
  for (const [nm, url] of Object.entries(png)) {
    const fig = document.createElement("figure");
    const im = document.createElement("img");
    im.src = url;
    const cap = document.createElement("figcaption");
    cap.textContent = nm;
    fig.append(im, cap);
    host.appendChild(fig);
  }
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  window.__out = { png, missing, iconPx: B.ICON_PX };
 } catch (e) {
  window.__out = { error: String(e && e.stack || e) };
 }
})();
</script>`;

// `__out` IS this page's readiness flag — set on both the success and the error
// path, so the harness waits for the BAKE rather than for a load event that
// fires long before the first painter runs.
const { page, browser } = await open(html, {
  width: 1500,
  height: 1000,
  scale: 1,
  ready: "__out",
  timeout: 180_000,
});
const res = await page.evaluate(() => window.__out);
if (res.error) {
  console.error(res.error);
  await browser.close();
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const names = Object.keys(res.png).sort();
for (const nm of names) {
  save(join(out, `${nm}.png`), Buffer.from(res.png[nm].split(",")[1], "base64"));
}
writeFileSync(
  join(out, "icons.json"),
  JSON.stringify(
    {
      producer: "legacy/scripts/bake-gui-icons.mjs",
      source: "src/game/pinball-knight/gui/icons.ts itemIcon() over ITEM_PAINTS (cards excluded)",
      bakedAt: new Date().toISOString(),
      iconPx: res.iconPx,
      required: REQUIRED,
      files: names,
    },
    null,
    2,
  ) + "\n",
);
if (sheetPath) {
  save(sheetPath, await page.screenshot({ fullPage: true }));
  console.log("review sheet:", sheetPath);
}
if (res.missing.length) {
  console.log(`no painter for ${res.missing.length}: ${res.missing.join(", ")}`);
}
console.log(`baked ${names.length} icons → ${out}`);
await browser.close();
