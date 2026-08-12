/**
 * BAKE CARD FACES — export the game's own card art as PNGs for the port.
 *
 *   node scripts/bake-card-faces.mjs                      → ../assets/gui/cards/
 *   node scripts/bake-card-faces.mjs --out /abs/path
 *   node scripts/bake-card-faces.mjs --sheet /tmp/c.png       + a review sheet
 *
 * ── WHY THIS EXISTS, SEPARATELY FROM bake-gui-icons.mjs ───────────────────
 * `bake-gui-icons.mjs` deliberately EXCLUDES card ids, and says why: "a card in
 * the UI is not an icon, it is `cardFaceAt()`, a whole different renderer at a
 * whole different aspect, and the card dealer's counter will need its own
 * bake." This is that bake. An icon is a 72px square chip reframed around a
 * subject; a card is a 512×716 portrait with a title, a type line, a stat box, a
 * flavour line, rarity pips and a metal edge — `render/holo-card.ts`, 809 lines
 * of art direction. Transcribing that into Rust would be a second
 * implementation of the art, drifting forever, so the pixels ship instead
 * (docs/src/art/bake.md, the standing decision).
 *
 * ── WHAT COMES OUT, AND WHY THAT SHAPE ────────────────────────────────────
 * `<id>.png` and `<id>-shiny.png`, at TWO widths: 56 and 112. That is 25 bases ×
 * 2 finishes × 2 sizes = 100 files, ~1.8MB. Three decisions produced it, each
 * measured rather than assumed:
 *
 * 1. LEVEL IS NOT BAKED. A card id encodes level and shine (`spidersilk#4s`),
 *    so the full space is 25 × 10 × 2 = 500 faces. Measured at the size the
 *    tavern blits (CARD_SLOT_W = 56): level moves **0.6%** of pixels, against a
 *    positive control of 8.2% for two *different* base cards. Rendered side by
 *    side, level 1 / 7 / 10 are indistinguishable; the only tell is the level
 *    seal, ~4×5px in the title bar's right margin. The port draws that seal
 *    itself (`pk_gui::cards::level_seal`) over the baked face. The level-scaled
 *    STAT TEXT genuinely differs — and at 56px it is 2px-tall mush that no
 *    reader can recover a number from, so nothing is lost by not baking it.
 *
 * 2. SHINE IS BAKED. Same measurement: shine moves **11.7%** of pixels — MORE
 *    than swapping to an entirely different card (8.2%). It is a sparkle field
 *    scattered inside the clipped art window plus a prismatic edge, drawn from
 *    the same `rand()` stream the rest of the face consumes, so it is not an
 *    overlay that can be composited on afterwards. It has to be its own face.
 *
 * 3. BOTH SIZES ARE BAKED, and the port never resamples. The vendor counters are
 *    authored in a 600×338 design box with max zoom 2 (pk-game/src/gui.rs), so a
 *    card cell is 56 px at zoom 1 and 112 device px at zoom 2. 716/512 does not
 *    survive integer scaling — 3×56 = 168 wide is 235 tall, and 235/3 = 78.33 —
 *    so there is no single master that downscales exactly to both, the way the
 *    72px icon chip does. The alternative was to ship 56 only and blit it 2×
 *    nearest at zoom 2; rendered side by side, the 112 bake reads its title and
 *    all four stat rows and the 2× nearest blit of the 56 is unreadable. That is
 *    `card-face.ts`'s own argument, confirmed in pixels: a card's whole job is
 *    carrying a title and stat lines, and a nearest resample destroys exactly
 *    the part that had to be read. So each tier is produced ONCE here, FILTERED
 *    from the 512px master by `cardFaceAt` — and the port blits 1:1.
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────
 * `paintFace` is seeded off the card's base id through `mulberry32(hashString)`
 * — no `Math.random`, no time, no device pixel ratio — and Chromium's PNG
 * encoder writes no timestamp. Run it twice and `sha256sum` the output: only
 * `cards.json`'s `bakedAt` moves.
 */
import { resolve, join, dirname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY = resolve(HERE, "..");

const out = resolve(arg("out", resolve(LEGACY, "..", "assets", "gui", "cards")));
const sheet = arg("sheet", "");
const sheetPath = sheet ? resolve(sheet) : "";
process.chdir(LEGACY);

/** The widths the port blits, and the only widths it may blit. See (3) above. */
const WIDTHS = [56, 112];

/**
 * THE PALETTE GATE — and the four versions of it that did not work.
 *
 * `engine/palette-source.ts` DEFAULTS TO A 16-STEP GREYSCALE and the game
 * installs the real Cold Crypt at dungeon boot. A harness that paints without
 * booting gets grey art and no error — "a bug that renders, so it would not
 * announce itself". The icon bake shipped 51 grey icons that way and nothing
 * failed, which is why that script carries a colour gate.
 *
 * Copying that gate here produced a check that CANNOT FIRE, and it took a
 * sabotage run to notice. Removing `installPalette()` from this script changes
 * nothing at all — `monsterPortrait()` installs the palette ITSELF, for exactly
 * this reason ("a cold-started tavern would draw grey robots"). Removing BOTH
 * does break the art — 76 of 100 faces change — and the copied gate passed on
 * every one of them.
 *
 * Three statistics were tried against that sabotage and all three were blind:
 *
 *   - max channel spread over the art window: reads 115-123 in BOTH states
 *   - mean channel spread over the window:    differs by 0.2
 *   - count of bright+colourful window px:    differs by 1-3%
 *
 * They fail for one reason. The art window is mostly NOT the portrait: it is a
 * coloured backdrop glow, a metal bevel, a dark recess and a ground haze, all
 * from `styleForCard`/`metalFor` — plain JS tables that are colourful with or
 * without a palette. The portrait is a few hundred pixels in the middle of it.
 *
 * And the fallback does not wash a portrait to mid-grey, which is what all
 * three statistics were built to detect. It collapses it toward BLACK: the
 * goblin's orange head becomes a void with white teeth, the bat becomes a
 * silhouette, the golem's blue eyes go dead. Black has zero channel spread and
 * near-zero weight in any average, so the art can be destroyed while every
 * window-wide number holds still.
 *
 * So the gate samples the SUBJECT BOX — the middle of the art window, where the
 * creature's body is — and counts pixels that are both bright and saturated.
 * Measured across all 19 portrait cards, good vs greyscale:
 *
 *   crystalshard   158 lit → 0        ← the probe, and the only clean margin
 *   golemcore        9 lit → 0
 *   shamblerhide     6 lit → 0
 *   goblintooth    762 lit → 444      ← collapses, but nowhere near zero
 *   wispspark      592 lit → 589      ← the old probe. blind. it is a flat
 *                                       cyan sprite the crush barely moves
 *
 * `crystalshard` is the probe because its margin is the widest and it holds in
 * both finishes (158 plain / 117 shiny, 0 in both when grey). The single-digit
 * cards collapse too, but a threshold under 9 is not a threshold.
 *
 * ⚠️ Six cards have NO portrait at all — the five sourceless chase cards and
 * `spidersilk`, whose art is a path sigil. They are byte-identical with the
 * palette gone. A probe must never be one of them.
 */
const SUBJECT_PROBES = [
  { id: "crystalshard", min: 60, note: "blue crystal golem, 158 lit px alive / 0 dead" },
];
/** A pixel counts as "lit colour": bright enough AND saturated enough. */
const LIT_VALUE = 90;
const LIT_SAT = 50;

const js = await bundle(`
import { cardFaceAt, cardFaceHeight, CARD_W, CARD_H } from "./src/game/pinball-knight/gui/card-face";
import { CARD_IDS, CARDS } from "./src/game/pinball-knight/cards";
import { installPalette } from "./src/game/pinball-knight/render/palette";
// BEFORE any painter runs, and before anything memoises a palette derivation.
installPalette();
window.__bake = {
  cardFaceAt, cardFaceHeight, CARD_W, CARD_H,
  ids: [...CARD_IDS].sort(),
  rarity: Object.fromEntries(CARD_IDS.map((id) => [id, CARDS[id].rarity])),
  // The art window, from holo-card.ts's LAYOUT table: ax = PAD + 8 with
  // PAD = 22, ay = ART_Y = 88, ah = ART_H = 320. Those are module-private
  // constants there and they are NOT exported to serve this bake — adding an
  // export to the oracle so a tool can read it is how a port starts editing the
  // thing it is copying. Restated here instead, and the palette gate below is
  // what would notice if the window ever moved: a probe reading the wrong
  // rectangle reads the black recess and fails CLOSED, loudly.
  art: { x: 22 + 8, y: 88, w: CARD_W - (22 + 8) * 2, h: 320 },
};
`);

const html = `<!doctype html><meta charset=utf8>
<title>bake-card-faces</title>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 8px 16px}
 .row{display:flex;flex-wrap:wrap;gap:10px;padding:0 16px;align-items:flex-end}
 figure{margin:0;text-align:center;width:118px}
 img{display:block;background:#141821;border:1px solid #232833;image-rendering:pixelated;margin:0 auto}
 figcaption{padding-top:3px;font-size:9px;word-break:break-all}
</style>
<h2>CARD FACES — cardFaceAt(id, w), as the dealer will blit them</h2>
<div class=row id=sheet></div>
<script>${js}</script>
<script>
(async () => {
 try {
  const B = window.__bake;
  const png = {};
  const dims = {};
  const missing = [];
  for (const base of B.ids) {
    for (const [suffix, id] of [["", base], ["-shiny", base + "#1s"]]) {
      for (const w of ${JSON.stringify(WIDTHS)}) {
        const c = B.cardFaceAt(id, w);
        if (!c) { missing.push(id + "@" + w); continue; }
        // The height the PORT will compute for itself must match the height
        // that came out of here, or every cell is off by a pixel somewhere.
        const want = B.cardFaceHeight(w);
        if (c.width !== w || c.height !== want) {
          throw new Error(id + "@" + w + " is " + c.width + "x" + c.height +
                          ", not " + w + "x" + want + " — the port's layout derives from that ratio");
        }
        png[base + suffix + "-" + w] = c.toDataURL("image/png");
        dims[w] = { w, h: want };
      }
    }
  }
  // EVERY card, at every size, in both finishes. A card the dealer can offer
  // and cannot draw is a hole in the shelf — and the shelf is three cards wide,
  // so one hole is a third of the counter.
  const expected = B.ids.length * 2 * ${WIDTHS.length};
  if (Object.keys(png).length !== expected) {
    throw new Error("baked " + Object.keys(png).length + " faces, expected " + expected +
                    " (" + B.ids.length + " cards x 2 finishes x ${WIDTHS.length} sizes)");
  }

  // ── THE PALETTE GATE ──
  // Count bright, saturated pixels in the SUBJECT BOX — the middle of the art
  // window, where the creature's body is. NOT the whole window: the window is
  // mostly backdrop glow, bevel, recess and haze, none of which touch the
  // palette, and three window-wide statistics were measured blind to a sabotage
  // that greyed all 19 portraits. See SUBJECT_PROBES for that measurement.
  const litSubject = (id) => {
    const c = B.cardFaceAt(id, B.CARD_W);   // the master, unscaled
    const g = c.getContext("2d", { willReadFrequently: true });
    const a = B.art;
    // The creature stands centred with its feet low in the window, so the
    // middle 44% across and the 30-80% band down is its body.
    const x = Math.round(a.x + a.w * 0.28);
    const y = Math.round(a.y + a.h * 0.30);
    const w = Math.round(a.w * 0.44);
    const h = Math.round(a.h * 0.50);
    const { data } = g.getImageData(x, y, w, h);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const [r, gr, b] = [data[i], data[i + 1], data[i + 2]];
      const mx = Math.max(r, gr, b);
      if (mx >= ${LIT_VALUE} && mx - Math.min(r, gr, b) >= ${LIT_SAT}) lit++;
    }
    return lit;
  };
  for (const p of ${JSON.stringify(SUBJECT_PROBES)}) {
    const lit = litSubject(p.id);
    if (lit < p.min) {
      throw new Error(
        p.id + " (" + p.note + ") has only " + lit + " lit colour pixels on its SUBJECT, " +
        "below the floor of " + p.min + ". The Cold Crypt palette is not installed and the " +
        "portraits have collapsed toward black — every monster in this bake is quantized " +
        "against engine/palette-source.ts's 16-step greyscale fallback.");
    }
  }

  // Contact sheet, for a human to LOOK at — at 112, the readable tier.
  const host = document.getElementById("sheet");
  for (const base of B.ids) {
    for (const suffix of ["", "-shiny"]) {
      const fig = document.createElement("figure");
      const im = document.createElement("img");
      im.src = png[base + suffix + "-112"];
      const cap = document.createElement("figcaption");
      cap.textContent = base + suffix + " (" + B.rarity[base] + ")";
      fig.append(im, cap);
      host.appendChild(fig);
    }
  }
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  window.__out = { png, missing, dims, widths: ${JSON.stringify(WIDTHS)}, cards: B.ids.length };
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
  timeout: 300_000,
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
  join(out, "cards.json"),
  JSON.stringify(
    {
      producer: "legacy/scripts/bake-card-faces.mjs",
      source: "src/game/pinball-knight/gui/card-face.ts cardFaceAt() over CARD_IDS",
      bakedAt: new Date().toISOString(),
      widths: res.widths,
      dims: res.widths.map((w) => res.dims[w]),
      cards: res.cards,
      finishes: ["", "-shiny"],
      note: "level is NOT baked — the port draws the level seal; see this script's header",
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
  console.log(`no face for ${res.missing.length}: ${res.missing.join(", ")}`);
}
console.log(`baked ${names.length} card faces → ${out}`);
await browser.close();
