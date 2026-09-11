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

const MONSTERS = [
  {
    key: "pit_peeper",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/pit_peeper_sheet_1789114668121.jpg",
    dir: "pit_peeper-2026-09-11",
    desc: "The Pit Peeper weird armpit-eyeball monster with tube socks",
    palette: ["#ea580c", "#c2410c", "#9a3412", "#fdba74", "#ffffff", "#ef4444", "#1e3a8a", "#000000"],
  },
  {
    key: "dumpster_dan",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/dumpster_dan_sheet_1789114755743.jpg",
    dir: "dumpster_dan-2026-09-11",
    desc: "Dumpster Dan living green municipal trashbag gremlin with hotdog club",
    palette: ["#15803d", "#166534", "#14532d", "#86efac", "#dc2626", "#eab308", "#ffffff", "#000000"],
  },
  {
    key: "toaster_gremlin",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/toaster_gremlin_sheet_1789114773040.jpg",
    dir: "toaster_gremlin-2026-09-11",
    desc: "Toaster Gremlin spindly goblin with chrome toaster head and red heating coils",
    palette: ["#7e22ce", "#6b21a8", "#581c87", "#c084fc", "#94a3b8", "#cbd5e1", "#f97316", "#ef4444"],
  },
  {
    key: "lip_flapper",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/lip_flapper_sheet_v2_1789115033020.jpg",
    dir: "lip_flapper-2026-09-11",
    desc: "Lip Flapper striped accordion stalk with giant braced red wax cartoon lips",
    palette: ["#dc2626", "#b91c1c", "#991b1b", "#000000", "#ffffff", "#94a3b8", "#e2e8f0"],
  },
];

async function prepMonster(m) {
  console.log(`\n📦 Processing ${m.key}...`);
  const monsterDir = join(SOURCES, m.dir);
  const altDir = join(monsterDir, "alt-takes");
  const masterFilename = `${m.key}_master.jpg`;
  const masterSrc = join(altDir, masterFilename);

  mkdirSync(altDir, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(m.raw) && !existsSync(masterSrc)) {
    copyFileSync(m.raw, masterSrc);
    console.log(`Copied raw image to alt-takes: ${masterSrc}`);
  }

  const readme = join(altDir, "README.md");
  writeFileSync(
    readme,
    `# ${m.key} Sprite Sheet Archive\n\n- **Date**: 2026-09-11\n- **Description**: ${m.desc}\n- **Chroma**: #FF00FF\n- **Layout**: 4x4 (1024x1024, 256x256/cell)\n`
  );

  const srcPath = existsSync(masterSrc) ? masterSrc : m.raw;
  const masterImg = await loadImage(srcPath);
  const w = 1024;
  const h = 1024;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(masterImg, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Chroma key cleanup for #FF00FF magenta
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const px = (i / 4) % w;
    const py = Math.floor((i / 4) / w);

    const isMagenta = r > 175 && g < 95 && b > 175;
    const isGridLine =
      (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 75 && g < 75 && b < 75);
    const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;

    if (isMagenta || isGridLine || isOuterBorder) {
      d[i] = 255;
      d[i + 1] = 0;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const compData = ctx.getImageData(0, 0, w, h).data;
  const rows = ["idle", "walk", "attack", "death"];
  const manifestRows = [];

  for (let row = 0; row < 4; row++) {
    const rowCells = [];
    for (let col = 0; col < 4; col++) {
      const x0 = col * 256;
      const y0 = row * 256;
      let minX = 256,
        minY = 256,
        maxX = 0,
        maxY = 0;
      let found = false;

      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const idx = ((y0 + y) * w + (x0 + x)) * 4;
          const r = compData[idx];
          const g = compData[idx + 1];
          const b = compData[idx + 2];
          const a = compData[idx + 3];

          const isBg = r > 175 && g < 95 && b > 175;
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
        const globalX0 = x0 + Math.max(0, minX - 1);
        const globalY0 = y0 + Math.max(0, minY - 1);
        const globalX1 = x0 + Math.min(255, maxX + 1);
        const globalY1 = y0 + Math.min(255, maxY + 1);
        rowCells.push([globalX0, globalY0, globalX1, globalY1]);
      }
    }

    manifestRows.push({
      clip: rows[row],
      cells: rowCells,
    });
  }

  // Save source PNG
  const sourcePng = join(monsterDir, `${m.key}-S.png`);
  writeFileSync(sourcePng, canvas.toBuffer("image/png"));
  console.log(`Saved source PNG: ${sourcePng}`);

  // Save inbox PNG and JSON
  const inboxPng = join(INBOX, `${m.key}-S.png`);
  const inboxJson = join(INBOX, `${m.key}-S.json`);

  writeFileSync(inboxPng, canvas.toBuffer("image/png"));

  const manifest = {
    sheet: `${m.key}-S`,
    author: "LazyCat420 & Nano Banana",
    notes: m.desc,
    matte: { tolerance: 64, bg: [255, 0, 255] },
    grid: [4, 4],
    rows: ["idle", "walk", "attack", "death"],
    palette: m.palette,
    rects: manifestRows.map((r) => r.cells),
  };

  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Saved inbox files: ${inboxPng}, ${inboxJson}`);
}

async function run() {
  console.log("🎨 Prepping 4 Weird Monsters for Sprite-Forge...");
  for (const m of MONSTERS) {
    await prepMonster(m);
  }
  console.log("\n✨ All 4 monsters prepped into inbox successfully!");
}

run().catch((err) => {
  console.error("Prep failed:", err);
  process.exit(1);
});
