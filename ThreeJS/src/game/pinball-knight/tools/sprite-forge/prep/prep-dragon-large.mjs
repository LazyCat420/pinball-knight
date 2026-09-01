import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = "/home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge";
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");

const BODY_SRC = "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/dragon_body_large_1788220683688.jpg";
const FX_SRC = "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11/dragon_fx_layer_1788220872374.jpg";

async function run() {
  console.log("Loading dragon large body and fx layers...");
  const bodyImg = await loadImage(BODY_SRC);
  const fxImg = await loadImage(FX_SRC);

  const w = 1024;
  const h = 1024;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  // Chroma key helper for #FF00FF magenta
  function matteMagenta(srcImg) {
    const c = createCanvas(w, h);
    const cx = c.getContext("2d");
    cx.drawImage(srcImg, 0, 0, w, h);
    const imgData = cx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      // Magenta #FF00FF
      if (r > 190 && g < 70 && b > 190) {
        d[i + 3] = 0;
      }
      // Strip black grid border lines between cells (at x=256, 512, 768 or y=256, 512, 768)
      const px = (i / 4) % w;
      const py = Math.floor((i / 4) / w);
      if ((px % 256 === 0 || px % 256 === 255 || py % 256 === 0 || py % 256 === 255) && r < 40 && g < 40 && b < 40) {
        d[i + 3] = 0;
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const mattedBody = matteMagenta(bodyImg);
  const mattedFx = matteMagenta(fxImg);

  // 1. Draw solid magenta background on final canvas
  ctx.fillStyle = "#FF00FF";
  ctx.fillRect(0, 0, w, h);

  // 2. Draw matted body
  ctx.drawImage(mattedBody, 0, 0);

  // 3. Composite FX layer onto Attack row (row 2: y 512..768)
  // Extract flame blast from row 2 of mattedFx (y 512..768)
  ctx.drawImage(mattedFx, 0, 512, w, 256, 30, 512, w, 256);

  const pngBuf = canvas.toBuffer("image/png");

  // Save parts
  const srcDir = join(SOURCES, "dragon-2026-08-31");
  const partsDir = join(srcDir, "parts");
  mkdirSync(partsDir, { recursive: true });

  const bodyCanvas = createCanvas(w, h);
  const bodyCtx = bodyCanvas.getContext("2d");
  bodyCtx.fillStyle = "#FF00FF";
  bodyCtx.fillRect(0, 0, w, h);
  bodyCtx.drawImage(mattedBody, 0, 0);
  writeFileSync(join(partsDir, "dragon_body-S.png"), bodyCanvas.toBuffer("image/png"));

  const fxCanvas = createCanvas(w, h);
  const fxCtx = fxCanvas.getContext("2d");
  fxCtx.fillStyle = "#FF00FF";
  fxCtx.fillRect(0, 0, w, h);
  fxCtx.drawImage(mattedFx, 0, 0);
  writeFileSync(join(partsDir, "dragon_fx-S.png"), fxCanvas.toBuffer("image/png"));

  // Save composite
  writeFileSync(join(srcDir, "dragon-S.png"), pngBuf);

  // Save to inbox
  mkdirSync(INBOX, { recursive: true });
  writeFileSync(join(INBOX, "dragon-S.png"), pngBuf);

  // Generate exact ink-tight cell bounds per 256x256 tile
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
          if (a > 20 && !(r > 190 && g < 70 && b > 190)) {
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
    rows: ["idle", "walk", "attack", "death"],
    rects: cells,
    scale: 1.0,
    matte: { tolerance: 64 }
  };

  writeFileSync(join(INBOX, "dragon-S.json"), JSON.stringify(sidecar, null, 2));
  console.log("Dragon large composite and sidecar saved successfully with exact 4x4 rects!");
}

run().catch(console.error);
