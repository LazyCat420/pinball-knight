#!/usr/bin/env node
// ─── trace — image (or hand-authored rows) → editable pixel-art cells ──
//
// A third pipeline alongside this game's PAINTERS (render/monsters/*.ts,
// procedural canvas code — see the "monsters are painters" project memory)
// and sprite-forge (whole PNG sheets: matte → slice → resample → register).
// Neither fits a one-off 32x32 or 32x64 icon: a painter is overkill for
// something with no animation, and sprite-forge's contract is a multi-row
// sheet with feet-anchored frames. This is for that gap, and for anything
// else where an editable text grid beats a baked PNG.
//
//   node tools/sprite-forge/pixel-trace/trace.mjs grids
//       every registered grid: dimensions and texel count.
//
//   node tools/sprite-forge/pixel-trace/trace.mjs trace sheet.png --grid square32
//       an image down to true pixels: alpha-aware box-average downsample to
//       the grid, quantised to a small palette (median-cut by default, or
//       --palette=coldcrypt to snap to this game's dungeon palette), written
//       as JSON — rows of characters you paste into code or edit by hand.
//
//   node tools/sprite-forge/pixel-trace/trace.mjs trace-set dir/ --grid tall32
//       a whole directory of PNGs, one file per pose, as one JSON module.
//
//   node tools/sprite-forge/pixel-trace/trace.mjs render cell.json --scale 12
//       press an authored cell (or every cell in a traced set) onto a
//       magnified PNG. LOOK at it — a grid can be arithmetically perfect
//       and print a shape with no face.
//
// ── Why JSON, not a hand-rolled .ts object literal ──────────────────────
// `resolveJsonModule` is already on in this project's tsconfig, so
// `import cell from "./foo.json"` typed as AuthoredCell (see
// authored-cell.ts) works with no codegen step. JSON also diffs and
// hand-edits cleanly — rows are just strings — with no formatter re-
// serialising them on every edit.
//
// ── `trace` is deliberately not clever ──────────────────────────────────
// Box-average down, then quantise to N colours. No edge detection, no
// hinting, no super-resolution. What comes out is a STARTING POINT a human
// or an agent then edits — the format is rows of characters precisely so
// that editing it is possible. A tracer that tried to be good enough to
// ship unedited would produce art nobody can fix.
//
// ── `render` needs no test harness ──────────────────────────────────────
// The authored cell is just characters and hex strings — pressing it onto
// a canvas needs nothing but `node-canvas`, already a devDependency here
// (sprite-forge/prep/pixelize.mjs uses it too). No vitest, no jsdom.
// ─────────────────────────────────────────────────────────────────────────

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GRIDS = {
  square16: { width: 16, height: 16 },
  square32: { width: 32, height: 32 },
  tall32: { width: 32, height: 64 },
  square64: { width: 64, height: 64 },
  tall64: { width: 64, height: 128 },
};

/**
 * Cold Crypt palette, copied from sprite-forge/prep/pixelize.mjs for
 * --palette=coldcrypt. Kept as a literal rather than an import so this tool
 * has no dependency on sprite-forge's module staying stable — the two
 * pipelines are deliberately independent.
 */
const COLD_CRYPT_HEX = [
  0x0b0d12, 0x171a22, 0x2b303b, 0x454f5e, 0x6b7688, 0x9aa4b4, // stone/void
  0x1e2f1f, 0x3d5c3a, 0x5f8a4f, 0x8fc46b, // rot green
  0x3a0f18, 0x6b1f2a, 0xa83244, 0xd95763, // blood
  0x7a3b12, 0xd97b29, 0xf0a63c, 0xffd98a, 0xfff3c8, // torch
  0x4a5364, 0x8a94a6, 0xc8ccd4, 0xeef1f5, // steel
  0x6b4436, 0xa9705a, 0xd69f7e, // skin
  0x2a1c14, 0x4a3222, 0x6b4a2e, // leather/wood
  0x1f3d52, 0x2e6d8f, 0x6fd0e8, // arcane
];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function usage(code = 0) {
  process.stdout.write(
    `trace — editable pixel-art cells\n\n` +
      `  grids                        every registered grid\n` +
      `  trace IMG [--grid ID]        an image down to true pixels\n` +
      `        [--colours N] [--alpha N] [--palette coldcrypt] [--out FILE]\n` +
      `        [--no-matte] [--matte-tol N] [--resample kcentroid|box] [--no-crop]\n` +
      `        [--no-despeckle] [--chroma #rrggbb|magenta] [--chroma-tol N]\n` +
      `        [--no-defringe] [--defringe #rrggbb] [--defringe-band N] [--defringe-range N]\n` +
      `  trace-set DIR [--grid ID]    a whole pose directory, as one file\n` +
      `        (same flags as trace)\n` +
      `  render CELL.json [--scale N] [--cell POSE] [--out FILE]\n` +
      `        [--backdrop checker|dark|none|#rrggbb]\n` +
      `        press an authored cell (or a whole traced set) to a PNG\n\n` +
      `The background is keyed out by default (generated art has no alpha).\n` +
      `Pass --no-matte only for art that already has a real alpha channel.\n\n`,
  );
  process.exitCode = code;
}

function envelope(result, warnings = []) {
  process.stdout.write(
    JSON.stringify({ ok: true, tool: "trace", warnings, result }, null, 2) +
      "\n",
  );
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function argOf(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return null;
  return args[at + 1] ?? null;
}

// ─── grids ──────────────────────────────────────────────────

function runGrids() {
  const rows = Object.entries(GRIDS).map(([id, g]) => ({
    id,
    canvas: `${g.width}x${g.height}`,
    texels: g.width * g.height,
  }));
  envelope({ grids: rows });
}

// ─── image decode (node-canvas — no bespoke PNG reader needed) ──────────

async function loadRgba(path) {
  const img = await loadImage(path);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  return { rgba: data, width: img.width, height: img.height };
}

/**
 * Opaque background → alpha, by flood fill from the border.
 *
 * ON BY DEFAULT, and that default is the whole point. Diffusion models have
 * no alpha channel, so essentially every generated reference image arrives on
 * an opaque white or cream field (sprite-forge's README says the same, and
 * `matte.ts` exists there for the same reason). Traced without this, the
 * background is not dropped — it is QUANTISED INTO THE ART, and the cell
 * comes out a solid rectangle. That failure is invisible in a preview drawn
 * on white: measured on `samples/fisherman.source.png`, the trace had 0 of
 * 1024 texels transparent and looked correct until it was pressed onto a dark
 * backdrop, where it read as a white block with a figure on it. Hence also
 * the checkerboard in `render`.
 *
 * Only pixels REACHABLE from the border are keyed, so an interior region the
 * same colour as the background (a white shirt) survives. Ported from
 * sprite-forge/prep/pixelize.mjs; it is a no-op on art that already has alpha,
 * because a fully-transparent border seed is skipped rather than spread.
 */
function matte(data, w, h, tol) {
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
  const seeds = [];
  for (let x = 0; x < w; x++) {
    seeds.push(idx(x, 0));
    seeds.push(idx(x, h - 1));
  }
  for (let y = 0; y < h; y++) {
    seeds.push(idx(0, y));
    seeds.push(idx(w - 1, y));
  }
  // The average colour of what was keyed — defringe needs to know what the
  // background WAS to recognise a pixel that is halfway to it.
  let kr = 0, kg = 0, kb = 0, kn = 0;
  for (const s of seeds) {
    if (seen[s]) continue;
    const p = s * 4;
    const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
    if (data[p + 3] <= 8) {
      seen[s] = 1;
      continue;
    }
    stack.push([s, r, g, b]);
    while (stack.length) {
      const [ci, cr, cg, cb] = stack.pop();
      if (seen[ci] || !near(ci, cr, cg, cb)) continue;
      seen[ci] = 1;
      kr += data[ci * 4]; kg += data[ci * 4 + 1]; kb += data[ci * 4 + 2]; kn++;
      data[ci * 4 + 3] = 0;
      const x = ci % w;
      const y = (ci / w) | 0;
      if (x > 0) stack.push([ci - 1, cr, cg, cb]);
      if (x < w - 1) stack.push([ci + 1, cr, cg, cb]);
      if (y > 0) stack.push([ci - w, cr, cg, cb]);
      if (y < h - 1) stack.push([ci + w, cr, cg, cb]);
    }
  }
  return kn ? [Math.round(kr / kn), Math.round(kg / kn), Math.round(kb / kn)] : null;
}

/**
 * DEFRINGE — turn the contamination ring back into the alpha it really is.
 *
 * The matte stops at the anti-aliased edge: a pixel that is half figure and
 * half background is nowhere near the background colour, so tolerance leaves
 * it opaque, and a 1-2px whitened ring survives around the whole silhouette.
 * Whether that ring is VISIBLE depends on the grid, which is why 32-grids
 * looked clean and 64-grids dirty: the ring is fixed-width in SOURCE pixels,
 * so at a ~6.5px texel footprint it is a minority k-centroid outvotes, and
 * at ~2-3px it wins whole texels and prints as a pale halo. Despeckle rightly
 * spares it — halo texels arrive in connected runs (allies) and far from the
 * figure's colours (the accent gate). The fix belongs HERE, in source space,
 * before any texel exists.
 *
 * A blend toward the background IS partial coverage, so recover it as alpha
 * (the compositing-industry defringe): for opaque pixels within `band` px of
 * transparency, alpha = clamp(dist(pixel, bg) / range). Mostly-background
 * ring pixels go transparent, half-blends go half-alpha, and the
 * premultiplied resampler already knows what partial alpha means. Band-
 * restricted so a genuinely white interior — a glove, a fish belly — is
 * never touched; only the silhouette ring is re-read.
 */
function defringe(img, bg, band, range) {
  const { rgba, width, height } = img;
  // pixels within `band` of transparency, by `band` dilations
  let edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 8) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (rgba[(ny * width + nx) * 4 + 3] > 8) edge[ny * width + nx] = 1;
      }
    }
  }
  for (let pass = 1; pass < band; pass++) {
    const grown = Uint8Array.from(edge);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!edge[y * width + x]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (rgba[(ny * width + nx) * 4 + 3] > 8) grown[ny * width + nx] = 1;
        }
      }
    }
    edge = grown;
  }
  let touched = 0;
  for (let i = 0; i < edge.length; i++) {
    if (!edge[i]) continue;
    const p = i * 4;
    const dr = rgba[p] - bg[0];
    const dg = rgba[p + 1] - bg[1];
    const db = rgba[p + 2] - bg[2];
    // Squared falloff: a half-blend keeps only a quarter of its alpha, so a
    // texel the ring covers entirely still fails the alpha floor instead of
    // scraping past it at ~50% and printing as a pale halo anyway.
    const a = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / range) ** 2;
    const scaled = Math.round(a * rgba[p + 3]);
    if (scaled < rgba[p + 3]) touched++;
    rgba[p + 3] = scaled;
  }
  return touched;
}

/**
 * Load, and unless `--no-matte`, key the background out first. Unless
 * `--no-crop`, then tight-crop to the content padded to the grid's aspect —
 * matte first is what makes the crop meaningful, since an unmatted image is
 * opaque to its corners and crops to nothing at all.
 */
/**
 * CHROMA KEY — for sheets deliberately generated on a chroma field.
 *
 * `--chroma "#ff00ff"` keys every pixel within `--chroma-tol` (default 60) of
 * that colour, ANYWHERE in the image — not just border-reachable ones. That
 * is the whole point of asking the generator for a chroma background: the
 * flood matte must leave an ENCLOSED background pocket opaque (a white glove
 * and a keyed hole are indistinguishable when the background is white), but
 * a chroma colour is chosen precisely because the art never contains it, so
 * a global key clears the pocket between a figure's legs safely.
 *
 * The tolerance is generous by default because a generator cannot be
 * prompted into flat colour — the field arrives dithered a few dozen units
 * wide. Distance is plain RGB: chroma separation is engineered to be huge,
 * and luma-weighting would only narrow the magenta channel it lives on.
 */
function chromaKey(data, key, tol) {
  const t2 = tol * tol * 3;
  let keyed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - key[0];
    const dg = data[i + 1] - key[1];
    const db = data[i + 2] - key[2];
    if (dr * dr + dg * dg + db * db <= t2) {
      data[i + 3] = 0;
      keyed++;
    }
  }
  return keyed;
}

function parseHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(s ?? "");
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
}

async function loadForTrace(path, args, grid) {
  let img = await loadRgba(path);
  const chroma = argOf(args, "--chroma");
  let bg = null;
  if (chroma) {
    const key = parseHex(chroma === "magenta" ? "#ff00ff" : chroma);
    if (!key) {
      process.stderr.write(`--chroma wants #rrggbb or "magenta", got "${chroma}"\n`);
      process.exit(2);
    }
    chromaKey(img.rgba, key, Number(argOf(args, "--chroma-tol") ?? 60));
    bg = key;
  } else if (!args.includes("--no-matte")) {
    bg = matte(img.rgba, img.width, img.height, Number(argOf(args, "--matte-tol") ?? 26));
  }
  // Defringe defaults ON only under --chroma, and that asymmetry is the
  // design: against magenta every art colour — including a silver fish — is
  // 200+ away, so a blend is unambiguous. Against white, PALE ART IS
  // INDISTINGUISHABLE FROM HALO by colour distance (measured: band 3 /
  // range 220 hollowed the fish body and shredded its sneakers), so on the
  // matte path it is strictly opt-in via `--defringe #rrggbb` (naming the
  // field the edges were blended against), for figures dark against their
  // field.
  const override = parseHex(argOf(args, "--defringe") ?? "");
  if (override) bg = override;
  const want = override || (chroma && !args.includes("--no-defringe"));
  if (want && bg) {
    defringe(
      img,
      bg,
      Number(argOf(args, "--defringe-band") ?? (chroma ? 3 : 2)),
      Number(argOf(args, "--defringe-range") ?? 160),
    );
  }
  if (!args.includes("--no-crop")) img = cropToAspect(img, grid);
  return img;
}

/** The `--resample` strategy, validated. */
function strategyOf(args) {
  const s = argOf(args, "--resample") ?? "kcentroid";
  if (s !== "kcentroid" && s !== "box") {
    process.stderr.write(`no resample strategy "${s}" — kcentroid or box\n`);
    process.exit(2);
  }
  return s;
}

/**
 * Tight-crop to the opaque content, padded out to the grid's aspect.
 *
 * ON BY DEFAULT (`--no-crop` restores whole-image mapping) because margin is
 * where the detail budget goes to die: the fisherman source is 640² but the
 * figure is ~380×500, so mapping the whole image onto 32×32 spends a third of
 * the texels on nothing. Cropping first hands those texels to the figure.
 *
 * The bbox is padded — never stretched — to the grid's aspect, centred, which
 * is exactly the remedy the ASPECT_STRETCH warning tells the user to apply by
 * hand. With crop on, the warning therefore cannot fire; with `--no-crop` the
 * whole-image mapping and its warning behave as before.
 */
function cropToAspect(img, grid) {
  const { rgba, width, height } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return img; // nothing opaque — leave it for the empty-cell error
  let cw = x1 - x0 + 1;
  let ch = y1 - y0 + 1;
  // pad the SHORT axis out to the grid's aspect, centred on the figure
  const target = grid.width / grid.height;
  if (cw / ch < target) cw = Math.ceil(ch * target);
  else ch = Math.ceil(cw / target);
  const ox = Math.max(0, Math.round(x0 - (cw - (x1 - x0 + 1)) / 2));
  const oy = Math.max(0, Math.round(y0 - (ch - (y1 - y0 + 1)) / 2));
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sx = ox + x;
      const sy = oy + y;
      if (sx >= width || sy >= height) continue; // off-canvas padding stays transparent
      const from = (sy * width + sx) * 4;
      const to = (y * cw + x) * 4;
      out[to] = rgba[from];
      out[to + 1] = rgba[from + 1];
      out[to + 2] = rgba[from + 2];
      out[to + 3] = rgba[from + 3];
    }
  }
  return { rgba: out, width: cw, height: ch };
}

/** k-means passes per texel — blocks are tiny, centroids settle in 2-3. */
const KMEANS_PASSES = 4;

/**
 * Dominant centroid of a 2-means split over one texel's covered pixels.
 * Ported verbatim from sprite-forge/resample.ts (its `kCentroid`): seeds are
 * the min- and max-luma pixels; null means the block cannot split and the box
 * average was already right.
 */
function kCentroid(px) {
  const n = px.length / 4;
  if (n < 2) return null;
  let lo = 0, hi = 0, loL = Infinity, hiL = -Infinity;
  for (let i = 0; i < n; i++) {
    const l = 0.3 * px[i * 4 + 1] + 0.59 * px[i * 4 + 2] + 0.11 * px[i * 4 + 3];
    if (l < loL) { loL = l; lo = i; }
    if (l > hiL) { hiL = l; hi = i; }
  }
  if (hiL - loL < 1) return null;
  let c0 = [px[lo * 4 + 1], px[lo * 4 + 2], px[lo * 4 + 3]];
  let c1 = [px[hi * 4 + 1], px[hi * 4 + 2], px[hi * 4 + 3]];
  let w0 = 0, w1 = 0;
  for (let pass = 0; pass < KMEANS_PASSES; pass++) {
    let a0 = 0, a1 = 0, r0 = 0, g0 = 0, b0 = 0, r1 = 0, g1 = 0, b1 = 0;
    for (let i = 0; i < n; i++) {
      const w = px[i * 4], r = px[i * 4 + 1], g = px[i * 4 + 2], b = px[i * 4 + 3];
      const d0 = (r - c0[0]) ** 2 + (g - c0[1]) ** 2 + (b - c0[2]) ** 2;
      const d1 = (r - c1[0]) ** 2 + (g - c1[1]) ** 2 + (b - c1[2]) ** 2;
      if (d0 <= d1) { a0 += w; r0 += r * w; g0 += g * w; b0 += b * w; }
      else { a1 += w; r1 += r * w; g1 += g * w; b1 += b * w; }
    }
    if (a0 <= 0 || a1 <= 0) return null; // degenerate split — box was right
    c0 = [r0 / a0, g0 / a0, b0 / a0];
    c1 = [r1 / a1, g1 / a1, b1 / a1];
    w0 = a0;
    w1 = a1;
  }
  const c = w0 >= w1 ? c0 : c1;
  return [c[0], c[1], c[2]];
}

/**
 * Resample an RGBA image down to `width` x `height`.
 *
 * Two strategies, both ported from sprite-forge/resample.ts, which measured
 * this exact decision (its header has the full argument):
 *
 *   kcentroid  DEFAULT. Per texel, 2-means-split the covered source pixels
 *              and take the dominant cluster's centroid — the AI-art
 *              community's standard downscaler (Astropulse's pixeldetector
 *              lineage). A noisy red-and-cream texel picks its red side
 *              instead of averaging to mauve, so edges arrive at the palette
 *              snap still being edges. This is where the detail comes from.
 *
 *   box        Premultiplied exact-coverage area average. Correct, never
 *              invents — and averages soft gradients into in-between colours
 *              the quantiser then has to guess at. Kept as the A/B arm.
 *
 * Alpha is always the premultiplied box average regardless of strategy; only
 * the COLOUR of a texel is strategy-dependent.
 */
function resampleDown(src, srcW, srcH, width, height, strategy = "kcentroid") {
  const out = new Uint8ClampedArray(width * height * 4);
  const kx = srcW / width;
  const ky = srcH / height;
  const px = []; // flat [w, r, g, b] runs for the k-means strategy
  for (let oy = 0; oy < height; oy++) {
    const ay = oy * ky;
    const by = ay + ky;
    for (let ox = 0; ox < width; ox++) {
      const ax = ox * kx;
      const bx = ax + kx;
      let sumW = 0, sumA = 0, sumR = 0, sumG = 0, sumB = 0;
      px.length = 0;
      for (let y = Math.floor(ay); y < Math.ceil(by); y++) {
        const wy = Math.min(by, y + 1) - Math.max(ay, y);
        for (let x = Math.floor(ax); x < Math.ceil(bx); x++) {
          const wx = Math.min(bx, x + 1) - Math.max(ax, x);
          const w = wx * wy;
          const i = (y * srcW + x) * 4;
          const a = src[i + 3] / 255;
          const aw = a * w;
          sumW += w;
          sumA += aw;
          if (aw <= 0) continue;
          const r = src[i], g = src[i + 1], b = src[i + 2];
          sumR += r * aw;
          sumG += g * aw;
          sumB += b * aw;
          if (strategy === "kcentroid") px.push(aw, r, g, b);
        }
      }
      const j = (oy * width + ox) * 4;
      out[j + 3] = Math.round((sumA / (sumW || 1)) * 255);
      if (sumA <= 0) continue;
      let r = sumR / sumA, g = sumG / sumA, b = sumB / sumA;
      if (strategy === "kcentroid") {
        const c = kCentroid(px);
        if (c) { r = c[0]; g = c[1]; b = c[2]; }
      }
      out[j] = Math.round(r);
      out[j + 1] = Math.round(g);
      out[j + 2] = Math.round(b);
    }
  }
  return out;
}

// ─── quantisation ───────────────────────────────────────────

/**
 * Median cut to `want` colours.
 *
 * Splits along whichever channel the current box is widest in, so a sprite
 * that is mostly one hue still spends its palette on the distinctions that
 * hue makes rather than on an even spread of the whole cube.
 */
function medianCut(pixels, want) {
  const boxes = [pixels];
  while (boxes.length < want) {
    boxes.sort((a, b) => spread(b) - spread(a));
    const widest = boxes.shift();
    if (!widest || widest.length < 2 || spread(widest) === 0) {
      if (widest) boxes.push(widest);
      break;
    }
    const channel = widestChannel(widest);
    const sorted = [...widest].sort((a, b) => a[channel] - b[channel]);
    const half = Math.floor(sorted.length / 2);
    boxes.push(sorted.slice(0, half), sorted.slice(half));
  }
  return boxes.filter((box) => box.length).map(average);
}

function widestChannel(box) {
  let best = 0;
  let bestRange = -1;
  for (let channel = 0; channel < 3; channel++) {
    let low = 255;
    let high = 0;
    for (const pixel of box) {
      if (pixel[channel] < low) low = pixel[channel];
      if (pixel[channel] > high) high = pixel[channel];
    }
    if (high - low > bestRange) {
      bestRange = high - low;
      best = channel;
    }
  }
  return best;
}

function spread(box) {
  if (!box.length) return 0;
  let worst = 0;
  for (let channel = 0; channel < 3; channel++) {
    let low = 255;
    let high = 0;
    for (const pixel of box) {
      if (pixel[channel] < low) low = pixel[channel];
      if (pixel[channel] > high) high = pixel[channel];
    }
    worst = Math.max(worst, high - low);
  }
  return worst;
}

function average(box) {
  const sum = [0, 0, 0];
  for (const pixel of box) {
    sum[0] += pixel[0];
    sum[1] += pixel[1];
    sum[2] += pixel[2];
  }
  return sum.map((total) => Math.round(total / box.length));
}

function hex([r, g, b]) {
  return (
    "#" + [r, g, b].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

/**
 * The palette a trace quantises to, and the distance it's chosen by.
 *
 * `--palette coldcrypt` snaps to this game's real 32-colour palette with the
 * same luma-weighted metric the in-game quantizer uses (matches
 * sprite-forge/prep/pixelize.mjs), so traced art that goes through it needs no
 * second quantisation pass later. The default is freeform median-cut — this
 * tool is deliberately not tied to one palette.
 */
function paletteFor(opaque, args) {
  if ((argOf(args, "--palette") ?? "auto") === "coldcrypt") {
    const palette = COLD_CRYPT_HEX.map((h) => [
      (h >> 16) & 255,
      (h >> 8) & 255,
      h & 255,
    ]);
    const W = [0.3, 0.59, 0.11];
    const dist = (p, r, g, b) => {
      const dr = (p[0] - r) * W[0];
      const dg = (p[1] - g) * W[1];
      const db = (p[2] - b) * W[2];
      return dr * dr + dg * dg + db * db;
    };
    return { palette, dist };
  }
  const colours = Number(argOf(args, "--colours") ?? 12);
  const palette = medianCut(opaque, colours);
  const dist = (p, r, g, b) => (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
  return { palette, dist };
}

/**
 * Warn when the source's aspect and the grid's aspect disagree.
 *
 * `boxDown` maps the whole source onto the whole grid, so a 1:1 image traced
 * to `tall32` (1:2) comes out stretched 2x vertically — silently, and the
 * result still looks like deliberate art, just a lankier character. Measured
 * on the fisherman: a 640x640 source on tall32 elongated the figure with an
 * empty `warnings` array to report it.
 *
 * The tool this was adapted from carried the same warning in world-space
 * terms (its grids owned a quad size, and it compared quad aspect against the
 * aspect its sprites were drawn for). These grids own no world geometry, so
 * the comparison that survives the port is the plain one: pixels in vs texels
 * out. CROP OR PAD the source to the grid's aspect if you did not mean it.
 */
function aspectWarning(width, height, grid, gridId) {
  const source = width / height;
  const target = grid.width / grid.height;
  const stretch = target / source;
  if (Math.abs(stretch - 1) < 0.02) return [];
  const axis = stretch > 1 ? "squashed horizontally" : "stretched vertically";
  return [
    {
      code: "ASPECT_STRETCH",
      message:
        `source is ${width}x${height} (${source.toFixed(3)}:1) but grid "${gridId}" is ` +
        `${grid.width}x${grid.height} (${target.toFixed(3)}:1) — the trace is ${axis} by ` +
        `${(stretch > 1 ? stretch : 1 / stretch).toFixed(2)}x. Crop or pad the source to the ` +
        `grid's aspect, or pick a grid that matches.`,
    },
  ];
}

/**
 * DESPECKLE — the noise pass, run on the quantised grid. On by default;
 * `--no-despeckle` skips it.
 *
 * Measured on the traced stiltneck (64-grid): 653 of 3422 opaque texels had a
 * colour shared by no neighbour, and they cluster on the silhouette and on
 * region boundaries — the source's anti-aliased blend pixels each landing on
 * a different palette entry. That fringe is what reads as "AI noise". The
 * community tools for this exact job (unfake.js "morphological cleanup",
 * Pixel Snapper's plurality-per-cell) all converge on neighbourhood
 * consensus, so:
 *
 *   1. TINY-ISLAND REMOVAL — opaque components of ≤2 texels detached from
 *      everything else become transparent. Unambiguous debris.
 *   2. NEAR-DUPLICATE SNAP — a texel whose colour is shared by NO neighbour
 *      adopts its chromatically nearest neighbouring colour, provided that
 *      colour is CLOSE (luma-weighted). Not a plurality/mode filter, on
 *      measurement: fringe sits on silhouettes and region boundaries where
 *      the neighbourhood is mixed, so a plurality rule caught 17 of 653
 *      fringe texels (fixed 5-of-8) and ~40 (share-scaled) — boundaries
 *      have no majority to defer to. The property that actually identifies
 *      quantisation fringe is having a NEAR-DUPLICATE next door: mauve
 *      beside brown is the quantiser guessing twice at one edge. The
 *      distance gate alone is the accent protection — a white eye-glint on
 *      black has no near neighbour and survives. A texel with even one
 *      same-colour neighbour is a pattern, not a speck, and is never
 *      touched — that protects outlines, 1-texel rods and dither.
 *
 * One pass, not iterated: iterating a consensus filter erodes dither and
 * outline patterns that are art. What one pass leaves is for the hand-edit
 * the format exists for.
 */
const DESPECKLE_NEAR = 60 * 60; // luma-weighted distance² gate
const ISLAND_MAX = 2; // components this size or smaller are debris

function despeckle(rows, ink) {
  const H = rows.length;
  const W = rows[0].length;
  const g = rows.map((r) => r.split(""));
  const rgb = {};
  for (const [ch, hexCol] of Object.entries(ink)) {
    rgb[ch] = [
      parseInt(hexCol.slice(1, 3), 16),
      parseInt(hexCol.slice(3, 5), 16),
      parseInt(hexCol.slice(5, 7), 16),
    ];
  }
  const wdist = (a, b) => {
    const dr = (a[0] - b[0]) * 0.3;
    const dg = (a[1] - b[1]) * 0.59;
    const db = (a[2] - b[2]) * 0.11;
    return dr * dr + dg * dg + db * db;
  };

  // 1. tiny islands
  let dropped = 0;
  const seen = Array.from({ length: H }, () => new Uint8Array(W));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] === "." || seen[y][x]) continue;
      const comp = [];
      const stack = [[x, y]];
      seen[y][x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (seen[ny][nx] || g[ny][nx] === ".") continue;
          seen[ny][nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (comp.length <= ISLAND_MAX) {
        for (const [cx, cy] of comp) g[cy][cx] = ".";
        dropped += comp.length;
      }
    }
  }

  // 2. distance-gated mode filter — decisions from a snapshot, applied after,
  // so a replacement cannot cascade into its neighbour's vote this pass
  const snap = g.map((r) => [...r]);
  let changed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = snap[y][x];
      if (ch === ".") continue;
      let hasAlly = false;
      let best = null;
      let bestD = Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = snap[ny][nx];
        if (nc === ".") continue;
        if (nc === ch) { hasAlly = true; break; }
        const d = wdist(rgb[ch], rgb[nc]);
        if (d < bestD) { bestD = d; best = nc; }
      }
      if (hasAlly || !best) continue; // an ally makes it a pattern, not a speck
      if (bestD > DESPECKLE_NEAR) continue; // far from everything = deliberate accent
      g[y][x] = best;
      changed++;
    }
  }
  return { rows: g.map((r) => r.join("")), dropped, changed };
}

function nearestIn(palette, dist, r, g, b) {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < palette.length; index++) {
    const distance = dist(palette[index], r, g, b);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

// ─── trace ──────────────────────────────────────────────────

function idFromFile(file) {
  return file
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-");
}

async function runTrace(args) {
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) {
    process.stderr.write("trace: needs an image\n");
    process.exitCode = 2;
    return;
  }
  const gridId = argOf(args, "--grid") ?? "square32";
  const grid = GRIDS[gridId];
  if (!grid) {
    process.stderr.write(
      `trace: no grid "${gridId}" — try ${Object.keys(GRIDS).join(", ")}\n`,
    );
    process.exitCode = 2;
    return;
  }
  // Below this the source pixel is treated as absent, not dark.
  const alphaFloor = Number(argOf(args, "--alpha") ?? 128);

  const { rgba, width, height } = await loadForTrace(resolve(file), args, grid);
  const small = resampleDown(rgba, width, height, grid.width, grid.height, strategyOf(args));

  const opaque = [];
  for (let at = 0; at < small.length; at += 4) {
    if (small[at + 3] >= alphaFloor) {
      opaque.push([small[at], small[at + 1], small[at + 2]]);
    }
  }
  if (!opaque.length) {
    process.stderr.write(
      `trace: nothing above alpha ${alphaFloor} — is the image transparent, or is --alpha too high?\n`,
    );
    process.exitCode = 1;
    return;
  }
  const { palette, dist } = paletteFor(opaque, args);

  const ink = {};
  const rows = [];
  for (let y = 0; y < grid.height; y++) {
    let line = "";
    for (let x = 0; x < grid.width; x++) {
      const at = (y * grid.width + x) * 4;
      if (small[at + 3] < alphaFloor) {
        line += ".";
        continue;
      }
      const index = nearestIn(palette, dist, small[at], small[at + 1], small[at + 2]);
      const char = ALPHABET[index];
      if (!char) {
        process.stderr.write(
          `trace: ${palette.length} colours needs a longer alphabet — lower --colours\n`,
        );
        process.exitCode = 1;
        return;
      }
      ink[char] = hex(palette[index]);
      line += char;
    }
    rows.push(line);
  }

  let finalRows = rows;
  let cleaned = { dropped: 0, changed: 0 };
  if (!args.includes("--no-despeckle")) {
    const d = despeckle(rows, ink);
    finalRows = d.rows;
    cleaned = d;
  }

  const id = idFromFile(file);
  const cell = { id, grid: gridId, ink, rows: finalRows };

  const out = resolve(argOf(args, "--out") ?? `${id}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(cell, null, 2) + "\n");
  envelope(
    {
      traced: file, grid: gridId, colours: palette.length,
      despeckled: cleaned.changed, debrisDropped: cleaned.dropped, out,
    },
    aspectWarning(width, height, grid, gridId),
  );
}

// ─── trace-set ──────────────────────────────────────────────

async function runTraceSet(args) {
  const dir = args.find((arg) => !arg.startsWith("--"));
  if (!dir) {
    process.stderr.write("trace-set: needs a pose directory\n");
    process.exitCode = 2;
    return;
  }
  const gridId = argOf(args, "--grid") ?? "square32";
  const grid = GRIDS[gridId];
  if (!grid) {
    process.stderr.write(`trace-set: no grid "${gridId}"\n`);
    process.exitCode = 2;
    return;
  }
  const alphaFloor = Number(argOf(args, "--alpha") ?? 128);
  const root = resolve(dir);
  const files = readdirSafe(root)
    .filter((name) => name.endsWith(".png"))
    .sort();
  if (!files.length) {
    process.stderr.write(`trace-set: no PNGs in ${root}\n`);
    process.exitCode = 2;
    return;
  }

  const cells = {};
  const skipped = [];
  const stretched = [];
  for (const file of files) {
    const { rgba, width, height } = await loadForTrace(join(root, file), args, grid);
    if (aspectWarning(width, height, grid, gridId).length) {
      stretched.push(`${file} (${width}x${height})`);
    }
    const small = resampleDown(rgba, width, height, grid.width, grid.height, strategyOf(args));
    const opaque = [];
    for (let at = 0; at < small.length; at += 4) {
      if (small[at + 3] >= alphaFloor) {
        opaque.push([small[at], small[at + 1], small[at + 2]]);
      }
    }
    const pose = file.replace(/\.png$/, "");
    if (!opaque.length) {
      skipped.push(pose);
      continue;
    }
    // A palette PER CELL, not one for the set: forcing every pose onto a
    // shared palette spends most of it on hues only one or two poses use.
    const { palette, dist } = paletteFor(opaque, args);
    const ink = {};
    const rows = [];
    for (let y = 0; y < grid.height; y++) {
      let line = "";
      for (let x = 0; x < grid.width; x++) {
        const at = (y * grid.width + x) * 4;
        if (small[at + 3] < alphaFloor) {
          line += ".";
          continue;
        }
        const index = nearestIn(palette, dist, small[at], small[at + 1], small[at + 2]);
        const char = ALPHABET[index];
        if (!char) {
          skipped.push(`${pose} (>${ALPHABET.length} colours)`);
          line = null;
          break;
        }
        ink[char] = hex(palette[index]);
        line += char;
      }
      if (line === null) break;
      rows.push(line);
    }
    if (rows.length === grid.height) {
      const finalRows = args.includes("--no-despeckle") ? rows : despeckle(rows, ink).rows;
      cells[pose] = { id: pose, grid: gridId, ink, rows: finalRows };
    }
  }

  const setId = root.split("/").filter(Boolean).pop();
  // Repo-relative when run from the repo root, so the recorded source
  // doesn't bake in whichever worktree happened to run the tracer.
  // Repo-relative, not cwd-relative: an absolute or cwd-dependent path bakes
  // whichever worktree ran the tracer into a committed file, so the next
  // worktree regenerates it to a one-line diff that is about nobody. The
  // repo root is derived from this script's own location, which is stable.
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
  const from = root.startsWith(REPO + "/") ? root.slice(REPO.length + 1) : root;
  const out = resolve(
    argOf(args, "--out") ?? join(root, `${setId}.traced.json`),
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify({ id: setId, grid: gridId, source: from, cells }, null, 2) +
      "\n",
  );

  const warnings = [];
  if (stretched.length) {
    warnings.push({
      code: "ASPECT_STRETCH",
      message:
        `${stretched.length} source(s) do not match grid "${gridId}" ` +
        `(${grid.width}x${grid.height}) and were stretched to fit: ${stretched.join(", ")}`,
    });
  }
  if (skipped.length) {
    warnings.push({
      code: "CELL_EMPTY",
      message: `${skipped.length} pose(s) traced to nothing and were left out: ${skipped.join(", ")}`,
    });
  }
  envelope(
    {
      set: setId,
      grid: gridId,
      traced: Object.keys(cells).length,
      of: files.length,
      out,
    },
    warnings,
  );
}

// ─── render ─────────────────────────────────────────────────

function drawCell(ctx, cell, ox, oy, scale) {
  for (let y = 0; y < cell.rows.length; y++) {
    const line = cell.rows[y];
    for (let x = 0; x < line.length; x++) {
      const ch = line[x];
      if (ch === ".") continue;
      const colour = cell.ink[ch];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

function runRender(args) {
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) {
    process.stderr.write("render: needs a traced/authored .json file\n");
    process.exitCode = 2;
    return;
  }
  const scale = Number(argOf(args, "--scale") ?? 10);
  const data = JSON.parse(readFileSync(resolve(file), "utf8"));

  let cells;
  if (data.cells) {
    const only = argOf(args, "--cell");
    cells = only ? { [only]: data.cells[only] } : data.cells;
  } else {
    cells = { [data.id]: data };
  }
  const entries = Object.entries(cells).filter(([, c]) => c);
  if (!entries.length) {
    process.stderr.write("render: nothing to render — check --cell matches a pose\n");
    process.exitCode = 1;
    return;
  }

  const gridId = entries[0][1].grid;
  const grid = GRIDS[gridId];
  if (!grid) {
    process.stderr.write(`render: cell references unknown grid "${gridId}"\n`);
    process.exitCode = 1;
    return;
  }
  const cols = Math.ceil(Math.sqrt(entries.length));
  const rows = Math.ceil(entries.length / cols);
  const pad = scale;
  const cellW = grid.width * scale + pad;
  const cellH = grid.height * scale + pad;

  const canvas = createCanvas(cols * cellW, rows * cellH);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // A CHECKERBOARD, not white — and this default is load-bearing. A cell whose
  // background was never keyed out is a solid rectangle, and on a white page
  // that is indistinguishable from correct art. It shipped that way once. The
  // checker makes "this has no transparency" the most obvious thing on screen.
  // `--backdrop dark` presses it onto Cold Crypt stone instead, which is the
  // second look worth taking: an effect invisible against its own backdrop is
  // not judged until it is seen against another.
  const backdrop = argOf(args, "--backdrop") ?? "checker";
  if (backdrop === "checker") {
    const sq = Math.max(4, Math.round(scale / 2));
    for (let y = 0; y * sq < canvas.height; y++) {
      for (let x = 0; x * sq < canvas.width; x++) {
        ctx.fillStyle = (x + y) % 2 ? "#c8ccd4" : "#eef1f5";
        ctx.fillRect(x * sq, y * sq, sq, sq);
      }
    }
  } else if (backdrop === "dark") {
    ctx.fillStyle = "#2b303b"; // Cold Crypt stone
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (backdrop !== "none") {
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  entries.forEach(([, cell], i) => {
    const ox = (i % cols) * cellW + pad / 2;
    const oy = Math.floor(i / cols) * cellH + pad / 2;
    drawCell(ctx, cell, ox, oy, scale);
  });

  const out = resolve(argOf(args, "--out") ?? file.replace(/\.json$/, ".preview.png"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, canvas.toBuffer("image/png"));
  envelope({ rendered: entries.map(([pose]) => pose), grid: gridId, out });
}

// ─── dispatch ───────────────────────────────────────────────

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  const [mode, ...rest] = process.argv.slice(2);
  switch (mode) {
    case "grids":
      runGrids();
      break;
    case "trace":
      await runTrace(rest);
      break;
    case "trace-set":
      await runTraceSet(rest);
      break;
    case "render":
      runRender(rest);
      break;
    case undefined:
    case "--help":
    case "-h":
      usage();
      break;
    default:
      process.stderr.write(`trace: no mode "${mode}"\n`);
      usage(2);
  }
}
