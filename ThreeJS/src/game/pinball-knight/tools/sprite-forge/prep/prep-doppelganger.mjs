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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/doppelganger_boss_sheet_1789110092864.jpg";
const BOSS_DIR = join(SOURCES, "doppelganger-2026-09-11");
const ALT_DIR = join(BOSS_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "doppelganger_boss_sheet_1789110092864.jpg");

async function run() {
  console.log("⚔️ Preparing The Doppelgänger (Evil Pinball Knight Boss) Sprite Sheet...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# The Doppelgänger (Evil Pinball Knight Boss) Sprite Sheet Archive

- **Date**: 2026-09-11
- **Subject**: The Doppelgänger (\`doppelganger\`), the evil corrupted mirror boss of Pinball Knight: blackened obsidian plate armor with glowing violet etched runes, sharp flared pauldrons, pointed bascinet helm with glowing crimson/violet visor slit, wielding a jagged dark rune blade and spiked shield.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/doppelganger-2026-09-11/doppelganger-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (4 frames: menacing stance with smoky wisps, pulsing violet visor slit, sword held resting forward)
  - Row 1 (4..7): \`walk\` (4 frames: aggressive armored march stalk forward with blade raised and shield locked)
  - Row 2 (8..11): \`attack\` (4 frames: The Corrupted Cleave Slash: high-energy leaping swing releasing a luminous purple crescent blade arc slash trail)
  - Row 3 (12..15): \`death\` (4 frames: stagger back, obsidian armor cracking with blinding light rays bursting out, sword shattering, collapsing into shadows and dark plate remnants)
- **Chroma Background**: \`#FF00FF\` magenta
- **Master Take**: \`alt-takes/doppelganger_boss_sheet_1789110092864.jpg\`
`
  );
  console.log(`Saved README to ${readme}`);

  const srcPath = existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG;
  const masterImg = await loadImage(srcPath);

  const w = 1024;
  const h = 1024;
  console.log(`Loaded master image: ${w}x${h}`);

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(masterImg, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Chroma key cleanup for #FF00FF
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const px = (i / 4) % w;
    const py = Math.floor((i / 4) / w);

    // Magenta chroma check
    const isMagenta = r > 175 && g < 90 && b > 175;
    // Edge artifacts or grid boundary noise
    const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 75 && g < 75 && b < 75);
    // Outer perimeter must always be clean magenta
    const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;

    if (isMagenta || isGridLine || isOuterBorder) {
      d[i] = 255;
      d[i + 1] = 0;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Compute ink-tight cell bounds per 256x256 tile
  const compData = ctx.getImageData(0, 0, w, h).data;
  const rows = ["idle", "walk", "attack", "death"];
  const manifestRows = [];

  for (let row = 0; row < 4; row++) {
    const rowCells = [];
    for (let col = 0; col < 4; col++) {
      const x0 = col * 256;
      const y0 = row * 256;
      let minX = 256, minY = 256, maxX = 0, maxY = 0;
      let found = false;

      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const idx = ((y0 + y) * w + (x0 + x)) * 4;
          const r = compData[idx];
          const g = compData[idx + 1];
          const b = compData[idx + 2];
          const a = compData[idx + 3];

          const isBg = r > 175 && g < 90 && b > 175;
          if (a > 20 && !isBg) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (!found) {
        minX = 10;
        minY = 10;
        maxX = 245;
        maxY = 245;
      }

      // Add a 1px margin around character bounding box within the tile
      const globalX0 = x0 + Math.max(0, minX - 1);
      const globalY0 = y0 + Math.max(0, minY - 1);
      const globalX1 = x0 + Math.min(255, maxX + 1);
      const globalY1 = y0 + Math.min(255, maxY + 1);

      rowCells.push([globalX0, globalY0, globalX1, globalY1]);
    }

    manifestRows.push({
      clip: rows[row],
      cells: rowCells,
    });
  }

  // Save source PNG in sources/doppelganger-2026-09-11/
  const sourcePng = join(BOSS_DIR, "doppelganger-S.png");
  writeFileSync(sourcePng, canvas.toBuffer("image/png"));
  console.log(`Saved source PNG: ${sourcePng}`);

  // Save inbox PNG and JSON
  const inboxPng = join(INBOX, "doppelganger-S.png");
  const inboxJson = join(INBOX, "doppelganger-S.json");

  writeFileSync(inboxPng, canvas.toBuffer("image/png"));

  const manifest = {
    sheet: "doppelganger-S",
    author: "LazyCat420 & Nano Banana",
    notes: "The Doppelgänger evil pinball knight 4x4 SNES boss sprite sheet",
    matte: { tolerance: 64, bg: [255, 0, 255] },
    grid: [4, 4],
    rows: ["idle", "walk", "attack", "death"],
    palette: [
      "#0d0b14",
      "#1a1528",
      "#2c2440",
      "#423760",
      "#624e88",
      "#8b6db5",
      "#b892e6",
      "#d8bbf8",
      "#ff2a8d",
      "#ff0055"
    ],
    rects: manifestRows.map((r) => r.cells),
  };

  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Saved inbox PNG & JSON: ${inboxPng}, ${inboxJson}`);
  console.log("✅ The Doppelgänger prep completed successfully!");
}

run().catch((err) => {
  console.error("Failed to prep The Doppelgänger:", err);
  process.exit(1);
});
