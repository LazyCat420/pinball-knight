import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = join(__dirname, "..");
const SOURCES = join(BASE, "sources");
const PUBLIC_SPRITES = join(BASE, "../../../../../public/sprites");

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/30396d1e-987f-44e2-8505-405d5820ae6b/chinese_fan_weapon_sheet_1788686193357.jpg";
const FAN_DIR = join(SOURCES, "chinese_fan-2026-09-06");
const ALT_DIR = join(FAN_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "chinese_fan_weapon_sheet_1788686193357.jpg");

async function run() {
  console.log("🪭 Preparing Chinese War Fan Boomerang Weapon Sprite Sheet...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(PUBLIC_SPRITES, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      `# Chinese War Fan Boomerang Weapon Animation Sprite Sheet Archive

- **Date**: 2026-09-06
- **Subject**: Chinese War Fan (\`chinese_fan\`) spinning boomerang weapon with emerald jade leaves, golden bamboo ribs, red tassel, and jade razor wind ribbons.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/chinese_fan-2026-09-06/chinese_fan.png\`
- **Layout**: 4 columns × 2 rows (8 frames of 360-degree rotation)
- **Chroma Background**: \`#FF00FF\` magenta
- **Takes Archive**:
  - \`alt-takes/chinese_fan_weapon_sheet_1788686193357.jpg\` (Master Take: 8 rotation frames on magenta)
`,
    );
  }

  const masterImg = await loadImage(existsSync(MASTER_SRC) ? MASTER_SRC : RAW_IMG);

  const w = 1024;
  const h = 1024;

  // Clean sheet and convert #FF00FF magenta into transparent alpha for weapon rendering
  const c = createCanvas(w, h);
  const cx = c.getContext("2d");
  cx.drawImage(masterImg, 0, 0, w, h);
  const imgData = cx.getImageData(0, 0, w, h);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const isMagenta = (r > 150 && b > 150 && g < 110) || (r > 120 && b > 120 && (r + b) > g * 2.1);
    if (isMagenta) {
      d[i + 3] = 0; // transparent
    }
  }
  cx.putImageData(imgData, 0, 0);

  // Save to sources
  const destSource = join(FAN_DIR, "chinese_fan.png");
  writeFileSync(destSource, c.toBuffer("image/png"));
  console.log(`Saved cleaned source to: ${destSource}`);

  // Save to public sprites directory
  const publicDest = join(PUBLIC_SPRITES, "chinese_fan.png");
  writeFileSync(publicDest, c.toBuffer("image/png"));
  console.log(`Saved public weapon sprite to: ${publicDest}`);

  // Also extract the single crisp centered hero fan frame for static texture use
  // Frame 0 is in the top-left cell (0, 0, 256, 512)
  const heroCanvas = createCanvas(256, 256);
  const heroCtx = heroCanvas.getContext("2d");
  heroCtx.drawImage(c, 0, 0, 256, 256, 0, 0, 256, 256);
  const heroDest = join(PUBLIC_SPRITES, "fan_hero.png");
  writeFileSync(heroDest, heroCanvas.toBuffer("image/png"));
  console.log(`Saved hero fan frame to: ${heroDest}`);

  console.log("✅ Chinese War Fan weapon sprite sheet prep complete!");
}

run().catch((err) => {
  console.error("Failed to prep chinese fan weapon sprite sheet:", err);
  process.exit(1);
});
