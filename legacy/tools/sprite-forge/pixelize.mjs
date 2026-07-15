/**
 * sprite-forge — systematic IMAGE → PIXEL-ART SPRITE converter.
 *
 * The idea: you make/supply a source image however you like (draw it, render a
 * 3D model, generate it, photograph a doodle) and this turns it, deterministic-
 * ally, into a game-ready sprite in the dungeon's 32-colour "Cold Crypt"
 * palette — so it drops into the world already colour-matched and the in-game
 * quantizer never fights it.
 *
 * Pipeline per image:
 *   1. background → alpha    (edge flood-fill; robust to white/uniform bg)
 *   2. downscale to grid     (high-quality area resample to the target height)
 *   3. palette-map           (nearest of 32, luma-weighted; optional FS dither)
 *   4. selective outline      (1px ink silhouette — the SNES/GBA look)
 *   5. trim + return          (tight pixel canvas, feet-anchored by caller)
 *
 * This module is pure/among tooling — it never ships in the game bundle.
 * Run `node tools/sprite-forge/pixelize.mjs <in.png> <out.png> [--h=64] [...]`.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync } from "fs";

// ── Cold Crypt palette (mirror of render/palette.ts) ────────────
export const PALETTE_HEX = [
  0x0b0d12, 0x171a22, 0x2b303b, 0x454f5e, 0x6b7688, 0x9aa4b4, // stone/void
  0x1e2f1f, 0x3d5c3a, 0x5f8a4f, 0x8fc46b, // rot green
  0x3a0f18, 0x6b1f2a, 0xa83244, 0xd95763, // blood
  0x7a3b12, 0xd97b29, 0xf0a63c, 0xffd98a, 0xfff3c8, // torch
  0x4a5364, 0x8a94a6, 0xc8ccd4, 0xeef1f5, // steel
  0x6b4436, 0xa9705a, 0xd69f7e, // skin
  0x2a1c14, 0x4a3222, 0x6b4a2e, // leather/wood
  0x1f3d52, 0x2e6d8f, 0x6fd0e8, // arcane
];
const INK = 1; // outline colour index

const RGB = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
// Luma-weighted distance — matches the in-game quantizer's colour metric.
const W = [0.3, 0.59, 0.11];

function nearest(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < RGB.length; i++) {
    const dr = (r - RGB[i][0]) * W[0];
    const dg = (g - RGB[i][1]) * W[1];
    const db = (b - RGB[i][2]) * W[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Edge flood-fill background removal: anything reachable from a border pixel
 *  and within `tol` of that border's colour becomes transparent. Interior
 *  regions the same colour as the bg (a white shirt) are preserved. */
function removeBackground(data, w, h, tol) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const idx = (x, y) => y * w + x;
  const near = (i, r, g, b) => {
    const p = i * 4;
    const dr = data[p] - r;
    const dg = data[p + 1] - g;
    const db = data[p + 2] - b;
    return dr * dr + dg * dg + db * db <= tol * tol * 3 && data[p + 3] > 8;
  };
  // Seed from all four borders using each seed's own colour.
  const seeds = [];
  for (let x = 0; x < w; x++) { seeds.push(idx(x, 0)); seeds.push(idx(x, h - 1)); }
  for (let y = 0; y < h; y++) { seeds.push(idx(0, y)); seeds.push(idx(w - 1, y)); }
  for (const s of seeds) {
    if (seen[s]) continue;
    const p = s * 4;
    const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
    if (data[p + 3] <= 8) { seen[s] = 1; continue; }
    stack.push([s, r, g, b]);
    while (stack.length) {
      const [ci, cr, cg, cb] = stack.pop();
      if (seen[ci] || !near(ci, cr, cg, cb)) continue;
      seen[ci] = 1;
      data[ci * 4 + 3] = 0; // make transparent
      const x = ci % w, y = (ci / w) | 0;
      if (x > 0) stack.push([ci - 1, cr, cg, cb]);
      if (x < w - 1) stack.push([ci + 1, cr, cg, cb]);
      if (y > 0) stack.push([ci - w, cr, cg, cb]);
      if (y < h - 1) stack.push([ci + w, cr, cg, cb]);
    }
  }
}

/** Convert one loaded image to a pixel-art canvas. */
export function pixelize(img, opts = {}) {
  const {
    targetH = 64,
    bg = true,          // remove background via edge flood-fill
    bgTol = 26,         // colour tolerance for bg matching
    alphaThresh = 128,  // below this after downscale → transparent
    dither = false,     // Floyd–Steinberg into the palette
    outline = true,     // 1px ink silhouette
  } = opts;

  // ── source pixels ──
  const src = createCanvas(img.width, img.height);
  const sctx = src.getContext("2d");
  sctx.drawImage(img, 0, 0);
  const sdata = sctx.getImageData(0, 0, img.width, img.height);
  if (bg) removeBackground(sdata.data, img.width, img.height, bgTol);
  sctx.putImageData(sdata, 0, 0);

  // ── downscale to the pixel grid (area-ish resample, alpha preserved) ──
  const tw = Math.max(1, Math.round((img.width * targetH) / img.height));
  const th = targetH;
  const small = createCanvas(tw, th);
  const ctx = small.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, tw, th);
  ctx.drawImage(src, 0, 0, tw, th);
  const im = ctx.getImageData(0, 0, tw, th);
  const d = im.data;

  // ── palette map (+ optional dithering) ──
  const at = (x, y) => (y * tw + x) * 4;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const p = at(x, y);
      if (d[p + 3] < alphaThresh) { d[p + 3] = 0; continue; }
      const r = d[p], g = d[p + 1], b = d[p + 2];
      const ni = nearest(r, g, b);
      const [nr, ng, nb] = RGB[ni];
      d[p] = nr; d[p + 1] = ng; d[p + 2] = nb; d[p + 3] = 255;
      if (dither) {
        const er = r - nr, eg = g - ng, eb = b - nb;
        const spread = (dx, dy, f) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= tw || ny < 0 || ny >= th) return;
          const q = at(nx, ny);
          if (d[q + 3] < alphaThresh) return;
          d[q] += er * f; d[q + 1] += eg * f; d[q + 2] += eb * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
  }

  // ── selective 1px ink outline: transparent pixels touching the figure ──
  if (outline) {
    const [ir, ig, ib] = RGB[INK];
    const opaque = new Uint8Array(tw * th);
    for (let i = 0; i < tw * th; i++) opaque[i] = d[i * 4 + 3] > 0 ? 1 : 0;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        if (opaque[y * tw + x]) continue;
        const n =
          (x > 0 && opaque[y * tw + x - 1]) ||
          (x < tw - 1 && opaque[y * tw + x + 1]) ||
          (y > 0 && opaque[(y - 1) * tw + x]) ||
          (y < th - 1 && opaque[(y + 1) * tw + x]);
        if (n) {
          const p = at(x, y);
          d[p] = ir; d[p + 1] = ig; d[p + 2] = ib; d[p + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(im, 0, 0);
  return small;
}

/** Nearest-neighbour upscale, for eyeballing tiny sprites. */
export function upscale(canvas, factor) {
  const big = createCanvas(canvas.width * factor, canvas.height * factor);
  const b = big.getContext("2d");
  b.imageSmoothingEnabled = false;
  b.drawImage(canvas, 0, 0, big.width, big.height);
  return big;
}

// ── CLI ─────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [, , inPath, outPath, ...flags] = process.argv;
  if (!inPath || !outPath) {
    console.error("usage: pixelize.mjs <in.png> <out.png> [--h=64] [--no-outline] [--dither] [--no-bg] [--preview=6]");
    process.exit(1);
  }
  const opt = { targetH: 64, outline: true, dither: false, bg: true };
  let preview = 0;
  for (const f of flags) {
    if (f.startsWith("--h=")) opt.targetH = +f.slice(4);
    else if (f === "--no-outline") opt.outline = false;
    else if (f === "--dither") opt.dither = true;
    else if (f === "--no-bg") opt.bg = false;
    else if (f.startsWith("--preview=")) preview = +f.slice(10);
    else if (f.startsWith("--bgtol=")) opt.bgTol = +f.slice(8);
  }
  const img = await loadImage(inPath);
  const out = pixelize(img, opt);
  writeFileSync(outPath, out.toBuffer("image/png"));
  console.log(`✔ ${inPath} (${img.width}x${img.height}) → ${outPath} (${out.width}x${out.height})`);
  if (preview > 0) {
    const pv = outPath.replace(/\.png$/, `.x${preview}.png`);
    writeFileSync(pv, upscale(out, preview).toBuffer("image/png"));
    console.log(`  preview → ${pv}`);
  }
}
