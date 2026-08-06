/**
 * Wan clip directories  ->  inbox/brute-S.png (+ sidecar).
 *
 * The brute is the first creature built end to end by the local pipeline, and
 * its input shape is new: not one generated GRID sheet (jester, knight) but a
 * DIRECTORY PER CLIP of individual frames, because Wan I2V emits one PNG per
 * frame. So there is nothing to slice — the cell boundaries are the files.
 * What still has to happen is everything after the slice:
 *
 *   · KEY the magenta field (prep-sheet's `isChroma`, shared — the model
 *     paints the same magenta family here, floor shelf included).
 *   · BBOX each frame, because Wan re-centres the figure slightly from frame
 *     to frame and the raw canvas margin is not the silhouette.
 *   · PICK frames. 17 frames is a video, not a clip; the roster wants ~2-6.
 *     Stride-picking beats taking the head of the clip: Wan's motion is
 *     slowest at the start (it eases out of the init) so the first frames are
 *     near-duplicates, and `drift.ts`'s `distinct` gate exists to catch
 *     exactly that.
 *   · NORMALISE to one scale and ONE BASELINE. Per-frame scaling would
 *     flatten a death collapse into a stand; the scale is one factor from the
 *     median LIVING height, which is sprite-forge's own aliveScale rule.
 *
 *   node .../prep/prep-brute.mjs report <workDir>
 *   node .../prep/prep-brute.mjs build  <workDir> <outPngPath>
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { keyChroma } from "./prep-sheet.mjs";

const [, , mode, workDir, outPath] = process.argv;
if (!mode || !workDir) throw new Error("usage: prep-brute.mjs <report|build> <workDir> [outPng]");

/**
 * clip -> source directory + how many frames to keep.
 *
 * `idle` is REQUIRED — `importedPaints` returns null without it and the
 * creature then never draws at all (a silent failure with a documented
 * history). The brute's painter offers idle/walk/death and nothing else, so
 * matching that set is parity, not a shortfall.
 *
 * idle comes out of the walk clip on purpose: Wan's "walk" for a creature this
 * heavy is a weight-shifting stomp, and its quietest frames ARE the idle sway.
 * Taking them from the same clip also guarantees the two share a body.
 */
const PLAN = [
  // CURATED, not strided. Two defects make automatic picking wrong here, and
  // both are visible on a contact sheet (work/brute/contact-*.png):
  //
  //   1. Wan blurs unpredictably — walk 199/203 and death 216/220 carry heavy
  //      translucent ghosting. It is not periodic, so no stride avoids it.
  //   2. This "walk" is a WEIGHT-SHIFTING SWAY, not a stride. Wan gave the
  //      brute almost no locomotion (the known slide problem), so the clip is
  //      an honest idle and only a passable walk. Picked for the widest stance
  //      and arm spread available rather than for a gait that is not there.
  //
  // `idle` is REQUIRED — importedPaints returns null without it and the
  // creature silently never draws.
  { clip: "idle", dir: "walk", pick: ["00191", "00205"] },
  { clip: "walk", dir: "walk", pick: ["00194", "00197", "00201", "00206"] },
  // A real arc: upright → stagger with the arms thrown up → pitching forward
  // → down → settled. 216/220 dropped for ghosting.
  { clip: "death", dir: "death", pick: ["00211", "00214", "00217", "00219", "00223"] },
];

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
 * GHOSTING SCORE — the count of pixels in the near-miss chroma band.
 *
 * Wan blurs hardest in the MIDDLE of a clip: the endpoints are crisp (frame 1
 * is the init, the last has settled) and the frames between carry translucent
 * motion smears. Those smears are art blended over magenta, so they are not
 * chroma enough to key and not opaque enough to be a silhouette — they survive
 * the key and stretch the bbox to the full canvas. Measured on this clip: the
 * crisp frames bbox at ~470-640px wide, the ghosted ones at exactly 640x640.
 *
 * Counting that band is a direct read of the defect, which is why picking is
 * scored rather than strided — an evenly spaced pick lands squarely on the
 * blurriest frames of the clip.
 */
function ghosting(data) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue; // already keyed out
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 90 && b > 90 && g >= 60 && g < 150 && Math.abs(r - b) < 70) n++;
  }
  return n;
}

const rows = [];
for (const p of PLAN) {
  const d = join(workDir, p.dir);
  if (!existsSync(d)) throw new Error(`missing clip dir: ${d}`);
  const files = readdirSync(d).filter((f) => f.endsWith(".png")).sort();
  const frames = [];
  for (const tag of p.pick) {
    const f = files.find((n) => n.includes(tag));
    if (!f) throw new Error(`${p.clip}: no frame matching ${tag} in ${d}`);
    const src = await loadKeyed(join(d, f));
    const bb = bbox(src.data, src.w, src.h);
    if (!bb) throw new Error(`${p.clip}/${f}: keyed to nothing`);
    frames.push({ file: f, src, bb, ghost: ghosting(src.data) });
  }
  rows.push({ ...p, frames });
}

if (mode === "report") {
  for (const r of rows) {
    console.log(`${r.clip.padEnd(6)} ${r.frames.length} frames from ${r.dir}/`);
    for (const f of r.frames) console.log(`   ${f.file}  ${f.bb.w}x${f.bb.h}  ghost=${f.ghost}`);
  }
  process.exit(0);
}

if (mode !== "build") throw new Error(`unknown mode ${mode}`);
if (!outPath) throw new Error("build needs an output path");

const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

// ONE scale from the LIVING clips (idle+walk). A death sprawl is genuinely a
// different rectangle and must not drag everyone else's size with it.
const CELL_H = 320;
const TARGET = CELL_H * 0.8;
const living = rows.filter((r) => r.clip !== "death").flatMap((r) => r.frames.map((f) => f.bb.h));
const scale = TARGET / median(living);

const scaledW = rows.flatMap((r) => r.frames.map((f) => f.bb.w * scale));
const CELL_W = Math.ceil((Math.max(...scaledW) * 1.06) / 2) * 2;
const COLS = Math.max(...rows.map((r) => r.frames.length));
const BASELINE = Math.round(CELL_H * 0.94);

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
    const s = Math.min(scale, (CELL_H * 0.96) / bb.h);
    const w = Math.round(bb.w * s);
    const h = Math.round(bb.h * s);
    sx.drawImage(tmp, ci * CELL_W + Math.round((CELL_W - w) / 2), ri * CELL_H + BASELINE - h, w, h);
  });
});

writeFileSync(outPath, sheet.toBuffer("image/png"));
writeFileSync(
  outPath.replace(/\.png$/, ".json"),
  JSON.stringify({ rows: rows.map((r) => r.clip), cells: rows.map((r) => r.frames.length) }, null, 1),
);
console.log(`${outPath}  ${sheet.width}x${sheet.height}  rows=${rows.map((r) => `${r.clip}x${r.frames.length}`).join(" ")}  scale=${scale.toFixed(3)}`);
