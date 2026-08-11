/**
 * BAKE MAZE TEXTURES — export the dungeon's painted stone as PNGs for the port.
 *
 *   node scripts/bake-maze-textures.mjs                  → ../assets/maze/
 *   node scripts/bake-maze-textures.mjs --out /abs/path
 *   node scripts/bake-maze-textures.mjs --sheet /tmp/m.png   + a review sheet
 *
 * ── WHY A BAKE AND NOT A PORT (docs/src/art/bake.md) ──────────────────────
 * `maze/build.ts` builds every surface out of Canvas2D: a hash-noise field, a
 * per-flagstone character pass (moss, cracks, sunken stones, an inlaid arcane
 * medallion), real coursed masonry with bevels and chips, and a Sobel-differenced
 * normal map baked from a height field that mirrors the diffuse paint. That is
 * ~700 lines of painting whose output depends on Skia's rasteriser, its stroke
 * joins and its alpha compositing. Transcribing it to Rust would be a second
 * implementation to keep in step forever, and every difference would show up as
 * "the dungeon looks a bit off" rather than as a failing assertion.
 *
 * So it is RUN, once, in the browser it was authored against, through the same
 * `bakeMazeSurfaces()` seam the game's own painters feed — and the pixels ship.
 *
 * ── WHAT COMES OUT, AND WHY THE COUNTS DIFFER ─────────────────────────────
 * DIFFUSE is per biome: `css()` resolves three palette slots through
 * `BIOME_STONE`, so the stone colour is baked in and a Crypt wall and a
 * Bloodworks wall are different pixels. Eight surfaces × four biomes.
 *
 * NORMALS are not: they come from the height fields alone and are byte-identical
 * in all four biomes. Four of them, baked once. (build.ts's own cache keys
 * normals by biome and says in its comment that this costs "a rebuild per biome,
 * four at most" — here we simply do not pay it.)
 *
 * ── THE RUNG IS PINNED, AND IT IS NOT COSMETIC ────────────────────────────
 * `pixelTexture` rasterises at the CAMERA's PPU while the painter keeps drawing
 * in its authored 64px tile space. PPU is resolved from localStorage at module
 * load, so an ambient-only bake would silently change resolution if a settings
 * blob ever landed in the browser profile. We assert the sizes we expect and
 * fail loudly rather than shipping half-resolution stone.
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────
 * Nothing here is seeded because nothing here is random: `noise()` is a hash of
 * its coordinates, and Chromium's PNG encoder writes no timestamp. Run it twice
 * and `sha256sum` the PNGs — that is the gate. Only `bake.json` moves.
 */
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY = resolve(HERE, "..");

const out = resolve(arg("out", resolve(LEGACY, "..", "assets", "maze")));
const sheet = arg("sheet", "");
const sheetPath = sheet ? resolve(sheet) : "";
process.chdir(LEGACY);

/** `BIOME_STONE`'s order, and the names the Rust side uses. */
const BIOMES = ["crypt", "warren", "bloodworks", "arcane"];

/**
 * The sizes `pixelTexture` must produce at the shipped rung (PPU 56, authored
 * TILE_PX 64): `potCeil(authored * 56 / 64)`. The floor is 8 tiles per repeat.
 *   floor 512 → potCeil(448) = 512      wall/cap 64 → potCeil(56) = 64
 * A mismatch means the rung moved and every tuned offset in the painter — seams
 * every 22px, a 3px contact-shadow row — is now at a different density.
 */
const EXPECT = { floor: 512, cap: 64, wall: 64 };

const js = await bundle(`
import { bakeMazeSurfaces, setMazeBiome, BIOME_STONE } from "./src/game/pinball-knight/maze/build";
window.__bake = { bakeMazeSurfaces, setMazeBiome, biomes: BIOME_STONE.length };
`);

const html = `<!doctype html><meta charset=utf8>
<title>bake-maze-textures</title>
<style>
 body{margin:0;background:#0b0d12;font:11px ui-monospace,Menlo,monospace;color:#8a8272}
 h2{color:#c9bfa4;font-size:12px;letter-spacing:2px;margin:14px 0 8px 16px}
 .row{display:flex;flex-wrap:wrap;gap:12px;padding:0 16px;align-items:flex-end}
 figure{margin:0;text-align:center}
 img{display:block;background:#141821;border:1px solid #232833;image-rendering:pixelated}
 figcaption{padding-top:3px;font-size:10px}
</style>
<h2>MAZE SURFACES — diffuse per biome, normals shared</h2><div class=row id=sheet></div>
<script>${js}</script>
<script>
(async () => {
 try {
  const B = window.__bake;
  const png = {};
  const meta = { sizes: {}, biomes: ${JSON.stringify(BIOMES)} };
  if (B.biomes !== ${BIOMES.length}) {
    throw new Error("BIOME_STONE has " + B.biomes + " entries, this bake names ${BIOMES.length}");
  }
  let normalsDone = false;
  for (let i = 0; i < ${BIOMES.length}; i++) {
    B.setMazeBiome(i);
    const name = ${JSON.stringify(BIOMES)}[i];
    const set = B.bakeMazeSurfaces();
    for (const [k, c] of Object.entries(set.diffuse)) {
      const want = k === "floor" ? ${EXPECT.floor} : k === "cap" ? ${EXPECT.cap} : ${EXPECT.wall};
      if (c.width !== want || c.height !== want) {
        throw new Error(name + "/" + k + " is " + c.width + "x" + c.height + ", expected " + want +
                        " — the camera rung moved and every tuned offset with it");
      }
      meta.sizes[k] = c.width;
      png[name + "-" + k] = c.toDataURL("image/png");
    }
    // Normals are biome-independent (height fields only), so bake them once —
    // but PROVE it rather than asserting it in a comment: every later biome's
    // normals must be the identical data URL.
    for (const [k, c] of Object.entries(set.normal)) {
      const url = c.toDataURL("image/png");
      if (!normalsDone) png["normal-" + k] = url;
      else if (png["normal-" + k] !== url) {
        throw new Error("normal/" + k + " changed with the biome — it is not a height field any more");
      }
    }
    normalsDone = true;
  }

  // Contact sheet, for a human to LOOK at. A flat or greyscale bake is the
  // known failure mode and it is invisible in a byte count.
  const host = document.getElementById("sheet");
  for (const [nm, url] of Object.entries(png)) {
    const fig = document.createElement("figure");
    const im = document.createElement("img");
    im.src = url;
    im.style.width = (nm.includes("floor") ? 256 : 128) + "px";
    const cap = document.createElement("figcaption");
    cap.textContent = nm;
    fig.append(im, cap);
    host.appendChild(fig);
  }
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  window.__out = { png, meta };
 } catch (e) {
  window.__out = { error: String(e && e.stack || e) };
 }
})();
</script>`;

const { page, browser } = await open(html, { width: 1500, height: 1000, scale: 1 });
await page.waitForFunction(() => !!window.__out, null, { timeout: 120_000 });
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
  join(out, "bake.json"),
  JSON.stringify(
    {
      producer: "legacy/scripts/bake-maze-textures.mjs",
      source: "src/game/pinball-knight/maze/build.ts bakeMazeSurfaces()",
      bakedAt: new Date().toISOString(),
      ...res.meta,
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
console.log(`baked ${names.length} maze textures → ${out}`);
await browser.close();
