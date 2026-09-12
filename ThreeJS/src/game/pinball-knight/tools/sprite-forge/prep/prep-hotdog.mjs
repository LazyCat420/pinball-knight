import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = join(__dirname, "..");
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");

const HOTDOG = {
  key: "hotdog",
  raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/hotdog_monster_sheet_1789214996051.jpg",
  dir: "hotdog-2026-09-12",
  desc: "Hotdog Monster plump ballpark wiener in toasted split bun with mustard cannon and relish splatter",
  palette: [
    "#d97706",
    "#b45309",
    "#92400e",
    "#78350f",
    "#fef3c7",
    "#fde68a",
    "#b91c1c",
    "#991b1b",
    "#7f1d1d",
    "#450a0a",
    "#facc15",
    "#eab308",
    "#fef08a",
    "#16a34a",
    "#15803d",
    "#166534",
    "#ffffff",
    "#000000",
  ],
};

async function prepHotdog() {
  console.log(`\n🌭 Preparing ${HOTDOG.key}...`);
  const monsterDir = join(SOURCES, HOTDOG.dir);
  const altDir = join(monsterDir, "alt-takes");
  const masterFilename = `${HOTDOG.key}_master.jpg`;
  const masterSrc = join(altDir, masterFilename);

  mkdirSync(altDir, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(HOTDOG.raw)) {
    copyFileSync(HOTDOG.raw, masterSrc);
    console.log(`Copied raw image to alt-takes: ${masterSrc}`);
  }

  const readme = join(altDir, "README.md");
  writeFileSync(
    readme,
    `# ${HOTDOG.key} Sprite Sheet Archive\n\n- **Date**: 2026-09-12\n- **Description**: ${HOTDOG.desc}\n- **Chroma**: #FF00FF\n- **Layout**: 4x4 (1024x1024, 256x256/cell)\n`
  );

  const srcPath = existsSync(masterSrc) ? masterSrc : HOTDOG.raw;
  const masterImg = await loadImage(srcPath);
  const w = 1024;
  const h = 1024;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(masterImg, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Chroma key cleanup for #FF00FF magenta
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const px = (i / 4) % w;
    const py = Math.floor((i / 4) / w);

    const isMagenta = r > 165 && g < 105 && b > 165;
    const isGridLine =
      (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 80 && g < 80 && b < 80);
    const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;

    if (isMagenta || isGridLine || isOuterBorder) {
      d[i] = 255;
      d[i + 1] = 0;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const compData = ctx.getImageData(0, 0, w, h).data;
  const rows = ["idle", "walk", "attack", "death"];
  const rects = [];

  for (let row = 0; row < 4; row++) {
    const rowCells = [];
    for (let col = 0; col < 4; col++) {
      const x0 = col * 256;
      const y0 = row * 256;
      let minX = 256,
        minY = 256,
        maxX = 0,
        maxY = 0;
      let found = false;

      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const idx = ((y0 + y) * w + (x0 + x)) * 4;
          const r = compData[idx];
          const g = compData[idx + 1];
          const b = compData[idx + 2];
          const a = compData[idx + 3];

          const isBg = r > 165 && g < 105 && b > 165;
          if (a > 20 && !isBg) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (found) {
        const globalX0 = x0 + Math.max(0, minX - 1);
        const globalY0 = y0 + Math.max(0, minY - 1);
        const globalX1 = x0 + Math.min(255, maxX + 1);
        const globalY1 = y0 + Math.min(255, maxY + 1);
        rowCells.push([globalX0, globalY0, globalX1, globalY1]);
      }
    }

    rects.push(rowCells);
  }

  // Save to sources/<dir>/hotdog-S.png
  const sourcePng = join(monsterDir, `${HOTDOG.key}-S.png`);
  writeFileSync(sourcePng, canvas.toBuffer("image/png"));
  console.log(`Saved master source sheet: ${sourcePng}`);

  // Save to inbox/<key>-S.png
  const inboxPng = join(INBOX, `${HOTDOG.key}-S.png`);
  writeFileSync(inboxPng, canvas.toBuffer("image/png"));

  // Build inbox JSON sidecar
  const sidecar = {
    sheet: `${HOTDOG.key}-S`,
    author: "LazyCat420 & Nano Banana",
    notes: HOTDOG.desc,
    matte: {
      tolerance: 64,
      bg: [255, 0, 255],
    },
    grid: [4, 4],
    rows: rows,
    palette: HOTDOG.palette,
    rects: rects,
  };

  const inboxJson = join(INBOX, `${HOTDOG.key}-S.json`);
  writeFileSync(inboxJson, JSON.stringify(sidecar, null, 2) + "\n");
  console.log(`Prepared inbox assets:`);
  console.log(` - ${inboxPng}`);
  console.log(` - ${inboxJson}`);
}

prepHotdog().catch(console.error);
