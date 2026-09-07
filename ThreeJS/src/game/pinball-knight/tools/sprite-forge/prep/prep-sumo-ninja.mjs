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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/c3e4a78c-99fa-41ea-ba61-e57d6b4d78f0/sumo_ninja_sheet_1788760408337.jpg";
const SUMO_DIR = join(SOURCES, "sumo_ninja-2026-09-06");
const ALT_DIR = join(SUMO_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "sumo_ninja_sheet_1788760408337.jpg");

async function run() {
  console.log("🥷 Preparing Drunk Sumo Ninja (sumo_ninja) Sprite Sheet...");

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

  // Clean sheet: flood fill background to magenta (#FF00FF)
  function cleanSheet(srcImg) {
    const c = createCanvas(w, h);
    const cx = c.getContext("2d");
    cx.drawImage(srcImg, 0, 0, w, h);
    const imgData = cx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Flood fill background starting from border pixels
    const visited = new Uint8Array(1024 * 1024);
    const queue = new Int32Array(1024 * 1024 * 2);
    let head = 0, tail = 0;

    function isBg(idx) {
      const r = d[idx], g = d[idx + 1], b = d[idx + 2];
      // Background is vibrant neon green: low red, high green, low blue
      return r < 50 && g > 210 && b < 50;
    }

    // Push outer border pixels
    for (let x = 0; x < 1024; x++) {
      queue[tail++] = x; queue[tail++] = 0; visited[x] = 1;
      queue[tail++] = x; queue[tail++] = 1023; visited[1023 * 1024 + x] = 1;
    }
    for (let y = 0; y < 1024; y++) {
      queue[tail++] = 0; queue[tail++] = y; visited[y * 1024] = 1;
      queue[tail++] = 1023; queue[tail++] = y; visited[y * 1024 + 1023] = 1;
    }

    while (head < tail) {
      const cx = queue[head++];
      const cy = queue[head++];
      const idx = (cy * 1024 + cx) * 4;

      if (isBg(idx)) {
        d[idx] = 255;
        d[idx + 1] = 0;
        d[idx + 2] = 255;
        d[idx + 3] = 255;

        const neighbors = [
          [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < 1024 && ny >= 0 && ny < 1024) {
            const nPos = ny * 1024 + nx;
            if (!visited[nPos]) {
              visited[nPos] = 1;
              const nIdx = nPos * 4;
              if (isBg(nIdx)) {
                queue[tail++] = nx;
                queue[tail++] = ny;
              }
            }
          }
        }
      }
    }

    // Outer edge cleanup
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        if (x < 2 || x >= 1022 || y < 2 || y >= 1022) {
          const idx = (y * 1024 + x) * 4;
          d[idx] = 255;
          d[idx + 1] = 0;
          d[idx + 2] = 255;
          d[idx + 3] = 255;
        }
      }
    }

    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);

  // Save cleaned source to sources directory
  const destSource = join(SUMO_DIR, "sumo_ninja-S.png");
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "sumo_ninja-S.png");
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
    return r > 230 && g < 30 && b > 230;
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
        rowRects.push([minCellX + 10, minCellY + 10, maxCellX - 10, maxCellY - 10]);
      }
    }
    rects.push(rowRects);
  }

  const manifest = {
    sheet: "sumo_ninja-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Drunk Sumo Ninja with black hood, mawashi belt, flushed cheeks, stumbling walk, and ninja star throw",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [255, 0, 255],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "sumo_ninja-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Drunk Sumo Ninja sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep sumo_ninja sprite sheet:", err);
  process.exit(1);
});
