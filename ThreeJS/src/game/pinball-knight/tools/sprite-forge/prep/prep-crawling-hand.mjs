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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/4321b33f-3337-4e16-b603-ef2e52ab7300/crawling_hand_sheet_1788760396424.jpg";
const HAND_DIR = join(SOURCES, "crawling-hand-2026-09-06");
const ALT_DIR = join(HAND_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "crawling_hand_sheet_1788760396424.jpg");

async function run() {
  console.log("🖐️ Preparing Crawling Hand ('Thing' from Addams Family) Sprite Sheet...");

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

  // Clean sheet: clean magenta background and remove cell grid line dividers via flood fill
  function cleanSheet(srcImg) {
    const c = createCanvas(w, h);
    const cx = c.getContext("2d");
    cx.drawImage(srcImg, 0, 0, w, h);
    const imgData = cx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Flood fill from borders to only key background pixels, protecting all interior hand flesh
    const visited = new Uint8Array(w * h);
    const queue = [];

    function isBgPixel(px, py) {
      const idx = (py * w + px) * 4;
      const r = d[idx];
      const g = d[idx + 1];
      const b = d[idx + 2];
      // True magenta background (high red & blue, low green)
      const isMagenta = (r > 170 && b > 170 && g < 60) || (r > 140 && b > 140 && g < 40);
      // Strip any edge grid line artifacts
      const isGridLine = (px % 256 <= 2 || px % 256 >= 253 || py % 256 <= 2 || py % 256 >= 253) && (r < 80 && g < 80 && b < 80);
      // Outer border frame
      const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;
      return isMagenta || isGridLine || isOuterBorder;
    }

    for (let x = 0; x < w; x++) {
      if (isBgPixel(x, 0)) { queue.push(x); visited[x] = 1; }
      const btm = (h - 1) * w + x;
      if (isBgPixel(x, h - 1)) { queue.push(btm); visited[btm] = 1; }
    }
    for (let y = 0; y < h; y++) {
      const left = y * w;
      if (isBgPixel(0, y)) { queue.push(left); visited[left] = 1; }
      const right = y * w + (w - 1);
      if (isBgPixel(w - 1, y)) { queue.push(right); visited[right] = 1; }
    }

    let head = 0;
    while (head < queue.length) {
      const pos = queue[head++];
      const px = pos % w;
      const py = Math.floor(pos / w);
      const neighbors = [
        [px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const npos = ny * w + nx;
          if (!visited[npos] && isBgPixel(nx, ny)) {
            visited[npos] = 1;
            queue.push(npos);
          }
        }
      }
    }

    for (let i = 0; i < w * h; i++) {
      if (visited[i]) {
        const idx = i * 4;
        d[idx] = 255;
        d[idx + 1] = 0;
        d[idx + 2] = 255;
        d[idx + 3] = 255; // solid magenta background for sprite forge
      }
    }

    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);

  // Save cleaned source to sources directory
  const destSource = join(HAND_DIR, "crawling_hand-S.png");
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "crawling_hand-S.png");
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
    return r > 235 && g < 30 && b > 235;
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
        rowRects.push([minCellX + 10, minCellY + 10, maxCellX - 10, maxCellY - 10]);
      }
    }
    rects.push(rowRects);
  }

  const manifest = {
    sheet: "crawling_hand-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Crawling Hand monster ('Thing' from Addams Family) with finger-walking crawl and grab attack",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [255, 0, 255],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "crawling_hand-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Crawling Hand sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep crawling hand sprite sheet:", err);
  process.exit(1);
});
