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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/dracula_sheet_1788838569578.jpg";
const DRACULA_DIR = join(SOURCES, "dracula-2026-09-07");
const ALT_DIR = join(DRACULA_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "dracula_sheet_1788838569578.jpg");

async function run() {
  console.log("🧛 Preparing Count Dracula Sprite Sheet...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# Count Dracula Monster Sprite Sheet Archive

- **Date**: 2026-09-07
- **Subject**: Count Dracula vampire monster (\`dracula\`), aristocratic vampire lord with blood drain siphon and bat death transformation.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/dracula-2026-09-07/dracula-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (4 frames: regal vampire posture, flowing cloak with scarlet lining, glowing crimson eyes)
  - Row 1 (4..7): \`walk\` (4 frames: predatory gliding stride forward across floor)
  - Row 2 (8..11): \`attack\` (4 frames: cloak flares open, baring fangs, crimson blood siphon tendrils draining energy)
  - Row 3 (12..15): \`death\` (4 frames: clutches chest in agony, wraps in cloak, bursts into purple/crimson shadow vortex as a bat emerges)
- **Chroma Background**: \`#00FF00\` bright green
- **Takes Archive**:
  - \`alt-takes/dracula_sheet_1788838569578.jpg\` (Take 1 - Master: Count Dracula)
`,
  );
  console.log(`Saved README to ${readme}`);

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

      // Protect Dracula features:
      // Dark clothes / charcoal / black cape & boots
      const isDark = r < 70 && g < 70 && b < 70;
      // Crimson silk lining, blood siphon tendrils, red eyes, waistcoat
      const isCrimson = (r > 90 && r > g * 1.5 && r > b * 1.2) || (r > 130 && g < 70 && b < 70);
      // Pale skin, white cravat/shirt, fangs
      const isPaleOrWhite = r > 150 && g > 150 && b > 150;
      // Purple smoke & bat vortex (death row)
      const isPurpleSmoke = (r > 50 && b > 60 && g < 60) || (b > 80 && b > g * 1.3);

      // Pure background chroma green check: high green with low red and low blue
      const isChromaGreen = !isDark && !isCrimson && !isPaleOrWhite && !isPurpleSmoke && (
        (g > 175 && r < 75 && b < 75) ||
        (g > 205 && (r + b) < 160)
      );

      // Strip any edge grid line artifacts
      const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 60 && g < 60 && b < 60);
      // Outer border frame
      const isOuterBorder = px < 3 || px >= w - 3 || py < 3 || py >= h - 3;

      if (isChromaGreen || isGridLine || isOuterBorder) {
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
  const destSource = join(DRACULA_DIR, "dracula-S.png");
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "dracula-S.png");
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
    return g > 230 && r < 40 && b < 40;
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
    sheet: "dracula-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Count Dracula vampire lord with blood drain siphon attack and bat death transformation",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [0, 255, 0],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "dracula-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Count Dracula sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep dracula sprite sheet:", err);
  process.exit(1);
});
