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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/pinball_boss_sheet_1788829817764.jpg";
const BOSS_DIR = join(SOURCES, "pinball_boss-2026-09-07");
const ALT_DIR = join(BOSS_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "pinball_boss_sheet_1788829817764.jpg");

async function run() {
  console.log("⚪ Preparing Tilt Titan (Evil Pinball Boss) Sprite Sheet...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# Tilt Titan (Evil Pinball Boss) Sprite Sheet Archive

- **Date**: 2026-09-07
- **Subject**: Tilt Titan (\`pinball_boss\`), a giant spherical chrome steel pinball boss with an evil mechanical grin, glowing red robotic visor eyes, and electric turbine rev-up sparks.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/pinball_boss-2026-09-07/pinball_boss-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (4 frames: heavy metallic hover and bobbing with moving chrome sheen reflections and red eye glow)
  - Row 1 (4..7): \`walk\` (4 frames: rolling forward across flagstones with rotating etched face and contact friction sparks)
  - Row 2 (8..11): \`attack\` (4 frames: high-RPM spin rev-up with grinding blue/yellow friction sparks into a blazing rocket-boost dash)
  - Row 3 (12..15): \`death\` (4 frames: steel shell fractures, glowing core breach, exploding outward into metal shrapnel and ball bearings)
- **Chroma Background**: \`#00FF00\` bright green
- **Takes Archive**:
  - \`alt-takes/pinball_boss_sheet_1788829817764.jpg\` (Take 1 - Master: Evil Chrome Pinball Boss)
`,
  );
  console.log(`Saved README to ${readme}`);

  const srcPath = existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG;
  const masterImg = await loadImage(srcPath);

  const w = 1024;
  const h = 1024;

  // Chroma key helper for #00FF00 green + edge cleanup
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

      // Protect pinball boss features:
      // Red glowing eyes / visor
      const isRedEye = r > 110 && r > g * 1.4 && r > b * 1.4;
      // Electric sparks (yellow/cyan/white)
      const isYellowSpark = r > 160 && g > 150 && b < 100;
      const isCyanSpark = b > 140 && g > 130 && r < 120;
      // Chrome metal / dark mouth / white teeth / shaded reflections
      const isChrome = Math.abs(r - g) < 45 && Math.abs(g - b) < 45;
      const isMetal = isChrome && (r > 30 || g > 30 || b > 30);
      const isDarkOutline = r < 50 && g < 50 && b < 50;

      // Pure green background check
      const isGreen = !isRedEye && !isYellowSpark && !isCyanSpark && !isDarkOutline && (
        (g > 140 && g > r * 1.35 && g > b * 1.35) ||
        (g > 185 && (r + b) < 220)
      );

      // Edge border cleanup
      const isOuterBorder = px < 2 || px >= w - 2 || py < 2 || py >= h - 2;

      if (isGreen || isOuterBorder) {
        d[i] = 0;
        d[i + 1] = 255;
        d[i + 2] = 0;
        d[i + 3] = 255; // solid pure green
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);

  // Save cleaned source to sources directory
  const destSource = join(BOSS_DIR, "pinball_boss-S.png");
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "pinball_boss-S.png");
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
    sheet: "pinball_boss-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Tilt Titan giant evil pinball boss monster with boost charge and wall smash mechanics",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [0, 255, 0],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "pinball_boss-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Tilt Titan sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep pinball boss sprite sheet:", err);
  process.exit(1);
});
