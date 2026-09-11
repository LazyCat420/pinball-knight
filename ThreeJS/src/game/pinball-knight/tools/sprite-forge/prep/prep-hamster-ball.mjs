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

const RAW_IMG = "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/hamster_ball_sheet_1789080713785.jpg";
const HAMSTER_DIR = join(SOURCES, "hamster-ball-2026-09-10");
const ALT_DIR = join(HAMSTER_DIR, "alt-takes");
const MASTER_SRC = join(ALT_DIR, "hamster_ball_sheet_1789080713785.jpg");

async function run() {
  console.log("🐹 Preparing Hamster in Exercise Ball Monster Sprite Sheet (Nano Banana + Sprite Forge)...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(RAW_IMG) && !existsSync(MASTER_SRC)) {
    copyFileSync(RAW_IMG, MASTER_SRC);
    console.log(`Copied raw take to alt-takes: ${MASTER_SRC}`);
  }

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# Hamster in Exercise Ball Monster Sprite Sheet Archive

- **Date**: 2026-09-10
- **Subject**: Hamster in Exercise Ball monster (\`hamster_ball\`), a cute chubby hamster sprinting inside a transparent plastic exercise sphere.
- **Mechanics**:
  - Normal player mode (\`p.momSpeed <= 0\`): damages the player on touch.
  - Pinball mode (\`p.momSpeed > 0\`): acts as a kinetic bumper deflector, knocking the pinball with high rebound velocity into unpredictable directions.
  - Death: sphere shatters into ricocheting plastic shards.
- **Primary Source**: \`src/game/pinball-knight/tools/sprite-forge/sources/hamster-ball-2026-09-10/hamster_ball-S.png\`
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\` (4 frames: hamster sniffing, scurrying feet inside the transparent plastic sphere, subtle plastic ball wobble/gleam)
  - Row 1 (4..7): \`walk\` (4 frames: running rapidly in ball, exercise ball rolling forward with rotating seams/highlights)
  - Row 2 (8..11): \`attack\` (4 frames: high-speed ram charge, spinning in place then blasting forward with kinetic energy)
  - Row 3 (12..15): \`death\` (4 frames: high impact collision, plastic cracks, sphere shatters into tumbling plastic shards, dizzy hamster)
- **Chroma Background**: \`#00FF00\` bright green
- **Takes Archive**:
  - \`alt-takes/hamster_ball_sheet_1789080713785.jpg\` (Master Take)
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
    const id = cx.getImageData(0, 0, w, h);
    const d = id.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];

      // Green screen removal: strong green compared to red and blue
      if (g > 115 && g > r * 1.25 && g > b * 1.25) {
        d[i + 3] = 0;
      } else if (g > 85 && g > r * 1.15 && g > b * 1.15) {
        const edgeAlpha = Math.max(0, 255 - Math.round(((g - Math.max(r, b)) / 50) * 255));
        d[i + 3] = Math.min(d[i + 3], edgeAlpha);
      }
    }

    cx.putImageData(id, 0, 0);

    // Wipe outer borders & grid lines
    cx.clearRect(0, 0, w, 4);
    cx.clearRect(0, h - 4, w, 4);
    cx.clearRect(0, 0, 4, h);
    cx.clearRect(w - 4, 0, 4, h);

    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);
  const cleanedBuffer = cleanedCanvas.toBuffer("image/png");

  const sourcesFinalPath = join(HAMSTER_DIR, "hamster_ball-S.png");
  writeFileSync(sourcesFinalPath, cleanedBuffer);
  console.log(`Saved master source sheet to ${sourcesFinalPath}`);

  // Pack into inbox for sprite-forge pipeline
  const inboxPng = join(INBOX, "hamster_ball-S.png");
  writeFileSync(inboxPng, cleanedBuffer);

  const cellW = 256;
  const cellH = 256;
  const cols = 4;
  const rows = 4;

  const frames = [];
  const anims = {
    idle: [0, 1, 2, 3],
    walk: [4, 5, 6, 7],
    attack: [8, 9, 10, 11],
    death: [12, 13, 14, 15],
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      frames.push({
        x: c * cellW,
        y: r * cellH,
        w: cellW,
        h: cellH,
      });
    }
  }

  const manifest = {
    meta: {
      image: "hamster_ball-S.png",
      size: { w, h },
      scale: "1",
      app: "sprite-forge",
      version: "1.0",
      facing: "S",
      kind: "hamster_ball",
    },
    frames,
    anims,
    clipFrameCounts: {
      idle: 4,
      walk: 4,
      attack: 4,
      death: 4,
    },
  };

  const inboxJson = join(INBOX, "hamster_ball-S.json");
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`Wrote inbox assets: ${inboxPng} and ${inboxJson}`);

  // Copy directly into public/sprites for immediate gameplay runtime
  const publicDir = join(__dirname, "../../../../../../public/sprites");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "hamster_ball-S.png"), cleanedBuffer);
  writeFileSync(join(publicDir, "hamster_ball-S.json"), JSON.stringify(manifest, null, 2));
  console.log(`Published directly to public/sprites/hamster_ball-S.*`);

  // Also copy to Windows build distribution assets
  const distDir = join(__dirname, "../../../../../../../dist/pinball-knight-windows-x86_64/assets/sprites");
  if (existsSync(distDir)) {
    writeFileSync(join(distDir, "hamster_ball-S.png"), cleanedBuffer);
    writeFileSync(join(distDir, "hamster_ball-S.json"), JSON.stringify(manifest, null, 2));
    console.log(`Published to Windows binary dist assets: ${distDir}/hamster_ball-S.*`);
  }

  console.log("✅ Hamster in Exercise Ball Monster Sprite Forge Preparation Complete!");
}

run().catch((err) => {
  console.error("Prep Hamster Ball error:", err);
  process.exit(1);
});
