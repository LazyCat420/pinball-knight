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
    key: "ketchup",
    raw: join(SOURCES, "ketchup-2026-09-12/alt-takes/ketchup_master.jpg"),
    dir: "ketchup-2026-09-12",
    desc: "Ketchup Monster (Baron von Ketchup) living red squeeze bottle squirting thick sticky tomato paste and splattering on death",
    palette: [
      "#dc2626",
      "#b91c1c",
      "#991b1b",
      "#7f1d1d",
      "#450a0a",
      "#f87171",
      "#fca5a5",
      "#ffffff",
      "#f1f5f9",
      "#cbd5e1",
      "#94a3b8",
      "#fbbf24",
      "#f59e0b",
      "#1e293b",
      "#0f172a",
      "#000000",
    ],
  },
  {
    key: "mustard",
    raw: join(SOURCES, "mustard-2026-09-12/alt-takes/mustard_master.jpg"),
    dir: "mustard-2026-09-12",
    desc: "Mustard Monster (Colonel Dijon) living yellow squeeze bottle firing high-velocity spicy stadium mustard jets and leaving slip hazards",
    palette: [
      "#facc15",
      "#eab308",
      "#ca8a04",
      "#a16207",
      "#854d0e",
      "#713f12",
      "#fef08a",
      "#fef9c3",
      "#ffffff",
      "#f1f5f9",
      "#cbd5e1",
      "#94a3b8",
      "#fbbf24",
      "#f59e0b",
      "#1e293b",
      "#000000",
    ],
  },
];

async function prepMonster(cfg) {
  console.log(`\n🥫 Preparing ${cfg.key}...`);
  const monsterDir = join(SOURCES, cfg.dir);
  const altDir = join(monsterDir, "alt-takes");
  mkdirSync(altDir, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  const readme = join(altDir, "README.md");
  writeFileSync(
    readme,
    `# ${cfg.key} Sprite Sheet Archive\n\n- **Date**: 2026-09-12\n- **Description**: ${cfg.desc}\n- **Chroma**: #FF00FF\n- **Layout**: 4x4 (1024x1024, 256x256/cell)\n`
  );

  const masterImg = await loadImage(cfg.raw);
  const w = 1024;
  const h = 1024;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(masterImg, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Chroma key cleanup for #FF00FF magenta + erase text labels at py % 256 >= 232
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const px = (i / 4) % w;
    const py = Math.floor((i / 4) / w);

    const isMagenta = (r > 110 && b > 110 && g < 125) || (r > 90 && b > 90 && g < 75);
    const isGridLine =
      (px % 256 <= 2 || px % 256 >= 253 || py % 256 <= 2 || py % 256 >= 253) && (r < 90 && g < 90 && b < 90);
    const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;
    const isTextRow = py % 256 >= 232;

    if (isMagenta || isGridLine || isOuterBorder || isTextRow) {
      d[i] = 255;
      d[i + 1] = 0;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const compData = ctx.getImageData(0, 0, w, h).data;
  const rows = ["idle", "walk", "attack", "death"];
  const rects = [];

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

      for (let y = 0; y < 232; y++) {
        for (let x = 0; x < 256; x++) {
          const idx = ((y0 + y) * w + (x0 + x)) * 4;
          const r = compData[idx];
          const g = compData[idx + 1];
          const b = compData[idx + 2];
          const a = compData[idx + 3];

          const isBg = (r === 255 && g === 0 && b === 255) || (r > 110 && b > 110 && g < 125);
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
        const globalY1 = y0 + Math.min(231, maxY + 1);
        rowCells.push([globalX0, globalY0, globalX1, globalY1]);
      }
    }

    rects.push(rowCells);
  }

  // Save to sources/<dir>/<key>-S.png
  const sourcePng = join(monsterDir, `${cfg.key}-S.png`);
  writeFileSync(sourcePng, canvas.toBuffer("image/png"));
  console.log(`Saved master source sheet: ${sourcePng}`);

  // Save to inbox/<key>-S.png
  const inboxPng = join(INBOX, `${cfg.key}-S.png`);
  writeFileSync(inboxPng, canvas.toBuffer("image/png"));

  // Build inbox JSON sidecar
  const sidecar = {
    sheet: `${cfg.key}-S`,
    author: "LazyCat420 & Nano Banana",
    notes: cfg.desc,
    matte: {
      tolerance: 64,
      bg: [255, 0, 255],
    },
    grid: [4, 4],
    rows: rows,
    palette: cfg.palette,
    rects: rects,
  };

  const inboxJson = join(INBOX, `${cfg.key}-S.json`);
  writeFileSync(inboxJson, JSON.stringify(sidecar, null, 2) + "\n");
  console.log(`Prepared inbox assets:`);
  console.log(` - ${inboxPng}`);
  console.log(` - ${inboxJson}`);
}

async function main() {
  for (const m of MONSTERS) {
    await prepMonster(m);
  }
}

main().catch(console.error);
