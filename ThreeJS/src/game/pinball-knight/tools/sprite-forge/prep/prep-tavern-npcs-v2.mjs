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
    dateDir: "tavern_smith-2026-09-11",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/e9d59216-6eca-4313-a866-a558302582cb/tavern_smith_sheet_1789153188914.jpg",
    notes: "Tavern dwarf weaponsmith with heavy hammer, anvil sparks, water quench, and proud greeting",
  },
  {
    name: "tavern_alchemist",
    dateDir: "tavern_alchemist-2026-09-11",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/e9d59216-6eca-4313-a866-a558302582cb/tavern_alchem_sheet_1789153217541.jpg",
    notes: "Tavern goblin alchemist barmaid brewing bubbling potions and serving foaming mugs",
  },
  {
    name: "tavern_dealer",
    dateDir: "tavern_dealer-2026-09-11",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/e9d59216-6eca-4313-a866-a558302582cb/tavern_dealer_sheet_1789153233779.jpg",
    notes: "Tavern raccoon card dealer illusionist with top hat, waterfall card shuffle, and glowing cards",
  },
  {
    name: "tavern_armorer",
    dateDir: "tavern_armorer-2026-09-11",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/e9d59216-6eca-4313-a866-a558302582cb/tavern_armor_sheet_1789153248335.jpg",
    notes: "Tavern bulldog armorer in heavy plate armor with falling visor and mirrored shield",
  },
  {
    name: "tavern_gambler",
    dateDir: "tavern_gambler-2026-09-11",
    rawSrc: "/home/lazycat/.gemini/antigravity-ide/brain/e9d59216-6eca-4313-a866-a558302582cb/tavern_gambler_sheet_1789153285909.jpg",
    notes: "Tavern crow casino tout gambler flipping gold coins, throwing darts, and rolling dice",
  },
];

async function processCharacter(char) {
  console.log(`\n🎨 Processing ${char.name} (${char.notes})...`);

  const charDir = join(SOURCES, char.dateDir);
  const altDir = join(charDir, "alt-takes");
  mkdirSync(altDir, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  const rawFilename = `${char.name}_master.jpg`;
  const altTakePath = join(altDir, rawFilename);
  if (existsSync(char.rawSrc) && !existsSync(altTakePath)) {
    copyFileSync(char.rawSrc, altTakePath);
    console.log(`  Copied raw take to alt-takes: ${altTakePath}`);
  }

  const readmePath = join(altDir, "README.md");
  writeFileSync(
    readmePath,
    `# ${char.name} Sprite Sheet Archive\n\n- Date: 2026-09-11\n- Description: ${char.notes}\n- Primary Source: sources/${char.dateDir}/${char.name}-S.png\n- Master Take: ${rawFilename}\n- Chroma: #00FF00 green\n`
  );

  const img = await loadImage(existsSync(altTakePath) ? altTakePath : char.rawSrc);
  const w = 1024;
  const h = 1024;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Clean chroma key #00FF00 green
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const px = (i / 4) % w;
    const py = Math.floor((i / 4) / w);

    // Green chroma detection:
    // Pure green has high G, low R and low B
    const isChromaGreen = (g > 175 && r < 95 && b < 95) || (g > 215 && (r + b) < 180);
    const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 75 && g < 75 && b < 75);
    const isOuterBorder = px < 4 || px >= w - 4 || py < 4 || py >= h - 4;

    if (isChromaGreen || isGridLine || isOuterBorder) {
      d[i] = 0;
      d[i + 1] = 255;
      d[i + 2] = 0;
      d[i + 3] = 255; // Solid pure green for sprite-forge
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Save cleaned source to sources directory
  const destSource = join(charDir, `${char.name}-S.png`);
  writeFileSync(destSource, canvas.toBuffer("image/png"));
  console.log(`  Saved cleaned source: ${destSource}`);

  // Save cleaned source to inbox directory
  const inboxPng = join(INBOX, `${char.name}-S.png`);
  writeFileSync(inboxPng, canvas.toBuffer("image/png"));
  console.log(`  Saved inbox png: ${inboxPng}`);

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

          // Check if not chroma green
          const isGreen = g > 180 && r < 90 && b < 90;
          if (a > 20 && !isGreen) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (found) {
        const pad = 2;
        const x1 = Math.max(0, minX - pad) + x0;
        const y1 = Math.max(0, minY - pad) + y0;
        const x2 = Math.min(255, maxX + pad) + x0;
        const y2 = Math.min(255, maxY + pad) + y0;
        rowCells.push([x1, y1, x2, y2]);
      } else {
        rowCells.push([x0 + 10, y0 + 10, x0 + 246, y0 + 246]);
      }
    }
    cells.push(rowCells);
  }

  const manifest = {
    sheet: `${char.name}-S`,
    author: "LazyCat420 & Nano Banana",
    notes: char.notes,
    grid: [4, 4],
    rows: ["idle", "walk", "attack", "death"],
    rects: cells,
    scale: 1,
    matte: {
      tolerance: 48,
      bg: [0, 255, 0],
    },
  };

  const inboxJson = join(INBOX, `${char.name}-S.json`);
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`  Saved inbox json: ${inboxJson}`);
}

async function main() {
  console.log("=== PREPPING TAVERN NPCS V2 WITH GREEN CHROMA ===");
  for (const c of CHARACTERS) {
    await processCharacter(c);
  }
  console.log("\n✅ All 5 Tavern NPCs prepped for sprite-forge!");
}

main().catch((err) => {
  console.error("Failed to prep tavern npcs:", err);
  process.exit(1);
});
