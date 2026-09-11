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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/e9d59216-6eca-4313-a866-a558302582cb/blaster_frank_sheet_1789149818575.jpg";
const MONSTER_DIR = join(SOURCES, "blaster_frank-2026-09-11");
const ALT_DIR = join(MONSTER_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "blaster_frank_master.jpg");

async function run() {
  console.log("🔫 Preparing Blaster Frank Monster Sprite Sheet (Nano Banana + Sprite Forge)...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# Blaster Frank Monster Sprite Sheet Archive

- **Date**: 2026-09-11
- **Subject**: Blaster Frank monster (\`blaster_frank\`), short stout rogue inspired by Danny DeVito / Frank Reynolds who shoots a snub-nosed revolver into the air and suffers random misfires.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/blaster_frank-2026-09-11/blaster_frank-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (4 frames: short stout waddle bob, spectacles glinting, revolver at waist)
  - Row 1 (4..7): \`walk\` (4 frames: frantic waddling stride forward, coat flapping)
  - Row 2 (8..11): \`attack\` (4 frames: raises revolver straight up, shoots ceiling with muzzle flash, recoil)
  - Row 3 (12..15): \`death\` (4 frames: comic dizzy eyes, drops smoking gun, slips and falls flat on back)
- **Chroma Background**: \`#00FF00\` pure chroma green
- **Takes Archive**:
  - \`alt-takes/blaster_frank_master.jpg\` (Master Take)
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

      // Character protection:
      // Trenchcoat (tan / khaki / beige): R and B significantly higher than pure green
      const isTanCoat = r > 120 && g > 90 && b > 60 && r >= g * 0.9;
      // Dark green shirt: G is higher than R/B, but R and B are not near 0 (R > 35, B > 35) and G is <= 180
      const isGreenShirt = g > 40 && g <= 180 && r > 20 && b > 20 && r + b > 60;
      // Skin / spectacles / face: R > 150, G > 100, B > 80
      const isSkin = r > 150 && g > 95 && b > 70;
      // Hair / shoes / outlines / gun: dark values
      const isDark = r < 75 && g < 75 && b < 75;
      // Muzzle flash / sparks (bright yellow / white): R > 200, G > 180
      const isMuzzleFlash = r > 180 && g > 160 && (r + g > 360);

      const isCharacterPixel = isTanCoat || isGreenShirt || isSkin || isDark || isMuzzleFlash;

      // Pure background chroma green: high green, low red, low blue
      const isChromaGreen = !isCharacterPixel && (
        (g > 180 && r < 75 && b < 75) ||
        (g > 210 && (r + b) < 160)
      );

      // Strip any outer grid line or frame artifacts
      const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 60 && g < 60 && b < 60);
      const isOuterBorder = px < 3 || px >= w - 3 || py < 3 || py >= h - 3;

      if (isChromaGreen || isGridLine || isOuterBorder) {
        d[i] = 0;
        d[i + 1] = 255;
        d[i + 2] = 0;
        d[i + 3] = 255; // Solid pure #00FF00 green for sprite forge
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);

  // Save cleaned source to sources directory
  const destSource = join(MONSTER_DIR, "blaster_frank-S.png");
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "blaster_frank-S.png");
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
    return g > 230 && r < 45 && b < 45;
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
    sheet: "blaster_frank-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Danny DeVito inspired monster who shoots a snub-nosed revolver into the air and suffers random misfires",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    palette: [
      "#d97706", "#b45309", "#78350f", "#451a03",
      "#15803d", "#166534", "#14532d", "#fde047",
      "#f97316", "#ef4444", "#e2e8f0", "#94a3b8",
      "#475569", "#1e293b", "#0f172a", "#000000"
    ],
    matte: {
      bg: [0, 255, 0],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "blaster_frank-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Blaster Frank sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep Blaster Frank sprite sheet:", err);
  process.exit(1);
});
