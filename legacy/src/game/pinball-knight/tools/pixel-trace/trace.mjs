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
//   node tools/pixel-trace/trace.mjs grids
//       every registered grid: dimensions and texel count.
//
//   node tools/pixel-trace/trace.mjs trace sheet.png --grid square32
//       an image down to true pixels: alpha-aware box-average downsample to
//       the grid, quantised to a small palette (median-cut by default, or
//       --palette=coldcrypt to snap to this game's dungeon palette), written
//       as JSON — rows of characters you paste into code or edit by hand.
//
//   node tools/pixel-trace/trace.mjs trace-set dir/ --grid tall32
//       a whole directory of PNGs, one file per pose, as one JSON module.
//
//   node tools/pixel-trace/trace.mjs render cell.json --scale 12
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
// (sprite-forge/pixelize.mjs uses it too). No vitest, no jsdom.
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
};

/**
 * Cold Crypt palette, copied from sprite-forge/pixelize.mjs for
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
      `        [--no-matte] [--matte-tol N]\n` +
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
 * sprite-forge/pixelize.mjs; it is a no-op on art that already has alpha,
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
      data[ci * 4 + 3] = 0;
      const x = ci % w;
      const y = (ci / w) | 0;
      if (x > 0) stack.push([ci - 1, cr, cg, cb]);
      if (x < w - 1) stack.push([ci + 1, cr, cg, cb]);
      if (y > 0) stack.push([ci - w, cr, cg, cb]);
      if (y < h - 1) stack.push([ci + w, cr, cg, cb]);
    }
  }
}

/** Load, and unless `--no-matte`, key the background out first. */
async function loadForTrace(path, args) {
  const img = await loadRgba(path);
  if (!args.includes("--no-matte")) {
    matte(img.rgba, img.width, img.height, Number(argOf(args, "--matte-tol") ?? 26));
  }
  return img;
}

/**
 * Box-average an RGBA image down to `width` x `height`.
 *
 * Averaged rather than sampled: a nearest-neighbour downsample of a
 * photograph keeps whichever pixel happened to land on the grid and
 * throws away the rest, which reads as noise rather than as a smaller
 * picture. Fully transparent source pixels are left out of the colour
 * average so a sprite's edge does not get pulled toward black.
 */
function boxDown(src, srcW, srcH, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * srcH) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * srcH) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * srcW) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * srcW) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * srcW + sx) * 4;
          a += src[at + 3];
          if (src[at + 3] === 0) continue;
          r += src[at];
          g += src[at + 1];
          b += src[at + 2];
          n++;
        }
      }
      const cells = (y1 - y0) * (x1 - x0);
      const to = (y * width + x) * 4;
      out[to] = n ? r / n : 0;
      out[to + 1] = n ? g / n : 0;
      out[to + 2] = n ? b / n : 0;
      out[to + 3] = a / cells;
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
 * sprite-forge/pixelize.mjs), so traced art that goes through it needs no
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

  const { rgba, width, height } = await loadForTrace(resolve(file), args);
  const small = boxDown(rgba, width, height, grid.width, grid.height);

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

  const id = idFromFile(file);
  const cell = { id, grid: gridId, ink, rows };

  const out = resolve(argOf(args, "--out") ?? `${id}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(cell, null, 2) + "\n");
  envelope(
    { traced: file, grid: gridId, colours: palette.length, out },
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
    const { rgba, width, height } = await loadForTrace(join(root, file), args);
    if (aspectWarning(width, height, grid, gridId).length) {
      stretched.push(`${file} (${width}x${height})`);
    }
    const small = boxDown(rgba, width, height, grid.width, grid.height);
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
      cells[pose] = { id: pose, grid: gridId, ink, rows };
    }
  }

  const setId = root.split("/").filter(Boolean).pop();
  // Repo-relative when run from the repo root, so the recorded source
  // doesn't bake in whichever worktree happened to run the tracer.
  const cwd = process.cwd();
  const from = root.startsWith(cwd + "/") ? root.slice(cwd.length + 1) : root;
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
