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

const MASTER_SRC = "/home/lazycat/.gemini/antigravity-ide/brain/d35c88f8-2960-4fd8-81f0-40428a4408c1/trex_boss_sheet_1788566694003.jpg";
const PARTS_SRC = "/home/lazycat/.gemini/antigravity-ide/brain/d35c88f8-2960-4fd8-81f0-40428a4408c1/trex_parts_sheet_1788566710688.jpg";

async function run() {
  console.log("🦖 Preparing T-Rex Boss Sprite Sheet (Nano Banana + Sprite Forge)...");

  if (!existsSync(MASTER_SRC)) {
    throw new Error(`Master source missing: ${MASTER_SRC}`);
  }

  const masterImg = await loadImage(MASTER_SRC);
  const partsImg = existsSync(PARTS_SRC) ? await loadImage(PARTS_SRC) : null;

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

      // Magenta chroma key check
      const isMagenta = r > 180 && g < 80 && b > 180;
      // Strip border lines between cells (border at 0, 255, 256, 511, 512, 767, 768, 1023)
      const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 70 && g < 70 && b < 70);

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

  // 1. Save to sources/trex-2026-09-04/
  const srcDir = join(SOURCES, "trex-2026-09-04");
  const partsDir = join(srcDir, "parts");
  const altTakesDir = join(srcDir, "alt-takes");
  mkdirSync(partsDir, { recursive: true });
  mkdirSync(altTakesDir, { recursive: true });

  writeFileSync(join(srcDir, "trex-S.png"), pngBuf);

  if (partsImg) {
    const partsCanvas = createCanvas(w, h);
    const partsCtx = partsCanvas.getContext("2d");
    partsCtx.fillStyle = "#FF00FF";
    partsCtx.fillRect(0, 0, w, h);
    partsCtx.drawImage(partsImg, 0, 0, w, h);
    writeFileSync(join(partsDir, "trex_parts-S.png"), partsCanvas.toBuffer("image/png"));
  }

  writeFileSync(
    join(altTakesDir, "README.md"),
    `# T-Rex Boss Sprite Generation Takes\n\n- Master Sheet: trex_boss_sheet_1788566694003.jpg\n- Modular Parts: trex_parts_sheet_1788566710688.jpg\n- Primary Composite: sources/trex-2026-09-04/trex-S.png\n`
  );

  // 2. Save to inbox/
  mkdirSync(INBOX, { recursive: true });
  writeFileSync(join(INBOX, "trex-S.png"), pngBuf);

  // 3. Generate exact ink-tight cell bounds per 256x256 tile
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

          const isBg = r > 180 && g < 80 && b > 180;
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
    sheet: "trex-S",
    author: "LazyCat420 & Nano Banana",
    notes: "T-Rex Boss with Sunglasses, Wink, and 360 Tail Spin Special",
    grid: [4, 4],
    rows: ["idle", "walk", "attack", "death"],
    rects: cells,
    scale: 1.0,
    matte: { tolerance: 48 }
  };

  writeFileSync(join(INBOX, "trex-S.json"), JSON.stringify(sidecar, null, 2));
  console.log("✔ T-Rex Boss composite and inbox sidecar saved successfully with exact 4x4 rects!");
}

run().catch(console.error);
