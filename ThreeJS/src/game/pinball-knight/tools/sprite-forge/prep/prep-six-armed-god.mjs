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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/6a4c6ecf-04c6-4028-993a-dd7540a9bef4/six_armed_god_sheet_1788763217997.jpg";
const BOSS_DIR = join(SOURCES, "six_armed_god-2026-09-06");
const ALT_DIR = join(BOSS_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "six_armed_god_sheet_1788763217997.jpg");

async function run() {
  console.log("🔱 Preparing The Six-Armed Indian God Boss (Fire Breath & Dagger Volley) Sprite Sheet...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# The Six-Armed Indian God Boss Sprite Sheet Archive

- **Date**: 2026-09-06
- **Subject**: The Six-Armed Indian God Boss (\`six_armed_god\`) with radiant bronze skin, glowing third eye, ornate golden high crown (mukut), floating red/gold celestial sashes, six arms brandishing golden ritual daggers, mouth blowing roaring fire breath, and crumbling divine stone death collapse.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/six_armed_god-2026-09-06/six_armed_god-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (hovering posture, 6 arms holding golden daggers, sashes flowing)
  - Row 1 (4..7): \`walk\` (forward levitating glide, arms gesturing with blades, radiant aura)
  - Row 2 (8..11): \`attack\` (mouth unhinges exhaling roaring stream of fire while 6 arms fling daggers forward in fan)
  - Row 3 (12..15): \`death\` (divine light cracks torso and third eye, body crumbles into glowing stone fragments)
- **Chroma Background**: \`#FF00FF\` magenta
- **Takes Archive**:
  - \`alt-takes/six_armed_god_sheet_1788763217997.jpg\` (Take 1 - Master: 6-armed Indian deity with mouth fire breath and dagger fling)
`,
  );

  const masterImg = await loadImage(existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG);

  // Raw image analysis coordinates
  const rawRows = [
    { y1: 15, y2: 246, cols: [[12, 171], [180, 340], [348, 508], [517, 677]] },
    { y1: 277, y2: 499, cols: [[33, 155], [199, 323], [366, 490], [535, 659]] },
    { y1: 517, y2: 764, cols: [[18, 253], [282, 507], [535, 760], [787, 1012]] },
    { y1: 785, y2: 1020, cols: [[18, 213], [283, 476], [597, 740], [830, 972]] }
  ];

  const w = 1024;
  const h = 1024;
  const cellW = 256;
  const cellH = 256;

  // Master canvas with uniform solid magenta
  const masterCanvas = createCanvas(w, h);
  const mctx = masterCanvas.getContext("2d");
  mctx.fillStyle = "#FF00FF";
  mctx.fillRect(0, 0, w, h);

  // Temporary canvas to sample the raw image
  const rawCanvas = createCanvas(1024, 1024);
  const rctx = rawCanvas.getContext("2d");
  rctx.drawImage(masterImg, 0, 0);

  // Draw each frame centered into its 256x256 cell
  for (let r = 0; r < 4; r++) {
    const rowInfo = rawRows[r];
    const srcH = rowInfo.y2 - rowInfo.y1 + 1;
    for (let c = 0; c < 4; c++) {
      const colRange = rowInfo.cols[c];
      const srcX = colRange[0];
      const srcY = rowInfo.y1;
      const srcW = colRange[1] - colRange[0] + 1;

      const destCellX = c * cellW;
      const destCellY = r * cellH;

      // Center within the 256x256 cell
      const destX = destCellX + Math.round((cellW - srcW) / 2);
      const destY = destCellY + Math.round((cellH - srcH) / 2);

      mctx.drawImage(rawCanvas, srcX, srcY, srcW, srcH, destX, destY, srcW, srcH);
    }
  }

  // Chroma key cleanup on master canvas
  const imgData = mctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    const red = d[i];
    const green = d[i + 1];
    const blue = d[i + 2];
    const px = (i / 4) % w;
    const py = Math.floor((i / 4) / w);

    // Magenta chroma check
    const isMagenta = (red > 150 && blue > 150 && green < 110) || (red > 120 && blue > 120 && (red + blue) > green * 2.1);
    const isOuterBorder = px < 2 || px >= w - 2 || py < 2 || py >= h - 2;

    if (isMagenta || isOuterBorder) {
      d[i] = 255;
      d[i + 1] = 0;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  mctx.putImageData(imgData, 0, 0);

  // Save cleaned source to sources directory
  const destSource = join(BOSS_DIR, "six_armed_god-S.png");
  writeFileSync(destSource, masterCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "six_armed_god-S.png");
  writeFileSync(inboxPng, masterCanvas.toBuffer("image/png"));
  console.log(`Saved inbox image to: ${inboxPng}`);

  // Detect bounding rects in the 4x4 grid
  const rows = ["idle", "walk", "attack", "death"];
  const rects = [];

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
      const minCellX = c * cellW;
      const maxCellX = (c + 1) * cellW;
      const minCellY = r * cellH;
      const maxCellY = (r + 1) * cellH;

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
    sheet: "six_armed_god-S",
    author: "LazyCat420",
    notes: "The Six-Armed Indian God Boss wielding ceremonial daggers and mouth fire breath",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [255, 0, 255],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "six_armed_god-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ The Six-Armed Indian God sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep six-armed god sprite sheet:", err);
  process.exit(1);
});
