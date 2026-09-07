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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/a200ad12-411c-4af5-bf7d-173a4d6b96f9/gnome_lawnmower_sheet_1788746637016.jpg";
const GNOME_DIR = join(SOURCES, "gnome-2026-09-06");
const ALT_DIR = join(GNOME_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "gnome_lawnmower_master.jpg");

async function run() {
  console.log("🍄 Preparing Lawnmower Pipe Gnome Sprite Sheet...");

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
      `# Lawnmower Pipe Gnome Sprite Sheet Archive

- **Date**: 2026-09-06
- **Subject**: Lawnmower Pipe Gnome (\`gnome\`) pushing rotary lawnmower with spinning blades, smoking wooden pipe, and cartoon smoke poof death.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/gnome-2026-09-06/gnome-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames)
  - Row 0 (0..3): \`idle\` (gnome holding mower handlebars, pipe clenched in teeth puffing small smoke rings, engine idling)
  - Row 1 (4..7): \`walk\` (gnome running forward pushing lawnmower, wheels turning, smoke trailing behind)
  - Row 2 (8..11): \`attack\` (lawnmower revving with high-speed whirring blades, grass clippings and yellow sparks shooting from chute)
  - Row 3 (12..15): \`death\` (lawnmower pops, gnome engulfed in cartoon smoke cloud, poofing and dissolving into swirling smoke puffs until gone)
- **Chroma Background**: \`#FF00FF\` magenta
- **Master Take**: \`alt-takes/gnome_lawnmower_master.jpg\` (Nano Banana 4x4 take)
`,
    );
  }

  const masterImg = await loadImage(existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG);

  const w = 1024;
  const h = 1024;

  // Chroma key helper for #FF00FF magenta + border cleanup + hat taper
  function cleanSheet(srcImg) {
    const c = createCanvas(w, h);
    const cx = c.getContext("2d");
    cx.fillStyle = "#FF00FF";
    cx.fillRect(0, 0, w, h);

    // Scale each 256x256 cell by 0.94x anchored to bottom center (grounding the lawnmower)
    // to give 15px headroom so the hat is never cut off at the top border
    for (let r = 0; r < 4; r++) {
      for (let col = 0; col < 4; col++) {
        const srcCell = createCanvas(256, 256);
        const scx = srcCell.getContext("2d");

        if (r === 3 && col === 3) {
          // Enhance cell 3,3 (death3) with dissolving smoke puff cluster from death2 (cell 2,3)
          scx.fillStyle = "#FF00FF";
          scx.fillRect(0, 0, 256, 256);
          scx.drawImage(srcImg, 550, 790, 180, 180, 64, 64, 130, 130);
        } else {
          scx.drawImage(srcImg, col * 256, r * 256, 256, 256, 0, 0, 256, 256);
        }

        const tgtCell = createCanvas(256, 256);
        const tcx = tgtCell.getContext("2d");
        tcx.fillStyle = "#FF00FF";
        tcx.fillRect(0, 0, 256, 256);

        const scale = 0.94;
        const sw = 256 * scale;
        const sh = 256 * scale;
        const sx = (256 - sw) / 2;
        const sy = 254 - (254 * scale);

        tcx.drawImage(srcCell, sx, sy, sw, sh);

        // In living rows (0, 1, 2), taper the gnome's red cone hat to a sharp pointed apex
        if (r < 3) {
          const cellData = tcx.getImageData(0, 0, 256, 256);
          const cd = cellData.data;
          let topY = 256, topX = 128;
          for (let y = 0; y < 100; y++) {
            for (let x = 50; x < 180; x++) {
              const idx = (y * 256 + x) * 4;
              const red = cd[idx], green = cd[idx+1], blue = cd[idx+2];
              if (!(red > 180 && blue > 180 && green < 80)) {
                topY = y;
                topX = x;
                break;
              }
            }
            if (topY < 256) break;
          }

          let minX = topX, maxX = topX;
          for (let x = 50; x < 180; x++) {
            const idx = (topY * 256 + x) * 4;
            const red = cd[idx], green = cd[idx+1], blue = cd[idx+2];
            if (!(red > 180 && blue > 180 && green < 80)) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
            }
          }
          const midX = Math.round((minX + maxX) / 2);

          const setPixel = (px, py, col) => {
            const idx = (py * 256 + px) * 4;
            cd[idx] = col[0]; cd[idx+1] = col[1]; cd[idx+2] = col[2]; cd[idx+3] = 255;
          };
          const cHi = [224, 48, 48];
          const cMid = [196, 32, 32];
          const cDk = [152, 24, 24];

          if (topY >= 4) {
            // Row topY - 1: 3px wide
            setPixel(midX - 1, topY - 1, cDk);
            setPixel(midX, topY - 1, cMid);
            setPixel(midX + 1, topY - 1, cHi);
            // Row topY - 2: 2px wide
            setPixel(midX - 1, topY - 2, cDk);
            setPixel(midX, topY - 2, cHi);
            // Row topY - 3: 1px sharp apex!
            setPixel(midX, topY - 3, cMid);
          }
          tcx.putImageData(cellData, 0, 0);
        }

        cx.drawImage(tgtCell, col * 256, r * 256);
      }
    }

    const imgData = cx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Clean magenta keying
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const px = (i / 4) % w;
      const py = Math.floor((i / 4) / w);

      const isMagenta = (r > 160 && b > 160 && g < 80) || (r > 130 && b > 130 && g < 50);
      const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 75 && g < 75 && b < 75);

      if (isMagenta || isGridLine) {
        d[i] = 255;
        d[i + 1] = 0;
        d[i + 2] = 255;
        d[i + 3] = 255;
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);

  // Save cleaned source to sources directory
  const destSource = join(GNOME_DIR, "gnome-S.png");
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "gnome-S.png");
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
    sheet: "gnome-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Lawnmower Pipe Gnome with pipe smoke and vanishing poof death",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [255, 0, 255],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "gnome-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Lawnmower Pipe Gnome sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep gnome sprite sheet:", err);
  process.exit(1);
});
