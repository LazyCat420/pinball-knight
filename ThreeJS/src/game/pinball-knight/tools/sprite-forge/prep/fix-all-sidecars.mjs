import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { matte } from "../matte.js";

const INBOX = "/home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge/inbox";

const SHEETS_4X4 = [
  "warden-S",
  "golem-S",
  "reaper-S",
  "broodmother-S",
  "overlord-S",
  "archivist-S",
  "dragon-S",
  "goblin-S",
  "slime-S",
  "spider-S",
  "bat-S",
  "demon-S",
  "chomper-S",
  "crawler-S",
  "croaker-S",
  "crystalback-S",
  "mimic-S",
  "necro-S",
  "pin-S",
  "magnet-S",
  "webspinner-S",
  "sporeling-S",
  "hound-S",
];

async function processSheet(name) {
  const pngPath = join(INBOX, `${name}.png`);
  const jsonPath = join(INBOX, `${name}.json`);

  if (!existsSync(pngPath)) return;

  const img = await loadImage(pngPath);
  const w = img.width;
  const h = img.height;

  const cellW = Math.round(w / 4);
  const cellH = Math.round(h / 4);

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const rawData = ctx.getImageData(0, 0, w, h);
  let existing = {};
  if (existsSync(jsonPath)) {
    try {
      existing = JSON.parse(readFileSync(jsonPath, "utf8"));
    } catch {}
  }

  const matteOpts = existing.matte || { tolerance: 64 };
  const matted = matte(rawData.data, w, h, matteOpts);
  const mattedData = matted.data;

  const rows = existing.rows || ["idle", "walk", "attack", "death"];
  const rects = [];

  for (let r = 0; r < 4; r++) {
    const rowCells = [];
    for (let c = 0; c < 4; c++) {
      const x0 = c * cellW;
      const y0 = r * cellH;

      let minX = cellW, minY = cellH, maxX = 0, maxY = 0;
      let foundInk = false;

      for (let y = 0; y < cellH; y++) {
        for (let x = 0; x < cellW; x++) {
          const idx = ((y0 + y) * w + (x0 + x)) * 4;
          const alpha = mattedData[idx + 3];
          if (alpha >= 128) {
            foundInk = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (foundInk && maxX >= minX && maxY >= minY) {
        rowCells.push([x0 + minX, y0 + minY, x0 + maxX, y0 + maxY]);
      }
    }
    if (rowCells.length > 0) {
      rects.push(rowCells);
    }
  }

  const sidecar = {
    ...existing,
    rows,
    rects,
    matte: matteOpts,
  };

  writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2));
  console.log(`✔ Tight ink-matted sidecar for ${name} (${rects.length} rows)`);
}

async function run() {
  for (const s of SHEETS_4X4) {
    await processSheet(s);
  }
}

run().catch(console.error);
