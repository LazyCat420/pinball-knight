import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASE = join(__dirname, "..");
const INBOX = join(BASE, "inbox");
const SOURCES = join(BASE, "sources");

const NEW_MONSTERS = [
  {
    key: "corvid_bomber",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/corvid_bomber_sheet_1789212165274.jpg",
    dir: "corvid_bomber-2026-09-12",
    desc: "Corvid Bomber cunning dark raven dropping heavy timed iron fuse bombs",
    palette: ["#1e1b4b", "#312e81", "#4338ca", "#0f172a", "#1e293b", "#334155", "#64748b", "#f97316", "#ef4444", "#dc2626", "#ffffff", "#000000"],
  },
  {
    key: "vulture_scavenger",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/vulture_scavenger_sheet_1789212202182.jpg",
    dir: "vulture_scavenger-2026-09-12",
    desc: "Vulture Scavenger desert bone scavenger dropping jagged scrap metal shrapnel",
    palette: ["#451a03", "#78350f", "#92400e", "#b45309", "#dc2626", "#b91c1c", "#fef3c7", "#fde68a", "#d1d5db", "#4b5563", "#1f2937", "#000000"],
  },
  {
    key: "gull_bomber",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/gull_bomber_sheet_1789212221444.jpg",
    dir: "gull_bomber-2026-09-12",
    desc: "Gull Bomber aggressive seagull in navy sailor cap dropping explosive egg grenades",
    palette: ["#ffffff", "#f1f5f9", "#cbd5e1", "#94a3b8", "#64748b", "#1e3a8a", "#172554", "#ea580c", "#f97316", "#fef08a", "#000000"],
  },
  {
    key: "sky_falcon",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/sky_falcon_sheet_1789212246472.jpg",
    dir: "sky_falcon-2026-09-12",
    desc: "Sky Falcon predatory crimson peregrine dive-bomber dropping incendiary fire canisters",
    palette: ["#991b1b", "#b91c1c", "#dc2626", "#ef4444", "#fbbf24", "#d97706", "#92400e", "#fef08a", "#ffedd5", "#1f2937", "#000000"],
  },
  {
    key: "magma_slime",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/magma_slime_sheet_1789212264557.jpg",
    dir: "magma_slime-2026-09-12",
    desc: "Magma Slime bubbling volcanic lava gel with floating obsidian crust and fiery core",
    palette: ["#ffedd5", "#fed7aa", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#dc2626", "#1c1917", "#292524", "#44403c", "#78716c", "#000000"],
  },
  {
    key: "toxic_slime",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/toxic_slime_sheet_1789212281504.jpg",
    dir: "toxic_slime-2026-09-12",
    desc: "Toxic Slime bubbling hazardous radioactive green sludge with caustic acid spit",
    palette: ["#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#14532d", "#052e16", "#facc15", "#eab308", "#ffffff", "#000000"],
  },
  {
    key: "frost_slime",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/frost_slime_sheet_1789212296701.jpg",
    dir: "frost_slime-2026-09-12",
    desc: "Frost Slime shivering crystalline cyan glacial ice gel with freezing blizzard breath",
    palette: ["#ffffff", "#cffafe", "#a5f3fc", "#67e8f9", "#22d3ee", "#06b6d4", "#0891b2", "#0e7490", "#155e75", "#164e63", "#000000"],
  },
  {
    key: "void_slime",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/void_slime_sheet_1789212834682.jpg",
    dir: "void_slime-2026-09-12",
    desc: "Void Slime arcane dark-matter violet cosmic gel with floating gravity runes and event horizon",
    palette: ["#ffffff", "#f5d0fe", "#e879f9", "#c026d3", "#9333ea", "#7e22ce", "#581c87", "#3b0764", "#1e1b4b", "#0f172a", "#000000"],
  },
  {
    key: "riot_cop",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/riot_cop_sheet_1789212857041.jpg",
    dir: "riot_cop-2026-09-12",
    desc: "Riot Cop tactical SWAT enforcer with clear cyan riot shield and electric stun baton",
    palette: ["#0f172a", "#1e293b", "#334155", "#475569", "#64748b", "#38bdf8", "#0ea5e9", "#0284c7", "#bae6fd", "#f8fafc", "#000000"],
  },
  {
    key: "highway_patrol",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/highway_patrol_sheet_1789212957231.jpg",
    dir: "highway_patrol-2026-09-12",
    desc: "Highway Patrol state trooper with motorcycle helmet, sunglasses, tan uniform, and baton",
    palette: ["#ffffff", "#f8fafc", "#e2e8f0", "#94a3b8", "#d97706", "#b45309", "#92400e", "#78350f", "#1e293b", "#0f172a", "#1e3a8a", "#000000"],
  },
  {
    key: "detective_cop",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/detective_cop_sheet_1789212978194.jpg",
    dir: "detective_cop-2026-09-12",
    desc: "Detective Cop 1940s noir detective in grey trenchcoat and fedora with smoking revolver",
    palette: ["#f8fafc", "#e2e8f0", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#1e293b", "#0f172a", "#fbbf24", "#ef4444", "#000000"],
  },
  {
    key: "robo_cop",
    raw: "/home/lazycat/.gemini/antigravity-ide/brain/d60148b3-3da9-4505-ba58-c26b20148e50/robo_cop_sheet_1789213132883.jpg",
    dir: "robo_cop-2026-09-12",
    desc: "Robo Cop titanium cybernetic enforcer with glowing red visor and burst-fire auto pistol",
    palette: ["#ea580c", "#c2410c", "#9a3412", "#f97316", "#fed7aa", "#cbd5e1", "#94a3b8", "#64748b", "#334155", "#ef4444", "#dc2626", "#000000"],
  },
];

async function fixDumpsterDan() {
  console.log("\n🔧 Fixing dumpster_dan un-keyed magenta pixels...");
  const pngPath = join(INBOX, "dumpster_dan-S.png");
  const jsonPath = join(INBOX, "dumpster_dan-S.json");
  if (!existsSync(pngPath) || !existsSync(jsonPath)) {
    console.log("dumpster_dan files missing in inbox!");
    return;
  }

  const img = await loadImage(pngPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, img.width, img.height);
  const d = imgData.data;
  const w = img.width;
  const h = img.height;

  // Flood fill from seed [422, 564] to clear enclosed magenta pocket
  const seed = [422, 564];
  const q = [seed];
  const visited = new Uint8Array(w * h);
  let clearedCount = 0;

  function isMagenta(idx) {
    return d[idx] > 175 && d[idx + 1] < 95 && d[idx + 2] > 175;
  }

  const seedIdx = (seed[1] * w + seed[0]) * 4;
  if (isMagenta(seedIdx)) {
    visited[seed[1] * w + seed[0]] = 1;
    while (q.length > 0) {
      const [cx, cy] = q.pop();
      const cIdx = (cy * w + cx) * 4;
      // Set to transparent 0
      d[cIdx] = 0;
      d[cIdx + 1] = 0;
      d[cIdx + 2] = 0;
      d[cIdx + 3] = 0;
      clearedCount++;

      const neighbors = [
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy - 1],
        [cx, cy + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const nPos = ny * w + nx;
          if (!visited[nPos]) {
            visited[nPos] = 1;
            const nIdx = nPos * 4;
            if (isMagenta(nIdx)) {
              q.push([nx, ny]);
            }
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  writeFileSync(pngPath, canvas.toBuffer("image/png"));
  console.log(`Cleared ${clearedCount} enclosed magenta pixels in dumpster_dan-S.png`);

  const sidecar = JSON.parse(readFileSync(jsonPath, "utf8"));
  sidecar.matte = {
    tolerance: 64,
    bg: [255, 0, 255],
    keyEnclosed: [[422, 564]],
  };
  writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2) + "\n");
  console.log("Updated dumpster_dan-S.json with keyEnclosed: [[422, 564]]");
}

async function fixPitPeeper() {
  console.log("\n🔧 Fixing pit_peeper mouth pocket and palette quantization...");
  const pngPath = join(INBOX, "pit_peeper-S.png");
  const jsonPath = join(INBOX, "pit_peeper-S.json");
  if (!existsSync(pngPath) || !existsSync(jsonPath)) {
    console.log("pit_peeper files missing in inbox!");
    return;
  }

  const img = await loadImage(pngPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, img.width, img.height);
  const d = imgData.data;
  const w = img.width;
  const h = img.height;

  // Flood fill from seed [635, 850] to clear enclosed mouth magenta pocket
  const seed = [635, 850];
  const q = [seed];
  const visited = new Uint8Array(w * h);
  let clearedCount = 0;

  function isMagenta(idx) {
    return d[idx] > 175 && d[idx + 1] < 95 && d[idx + 2] > 175;
  }

  const seedIdx = (seed[1] * w + seed[0]) * 4;
  if (isMagenta(seedIdx)) {
    visited[seed[1] * w + seed[0]] = 1;
    while (q.length > 0) {
      const [cx, cy] = q.pop();
      const cIdx = (cy * w + cx) * 4;
      d[cIdx] = 0;
      d[cIdx + 1] = 0;
      d[cIdx + 2] = 0;
      d[cIdx + 3] = 0;
      clearedCount++;

      const neighbors = [
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy - 1],
        [cx, cy + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const nPos = ny * w + nx;
          if (!visited[nPos]) {
            visited[nPos] = 1;
            const nIdx = nPos * 4;
            if (isMagenta(nIdx)) {
              q.push([nx, ny]);
            }
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  writeFileSync(pngPath, canvas.toBuffer("image/png"));
  console.log(`Cleared ${clearedCount} enclosed magenta pixels in pit_peeper-S.png`);

  const sidecar = JSON.parse(readFileSync(jsonPath, "utf8"));
  sidecar.matte = {
    tolerance: 64,
    bg: [255, 0, 255],
    keyEnclosed: [[635, 850]],
  };
  // Add rich warm orange ramp so belly doesn't snap to pure white
  sidecar.palette = [
    "#ea580c",
    "#c2410c",
    "#9a3412",
    "#fdba74",
    "#f97316",
    "#fb923c",
    "#fef08a",
    "#ef4444",
    "#1e3a8a",
    "#ffffff",
    "#000000",
  ];
  writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2) + "\n");
  console.log("Updated pit_peeper-S.json with keyEnclosed and enriched orange palette");
}

async function prepMonster(m) {
  console.log(`\n📦 Processing ${m.key}...`);
  const monsterDir = join(SOURCES, m.dir);
  const altDir = join(monsterDir, "alt-takes");
  const masterFilename = `${m.key}_master.jpg`;
  const masterSrc = join(altDir, masterFilename);

  mkdirSync(altDir, { recursive: true });
  mkdirSync(INBOX, { recursive: true });

  if (existsSync(m.raw)) {
    copyFileSync(m.raw, masterSrc);
    console.log(`Copied raw image to alt-takes: ${masterSrc}`);
  }

  const readme = join(altDir, "README.md");
  writeFileSync(
    readme,
    `# ${m.key} Sprite Sheet Archive\n\n- **Date**: 2026-09-12\n- **Description**: ${m.desc}\n- **Chroma**: #FF00FF\n- **Layout**: 4x4 (1024x1024, 256x256/cell)\n`
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

    const isMagenta = r > 165 && g < 105 && b > 165;
    const isGridLine =
      (px % 256 <= 1 || px % 256 >= 254 || py % 256 <= 1 || py % 256 >= 254) && (r < 80 && g < 80 && b < 80);
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

          const isBg = r > 165 && g < 105 && b > 165;
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
  console.log("🎨 Step 1: Fixing Dumpster Dan & Pit Peeper...");
  await fixDumpsterDan();
  await fixPitPeeper();

  console.log("\n🎨 Step 2: Prepping 12 New Animated Monsters for Sprite-Forge...");
  for (const m of NEW_MONSTERS) {
    await prepMonster(m);
  }
  console.log("\n✨ All 14 monsters prepped into inbox successfully!");
}

run().catch((err) => {
  console.error("Prep failed:", err);
  process.exit(1);
});
