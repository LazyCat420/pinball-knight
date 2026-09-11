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

const CHARACTERS = [
  {
    name: "tavern_smith",
    dateDir: "tavern_smith-2026-09-10",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/tavern_smith_sheet_1789105908344.jpg",
    notes: "Tavern dwarf weaponsmith with heavy hammer, bellows, and masterwork sword",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "tavern_alchemist",
    dateDir: "tavern_alchemist-2026-09-10",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/tavern_alchemist_sheet_1789105921738.jpg",
    notes: "Tavern goblin alchemist barmaid brewing bubbling potions and serving foaming mugs",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "tavern_dealer",
    dateDir: "tavern_dealer-2026-09-10",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/tavern_dealer_sheet_1789105958900.jpg",
    notes: "Tavern raccoon card dealer illusionist with waterfall card shuffle and glowing cards",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "tavern_armorer",
    dateDir: "tavern_armorer-2026-09-10",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/tavern_armorer_sheet_1789106008278.jpg",
    notes: "Tavern bulldog armorer in heavy plate armor with falling visor and mirrored shield",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "tavern_gambler",
    dateDir: "tavern_gambler-2026-09-10",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/tavern_gambler_sheet_1789106027724.jpg",
    notes: "Tavern crow casino tout gambler flipping gold coins, throwing darts, and rolling dice",
    rows: ["idle", "walk", "attack", "death"],
  },
  {
    name: "maze_merchant",
    dateDir: "maze_merchant-2026-09-10",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/20b39876-27c7-46c8-a982-0cf7dd782234/maze_merchant_sheet_1789106856765.jpg",
    notes: "Travelling peddler pushing a wheeled shop cart with brass bell, lanterns, and opening shop shutters",
    rows: ["idle", "walk", "attack", "death"],
  },
];

async function processCharacter(char) {
  console.log(`\n🎨 Processing ${char.name} (${char.notes})...`);

  const charDir = join(SOURCES, char.dateDir);
  const altDir = join(charDir, "alt-takes");
  mkdirSync(altDir, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  const rawFilename = char.rawSrc.split("/").pop();
  const altTakePath = join(altDir, rawFilename);
  if (existsSync(char.rawSrc) && !existsSync(altTakePath)) {
    copyFileSync(char.rawSrc, altTakePath);
    console.log(`  Copied raw take to alt-takes: ${altTakePath}`);
  }

  const readmePath = join(altDir, "README.md");
  writeFileSync(
    readmePath,
    `# ${char.name} Sprite Sheet Archive\n\n- Date: 2026-09-10\n- Description: ${char.notes}\n- Primary Source: sources/${char.dateDir}/${char.name}-S.png\n- Master Take: ${rawFilename}\n`
  );

  const img = await loadImage(existsSync(altTakePath) ? altTakePath : char.rawSrc);
  const w = 1024;
  const h = 1024;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  // Draw image
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Chroma key cleanup for #FF00FF
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const px = (i / 4) % w;
    const py = Math.floor((i / 4) / w);

    // Magenta chroma check
    const isMagenta = r > 175 && g < 90 && b > 175;
    // Edge artifacts or grid boundary noise
    const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 75 && g < 75 && b < 75);
    // Outer perimeter must always be clean magenta
    const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;

    if (isMagenta || isGridLine || isOuterBorder) {
      d[i] = 255;
      d[i + 1] = 0;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Compute ink-tight cell bounds per 256x256 tile
  const cells = [];
  const compData = ctx.getImageData(0, 0, w, h).data;

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

          const isBg = r > 175 && g < 90 && b > 175;
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
        rowCells.push([x0 + minX, y0 + minY, x0 + maxX, y0 + maxY]);
      } else {
        rowCells.push([x0, y0, x0 + 255, y0 + 255]);
      }
    }
    cells.push(rowCells);
  }

  const pngBuf = canvas.toBuffer("image/png");

  // Save to sources
  const srcPng = join(charDir, `${char.name}-S.png`);
  writeFileSync(srcPng, pngBuf);
  console.log(`  Saved source: ${srcPng}`);

  // Save to inbox PNG & JSON
  const inboxPng = join(INBOX, `${char.name}-S.png`);
  writeFileSync(inboxPng, pngBuf);

  const sidecar = {
    sheet: `${char.name}-S`,
    author: "LazyCat420 & Nano Banana",
    notes: char.notes,
    grid: [4, 4],
    rows: char.rows,
    rects: cells,
    scale: 1.0,
    matte: {
      tolerance: char.name === "tavern_alchemist" ? 64 : 48,
      bg: [255, 0, 255],
    },
  };

  const inboxJson = join(INBOX, `${char.name}-S.json`);
  writeFileSync(inboxJson, JSON.stringify(sidecar, null, 2));
  console.log(`  Saved inbox sidecar: ${inboxJson}`);
}

async function main() {
  for (const char of CHARACTERS) {
    await processCharacter(char);
  }
  console.log("\n✔ All 6 character sheets prepared successfully!");
}

main().catch((err) => {
  console.error("Prep error:", err);
  process.exit(1);
});
