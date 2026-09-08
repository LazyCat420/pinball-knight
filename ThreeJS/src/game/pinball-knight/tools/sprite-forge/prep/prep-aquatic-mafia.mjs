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
    key: "shark_trapper",
    folder: "shark-trapper-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/shark_trapper_sheet_1788851038771.jpg",
    notes: "Shark Trapper in fisherman overalls with fishing rod that casts hook and reels knight in",
  },
  {
    key: "dolphin_brawler",
    folder: "dolphin-brawler-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/dolphin_brawler_sheet_1788851095502.jpg",
    notes: "Dolphin Brawler wearing blue denim jeans, sneakers, and sunglasses with 3-hit boxing combo and uppercut launch",
  },
  {
    key: "octopus_gunner",
    folder: "octopus-gunner-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/octopus_gunner_sheet_1788851167988.jpg",
    notes: "Octopus Mob Boss Don Tentacolo with fedora, pinstripe coat, 8-way radial revolver barrage, and ink smoke",
  },
  {
    key: "clownfish_mob",
    folder: "clownfish-mob-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/clownfish_mob_sheet_1788851197805.jpg",
    notes: "Clownfish Mobster with cigar, fedora, and rapid 4-round tommy-gun strafe burst",
  },
  {
    key: "lionfish_mob",
    folder: "lionfish-mob-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/lionfish_mob_sheet_1788851218260.jpg",
    notes: "Lionfish Mob Enforcer in waistcoat with 5-way venom spine spread shotgun and poison slow",
  },
  {
    key: "anglerfish_mob",
    folder: "anglerfish-mob-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/anglerfish_mob_sheet_1788851240456.jpg",
    notes: "Anglerfish Hitman in trenchcoat with glowing lure stun flashbang and piercing magnum snipe",
  },
  {
    key: "pufferfish_mob",
    folder: "pufferfish-mob-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/pufferfish_mob_sheet_1788851480864.jpg",
    notes: "Pufferfish Capo in tight mob suit with blunderbuss slugs and 360-degree death spike explosion",
  },
  {
    key: "swordfish_mob",
    folder: "swordfish-mob-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/swordfish_harpoon_sheet_1788851843119.jpg",
    notes: "Swordfish Mobster in sharp black suit wielding a two-handed harpoon speargun",
  },
  {
    key: "moray_mob",
    folder: "moray-mob-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/moray_mob_sheet_1788851562742.jpg",
    notes: "Moray Eel Mobster in zoot suit with electric shock orbs that leave hazard puddles",
  },
  {
    key: "seahorse_mob",
    folder: "seahorse-mob-2026-09-08",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/878e1b68-7679-4a65-bf9d-283c58c7185a/seahorse_mob_sheet_1788851952765.jpg",
    notes: "Seahorse Mobster in fedora and vest lobbing high-angle water mortar shells over obstacles",
  },
];

async function prepMonster(m) {
  console.log(`\n🌊 Processing ${m.key}...`);
  const srcDir = join(SOURCES, m.folder);
  const altDir = join(srcDir, "alt-takes");
  mkdirSync(altDir, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  const rawFilename = m.raw.split("/").pop();
  const masterSrc = join(altDir, rawFilename);
  if (existsSync(m.raw) && !existsSync(masterSrc)) {
    copyFileSync(m.raw, masterSrc);
    console.log(`  Copied raw image to: ${masterSrc}`);
  }

  const readme = join(altDir, "README.md");
  writeFileSync(
    readme,
    `# ${m.key} Sprite Sheet Archive\n\n- **Date**: 2026-09-08\n- **Subject**: ${m.notes}\n- **Source Take**: ${rawFilename}\n`,
  );

  const srcPath = existsSync(masterSrc) ? masterSrc : m.raw;
  const masterImg = await loadImage(srcPath);

  const w = 1024;
  const h = 1024;

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
      const px = (i / 4) % w;
      const py = Math.floor((i / 4) / w);

      // Chroma green check: strong green channel with low red and blue
      // Green background on these sheets is ~ #00FF00 (r<80, g>160, b<80)
      const isChromaGreen = (g > 150 && g > r * 1.35 && g > b * 1.35) ||
                            (g > 180 && (r + b) < 220);

      // Grid line artifact removal
      const isGridLine = (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 70 && g < 70 && b < 70);
      const isOuterBorder = px < 3 || px >= w - 3 || py < 3 || py >= h - 3;

      if (isChromaGreen || isGridLine || isOuterBorder) {
        d[i] = 0;
        d[i + 1] = 255;
        d[i + 2] = 0;
        d[i + 3] = 255;
      }
    }
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  const cleanedCanvas = cleanSheet(masterImg);

  const destSource = join(srcDir, `${m.key}-S.png`);
  writeFileSync(destSource, cleanedCanvas.toBuffer("image/png"));

  const inboxPng = join(INBOX, `${m.key}-S.png`);
  writeFileSync(inboxPng, cleanedCanvas.toBuffer("image/png"));

  const cellW = w / 4;
  const cellH = h / 4;
  const rows = ["idle", "walk", "attack", "death"];
  const rects = [];

  const cx = cleanedCanvas.getContext("2d");
  const imgData = cx.getImageData(0, 0, w, h);
  const d = imgData.data;

  function isBackground(px, py) {
    if (px < 0 || px >= w || py < 0 || py >= h) return true;
    const idx = (py * w + px) * 4;
    const r = d[idx];
    const g = d[idx + 1];
    const b = d[idx + 2];
    return g > 230 && r < 40 && b < 40;
  }

  for (let r = 0; r < 4; r++) {
    const rowRects = [];
    for (let c = 0; c < 4; c++) {
      const minCellX = Math.floor(c * cellW);
      const maxCellX = Math.floor((c + 1) * cellW);
      const minCellY = Math.floor(r * cellH);
      const maxCellY = Math.floor((r + 1) * cellH);

      let minX = maxCellX, maxX = minCellX;
      let minY = maxCellY, maxY = minCellY;
      let found = false;

      for (let y = minCellY; y < maxCellY; y++) {
        for (let x = minCellX; x < maxCellX; x++) {
          if (!isBackground(x, y)) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (found) {
        const padX1 = Math.max(minCellX, minX - 1);
        const padY1 = Math.max(minCellY, minY - 1);
        const padX2 = Math.min(maxCellX - 1, maxX + 1);
        const padY2 = Math.min(maxCellY - 1, maxY + 1);
        rowRects.push([padX1, padY1, padX2, padY2]);
      } else {
        rowRects.push([minCellX + 10, minCellY + 10, maxCellX - 10, maxCellY - 10]);
      }
    }
    rects.push(rowRects);
  }

  const manifest = {
    sheet: `${m.key}-S`,
    author: "LazyCat420 & Nano Banana",
    notes: m.notes,
    grid: [4, 4],
    rows: rows,
    rects: rects,
    matte: {
      bg: [0, 255, 0],
      tolerance: 64,
    },
  };

  const inboxJson = join(INBOX, `${m.key}-S.json`);
  writeFileSync(inboxJson, JSON.stringify(manifest, null, 2));
  console.log(`  Saved inbox assets: ${m.key}-S.png & ${m.key}-S.json`);
}

async function run() {
  console.log("🐟 Prepping 10 Aquatic & Mafia Monsters Sprite Sheets...");
  for (const m of MONSTERS) {
    await prepMonster(m);
  }
  console.log("\n✅ All 10 Aquatic & Mafia Monsters successfully prepped into inbox!");
}

run().catch((err) => {
  console.error("Failed to prep aquatic monster sheets:", err);
  process.exit(1);
});
