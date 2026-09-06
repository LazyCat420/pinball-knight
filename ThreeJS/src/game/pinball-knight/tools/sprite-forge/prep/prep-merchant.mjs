import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = join(__dirname, "..");
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");

const MASTER_SRC = join(SOURCES, "merchant-2026-09-06", "alt-takes", "mad_hatter_wizard_merchant_sheet_1788672741958.jpg");

async function run() {
  console.log("🎩 Preparing Alice in Wonderland Mad Hatter Wizard Merchant Sprite Sheet (Nano Banana + Sprite Forge)...");

  if (!existsSync(MASTER_SRC)) {
    throw new Error(`Master source missing: ${MASTER_SRC}`);
  }

  const masterImg = await loadImage(MASTER_SRC);

  const w = 1024;
  const h = 1024;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

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
      const isMagenta = r > 175 && g < 85 && b > 175;
      // Strip any edge grid line artifacts
      const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 75 && g < 75 && b < 75);

      if (isMagenta || isGridLine) {
        d[i] = 255;
        d[i + 1] = 0;
        d[i + 2] = 255;
        d[i + 3] = 255; // solid magenta background for sprite forge
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedMaster = cleanSheet(masterImg);

  // Draw solid magenta background on final composite canvas
  ctx.fillStyle = "#FF00FF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(cleanedMaster, 0, 0);

  const pngBuf = canvas.toBuffer("image/png");

  // 1. Save to sources/merchant-2026-09-06/
  const srcDir = join(SOURCES, "merchant-2026-09-06");
  const altTakesDir = join(srcDir, "alt-takes");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(altTakesDir, { recursive: true });

  writeFileSync(join(srcDir, "merchant-S.png"), pngBuf);

  writeFileSync(
    join(altTakesDir, "README.md"),
    `# Alice in Wonderland Mad Hatter Wizard Merchant Sprite Generation Takes

- Master Sheet: mad_hatter_wizard_merchant_sheet_1788672741958.jpg
- Primary Composite: sources/merchant-2026-09-06/merchant-S.png
- Notes: Eccentric Mad Hatter wizard merchant with giant crooked top hat, playing cards tucked in brim, wild white hair, purple/gold frock coat. Row 1 idle, Row 2 walk/roll strut, Row 3 reaching deep inside top hat to pull out glowing potions/cards, Row 4 offering magical treasures with sparkles and theatrical bow.
`
  );

  // 2. Save to inbox/
  mkdirSync(INBOX, { recursive: true });
  writeFileSync(join(INBOX, "merchant-S.png"), pngBuf);

  // 3. Generate ink-tight cell bounds per 256x256 tile
  const cells = [];
  const compCtx = canvas.getContext("2d");
  const compData = compCtx.getImageData(0, 0, w, h).data;

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

          const isBg = r > 175 && g < 85 && b > 175;
          if (a > 20 && !isBg) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (found) {
        rowCells.push([x0 + minX, y0 + minY, x0 + maxX, y0 + maxY]);
      } else {
        rowCells.push([x0, y0, x0 + 255, y0 + 255]);
      }
    }
    cells.push(rowCells);
  }

  const sidecar = {
    sheet: "merchant-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Alice in Wonderland Mad Hatter Wizard Merchant pulling items from top hat",
    grid: [4, 4],
    rows: ["idle", "walk", "reach", "offer"],
    rects: cells,
    scale: 1.0,
    matte: { tolerance: 48 }
  };

  writeFileSync(join(INBOX, "merchant-S.json"), JSON.stringify(sidecar, null, 2));
  console.log("✔ Alice in Wonderland Mad Hatter Wizard Merchant composite and inbox sidecar saved successfully!");
}

run().catch(console.error);
