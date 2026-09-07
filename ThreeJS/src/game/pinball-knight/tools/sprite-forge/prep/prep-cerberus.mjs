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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/cerberus_castlevania_sheet_1788809759128.jpg";
const RAW_WALK = "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/cerberus_walk_front_1788810606634.jpg";
const CERBERUS_DIR = join(SOURCES, "cerberus-2026-09-07");
const ALT_DIR = join(CERBERUS_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "cerberus_castlevania_sheet_1788809759128.jpg");
const WALK_SRC = join(ALT_DIR, "cerberus_walk_front_1788810606634.jpg");

async function run() {
  console.log("🐺 Preparing Cerberus Three-Headed Hellhound Boss Sprite Sheet (Castlevania Style + 3-Headed Walk)...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }
  if (existsSync(RAW_WALK) && !existsSync(WALK_SRC)) {
    copyFileSync(RAW_WALK, WALK_SRC);
    console.log(`Copied raw walk take to alt-takes: ${WALK_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# Cerberus Hellhound Boss Sprite Sheet Archive

- **Date**: 2026-09-07
- **Subject**: Cerberus, the giant mythological three-headed hellhound monster boss (\`cerberus\`), in dark gothic medieval Castlevania (SOTN / Rondo of Blood) aesthetic: sinewy dark slate musculature, spiked iron collars with hanging broken chains, bared razor fangs, glowing red eyes, signature mouth grab & thrash attack, side heads venting brimstone flame, and gothic death collapse.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/cerberus-2026-09-07/cerberus-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (4 frames: menacing gothic quadruped hellhound stance, 3 heads snarling/breathing, glowing red eyes, chain sway)
  - Row 1 (4..7): \`walk\` (4 frames: heavy predatory quadruped stalk stride forward with all 3 heads front-and-center, sinewy gait)
  - Row 2 (8..11): \`attack\` (4 frames: center jaws grab knight, violent side-to-side thrash, side heads breathing brimstone fire)
  - Row 3 (12..15): \`death\` (4 frames: agony howl, collapse dissolving into gothic demonic ash, smoke, and charred bone fragments)
- **Chroma Background**: \`#FF00FF\` magenta
- **Takes Archive**:
  - \`alt-takes/cerberus_sheet_1788782547671.jpg\` (Take 1 - Volcanic Hellhound)
  - \`alt-takes/cerberus_castlevania_sheet_1788809759128.jpg\` (Take 2 - Master: Gothic Medieval Castlevania Style)
  - \`alt-takes/cerberus_walk_front_1788810606634.jpg\` (Take 3 - Spliced Walk: 4-Frame 3-Headed Front Walk Cycle)
`,
  );
  console.log(`Saved README to ${readme}`);

  const srcPath = existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG;
  const masterImg = await loadImage(srcPath);

  const w = masterImg.width;
  const h = masterImg.height;
  console.log(`Loaded master image: ${w}x${h}`);

  const c = createCanvas(w, h);
  const cx = c.getContext("2d");
  cx.drawImage(masterImg, 0, 0, w, h);

  // Splice 3-headed walk cycle into Row 1 (y: 256..512)
  const walkPath = existsSync(WALK_SRC) ? WALK_SRC : RAW_WALK;
  if (existsSync(walkPath)) {
    const walkImg = await loadImage(walkPath);
    console.log(`Loaded walk strip: ${walkImg.width}x${walkImg.height}`);

    // Clear Row 1 with flat magenta
    cx.fillStyle = "#FF00FF";
    cx.fillRect(0, 256, 1024, 256);

    const colW = walkImg.width / 4;
    const walkCanvas = createCanvas(walkImg.width, walkImg.height);
    const wcx = walkCanvas.getContext("2d");
    wcx.drawImage(walkImg, 0, 0);
    const wd = wcx.getImageData(0, 0, walkImg.width, walkImg.height).data;

    for (let col = 0; col < 4; col++) {
      let minX = (col + 1) * colW, maxX = col * colW;
      let minY = walkImg.height, maxY = 0;
      for (let y = 0; y < walkImg.height; y++) {
        for (let x = Math.floor(col * colW); x < Math.floor((col + 1) * colW); x++) {
          const idx = (y * walkImg.width + x) * 4;
          const r = wd[idx], g = wd[idx + 1], b = wd[idx + 2];
          const isBg = (r > 160 && b > 160 && g < 70);
          if (!isBg) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const srcW = maxX - minX;
      const srcH = maxY - minY;
      const scale = 238 / 544;
      const destW = Math.round(srcW * scale);
      const destH = Math.round(srcH * scale);
      const destY = 506 - destH;
      const destX = Math.round(col * 256 + (256 - destW) / 2);

      cx.drawImage(walkImg, minX, minY, srcW, srcH, destX, destY, destW, destH);
    }
    console.log("Spliced 4-frame 3-headed walk cycle into Row 1");
  }
  const imgData = cx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // 1. Wipe all grid dividing lines (outer border + internal 256px dividers) with solid magenta
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isDivider = (x % 256 <= 3 || x % 256 >= 253 || y % 256 <= 3 || y % 256 >= 253);
      if (isDivider) {
        const idx = (y * w + x) * 4;
        d[idx] = 255;
        d[idx + 1] = 0;
        d[idx + 2] = 255;
        d[idx + 3] = 255;
      }
    }
  }

  // 2. Flood fill background pixels from image perimeter to remove noise
  const visited = new Uint8Array(w * h);
  const queue = [];

  function isBgPixel(px, py) {
    const idx = (py * w + px) * 4;
    const r = d[idx];
    const g = d[idx + 1];
    const b = d[idx + 2];
    return (r > 160 && b > 160 && g < 70) || (r > 130 && b > 130 && g < 45);
  }

  for (let x = 0; x < w; x++) {
    if (isBgPixel(x, 0)) { queue.push(x); visited[x] = 1; }
    const btm = (h - 1) * w + x;
    if (isBgPixel(x, h - 1)) { queue.push(btm); visited[btm] = 1; }
  }
  for (let y = 0; y < h; y++) {
    const left = y * w;
    if (isBgPixel(0, y)) { queue.push(left); visited[left] = 1; }
    const right = y * w + (w - 1);
    if (isBgPixel(w - 1, y)) { queue.push(right); visited[right] = 1; }
  }

  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++];
    const px = pos % w;
    const py = Math.floor(pos / w);
    const neighbors = [
      [px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const npos = ny * w + nx;
        if (!visited[npos] && isBgPixel(nx, ny)) {
          visited[npos] = 1;
          queue.push(npos);
        }
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    if (visited[i]) {
      const idx = i * 4;
      d[idx] = 255;
      d[idx + 1] = 0;
      d[idx + 2] = 255;
      d[idx + 3] = 255;
    }
  }

  cx.putImageData(imgData, 0, 0);

  // Save cleaned source to sources directory
  const destSource = join(CERBERUS_DIR, "cerberus-S.png");
  writeFileSync(destSource, c.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, "cerberus-S.png");
  writeFileSync(inboxPng, c.toBuffer("image/png"));
  console.log(`Saved inbox image to: ${inboxPng}`);

  // 3. Detect ink-tight bounding rects in the 4x4 grid
  const cellW = w / 4;
  const cellH = h / 4;
  const rows = ["idle", "walk", "attack", "death"];
  const rects = [];

  for (let r = 0; r < 4; r++) {
    const rowRects = [];
    for (let col = 0; col < 4; col++) {
      let minX = (col + 1) * cellW;
      let maxX = col * cellW;
      let minY = (r + 1) * cellH;
      let maxY = r * cellH;

      for (let y = r * cellH + 4; y < (r + 1) * cellH - 4; y++) {
        for (let x = col * cellW + 4; x < (col + 1) * cellW - 4; x++) {
          const idx = (y * w + x) * 4;
          const red = d[idx], green = d[idx + 1], blue = d[idx + 2];
          const isBg = (red > 170 && blue > 170 && green < 60) || (red > 140 && blue > 140 && green < 40);
          if (!isBg) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX >= minX && maxY >= minY) {
        rowRects.push([minX, minY, maxX, maxY]);
      } else {
        rowRects.push([col * cellW + 10, r * cellH + 10, (col + 1) * cellW - 10, (r + 1) * cellH - 10]);
      }
    }
    rects.push(rowRects);
  }

  const manifest = {
    sheet: "cerberus-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Cerberus Three-Headed Hellhound Boss with jaw grab thrash attack and mouth fire breath",
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [255, 0, 255],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, "cerberus-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to: ${inboxJson}`);
  console.log("✅ Cerberus sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep cerberus sprite sheet:", err);
  process.exit(1);
});
