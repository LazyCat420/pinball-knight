import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = join(__dirname, "..");
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");
const PUBLIC_SPRITES = join(__dirname, "../../../../../../public/sprites");

const ZOMBIE_DIR = join(SOURCES, "zombie-2026-09-14");
const ALT_DIR = join(ZOMBIE_DIR, "alt-takes");

const ZOMBIE_SPECS = [
  { id: "shambler", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_master_sheet_1789363406770.jpg", desc: "Classic undead rot-green shambling zombie" },
  { id: "runner", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_runner_master_1789406123144.jpg", desc: "Feral sprinting runner zombie with rapid strides" },
  { id: "lurcher", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_lurcher_master_1789406398681.jpg", desc: "Bulky hunched lurcher zombie with swollen shoulder" },
  { id: "hulk", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_hulk_master_1789406495034.jpg", desc: "Colossal zombie hulk titan with ground-shaking slam" },
  { id: "midget", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_midget_master_1789406535872.jpg", desc: "Small goblin-stature swarmer midget zombie" },
  { id: "crawler", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_crawler_master_1789406650240.jpg", desc: "Legless crawler zombie dragging itself with claws" },
  { id: "flailer", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_flailer_master_1789406695718.jpg", desc: "Armless flailer zombie with kicking leaps and headbutts" },
  { id: "hobbler", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_hobbler_master_1789406774796.jpg", desc: "Asymmetric hobbler zombie with one peg/withered leg" },
  { id: "plague", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_plague_master_1789407203881.jpg", desc: "Toxic plague shambler with glowing yellow-green boils" },
  { id: "armored", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_armored_master_1789407238364.jpg", desc: "Grave knight zombie in rusted plate armor and helm" },
  { id: "bloated", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_bloated_master_1789407280830.jpg", desc: "Grossly bloated corpse with distended toxic belly" },
  { id: "frenzy", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_frenzy_master_1789407772450.jpg", desc: "Red-eyed frenzy ghoul with elongated bloodied claws" },
  { id: "frost", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_frost_master_1789407806035.jpg", desc: "Frostbitten ice husk zombie with pale frozen cyan skin" },
  { id: "charred", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_charred_master_1789407891679.jpg", desc: "Charred cinder revenant with smoldering ember cracks" },
  { id: "screamer", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_screamer_master_1789407941560.jpg", desc: "Plague screamer with wide unhinged jaw and tattered rags" },
  { id: "clutcher", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_clutcher_master_1789407986921.jpg", desc: "Grave clutcher with elongated multi-jointed arms" },
  { id: "gravedigger", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_gravedigger_master_1789408028016.jpg", desc: "Rotting gravedigger zombie swinging a rusty iron shovel" },
  { id: "mummy", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_mummy_master_1789408440834.jpg", desc: "Cursed mummy zombie wrapped in ancient fraying linen" },
  { id: "herald", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_herald_master_1789408617074.jpg", desc: "Necro-herald cultist swinging a smoking skull censer" },
  { id: "abomination", path: "/home/lazycat/.gemini/antigravity-ide/brain/50a9bb87-0312-402e-9b4b-5425c382a7b8/zombie_abomination_master_1789408672134.jpg", desc: "Stitched two-headed abomination titan with multiple arms" }
];

async function processZombie(spec) {
  const { id, path: rawPath, desc } = spec;
  console.log(`Processing zombie type [${id}]...`);

  const masterDest = join(ALT_DIR, `zombie_${id}_master.jpg`);
  if (existsSync(rawPath) && !existsSync(masterDest)) {
    copyFileSync(rawPath, masterDest);
  }

  const srcPath = existsSync(masterDest) ? masterDest : rawPath;
  const masterImg = await loadImage(srcPath);

  const w = 1024;
  const h = 1024;

  const c = createCanvas(w, h);
  const cx = c.getContext("2d");
  cx.drawImage(masterImg, 0, 0, w, h);
  const imgData = cx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Clean chroma green & remove artifacts/banners
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const px = (i / 4) % w;
    const py = Math.floor((i / 4) / w);

    // Filter out black text banners (like across the middle on screamer)
    const isBannerRow = (py >= 225 && py <= 256) || (py >= 480 && py <= 512) || (py >= 736 && py <= 768) || (py >= 992 && py <= 1023);
    const isBlackBannerPixel = isBannerRow && r < 50 && g < 50 && b < 50;

    // Detect solid chroma green background
    const isChromaGreen = (g > 160 && r < 100 && b < 100) || (g > 200 && (r + b) < 180);

    // Border grid line cleanup
    const isGridLine = (px % 256 <= 2 || px % 256 >= 253 || py % 256 <= 2 || py % 256 >= 253) && (r < 70 && g < 70 && b < 70);
    const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;

    if (isChromaGreen || isBlackBannerPixel || isGridLine || isOuterBorder) {
      d[i] = 0;
      d[i + 1] = 255;
      d[i + 2] = 0;
      d[i + 3] = 255;
    }
  }
  cx.putImageData(imgData, 0, 0);

  // Save cleaned source to sources
  const cleanedSourcePng = join(ZOMBIE_DIR, `zombie_${id}-S.png`);
  writeFileSync(cleanedSourcePng, c.toBuffer("image/png"));

  // Detect cell bounds in the 4x4 grid
  const cellW = w / 4;
  const cellH = h / 4;
  const rows = ["idle", "walk", "attack", "death"];
  const rects = [];

  function isBackground(px, py) {
    if (px < 0 || px >= w || py < 0 || py >= h) return true;
    const idx = (py * w + px) * 4;
    const r = d[idx];
    const g = d[idx + 1];
    const b = d[idx + 2];
    return g > 230 && r < 50 && b < 50;
  }

  for (let r = 0; r < 4; r++) {
    const rowRects = [];
    for (let col = 0; col < 4; col++) {
      const minCellX = Math.floor(col * cellW);
      const maxCellX = Math.floor((col + 1) * cellW);
      const minCellY = Math.floor(r * cellH);
      const maxCellY = Math.floor((r + 1) * cellH);

      let minX = maxCellX, maxX = minCellX;
      let minY = maxCellY, maxY = minCellY;
      let found = false;

      for (let y = minCellY + 4; y < maxCellY - 4; y++) {
        for (let x = minCellX + 4; x < maxCellX - 4; x++) {
          if (!isBackground(x, y)) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (found && (maxX - minX > 8) && (maxY - minY > 8)) {
        const padX1 = Math.max(minCellX, minX - 2);
        const padY1 = Math.max(minCellY, minY - 2);
        const padX2 = Math.min(maxCellX - 1, maxX + 2);
        const padY2 = Math.min(maxCellY - 1, maxY + 2);
        rowRects.push([padX1, padY1, padX2, padY2]);
      } else {
        rowRects.push([minCellX + 15, minCellY + 15, maxCellX - 15, maxCellY - 15]);
      }
    }
    rects.push(rowRects);
  }

  // Create transparent PNG for public/sprites
  const transparentCanvas = createCanvas(w, h);
  const tcx = transparentCanvas.getContext("2d");
  tcx.drawImage(c, 0, 0, w, h);
  const tImgData = tcx.getImageData(0, 0, w, h);
  const td = tImgData.data;
  for (let i = 0; i < td.length; i += 4) {
    const r = td[i];
    const g = td[i + 1];
    const b = td[i + 2];
    if (g > 220 && r < 60 && b < 60) {
      td[i + 3] = 0; // Transparent
    }
  }
  tcx.putImageData(tImgData, 0, 0);

  // Write to inbox
  const key = `zombie_${id}`;
  const inboxJson = join(INBOX, `${key}-S.json`);
  const inboxPng = join(INBOX, `${key}-S.png`);
  const manifest = {
    sheet: `${key}-S`,
    author: "LazyCat420 & Nano Banana",
    notes: desc,
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: { bg: [0, 255, 0], tolerance: 64 }
  };
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  writeFileSync(inboxPng, c.toBuffer("image/png"));

  // Write published public sprites
  const pubJson = join(PUBLIC_SPRITES, `${key}-S.json`);
  const pubPng = join(PUBLIC_SPRITES, `${key}-S.png`);
  const pubPngBuf = transparentCanvas.toBuffer("image/png");
  const sha = createHash("sha256").update(pubPngBuf).digest("hex").slice(0, 12);
  const publishedManifest = {
    name: key,
    dir: "S",
    image: `/sprites/${key}-S.png`,
    source: [w, h],
    hash: sha,
    rows: rows.map((clip, rowIdx) => ({
      clip,
      cells: rects[rowIdx]
    }))
  };
  writeFileSync(pubJson, JSON.stringify(publishedManifest, null, 1));
  writeFileSync(pubPng, pubPngBuf);

  console.log(`✅ [${id}] published to ${pubJson} & ${pubPng}`);
}

async function main() {
  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });
  mkdirSync(PUBLIC_SPRITES, { recursive: true });

  for (const spec of ZOMBIE_SPECS) {
    await processZombie(spec);
  }
  console.log("🎉 All 20 Zombie variant sprite sheets successfully processed and published!");
}

main().catch((err) => {
  console.error("Batch processing failed:", err);
  process.exit(1);
});
