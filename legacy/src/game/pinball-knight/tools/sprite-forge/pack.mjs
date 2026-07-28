/**
 * sprite-forge packer — per-frame source images → one game-ready atlas.
 *
 * Reads a character spec:
 *   {
 *     "name": "knight-sword",
 *     "frame": 64,                     // cell size (square), px
 *     "pixelize": { "targetH": 64 },   // options forwarded to pixelize(); omit for pre-pixelled art
 *     "clips": {
 *       "S:idle":   ["inbox/knight/s-idle-0.png", "s-idle-1.png", ...],
 *       "S:walk":   [...],
 *       "E:attack": [...]
 *     }
 *   }
 *
 * Emits, next to public/dungeon/sprites/:
 *   <name>.png   — all frames in ONE horizontal strip (the game's contract)
 *   <name>.json  — { frames, clips: { "S:idle": [0,1,...] } }
 *
 * Frame paths are resolved relative to the spec file.
 *
 * ── THE RUNTIME HALF IS NOT WIRED (2026-07-28) ──────────────────────────────
 * `engine/render/atlas-loader.ts` used to fetch that pair at boot and hand it to
 * `setHandmadeOverride`. It was deleted, because `public/dungeon/sprites/` has
 * never existed: the loader fetched a manifest that does not exist on every
 * single launch, and in dev a missing public file answers 200 with the Next.js
 * HTML shell, so `res.ok` passed and `res.json()` threw into the catch — the
 * "missing art is a silent fallback" contract worked by accident rather than by
 * design. Two wasted requests per boot, on a boot already measured at 32-36s
 * headless, for a migration nobody has started.
 *
 * This packer is kept because it is the half with the hard problem in it (the
 * pixelize + strip-packing). When there is art to load, restore the loader —
 * `git show <this commit>^:src/game/pinball-knight/engine/render/atlas-loader.ts`
 * is 93 lines and its contract (single-row strip, "S:idle" clip keys, cell
 * height === sprite.pixelGrid) is unchanged.
 *
 * Usage: node tools/sprite-forge/pack.mjs characters/knight.json
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve, join } from "path";
import { fileURLToPath } from "url";
import { pixelize } from "./pixelize.mjs";

const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");

const [, , specPath] = process.argv;
if (!specPath) {
  console.error("usage: pack.mjs <spec.json>");
  process.exit(1);
}

const specFile = resolve(specPath);
const spec = JSON.parse(readFileSync(specFile, "utf8"));
const specDir = dirname(specFile);
const FRAME = spec.frame ?? 64;

// Collect frames in a stable clip order so re-packing is deterministic.
const clipKeys = Object.keys(spec.clips).sort();
const strip = [];
const clips = {};
for (const key of clipKeys) {
  clips[key] = [];
  for (const rel of spec.clips[key]) {
    const img = await loadImage(resolve(specDir, rel));
    let cell;
    if (spec.pixelize) {
      cell = pixelize(img, { targetH: FRAME, ...spec.pixelize });
    } else {
      // pre-pixelled art: just draw it, nearest, no resample surprises
      cell = createCanvas(
        Math.min(img.width, FRAME),
        Math.min(img.height, FRAME),
      );
      cell.getContext("2d").drawImage(img, 0, 0);
    }
    clips[key].push(strip.length);
    strip.push(cell);
  }
}
if (!strip.length) {
  console.error("spec has no frames");
  process.exit(1);
}

// Compose the strip: every cell centred in a FRAME×FRAME box, feet at bottom.
const atlas = createCanvas(FRAME * strip.length, FRAME);
const ctx = atlas.getContext("2d");
ctx.imageSmoothingEnabled = false;
strip.forEach((cell, i) => {
  const x = i * FRAME + Math.floor((FRAME - cell.width) / 2);
  const y = FRAME - cell.height; // feet on the cell floor
  ctx.drawImage(cell, x, y);
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(repoRoot, "public/dungeon/sprites");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${spec.name}.png`), atlas.toBuffer("image/png"));
writeFileSync(
  join(outDir, `${spec.name}.json`),
  JSON.stringify({ frames: strip.length, clips }, null, 2),
);
console.log(`✔ ${spec.name}: ${strip.length} frames → public/dungeon/sprites/${spec.name}.{png,json}`);
for (const key of clipKeys) console.log(`   ${key}: [${clips[key].join(", ")}]`);
