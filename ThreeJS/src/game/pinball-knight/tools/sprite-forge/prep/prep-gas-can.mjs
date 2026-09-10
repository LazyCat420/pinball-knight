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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/gas_can_sheet_1789080700162.jpg";
const GAS_CAN_DIR = join(SOURCES, "gas-can-2026-09-10");
const ALT_DIR = join(GAS_CAN_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "gas_can_sheet_1789080700162.jpg");

async function run() {
  console.log("⛽ Preparing 1950s Toon Gas Can Monster Sprite Sheet (Nano Banana + Sprite Forge)...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# 1950s Toon Gas Can Monster Sprite Sheet Archive

- **Date**: 2026-09-10
- **Subject**: 1950s Toon Gas Can monster (\`gas_can\`), vintage red gasoline canister with rubber hose limbs, white cartoon gloves, big smile, and pie-eyes. Paired with Zippo lighter monster. Spills oil slick on death.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/gas-can-2026-09-10/gas_can-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (4 frames: rubber-hose cartoon bounce, eye blink, cheery smile)
  - Row 1 (4..7): \`walk\` (4 frames: jaunty 50s cartoon stroll march)
  - Row 2 (8..11): \`attack\` (4 frames: leans forward, spouts flammable oil splash)
  - Row 3 (12..15): \`death\` (4 frames: knocked backward, falls over, lid pops and spills oil pool)
- **Chroma Background**: \`#00FF00\` bright green
- **Takes Archive**:
  - \`alt-takes/gas_can_sheet_1789080700162.jpg\` (Master Take)
`,
  );
  console.log(`Saved README to ${readme}`);

  const srcPath = existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG;
  const masterImg = await loadImage(srcPath);

  const w = 1024;
  const h = 1024;

  // Chroma key helper for #00FF00 green + border cleanup
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

      // Green screen detector
      const isGreen = g > 130 && r < 110 && b < 110 && (g - Math.max(r, b) > 40);
      const isBrightGreen = g > 180 && r < 140 && b < 140;

      if (isGreen || isBrightGreen) {
        d[i + 3] = 0; // Alpha to 0
      }
    }

    // Clean outer borders (avoid generator grid artifacts)
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
  const destSource = join(GAS_CAN_DIR, "gas_can-S.png");
  writeFileSync(destSource, cleaned.toBuffer("image/png"));
  console.log(`Saved cleaned master source to ${destSource}`);

  // Copy to inbox for sprite forge pack
  const inboxPng = join(INBOX, "gas_can-S.png");
  writeFileSync(inboxPng, cleaned.toBuffer("image/png"));
  console.log(`Saved to inbox: ${inboxPng}`);

  // Generate metadata JSON for sprite forge
  const cw = 256;
  const ch = 256;
  const clips = [
    { name: "idle", row: 0, count: 4 },
    { name: "walk", row: 1, count: 4 },
    { name: "attack", row: 2, count: 4 },
    { name: "death", row: 3, count: 4 },
  ];

  const rows = [];
  const ctx = cleaned.getContext("2d");

  for (const clip of clips) {
    const cells = [];
    for (let i = 0; i < clip.count; i++) {
      const sx = i * cw;
      const sy = clip.row * ch;
      const frameData = ctx.getImageData(sx, sy, cw, ch);
      const fd = frameData.data;

      // Find tight bounding box of non-transparent pixels
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

      // Add padding
      const pad = 3;
      const bx = Math.max(0, minX - pad);
      const by = Math.max(0, minY - pad);
      const bw = Math.min(cw, maxX + pad) - bx;
      const bh = Math.min(ch, maxY + pad) - by;

      cells.push([sx + bx, sy + by, bw, bh]);
    }
    rows.push({ clip: clip.name, cells });
  }

  const manifest = {
    name: "gas_can",
    dir: "S",
    image: "/sprites/gas_can-S.png",
    source: [w, h],
    hash: "gas_can_" + Date.now().toString(16),
    scale: 1.0,
    rows,
  };

  const inboxJson = join(INBOX, "gas_can-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Saved inbox manifest to ${inboxJson}`);
  console.log("✅ Gas Can Monster sprite prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep gas can sprite sheet:", err);
  process.exit(1);
});
