import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = join(__dirname, "..");
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/4321b33f-3337-4e16-b603-ef2e52ab7300/fry_monster_sheet_green_1788766951778.jpg";
const FRIES_DIR = join(SOURCES, "fries-2026-09-06");
const ALT_DIR = join(FRIES_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "fry_monster_sheet_green_1788766951778.jpg");

async function run() {
  console.log("🍟 Preparing Fry Sentinel Monster (Green Chroma #00FF00 - High Contrast) Sprite Sheet...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const srcPath = existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG;
  const masterImg = await loadImage(srcPath);

  const w = 1024;
  const h = 1024;

  // Chroma key helper for #00FF00 green + border cleanup
  function cleanSheet(srcImg) {
    const c = createCanvas(w, h);
    const cx = c.getContext("2d");
    cx.drawImage(srcImg, 0, 0, w, h);
    const imgData = cx.getImageData(0, 0, w, h);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const px = (i / 4) % w;
      const py = Math.floor((i / 4) / w);

      // Red carton protection: if it's noticeably reddish, NEVER treat as green background!
      const isRedCarton = r > 90 && r > g * 1.2 && r > b * 1.2;

      // Green chroma key check (high green, lower red and blue)
      const isGreen = !isRedCarton && (
        (g > 140 && g > r * 1.4 && g > b * 1.4) ||
        (g > 200 && (r + b) < 160)
      );

      // Strip any edge grid line artifacts
      const isGridLine = (px % 256 <= 2 || px % 256 >= 253 || py % 256 <= 2 || py % 256 >= 253) && (r < 60 && g < 60 && b < 60);
      // Outer border frame
      const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;

      if (isGreen || isGridLine || isOuterBorder) {
        d[i] = 0;
        d[i + 1] = 255;
        d[i + 2] = 0;
        d[i + 3] = 255; // solid pure green background for sprite forge
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);

  // Save cleaned source to sources directory
  const destSource = join(FRIES_DIR, "fries-S.png");
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "fries-S.png");
  writeFileSync(inboxPng, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved inbox image to: ${inboxPng}`);

  // Detect bounding rects in the 4x4 grid
  const cellW = w / 4;
  const cellH = h / 4;
  const rows = ["idle", "walk", "attack", "death"];
  const rects = [];

  const cx = cleanedCanvas.getContext("2d");
  const imgData = cx.getImageData(0, 0, w, h);
  const d = imgData.data;

  function isBackground(px, py) {
    if (px < 0 || px >= w || py < 0 || py >= h) return true;
    const idx = (py * w + px) * 4;
    const r = d[idx];
    const g = d[idx + 1];
    const b = d[idx + 2];
    // Background is pure green [0, 255, 0]
    return g > 200 && r < 50 && b < 50;
  }

  for (let r = 0; r < 4; r++) {
    const rowRects = [];
    for (let c = 0; c < 4; c++) {
      const minCellX = Math.floor(c * cellW);
      const maxCellX = Math.floor((c + 1) * cellW);
      const minCellY = Math.floor(r * cellH);
      const maxCellY = Math.floor((r + 1) * cellH);

      let minX = maxCellX, maxX = minCellX;
      let minY = maxCellY, maxY = minCellY;
      let found = false;

      // Scan for non-background pixels in cell
      for (let y = minCellY; y < maxCellY; y++) {
        for (let x = minCellX; x < maxCellX; x++) {
          if (!isBackground(x, y)) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (found) {
        // Add 1px padding, clamp to cell boundaries
        const padX1 = Math.max(minCellX, minX - 1);
        const padY1 = Math.max(minCellY, minY - 1);
        const padX2 = Math.min(maxCellX - 1, maxX + 1);
        const padY2 = Math.min(maxCellY - 1, maxY + 1);
        rowRects.push([padX1, padY1, padX2, padY2]);
      } else {
        // Fallback default cell
        rowRects.push([minCellX + 10, minCellY + 10, maxCellX - 10, maxCellY - 10]);
      }
    }
    rects.push(rowRects);
  }

  const manifest = {
    sheet: "fries-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Fry Sentinel monster with crinkle-cut limbs, eye amulet necklace, head fry barrage attack, and crispy crumbs death on pure green chroma",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [0, 255, 0],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "fries-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Fries sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep fries sprite sheet:", err);
  process.exit(1);
});
