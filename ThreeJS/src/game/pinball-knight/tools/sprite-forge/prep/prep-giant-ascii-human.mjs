import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = join(__dirname, "..");
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");
const PUBLIC_SPRITES = join(__dirname, "../../../../../../public/sprites");
const DIST_SPRITES = join(__dirname, "../../../../../../dist/pinball-knight-windows-x86_64/assets/sprites");

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/giant_ascii_sheet_1789091380505.jpg";
const GIANT_ASCII_DIR = join(SOURCES, "giant-ascii-human-2026-09-10");
const ALT_DIR = join(GIANT_ASCII_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "giant_ascii_sheet_1789091380505.jpg");

async function run() {
  console.log("👾 Preparing Giant ASCII Titan (giant_ascii_human) Sprite Sheet...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });
  mkdirSync(PUBLIC_SPRITES, { recursive: true });
  if (existsSync(DIST_SPRITES)) {
    mkdirSync(DIST_SPRITES, { recursive: true });
  }

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# Giant ASCII Titan Monster Sprite Sheet Archive

- **Date**: 2026-09-10
- **Subject**: Giant ASCII Titan monster (\`giant_ascii_human\`), towering muscular colossus made entirely of dense glowing green 0s and 1s binary digits and matrix glyphs. Formed when multiple ASCII Binary Humans merge together; smashes the stone ground with its massive dual fists.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/giant-ascii-human-2026-09-10/giant_ascii_human-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (4 frames: towering binary titan stance, breathing broad chest, streaming green matrix numbers, resting fists)
  - Row 1 (4..7): \`walk\` (4 frames: heavy earth-shattering stomp stride, forward march, swinging huge binary fists)
  - Row 2 (8..11): \`attack\` (4 frames: double-fist ground smash: raises both fists overhead, surging green lightning, downward hammer slam, crushing the floor with ground impact shockwave)
  - Row 3 (12..15): \`death\` (4 frames: catastrophic digital de-rez breakdown, dissolving into cascading green binary rain)
- **Chroma Background**: \`#FF00FF\` bright magenta
- **Takes Archive**:
  - \`alt-takes/giant_ascii_sheet_1789091380505.jpg\` (Master Take)
`,
  );
  console.log(`Saved README to ${readme}`);

  const srcPath = existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG;
  const masterImg = await loadImage(srcPath);

  const w = 1024;
  const h = 1024;

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

      // Magenta detector
      const isMagenta = r > 150 && b > 150 && g < 100 && (r + b - 2 * g > 80);
      const isBrightMagenta = r > 180 && b > 180 && g < 130;

      if (isMagenta || isBrightMagenta) {
        d[i + 3] = 0; // Alpha to 0
      }
    }

    // Clean outer cell borders (2px margin)
    const cw = 256;
    const ch = 256;
    for (let r = 0; r < 4; r++) {
      for (let cidx = 0; cidx < 4; cidx++) {
        const ox = cidx * cw;
        const oy = r * ch;
        for (let x = ox; x < ox + cw; x++) {
          for (let y = oy; y < oy + ch; y++) {
            if (x - ox < 2 || ox + cw - x <= 2 || y - oy < 2 || oy + ch - y <= 2) {
              const idx = (y * w + x) * 4;
              d[idx + 3] = 0;
            }
          }
        }
      }
    }

    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleaned = cleanSheet(masterImg);
  const destSource = join(GIANT_ASCII_DIR, "giant_ascii_human-S.png");
  writeFileSync(destSource, cleaned.toBuffer("image/png"));
  console.log(`Saved cleaned master source to ${destSource}`);

  // Copy to inbox for sprite forge pack
  const inboxPng = join(INBOX, "giant_ascii_human-S.png");
  writeFileSync(inboxPng, cleaned.toBuffer("image/png"));
  console.log(`Saved to inbox: ${inboxPng}`);

  // Also copy to public/sprites
  const publicPng = join(PUBLIC_SPRITES, "giant_ascii_human-S.png");
  writeFileSync(publicPng, cleaned.toBuffer("image/png"));
  console.log(`Saved to public sprites: ${publicPng}`);

  if (existsSync(DIST_SPRITES)) {
    const distPng = join(DIST_SPRITES, "giant_ascii_human-S.png");
    writeFileSync(distPng, cleaned.toBuffer("image/png"));
    console.log(`Saved to dist sprites: ${distPng}`);
  }

  // Calculate tight bounding boxes
  const cw = 256;
  const ch = 256;
  const clips = [
    { name: "idle", row: 0, count: 4 },
    { name: "walk", row: 1, count: 4 },
    { name: "attack", row: 2, count: 4 },
    { name: "death", row: 3, count: 4 },
  ];

  const rectsByRow = [];
  const rows = [];
  const ctx = cleaned.getContext("2d");

  for (const clip of clips) {
    const rowRects = [];
    for (let i = 0; i < clip.count; i++) {
      const sx = i * cw;
      const sy = clip.row * ch;
      const frameData = ctx.getImageData(sx, sy, cw, ch);
      const fd = frameData.data;

      let minX = cw;
      let minY = ch;
      let maxX = 0;
      let maxY = 0;
      let hasPixels = false;

      for (let py = 0; py < ch; py++) {
        for (let px = 0; px < cw; px++) {
          const a = fd[(py * cw + px) * 4 + 3];
          if (a > 20) {
            hasPixels = true;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }

      if (!hasPixels) {
        minX = 20; maxX = cw - 20;
        minY = 20; maxY = ch - 20;
      }

      const pad = 2;
      const rMinX = Math.max(0, sx + minX - pad);
      const rMinY = Math.max(0, sy + minY - pad);
      const rMaxX = Math.min(w, sx + maxX + pad);
      const rMaxY = Math.min(h, sy + maxY + pad);

      rowRects.push([rMinX, rMinY, rMaxX, rMaxY]);
    }
    rectsByRow.push(rowRects);
    rows.push({ clip: clip.name, cells: rowRects });
  }

  // Inbox sidecar
  const sidecar = {
    sheet: "giant_ascii_human-S",
    author: "LazyCat420 & Nano Banana",
    notes: "Giant ASCII Titan colossus composed of glowing green 0s and 1s with ground smash fists",
    grid: [4, 4],
    rows: ["idle", "walk", "attack", "death"],
    rects: rectsByRow,
  };

  const inboxJson = join(INBOX, "giant_ascii_human-S.json");
  writeFileSync(inboxJson, JSON.stringify(sidecar, null, 2));
  console.log(`Saved inbox sidecar to ${inboxJson}`);

  // Public manifest with sha256
  const pngBuf = readFileSync(publicPng);
  const sha = createHash("sha256").update(pngBuf).digest("hex").slice(0, 12);
  const publicManifest = {
    name: "giant_ascii_human",
    dir: "S",
    image: "/sprites/giant_ascii_human-S.png",
    source: [w, h],
    hash: sha,
    rows,
  };

  const publicJson = join(PUBLIC_SPRITES, "giant_ascii_human-S.json");
  writeFileSync(publicJson, JSON.stringify(publicManifest, null, 1));
  console.log(`Saved public manifest to ${publicJson}`);

  if (existsSync(DIST_SPRITES)) {
    const distJson = join(DIST_SPRITES, "giant_ascii_human-S.json");
    writeFileSync(distJson, JSON.stringify(publicManifest, null, 1));
    console.log(`Saved to dist json: ${distJson}`);
  }

  console.log("✅ Giant ASCII Titan sprite prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep giant ascii human sprite sheet:", err);
  process.exit(1);
});
