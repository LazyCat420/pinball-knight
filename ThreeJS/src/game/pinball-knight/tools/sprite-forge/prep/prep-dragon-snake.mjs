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

const PIECES = [
  {
    name: "dragon_snake_head",
    rawJpg: "/home/lazycat/.gemini/antigravity-ide/brain/a200ad12-411c-4af5-bf7d-173a4d6b96f9/dragon_snake_head_sheet_1788744112649.jpg",
    sheetKey: "dragon_snake_head-S",
    notes: "Serpentine Dragon Head piece with fire breath attack, undulating slither, and death recoil",
  },
  {
    name: "dragon_snake_body",
    rawJpg: "/home/lazycat/.gemini/antigravity-ide/brain/a200ad12-411c-4af5-bf7d-173a4d6b96f9/dragon_snake_body_sheet_1788744129375.jpg",
    sheetKey: "dragon_snake_body-S",
    notes: "Modular Serpentine Dragon Body Segment piece designed to chain into long snake bodies",
  },
  {
    name: "dragon_snake_tail",
    rawJpg: "/home/lazycat/.gemini/antigravity-ide/brain/a200ad12-411c-4af5-bf7d-173a4d6b96f9/dragon_snake_tail_sheet_1788744178935.jpg",
    sheetKey: "dragon_snake_tail-S",
    notes: "Serpentine Dragon Tail Tip piece with flame crest, swishing tail wave, and tail whip",
  },
];

const DRAGON_DIR = join(SOURCES, "dragon_snake-2026-09-06");
const ALT_DIR = join(DRAGON_DIR, "alt-takes");

async function run() {
  console.log("🐉 Preparing Multi-Part Snake Dragon Boss Sprite Sheets (Nano Banana + Sprite Forge)...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  const readme = join(ALT_DIR, "README.md");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      `# Multi-Part Snake Dragon Boss Sprite Sheet Archive

- **Date**: 2026-09-06
- **Subject**: Modular Serpentine Snake Dragon Boss (\`dragon_snake\`) composed of Head, Body Segments, and Tail Tip pieces generated via Nano Banana.
- **Components**:
  - \`dragon_snake_head-S\`: Head with horned crest, jaws, and fire breath attack.
  - \`dragon_snake_body-S\`: Modular interlocking body segment for snake-like chain.
  - \`dragon_snake_tail-S\`: Tapered tail tip with barbed fin and flame tuft.
- **Chroma Background**: \`#FF00FF\` magenta
- **Grid Layout**: 4 columns × 4 rows (16 frames per piece)
  - Row 0 (0..3): \`idle\`
  - Row 1 (4..7): \`walk\` (sinuous slither / undulating wave)
  - Row 2 (8..11): \`attack\` (fire breath / scale flare / tail whip)
  - Row 3 (12..15): \`death\` (collapse / crumble)
`,
    );
  }

  const w = 1024;
  const h = 1024;

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

      // Magenta chroma key check
      const isMagenta = (r > 160 && b > 160 && g < 110) || (r > 130 && b > 130 && (r + b) > g * 2.1);
      // Outer border frame
      const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;

      if (isMagenta || isOuterBorder) {
        d[i] = 255;
        d[i + 1] = 0;
        d[i + 2] = 255;
        d[i + 3] = 255;
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  for (const piece of PIECES) {
    console.log(`\n▸ Processing ${piece.name}...`);
    const masterSrc = join(ALT_DIR, `${piece.name}_master.jpg`);
    if (existsSync(piece.rawJpg) && !existsSync(masterSrc)) {
      copyFileSync(piece.rawJpg, masterSrc);
      console.log(`  Copied raw take to alt-takes: ${masterSrc}`);
    }

    const srcPath = existsSync(masterSrc) ? masterSrc : piece.rawJpg;
    const img = await loadImage(srcPath);
    const cleanedCanvas = cleanSheet(img);

    // Save cleaned source
    const destSource = join(DRAGON_DIR, `${piece.sheetKey}.png`);
    writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
    console.log(`  Saved source: ${destSource}`);

    // Save to inbox
    const inboxPng = join(INBOX, `${piece.sheetKey}.png`);
    writeFileSync(inboxPng, cleanedCanvas.toBuffer("image/png"));
    console.log(`  Saved inbox PNG: ${inboxPng}`);

    // Detect cells
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
      sheet: piece.sheetKey,
      author: "LazyCat420 & Nano Banana",
      notes: piece.notes,
      grid: [4, 4],
      rows: rows,
      rects: rects,
      matte: {
        bg: [255, 0, 255],
        tolerance: 64,
      },
    };

    const inboxJson = join(INBOX, `${piece.sheetKey}.json`);
    writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
    console.log(`  Saved inbox manifest: ${inboxJson}`);
  }

  console.log("\n✅ All Multi-Part Snake Dragon boss sprite sheets prepped successfully!");
}

run().catch((err) => {
  console.error("Failed to prep dragon snake sprite sheets:", err);
  process.exit(1);
});
