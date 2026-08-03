/**
 * Generator grid-of-frames  ->  normalised sprite-forge sheet.
 *
 * The missing link between "what an image model returns" and "what
 * sprite-forge's inbox expects". Three jobs it does that no existing stage
 * covers:
 *
 *   1. KEY THE MAGENTA FAMILY, not a single colour. The model draws a flat
 *      #ff00ff field AND a darker purple "floor shelf" under each row
 *      (measured rgb(153,0,153) and rgb(136,0,119)). Widening a global chroma
 *      tolerance far enough to swallow the shelf also reaches the art's own
 *      bright red #d95763 (distance 33349 vs the shelf's 32657 - closer than
 *      the thing we want gone). So key by HUE instead: high R, high B, and
 *      LOW GREEN. The shelf has G=0; the art's red has G=87 and survives.
 *
 *   2. SLICE the 2x3 grid by alpha projection, tolerating figures that touch
 *      the canvas edge (a clipped arm still belongs to its frame).
 *
 *   3. NORMALISE scale and baseline. Frames arrive at drifting sizes - the
 *      one thing per-image generation cannot hold steady. Every frame is
 *      scaled by ONE factor derived from the LIVING clips only (walk/attack/
 *      stumble/idle) and bottom-aligned onto a common ground line, which is
 *      sprite-forge's own aliveScale rule applied one stage earlier. A death
 *      sprawl that overflows is clamped alone instead of shrinking everyone.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Magenta-family test — see job 1 in the header. */
export function isChroma(r, g, b) {
  return g < 60 && r > 90 && b > 90 && Math.abs(r - b) < 70;
}

export function keyChroma(data) {
  let keyed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (isChroma(data[i], data[i + 1], data[i + 2])) {
      data[i + 3] = 0;
      keyed++;
    }
  }
  return keyed;
}

/** Runs of consecutive true values in an occupancy array, ignoring gaps < minGap. */
function runs(occ, minGap, minLen) {
  const out = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < occ.length; i++) {
    if (occ[i]) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap >= minGap) {
        const end = i - gap;
        if (end - start + 1 >= minLen) out.push([start, end]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0 && occ.length - start >= minLen) out.push([start, occ.length - 1]);
  return out;
}

/**
 * Slice a REGULAR cols x rows grid by cutting at minimum-occupancy lines.
 *
 * Alpha-projection slicing (below) needs a clean transparent gap between
 * frames and these sheets do not have one: an outstretched attack arm or a
 * raised stumble hand touches its neighbour, which merged whole rows into one
 * 1024-wide "frame" (hurt returned 2 frames for 6, attack 3 for 6). The
 * generator did lay the poses on a grid, so cut geometrically — but search a
 * window around each expected boundary and cut where the fewest opaque pixels
 * cross, i.e. at the natural pinch between two figures. Each cell is then
 * tightened to its own content.
 */
export function sliceGrid(data, w, h, cols, rows, win = 0.11) {
  const colSum = new Int32Array(w);
  const rowSum = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 127) { colSum[x]++; rowSum[y]++; }
    }
  }
  const cut = (sum, n, len) => {
    const at = [0];
    for (let i = 1; i < n; i++) {
      const want = Math.round((len * i) / n);
      const lo = Math.max(1, want - Math.round(len * win));
      const hi = Math.min(len - 1, want + Math.round(len * win));
      let best = want, bestV = Infinity;
      for (let p = lo; p <= hi; p++) {
        // prefer the emptiest column, tie-break toward the expected boundary
        const v = sum[p] * 1000 + Math.abs(p - want);
        if (v < bestV) { bestV = v; best = p; }
      }
      at.push(best);
    }
    at.push(len);
    return at;
  };
  const xs = cut(colSum, cols, w);
  const ys = cut(rowSum, rows, h);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = ys[r]; y < ys[r + 1]; y++) {
        for (let x = xs[c]; x < xs[c + 1]; x++) {
          if (data[(y * w + x) * 4 + 3] > 127) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) continue; // empty cell
      out.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, col: c, row: r });
    }
  }
  return out;
}

/** Slice a keyed image into frames: row bands, then columns within each band. */
export function sliceFrames(data, w, h, opts = {}) {
  const { rowGap = 0.02, colGap = 0.015, minFrac = 0.03 } = opts;
  const rowOcc = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 127) { rowOcc[y] = 1; break; }
    }
  }
  const bands = runs(rowOcc, Math.round(h * rowGap), Math.round(h * minFrac));
  const frames = [];
  for (const [y0, y1] of bands) {
    const colOcc = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      for (let y = y0; y <= y1; y++) {
        if (data[(y * w + x) * 4 + 3] > 127) { colOcc[x] = 1; break; }
      }
    }
    for (const [x0, x1] of runs(colOcc, Math.round(w * colGap), Math.round(w * minFrac))) {
      // tighten vertically inside this column range
      let ty0 = y1, ty1 = y0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (data[(y * w + x) * 4 + 3] > 127) {
            if (y < ty0) ty0 = y;
            if (y > ty1) ty1 = y;
            break;
          }
        }
      }
      frames.push({ x0, y0: ty0, x1, y1: ty1, w: x1 - x0 + 1, h: ty1 - ty0 + 1 });
    }
  }
  return frames;
}

/**
 * Key the FLOOR SHELVES the model draws under each row of poses.
 *
 * `keyChroma` gets the purple ones but not all of them: the model also draws
 * a dark maroon "ground shadow" line, which is a legitimate art colour and
 * must not be keyed by hue. What separates a shelf from art is STRUCTURE —
 * it spans the whole canvas width in one flat colour, and no figure does.
 * So: any row where one 4-bit-quantised colour owns >=70% of the width is a
 * shelf, and that colour is cleared on that row only.
 */
export function keyBands(data, w, h) {
  let cleared = 0;
  for (let y = 0; y < h; y++) {
    const tally = new Map();
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] === 0) continue;
      const k = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    let best = 0, bk = -1;
    for (const [k, n] of tally) if (n > best) { best = n; bk = k; }
    if (bk < 0 || best < w * 0.55) continue;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] === 0) continue;
      const k = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
      if (k === bk) { data[p + 3] = 0; cleared++; }
    }
  }
  return cleared;
}

/**
 * Drop fragments that bled in from the neighbouring pose.
 *
 * A min-occupancy cut lands at the narrowest point between two figures, which
 * is not always OUTSIDE both of them — an outstretched attack arm leaves a
 * sliver of its owner on the wrong side of the line. Those slivers are small
 * AND touch the cut edge; the pose's own body is large and does not. A
 * deliberately detached piece (the launched hat) is interior, so it survives.
 */
export function dropBleed(data, w, cell, minShare = 0.14) {
  const { x0, y0, x1, y1 } = cell;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const seen = new Uint8Array(cw * ch);
  const comps = [];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (seen[y * cw + x] || data[((y0 + y) * w + x0 + x) * 4 + 3] <= 127) continue;
      const px = [];
      const stack = [[x, y]];
      seen[y * cw + x] = 1;
      let touchesEdge = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        px.push([cx, cy]);
        if (cx === 0 || cx === cw - 1) touchesEdge = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          if (seen[ny * cw + nx] || data[((y0 + ny) * w + x0 + nx) * 4 + 3] <= 127) continue;
          seen[ny * cw + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      comps.push({ px, touchesEdge });
    }
  }
  if (!comps.length) return 0;
  const biggest = Math.max(...comps.map((c) => c.px.length));
  let dropped = 0;
  for (const c of comps) {
    if (!c.touchesEdge || c.px.length >= biggest * minShare) continue;
    for (const [cx, cy] of c.px) data[((y0 + cy) * w + x0 + cx) * 4 + 3] = 0;
    dropped += c.px.length;
  }
  return dropped;
}

export async function loadKeyed(path) {
  const img = await loadImage(path);
  const c = createCanvas(img.width, img.height);
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const im = x.getImageData(0, 0, img.width, img.height);
  keyChroma(im.data);
  keyBands(im.data, img.width, img.height);
  return { im, width: img.width, height: img.height };
}

/**
 * Split a cell that holds two poses STACKED vertically.
 *
 * The grid assumption is cols x rows over the whole canvas, and the death
 * sheet breaks it: its bottom-right third holds two separate sprawl piles,
 * one above the other, so the cell sliced to a single 460px-tall "frame" that
 * rendered as two corpses in one cell. A pose is one contiguous vertical band;
 * two poses have real empty space between them. So re-band each cell and emit
 * each band that is substantial on its own.
 */
export function splitStacked(data, w, cell, minBandFrac = 0.18, gapFrac = 0.04) {
  const { x0, y0, x1, y1 } = cell;
  const ch = y1 - y0 + 1;
  const occ = new Uint8Array(ch);
  for (let y = 0; y < ch; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[((y0 + y) * w + x) * 4 + 3] > 127) { occ[y] = 1; break; }
    }
  }
  const bands = runs(occ, Math.max(4, Math.round(ch * gapFrac)), Math.round(ch * minBandFrac));
  if (bands.length < 2) return [cell];
  return bands.map(([b0, b1]) => {
    let nx0 = x1, nx1 = x0;
    for (let y = y0 + b0; y <= y0 + b1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (data[(y * w + x) * 4 + 3] > 127) {
          if (x < nx0) nx0 = x;
          if (x > nx1) nx1 = x;
        }
      }
    }
    return { x0: nx0, y0: y0 + b0, x1: nx1, y1: y0 + b1, w: nx1 - nx0 + 1, h: b1 - b0 + 1 };
  });
}

/** Slice, de-bleed, re-tighten, then split any cell holding stacked poses. */
export function sliceClean(data, w, h, cols, rows) {
  for (const c of sliceGrid(data, w, h, cols, rows)) dropBleed(data, w, c);
  return sliceGrid(data, w, h, cols, rows).flatMap((c) => splitStacked(data, w, c));
}

// ── CLI: report what it finds, or build the sheet ────────────────────────
const [, , mode, dir, outPath] = process.argv;

/**
 * clip -> source sheet + the CURATED frame indices, in row order.
 *
 * Not every generated frame is usable and picking is part of the job — the
 * roster's own clip table is only idle 2 / walk 4 / attack 3 / death 4, so
 * there is no need to force six. Rejected, with reasons:
 *   attack[1] a neighbour's body bled across the cut; [3] its hat was cut
 *     into [4]'s cell, so the spring runs off-frame; [4] holds [3]'s hat.
 *     [0]/[2]/[5] alone read as the whole telegraph: compressed -> extended
 *     with the hat launched -> back at rest.
 *   death[0] duplicates [1] standing; [4] sliced to fragments.
 * The `hurt` sheet supplies TWO clips: its top row is the actual recoil, its
 * bottom row is three near-identical standing poses, which is an idle — and
 * `idle` is not optional, `importedPaints` returns null without it.
 */
const PLAN = [
  ["idle", "jester_hurt", [3, 4, 5]],
  ["walk", "jester_walk", [0, 1, 2, 3, 4, 5]],
  ["attack", "jester_attack", [0, 2, 5]],
  ["stumble", "jester_hurt", [0, 1, 2]],
  ["death", "jester_death", [1, 2, 3, 6, 7]],
];

if (mode === "report") {
  const files = require("fs").readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  for (const f of files) {
    const { im, width, height } = await loadKeyed(join(dir, f));
    const frames = sliceClean(im.data, width, height, 3, 2);
    const hs = frames.map((fr) => fr.h);
    console.log(
      f.replace(/_17\d+\.png/, "").padEnd(22),
      `${frames.length} frames`,
      `h: ${Math.min(...hs)}-${Math.max(...hs)} (spread ${(Math.max(...hs) / Math.min(...hs)).toFixed(2)}x)`,
    );
    frames.forEach((fr, i) => console.log(`   [${i}] ${fr.w}x${fr.h} @ ${fr.x0},${fr.y0}`));
  }
}

if (mode === "build") {
  const cache = new Map();
  const get = async (base) => {
    if (!cache.has(base)) {
      const file = require("fs").readdirSync(dir).find((f) => f.startsWith(base));
      const { im, width, height } = await loadKeyed(join(dir, file));
      const frames = sliceClean(im.data, width, height, 3, 2);
      cache.set(base, { im, width, height, frames });
    }
    return cache.get(base);
  };

  const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

  const rows = [];
  for (const [clip, base, pick] of PLAN) {
    const src = await get(base);
    rows.push({ clip, base, src, frames: pick.map((i) => src.frames[i]).filter(Boolean) });
  }

  // ── SCALE: one factor PER SOURCE SHEET, from that sheet's median height.
  // Not per frame: a crouched attack frame is genuinely shorter than an
  // extended one and flattening every frame to one height would delete the
  // spring telegraph, which is the read the whole attack exists for. Per
  // sheet fixes the drift that per-image generation actually causes (one
  // generation to the next) while preserving pose variation inside a sheet.
  const CELL_H = 320;
  const TARGET = CELL_H * 0.78;
  const scaleOf = new Map();
  for (const base of new Set(rows.map((r) => r.base))) {
    const hs = rows.filter((r) => r.base === base).flatMap((r) => r.frames.map((f) => f.h));
    scaleOf.set(base, TARGET / median(hs));
  }

  const allW = rows.flatMap((r) => r.frames.map((f) => f.w * scaleOf.get(r.base)));
  const CELL_W = Math.ceil((Math.max(...allW) * 1.08) / 2) * 2;
  const COLS = Math.max(...rows.map((r) => r.frames.length));

  const sheet = createCanvas(CELL_W * COLS, CELL_H * rows.length);
  const sx = sheet.getContext("2d");
  sx.imageSmoothingEnabled = false;

  const manifest = [];
  rows.forEach((row, ri) => {
    const cells = [];
    row.frames.forEach((f, ci) => {
      const tmp = createCanvas(f.w, f.h);
      const tx = tmp.getContext("2d");
      const sub = tx.createImageData(f.w, f.h);
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const from = ((f.y0 + y) * row.src.width + (f.x0 + x)) * 4;
          const to = (y * f.w + x) * 4;
          sub.data[to] = row.src.im.data[from];
          sub.data[to + 1] = row.src.im.data[from + 1];
          sub.data[to + 2] = row.src.im.data[from + 2];
          sub.data[to + 3] = row.src.im.data[from + 3];
        }
      }
      tx.putImageData(sub, 0, 0);

      let s = scaleOf.get(row.base);
      // a sprawl that would overflow clamps ITSELF rather than shrinking the roster
      if (f.h * s > CELL_H * 0.93) s = (CELL_H * 0.93) / f.h;
      if (f.w * s > CELL_W * 0.94) s = Math.min(s, (CELL_W * 0.94) / f.w);
      const dw = Math.max(1, Math.round(f.w * s));
      const dh = Math.max(1, Math.round(f.h * s));
      const ox = ci * CELL_W + Math.round((CELL_W - dw) / 2);
      const oy = ri * CELL_H + (CELL_H - 10) - dh; // feet on a common baseline
      sx.drawImage(tmp, ox, oy, dw, dh);
      cells.push([ox, oy, ox + dw - 1, oy + dh - 1]);
    });
    manifest.push({ clip: row.clip, cells });
  });

  mkdirSync(require("path").dirname(outPath), { recursive: true });
  writeFileSync(outPath, sheet.toBuffer("image/png"));
  writeFileSync(
    outPath.replace(/\.png$/, ".cells.json"),
    JSON.stringify({ source: [sheet.width, sheet.height], rows: manifest }, null, 2),
  );
  console.log(`sheet ${sheet.width}x${sheet.height}  cell ${CELL_W}x${CELL_H}`);
  rows.forEach((r) => console.log(`  ${r.clip.padEnd(8)} ${String(r.frames.length).padStart(2)} frames  scale ${scaleOf.get(r.base).toFixed(3)}`));
}
