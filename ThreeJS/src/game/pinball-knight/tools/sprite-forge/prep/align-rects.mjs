import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const INBOX = "/home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge/inbox";

function matteFlood(data, width, height, tol = 64) {
  const visited = new Uint8Array(width * height);
  const queue = [];

  // Seed with border pixels
  for (let x = 0; x < width; x++) {
    queue.push(x, 0);
    queue.push(x, height - 1);
    visited[x] = 1;
    visited[(height - 1) * width + x] = 1;
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push(0, y);
    queue.push(width - 1, y);
    visited[y * width] = 1;
    visited[y * width + (width - 1)] = 1;
  }

  // Get average background color from corners
  const corners = [0, (width - 1) * 4, (height - 1) * width * 4, ((height - 1) * width + width - 1) * 4];
  let bgR = 0, bgG = 0, bgB = 0;
  for (const c of corners) {
    bgR += data[c];
    bgG += data[c + 1];
    bgB += data[c + 2];
  }
  bgR = Math.round(bgR / 4);
  bgG = Math.round(bgG / 4);
  bgB = Math.round(bgB / 4);

  function isBg(idx) {
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const dr = (r - bgR) * 0.3;
    const dg = (g - bgG) * 0.59;
    const db = (b - bgB) * 0.11;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tol;
  }

  let head = 0;
  while (head < queue.length) {
    const qx = queue[head++];
    const qy = queue[head++];
    const qidx = (qy * width + qx) * 4;

    if (isBg(qidx)) {
      data[qidx + 3] = 0; // Transparent

      // Neighbors
      const neighbors = [
        [qx + 1, qy],
        [qx - 1, qy],
        [qx, qy + 1],
        [qx, qy - 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const npos = ny * width + nx;
          if (!visited[npos]) {
            visited[npos] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }
}

async function fixSidecar(name) {
  const jsonPath = join(INBOX, `${name}.json`);
  const pngPath = join(INBOX, `${name}.png`);
  if (!existsSync(jsonPath) || !existsSync(pngPath)) return;

  const side = JSON.parse(readFileSync(jsonPath, "utf8"));
  if (!side.rects) return;

  const img = await loadImage(pngPath);
  const w = img.width;
  const h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const tol = side.matte?.tolerance || 64;
  matteFlood(data, w, h, tol);

  const newRects = [];
  for (let r = 0; r < side.rects.length; r++) {
    const row = side.rects[r];
    const newRow = [];
    for (let c = 0; c < row.length; c++) {
      let [x0, y0, x1, y1] = row[c];
      let minX = w, maxX = 0, minY = h, maxY = 0;
      let found = false;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const idx = (y * w + x) * 4;
          if (data[idx + 3] >= 128) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (found) {
        newRow.push([minX, minY, maxX, maxY]);
      } else {
        newRow.push([x0, y0, x1, y1]);
      }
    }
    newRects.push(newRow);
  }

  side.rects = newRects;
  writeFileSync(jsonPath, JSON.stringify(side, null, 2));
  console.log(`Aligned exact ink bounds for ${name}`);
}

async function run() {
  const files = ["archivist-S", "magnet-S", "mimic-S", "webspinner-S", "dragon-S", "reaper-S", "broodmother-S", "overlord-S", "warden-S", "golem-S", "hound-S", "bat-S", "ghost-S", "goblin-S", "slime-S", "spider-S", "demon-S", "chomper-S", "crawler-S", "croaker-S", "crystalback-S", "necro-S", "pin-S", "sporeling-S"];
  for (const f of files) await fixSidecar(f);
}

run().catch(console.error);
