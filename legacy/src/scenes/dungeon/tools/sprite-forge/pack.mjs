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
 * Frame paths are resolved relative to the spec file. The in-game loader
 * (render/atlas-loader.ts) picks the pair up automatically on next launch.
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
