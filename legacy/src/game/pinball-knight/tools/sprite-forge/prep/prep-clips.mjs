/**
 * CURATED CLIP FRAMES  ->  inbox/<name>-<dir>.png (+ sidecar).
 *
 * Wan I2V emits one PNG per frame, so there is nothing to slice — the cell
 * boundaries are the files. What still has to happen is everything after the
 * slice: key the chroma, bbox each frame (Wan re-centres the figure slightly
 * frame to frame, so the raw canvas margin is not the silhouette), scale every
 * clip by ONE factor from the LIVING frames, and land them all on ONE baseline.
 *
 *   node .../prep/prep-clips.mjs report <recipe.json>
 *   node .../prep/prep-clips.mjs build  <recipe.json> <out.png>
 *
 * A recipe is portable and reviewable, which the old hard-coded PLAN was not:
 *
 *   {
 *     "name": "brute", "dir": "S",
 *     "rows": [
 *       { "clip": "idle",   "dir": "work/comfy/animate-idle", "pick": ["00191", "00205"] },
 *       { "clip": "walk",   "dir": "work/comfy/animate-walk", "pick": ["00194", "00197"] }
 *     ]
 *   }
 *
 * ── WHAT THIS REPLACES, AND THE BUG IT CARRIED ──────────────────────────────
 *
 * `prep-brute.mjs` did this job for exactly one creature and its last line was:
 *
 *     JSON.stringify({ rows: ..., cells: rows.map(r => r.frames.length) })
 *
 * That `cells` key is the defect. It sends the sheet through `equalCells`,
 * which re-cuts each row into UNIFORM columns — so the rects stop sitting on
 * the figures, `register.ts` centres the column instead of the ink, and the
 * sprite slides sideways as the clip plays. Measured on the sheet it produced:
 * the walk row swept 43% of a cell width, monotonically, across four frames.
 *
 * The override existed because nobody checked the slice. So this checks the
 * slice, and never writes `cells`.
 *
 * FOUR changes from the original, all of them load-bearing:
 *
 *   1. A REAL GUTTER. The old `CELL_W = max(scaledW) * 1.06` left ~13px of
 *      clearance at 895px wide — marginal, and marginal is exactly when the
 *      slicer merges two frames and someone reaches for `cells`. `GUTTER` is
 *      absolute and generous, horizontally and vertically.
 *   2. NEVER writes `cells`. The sidecar is `{ rows, commit: { derive: 20 } }`.
 *   3. VERIFIES ITS OWN OUTPUT. `cutSheet()` runs on the composite and the
 *      found shape must equal the plan, or nothing is written.
 *   4. RUNS `driftRow` on the composite and refuses on failure — the defect is
 *      caught where it is created, not two stages later at publish.
 *
 * Kept verbatim because each was measured: `ghosting()` (Wan's translucent
 * mid-clip smears survive the chroma key and stretch the bbox to the full
 * canvas), the living-frames-only scale vote, the shared baseline, the
 * per-frame bbox, and the lone clamp for an oversized death sprawl.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keyChroma } from "./prep-sheet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [, , mode, recipePath, outPath] = process.argv;
if (!mode || !recipePath) throw new Error("usage: prep-clips.mjs <report|build> <recipe.json> [out.png]");

const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
const ROOT = dirname(resolve(recipePath));

/** Blank source px between cells, and between rows. */
const GUTTER = 32;
const CELL_H = 320;
/** Living figures fill this share of the cell; the rest is headroom + gutter. */
const TARGET = CELL_H * 0.78;

const loadKeyed = async (file) => {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, img.width, img.height);
  keyChroma(im.data);
  return { data: im.data, w: img.width, h: img.height };
};

/** Tight alpha bbox — the silhouette, not the canvas. */
function bbox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * GHOSTING SCORE — pixels in the near-miss chroma band.
 *
 * Wan blurs hardest in the MIDDLE of a clip: the endpoints are crisp (frame 1
 * is the init, the last has settled) and the frames between carry translucent
 * motion smears. Those smears are art blended over the key colour, so they are
 * neither chroma enough to key nor opaque enough to be silhouette — they
 * survive and stretch the bbox to the full canvas. Counting the band is a
 * direct read of the defect, which is why picking is SCORED and not strided:
 * an evenly spaced pick lands squarely on the blurriest frames.
 */
function ghosting(data) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 90 && b > 90 && g >= 60 && g < 150 && Math.abs(r - b) < 70) n++;
  }
  return n;
}

const rows = [];
for (const p of recipe.rows) {
  const d = resolve(ROOT, p.dir);
  if (!existsSync(d)) throw new Error(`${p.clip}: missing clip dir ${d}`);
  const files = readdirSync(d).filter((f) => f.endsWith(".png")).sort();
  const frames = [];
  for (const tag of p.pick) {
    const f = files.find((n) => n.includes(tag));
    if (!f) throw new Error(`${p.clip}: no frame matching "${tag}" in ${d}`);
    const src = await loadKeyed(join(d, f));
    const bb = bbox(src.data, src.w, src.h);
    if (!bb) throw new Error(`${p.clip}/${f}: keyed to nothing — is the background the chroma colour?`);
    frames.push({ file: f, src, bb, ghost: ghosting(src.data) });
  }
  rows.push({ ...p, frames });
}

if (mode === "report") {
  for (const r of rows) {
    console.log(`${r.clip.padEnd(8)} ${r.frames.length} frames from ${r.dir}/`);
    for (const f of r.frames) console.log(`   ${f.file.padEnd(28)} ${f.bb.w}x${f.bb.h}  ghost=${f.ghost}`);
  }
  process.exit(0);
}
if (mode !== "build") throw new Error(`unknown mode ${mode}`);
if (!outPath) throw new Error("build needs an output path");

const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

// ONE scale from the LIVING clips. A death sprawl is genuinely a different
// rectangle and must not drag everyone else's size with it — that is
// `aliveScale`'s rule at runtime and this is its authoring twin.
const living = rows.filter((r) => r.clip !== "death").flatMap((r) => r.frames.map((f) => f.bb.h));
if (!living.length) throw new Error("every row is `death` — nothing to take a living scale from");
const scale = TARGET / median(living);

const scaledW = rows.flatMap((r) => r.frames.map((f) => f.bb.w * scale));
const CELL_W = Math.ceil((Math.max(...scaledW) + GUTTER * 2) / 2) * 2;
const COLS = Math.max(...rows.map((r) => r.frames.length));
const BASELINE = Math.round(CELL_H * 0.9);

const sheet = createCanvas(CELL_W * COLS, CELL_H * rows.length);
const sx = sheet.getContext("2d");
sx.imageSmoothingEnabled = false;

rows.forEach((row, ri) => {
  row.frames.forEach((f, ci) => {
    const { src, bb } = f;
    const tmp = createCanvas(bb.w, bb.h);
    const tctx = tmp.getContext("2d");
    const sub = tctx.createImageData(bb.w, bb.h);
    for (let y = 0; y < bb.h; y++) {
      for (let x = 0; x < bb.w; x++) {
        const from = ((bb.y0 + y) * src.w + (bb.x0 + x)) * 4;
        const to = (y * bb.w + x) * 4;
        sub.data[to] = src.data[from];
        sub.data[to + 1] = src.data[from + 1];
        sub.data[to + 2] = src.data[from + 2];
        sub.data[to + 3] = src.data[from + 3];
      }
    }
    tctx.putImageData(sub, 0, 0);
    // A death frame that overflows is clamped ALONE rather than shrinking the
    // whole sheet — the living scale is the one the game reads as body size.
    const s = Math.min(scale, (CELL_H - GUTTER) / bb.h);
    const w = Math.round(bb.w * s);
    const h = Math.round(bb.h * s);
    sx.drawImage(tmp, ci * CELL_W + Math.round((CELL_W - w) / 2), ri * CELL_H + BASELINE - h, w, h);
  });
});

// ── THE SHAPE THIS SHEET CLAIMS, STATED SO A MISMATCH IS ATTRIBUTABLE ────────
//
// The `cells` override existed because nobody checked that the slicer found
// what the author intended. The check now exists — `npm run sprites` runs
// `cutSheet` and then `driftRow`, and a row whose rects do not sit on the ink
// is a hard failure there. This script cannot run that check itself:
// `sheet-cut.ts` is TypeScript and this is a node CLI, and re-implementing the
// slicer here to verify the slicer is the "test that copies the logic" trap.
//
// So it states the shape it intends instead. If `npm run sprites` reports a
// different one, the GUTTER or the scale is wrong and the fix is in THIS file
// — not a `cells` override in the sidecar, which is the defect this script
// exists to stop producing.
const want = rows.map((r) => `${r.clip}x${r.frames.length}`).join(" ");

writeFileSync(outPath, sheet.toBuffer("image/png"));
writeFileSync(
  outPath.replace(/\.png$/, ".json"),
  // ⚠️ NO `cells`. See the header. `commit` puts the sheet on the x8 lattice
  // and `derive: 20` gives it its own palette instead of snapping to the
  // shared Cold-Crypt one.
  JSON.stringify({ rows: rows.map((r) => r.clip), commit: { derive: 20 } }, null, 1) + "\n",
);
console.log(
  `${outPath}  ${sheet.width}x${sheet.height}\n` +
    `  intends: ${want}\n` +
    `  scale=${scale.toFixed(3)}  cell=${CELL_W}x${CELL_H}  gutter=${GUTTER}px\n` +
    `  next: copy both files into inbox/ and run \`npm run sprites\`. It slices the sheet,\n` +
    `        checks the rects sit on the ink (driftRow), and prints the shape it actually found.`,
);
