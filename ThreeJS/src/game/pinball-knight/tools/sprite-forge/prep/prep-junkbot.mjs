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

const JUNK_DIR = join(SOURCES, "junkbot-2026-09-12");
const ALT_DIR = join(JUNK_DIR, "alt-takes");

const VARIANTS = [
  {
    key: "junkbot_tractor",
    label: "Tractorbot",
    rawPath: "/home/lazycat/.gemini/antigravity-ide/brain/002f1147-6824-4ea5-9836-4dcd801aa7ce/junkbot_tractor_sheet_1789194638529.jpg",
    notes: "Scavenger robot with retro CRT monitor body, heavy yellow excavator backhoe arm, diesel exhaust stack, and crawler tractor treads",
  },
  {
    key: "junkbot_cyber",
    label: "Cyberbot",
    rawPath: "/home/lazycat/.gemini/antigravity-ide/brain/002f1147-6824-4ea5-9836-4dcd801aa7ce/junkbot_cyber_sheet_1789194918524.jpg",
    notes: "Scavenger robot with retro computer chassis, articulated industrial robotic arms with laser welder / pincer claw, and titanium biped struts",
  },
  {
    key: "junkbot_motor",
    label: "Motorbot",
    rawPath: "/home/lazycat/.gemini/antigravity-ide/brain/002f1147-6824-4ea5-9836-4dcd801aa7ce/junkbot_motor_sheet_1789194931863.jpg",
    notes: "Scavenger robot with angry orange screen face, chrome car bumper battering ram, sparking spark plug club, and automotive suspension coil spring legs on rubber tires",
  },
  {
    key: "junkbot_crane",
    label: "Cranebot",
    rawPath: "/home/lazycat/.gemini/antigravity-ide/brain/002f1147-6824-4ea5-9836-4dcd801aa7ce/junkbot_crane_sheet_1789194947746.jpg",
    notes: "Scavenger robot with industrial hazard-striped terminal body, yellow cyclops eye, wrecking crane winch hook arm, spinning buzzsaw arm, and girder scaffolding tripod legs",
  },
  {
    key: "junkbot_appliance",
    label: "Appliancebot",
    rawPath: "/home/lazycat/.gemini/antigravity-ide/brain/002f1147-6824-4ea5-9836-4dcd801aa7ce/junkbot_appliance_sheet_1789194965359.jpg",
    notes: "Scavenger robot with green phosphor CRT face, ribbed vacuum cleaner suction hose arm, electric kitchen blender whisk arm, and office chair swivel caster legs",
  },
];

async function run() {
  console.log("🤖 Preparing 5 Scavenger Junkbot Variations (Nano Banana + Sprite Forge)...");

  mkdirSync(ALT_DIR, { recursive: true });
  mkdirSync(INBOX, { recursive: true });
  mkdirSync(PUBLIC_SPRITES, { recursive: true });

  const readme = join(ALT_DIR, "README.md");
  writeFileSync(
    readme,
    `# Scavenger Junkbot Monster Sprite Sheet Archive

- **Date**: 2026-09-12
- **Subject**: Junkbot monster (\`junkbot\`) with 5 scavenged part variations across the dungeon world.
- **Variations**:
  1. \`junkbot_tractor\`: Heavy hydraulic excavator bucket arm + diesel exhaust stack + crawler tractor tracks.
  2. \`junkbot_cyber\`: Multi-joint articulated industrial robot arms with laser welder & gripper + titanium biped struts.
  3. \`junkbot_motor\`: Chrome car bumper battering ram + spark-plug electrode fist + automotive suspension springs on rubber tires.
  4. \`junkbot_crane\`: Hazard-striped terminal with yellow cyclops eye + wrecking crane hook arm + spinning buzzsaw + scaffolding girder tripod legs.
  5. \`junkbot_appliance\`: Green phosphor face + ribbed vacuum cleaner hose + electric blender whisk + swivel office chair caster legs.
- **Layout**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell)
  - Row 0 (0..3): \`idle\`
  - Row 1 (4..7): \`walk\`
  - Row 2 (8..11): \`attack\`
  - Row 3 (12..15): \`death\`
- **Chroma Background**: \`#00FF00\` pure green
`,
  );
  console.log(`Saved README to ${readme}`);

  const w = 1024;
  const h = 1024;
  const cellW = 256;
  const cellH = 256;
  const clips = [
    { name: "idle", row: 0, count: 4 },
    { name: "walk", row: 1, count: 4 },
    { name: "attack", row: 2, count: 4 },
    { name: "death", row: 3, count: 4 },
  ];

  for (const v of VARIANTS) {
    console.log(`\n⚙️ Processing variant: ${v.label} (${v.key})...`);
    const masterSrc = join(ALT_DIR, `${v.key}_master.jpg`);
    if (existsSync(v.rawPath) && !existsSync(masterSrc)) {
      copyFileSync(v.rawPath, masterSrc);
      console.log(`Copied raw take to alt-takes: ${masterSrc}`);
    }

    const srcPath = existsSync(masterSrc) ? masterSrc : v.rawPath;
    const masterImg = await loadImage(srcPath);

    const c = createCanvas(w, h);
    const cx = c.getContext("2d");
    cx.drawImage(masterImg, 0, 0, w, h);
    const imgData = cx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Outer flood-fill / chroma-keying per 256x256 cell
    for (let r = 0; r < 4; r++) {
      for (let cidx = 0; cidx < 4; cidx++) {
        const ox = cidx * cellW;
        const oy = r * cellH;

        // BFS flood-fill from cell perimeter to remove background without punching inner greens
        const visited = new Uint8Array(cellW * cellH);
        const queue = [];

        function isBgColor(x, y) {
          const idx = ((oy + y) * w + (ox + x)) * 4;
          const red = d[idx];
          const green = d[idx + 1];
          const blue = d[idx + 2];
          // Chroma green test: high green, low red and blue
          return (green > 160 && red < 80 && blue < 80) || (green > 200 && (red + blue) < 160);
        }

        // Push border pixels
        for (let x = 0; x < cellW; x++) {
          queue.push([x, 0], [x, cellH - 1]);
        }
        for (let y = 0; y < cellH; y++) {
          queue.push([0, y], [cellW - 1, y]);
        }

        for (const [x, y] of queue) {
          const vIdx = y * cellW + x;
          if (!visited[vIdx]) {
            visited[vIdx] = 1;
          }
        }

        let head = 0;
        while (head < queue.length) {
          const [cx0, cy0] = queue[head++];
          if (!isBgColor(cx0, cy0)) {
            // Also clean edge grid line artifacts (2px border)
            if (cx0 <= 1 || cx0 >= cellW - 2 || cy0 <= 1 || cy0 >= cellH - 2) {
              const pIdx = ((oy + cy0) * w + (ox + cx0)) * 4;
              d[pIdx + 3] = 0;
            }
            continue;
          }

          const pIdx = ((oy + cy0) * w + (ox + cx0)) * 4;
          d[pIdx + 3] = 0; // set alpha to transparent

          const neighbors = [
            [cx0 + 1, cy0],
            [cx0 - 1, cy0],
            [cx0, cy0 + 1],
            [cx0, cy0 - 1],
          ];
          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < cellW && ny >= 0 && ny < cellH) {
              const nIdx = ny * cellW + nx;
              if (!visited[nIdx]) {
                visited[nIdx] = 1;
                if (isBgColor(nx, ny)) {
                  queue.push([nx, ny]);
                }
              }
            }
          }
        }

        // Secondary wipe for any isolated grid lines on cell seams
        for (let x = 0; x < cellW; x++) {
          for (let y = 0; y < cellH; y++) {
            if (x <= 1 || x >= cellW - 2 || y <= 1 || y >= cellH - 2) {
              const idx = ((oy + y) * w + (ox + x)) * 4;
              const red = d[idx];
              const green = d[idx + 1];
              const blue = d[idx + 2];
              if (red < 60 && green < 60 && blue < 60) {
                d[idx + 3] = 0;
              }
            }
          }
        }
      }
    }

    cx.putImageData(imgData, 0, 0);

    // Save cleaned source to sources directory
    const destSource = join(JUNK_DIR, `${v.key}-S.png`);
    writeFileSync(destSource, c.toBuffer("image/png"));
    console.log(`Saved cleaned source: ${destSource}`);

    // Save to inbox
    const inboxPng = join(INBOX, `${v.key}-S.png`);
    writeFileSync(inboxPng, c.toBuffer("image/png"));
    console.log(`Saved inbox image: ${inboxPng}`);

    // Save to public sprites
    const publicPng = join(PUBLIC_SPRITES, `${v.key}-S.png`);
    writeFileSync(publicPng, c.toBuffer("image/png"));
    console.log(`Saved public sprite: ${publicPng}`);

    // Calculate tight bounding rects
    const rectsByRow = [];
    const rows = [];
    const cleanedData = cx.getImageData(0, 0, w, h).data;

    for (const clip of clips) {
      const rowRects = [];
      for (let i = 0; i < clip.count; i++) {
        const sx = i * cellW;
        const sy = clip.row * cellH;

        let minX = cellW;
        let minY = cellH;
        let maxX = 0;
        let maxY = 0;
        let hasPixels = false;

        for (let py = 0; py < cellH; py++) {
          for (let px = 0; px < cellW; px++) {
            const a = cleanedData[((sy + py) * w + (sx + px)) * 4 + 3];
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
          minX = 20; maxX = cellW - 20;
          minY = 20; maxY = cellH - 20;
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
      sheet: `${v.key}-S`,
      author: "LazyCat420 & Nano Banana",
      notes: v.notes,
      grid: [4, 4],
      rows: ["idle", "walk", "attack", "death"],
      rects: rectsByRow,
    };
    const inboxJson = join(INBOX, `${v.key}-S.json`);
    writeFileSync(inboxJson, JSON.stringify(sidecar, null, 2));
    console.log(`Saved inbox sidecar: ${inboxJson}`);

    // Public manifest with sha256
    const pngBuf = readFileSync(publicPng);
    const sha = createHash("sha256").update(pngBuf).digest("hex").slice(0, 12);
    const publicManifest = {
      name: v.key,
      dir: "S",
      image: `/sprites/${v.key}-S.png`,
      source: [w, h],
      hash: sha,
      rows,
    };
    const publicJson = join(PUBLIC_SPRITES, `${v.key}-S.json`);
    writeFileSync(publicJson, JSON.stringify(publicManifest, null, 1));
    console.log(`Saved public manifest: ${publicJson}`);
  }

  // Also create base alias "junkbot-S" pointing to tractor variant as default
  console.log("\n📦 Creating base alias junkbot-S.{png,json}...");
  copyFileSync(join(PUBLIC_SPRITES, "junkbot_tractor-S.png"), join(PUBLIC_SPRITES, "junkbot-S.png"));
  copyFileSync(join(INBOX, "junkbot_tractor-S.png"), join(INBOX, "junkbot-S.png"));
  
  const baseManifestRaw = readFileSync(join(PUBLIC_SPRITES, "junkbot_tractor-S.json"), "utf8");
  const baseManifest = JSON.parse(baseManifestRaw);
  baseManifest.name = "junkbot";
  baseManifest.image = "/sprites/junkbot-S.png";
  writeFileSync(join(PUBLIC_SPRITES, "junkbot-S.json"), JSON.stringify(baseManifest, null, 1));

  const baseSidecarRaw = readFileSync(join(INBOX, "junkbot_tractor-S.json"), "utf8");
  const baseSidecar = JSON.parse(baseSidecarRaw);
  baseSidecar.sheet = "junkbot-S";
  writeFileSync(join(INBOX, "junkbot-S.json"), JSON.stringify(baseSidecar, null, 2));

  console.log("✅ All 5 Junkbot variations + base alias prepared successfully!");
}

run().catch((err) => {
  console.error("Failed to prep junkbot sprite sheets:", err);
  process.exit(1);
});
