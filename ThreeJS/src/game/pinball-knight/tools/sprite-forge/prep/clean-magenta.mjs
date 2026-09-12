import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const PUBLIC_SPRITES = join(process.cwd(), "public/sprites");
const INBOX = join(process.cwd(), "src/game/pinball-knight/tools/sprite-forge/inbox");

const MONSTER_KEYS = [
  "dumpster_dan",
  "pit_peeper",
  "corvid_bomber",
  "vulture_scavenger",
  "gull_bomber",
  "sky_falcon",
  "magma_slime",
  "toxic_slime",
  "frost_slime",
  "void_slime",
  "riot_cop",
  "highway_patrol",
  "detective_cop",
  "robo_cop",
  "hotdog",
];

async function cleanAllMagenta() {
  for (const key of MONSTER_KEYS) {
    for (const dir of [INBOX, PUBLIC_SPRITES]) {
      const pngPath = join(dir, `${key}-S.png`);
      const img = await loadImage(pngPath);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      const d = imgData.data;

      let cleaned = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const a = d[i + 3];
        // If magenta chroma, clear to transparent 0
        if (a > 10 && r > 220 && g < 35 && b > 220) {
          d[i] = 0;
          d[i + 1] = 0;
          d[i + 2] = 0;
          d[i + 3] = 0;
          cleaned++;
        }
      }
      if (cleaned > 0) {
        ctx.putImageData(imgData, 0, 0);
        writeFileSync(pngPath, canvas.toBuffer("image/png"));
        console.log(`Cleaned ${cleaned} magenta pixels in ${pngPath}`);
      }
    }
  }
}

cleanAllMagenta();
