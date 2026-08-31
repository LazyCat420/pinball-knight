import { createCanvas, loadImage } from "canvas";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const BRAIN = "/home/lazycat/.gemini/antigravity-ide/brain/c26503c8-1e8b-43cc-945f-1970fd471a11";

const BOSS_SOURCES = [
  {
    name: "reaper",
    jpg: "reaper_king_sheet_1788217054184.jpg",
    tolerance: 48,
  },
  {
    name: "broodmother",
    jpg: "broodmother_sheet_flat_1788217249998.jpg",
    tolerance: 48,
  },
  {
    name: "overlord",
    jpg: "overlord_sheet_1788217094919.jpg",
    tolerance: 48,
  },
  {
    name: "archivist",
    jpg: "archivist_sheet_1788217134759.jpg",
    tolerance: 48,
  },
];

async function main() {
  console.log("Ingesting boss sprite sheets...");

  // 1. Process standard 4x4 bosses
  for (const item of BOSS_SOURCES) {
    const jpgPath = path.join(BRAIN, item.jpg);
    if (!fs.existsSync(jpgPath)) {
      console.error("Missing JPG:", jpgPath);
      continue;
    }

    const buf = fs.readFileSync(jpgPath);
    const img = await loadImage(buf);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const sourceDir = path.join(ROOT, "sources", `${item.name}-2026-08-31`);
    fs.mkdirSync(sourceDir, { recursive: true });
    const sourcePng = path.join(sourceDir, `${item.name}-S.png`);
    fs.writeFileSync(sourcePng, canvas.toBuffer("image/png"));

    const inboxDir = path.join(ROOT, "inbox");
    fs.mkdirSync(inboxDir, { recursive: true });
    const inboxPng = path.join(inboxDir, `${item.name}-S.png`);
    fs.writeFileSync(inboxPng, canvas.toBuffer("image/png"));

    const sidecar = {
      sheet: `${item.name}-S`,
      author: "LazyCat420 & Nano Banana",
      notes: `${item.name} 4x4 SNES boss sprite sheet`,
      matte: {
        tolerance: item.tolerance,
      },
      grid: [4, 4],
      rows: ["idle", "walk", "attack", "death"],
    };
    fs.writeFileSync(
      path.join(inboxDir, `${item.name}-S.json`),
      JSON.stringify(sidecar, null, 2)
    );

    console.log(`✔ Ingested ${item.name}`);
  }

  // 2. Process Multi-Part Composite Dragon Boss
  const bodyJpg = path.join(BRAIN, "dragon_body_flat_sheet_1788217312690.jpg");
  const headWingsJpg = path.join(BRAIN, "dragon_head_wings_sheet_1788217167739.jpg");

  if (fs.existsSync(bodyJpg) && fs.existsSync(headWingsJpg)) {
    console.log("Compositing multi-part Dragon Boss...");
    const bodyBuf = fs.readFileSync(bodyJpg);
    const headWingsBuf = fs.readFileSync(headWingsJpg);

    const bodyImg = await loadImage(bodyBuf);
    const headWingsImg = await loadImage(headWingsBuf);

    // Save individual parts to sources/dragon-2026-08-31/parts/
    const dragonSourceDir = path.join(ROOT, "sources", "dragon-2026-08-31");
    const dragonPartsDir = path.join(dragonSourceDir, "parts");
    fs.mkdirSync(dragonPartsDir, { recursive: true });

    const bodyCanvas = createCanvas(bodyImg.width, bodyImg.height);
    bodyCanvas.getContext("2d").drawImage(bodyImg, 0, 0);
    fs.writeFileSync(path.join(dragonPartsDir, "dragon_body-S.png"), bodyCanvas.toBuffer("image/png"));

    const headCanvas = createCanvas(headWingsImg.width, headWingsImg.height);
    headCanvas.getContext("2d").drawImage(headWingsImg, 0, 0);
    fs.writeFileSync(path.join(dragonPartsDir, "dragon_head_wings-S.png"), headCanvas.toBuffer("image/png"));

    // Composite them together:
    const W = bodyImg.width;
    const H = bodyImg.height;
    const compCanvas = createCanvas(W, H);
    const compCtx = compCanvas.getContext("2d");

    // Fill background with uniform pure magenta (#FF00FF)
    compCtx.fillStyle = "#FF00FF";
    compCtx.fillRect(0, 0, W, H);

    const bodyCtx = bodyCanvas.getContext("2d");
    const bodyData = bodyCtx.getImageData(0, 0, W, H).data;

    const headCtx = headCanvas.getContext("2d");
    const headData = headCtx.getImageData(0, 0, W, H).data;

    const compImgData = compCtx.getImageData(0, 0, W, H);
    const compData = compImgData.data;

    for (let i = 0; i < compData.length; i += 4) {
      // 1. Check body pixel
      const br = bodyData[i];
      const bg = bodyData[i + 1];
      const bb = bodyData[i + 2];
      const ba = bodyData[i + 3];
      const bDist = Math.sqrt((br - 255) ** 2 + bg ** 2 + (bb - 255) ** 2);

      if (bDist > 45 && ba > 30) {
        compData[i] = br;
        compData[i + 1] = bg;
        compData[i + 2] = bb;
        compData[i + 3] = ba;
      }

      // 2. Check head/wings pixel (drawn on top)
      const hr = headData[i];
      const hg = headData[i + 1];
      const hb = headData[i + 2];
      const ha = headData[i + 3];
      const hDist = Math.sqrt((hr - 255) ** 2 + hg ** 2 + (hb - 255) ** 2);

      if (hDist > 45 && ha > 30) {
        compData[i] = hr;
        compData[i + 1] = hg;
        compData[i + 2] = hb;
        compData[i + 3] = ha;
      }
    }

    compCtx.putImageData(compImgData, 0, 0);

    // Save final composite dragon sheet
    const dragonSourcePng = path.join(dragonSourceDir, "dragon-S.png");
    fs.writeFileSync(dragonSourcePng, compCanvas.toBuffer("image/png"));

    const inboxDir = path.join(ROOT, "inbox");
    const dragonInboxPng = path.join(inboxDir, "dragon-S.png");
    fs.writeFileSync(dragonInboxPng, compCanvas.toBuffer("image/png"));

    const dragonSidecar = {
      sheet: "dragon-S",
      author: "LazyCat420 & Nano Banana (Multi-Part Composite)",
      notes: "Ancient Dragon 4x4 SNES boss sprite sheet assembled from modular Body and Head/Wings layers",
      matte: {
        tolerance: 48,
      },
      grid: [4, 4],
      rows: ["idle", "walk", "attack", "death"],
    };
    fs.writeFileSync(
      path.join(inboxDir, "dragon-S.json"),
      JSON.stringify(dragonSidecar, null, 2)
    );

    console.log("✔ Assembled and Ingested dragon-S (Multi-Part Composite)");
  }
}

main().catch((err) => {
  console.error("Error ingesting bosses:", err);
  process.exit(1);
});
