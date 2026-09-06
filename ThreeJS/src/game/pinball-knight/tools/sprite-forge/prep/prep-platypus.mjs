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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/30396d1e-987f-44e2-8505-405d5820ae6b/platypus_tail_slam_v3_1788683527251.jpg";
const PLATYPUS_DIR = join(SOURCES, "platypus-2026-09-06");
const ALT_DIR = join(PLATYPUS_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "platypus_tail_slam_v3_1788683527251.jpg");

async function run() {
  console.log("🦫 Preparing Iron Platypus (Tail Slam & Floor Cracks) Sprite Sheet...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      `# Iron Platypus (Tail Slam & Ground Cracks) Sprite Sheet Archive

- **Date**: 2026-09-06
- **Subject**: Iron Platypus (\`platypus\`) with tough duck bill peak, webbed claws, and heavy segmented steel tail.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/platypus-2026-09-06/platypus-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames)
  - Row 0 (0..3): \`idle\` (low waddling stance, breathing, twitching bill, metal tail raised behind)
  - Row 1 (4..7): \`walk\` (heavy quadruped waddle, dragging segmented steel tail)
  - Row 2 (8..11): \`attack\` (heavy metal tail slam: plants paws, handstand kick raising tail overhead, downward tail whip, tail crashes flat onto floor creating ground cracks)
  - Row 3 (12..15): \`death\` (knocked back, metal tail limp, cartoon dizzy stars, collapse flat)
- **Chroma Background**: \`#FF00FF\` magenta
- **Takes Archive**:
  - \`alt-takes/platypus_tail_slam_sheet_1788682246390.jpg\` (Take 1: head/body slam)
  - \`alt-takes/platypus_tail_slam_fixed_1788682401149.jpg\` (Take 2: hand-held tool slam)
  - \`alt-takes/platypus_tail_slap_v2_1788682785947.jpg\` (Take 3 - Master: quadruped tail arch, high-speed tail whip, and explosive metal tail ground smash creating deep floor cracks)
`,
    );
  }

  const masterImg = await loadImage(existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG);

  const w = 1024;
  const h = 1024;

  // Chroma key helper for #FF00FF magenta + border cleanup
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

      // Magenta chroma key check (high red & blue, low green)
      const isMagenta = (r > 150 && b > 150 && g < 110) || (r > 120 && b > 120 && (r + b) > g * 2.1);
      // Strip any edge grid line artifacts
      const isGridLine = (px % 256 <= 2 || px % 256 >= 253 || py % 256 <= 2 || py % 256 >= 253) && (r < 80 && g < 80 && b < 80);
      // Outer border frame
      const isOuterBorder = px < 8 || px >= w - 8 || py < 8 || py >= h - 8;

      if (isMagenta || isGridLine || isOuterBorder) {
        d[i] = 255;
        d[i + 1] = 0;
        d[i + 2] = 255;
        d[i + 3] = 255; // solid magenta background for sprite forge
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);

  // Save cleaned source to sources directory
  const destSource = join(PLATYPUS_DIR, "platypus-S.png");
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "platypus-S.png");
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
    return r > 235 && g < 25 && b > 235;
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
    sheet: "platypus-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Armored Iron Platypus with heavy metal tail ground slam",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [255, 0, 255],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "platypus-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Iron Platypus sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep platypus sprite sheet:", err);
  process.exit(1);
});
