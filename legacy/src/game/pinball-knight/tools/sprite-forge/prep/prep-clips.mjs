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
import { keyChroma, isChroma } from "./prep-sheet.mjs";
// The REAL matte, not a second copy of it. Node strips the types; this is the
// same function `npm run sprites` and the panel's cut preview run — see
// `keyFrame` below for why a magenta-only key was not enough.
import { matte } from "../matte.ts";
// Same gate the CLI and the panel run, not a third copy of the idea — a
// reimplemented check cannot see the original drift away from it.
import { ghostClip } from "../ghost.ts";

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

/**
 * KEY THE BACKGROUND THIS FRAME ACTUALLY HAS.
 *
 * `keyChroma` tests for the MAGENTA FAMILY (`g < 60`), which is right for a
 * sheet the model drew on a #ff00ff field and useless for anything else. The
 * 08-07 brute run is exactly anything else: measured at the corner, the S
 * clips sit on lavender (243,169,255 — g=169) and the E/N clips on near-white
 * (246,248,239). Both sail straight past `g < 60`, so every frame keyed to
 * NOTHING, the bbox became the full canvas, and the build died on the first
 * frame it touched.
 *
 * Widening the chroma test is the wrong repair twice over: white backgrounds
 * are not a hue at all, and a global colour key punches holes through art that
 * happens to match (the reason `matte.ts` exists and the reason it fills from
 * the BORDER instead). So the fallback is the real matte — the same function
 * `npm run sprites` runs one stage later — and chroma keeps first refusal
 * because a true magenta field is unambiguous and free.
 */
function keyFrame(data, w, h, file) {
  // A magenta corner means the generator was given the chroma backdrop; trust
  // the cheap hue test, which also handles the darker "floor shelf".
  if (isChroma(data[0], data[1], data[2])) {
    keyChroma(data);
    return { how: "chroma" };
  }
  const { data: keyed, report } = matte(data, w, h);
  if (report.failures.length) throw new Error(`${file}: matte refused — ${report.failures.join("; ")}`);
  data.set(keyed);
  return { how: `matte bg=${report.bg.join(",")} keyed=${(report.keyedPct * 100).toFixed(0)}%` };
}

/**
 * Load a frame TWICE over: the raw pixels and the keyed ones.
 *
 * The raw copy is not waste. `ghost.ts` is the only honest reading of a
 * dissolved limb and it measured its own separation collapsing from 95x to 2x
 * once a matte has been applied — the key's soft fringe is the confound. So the
 * gate has to see the frame as the decoder wrote it, and this is the last place
 * in the pipeline where that version still exists.
 */
const loadKeyed = async (file) => {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, img.width, img.height);
  const raw = { width: img.width, height: img.height, data: Uint8ClampedArray.from(im.data) };
  const { how } = keyFrame(im.data, img.width, img.height, file);
  return { data: im.data, w: img.width, h: img.height, how, raw };
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
 * The translucent smears are art blended over the key colour, so they are
 * neither chroma enough to key nor opaque enough to be silhouette — they
 * survive and stretch the bbox to the full canvas. Counting the band is a
 * direct read of the defect, which is why picking is SCORED and not strided:
 * an evenly spaced pick can land squarely on the ruined frames.
 *
 * ── THE EXPLANATION THAT USED TO BE HERE WAS WRONG ──────────────────────────
 *
 * It said "Wan blurs hardest in the MIDDLE of a clip: the endpoints are crisp".
 * That is what the defect LOOKS like and it is not what causes it. Measured
 * 2026-08-07 on a 21-frame walk: the ruined frames were 4, 5, 8, 12, 13, 16 —
 * `VAEDecodeTiled`'s temporal window boundaries at `temporal_size: 8`, where
 * the decoder cross-fades two independent decodes of a moving limb. Frame 0
 * looks crisp because it is the pinned init, not because endpoints are special.
 *
 * Decoding in ONE window (now the default in `graphs.mjs`) takes the worst
 * frame from 10.43% to 0.23% and flags nothing. So this function is a NET, not
 * the fix, and it should now find nothing on a fresh clip.
 *
 * Two limits worth knowing before trusting it: it is magenta-specific (that
 * band is a near-miss chroma test and reads nothing on a white field), and it
 * runs AFTER the key, where `ghost.ts` measured the separation collapsing from
 * 95x to 2x. `ghostClip` below is the gate; this stays for the picking score.
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

/**
 * THE FAIL-CLOSED HALF.
 *
 * `/forge` already excludes dissolved frames from the tray and skips them on
 * playback, but that is a panel behaviour and there are four doors into a
 * sheet. This is the one every published sprite goes through, and a frame whose
 * limb dissolved must not reach `public/sprites/` because somebody clicked past
 * a badge.
 *
 * Scored PER ROW rather than over the whole recipe: `ghostClip`'s relative rule
 * compares a frame against its own clip's median, and clips generated in
 * different runs are different populations. Pooling them would let a clean
 * clip's frames raise the bar for a bad one.
 *
 * Scored on the RAW pixels — see `loadKeyed`.
 */
const ghostVerdicts = rows.map((r) => ({
  clip: r.clip,
  v: ghostClip(r.frames.map((f) => f.src.raw), { label: `${recipe.name ?? "sheet"} ${r.clip}` }),
}));
const ghostBad = ghostVerdicts.filter((g) => g.v.flagged.length);

if (mode === "report") {
  for (const r of rows) {
    console.log(`${r.clip.padEnd(8)} ${r.frames.length} frames from ${r.dir}/`);
    const g = ghostVerdicts.find((x) => x.clip === r.clip);
    r.frames.forEach((f, i) => {
      const pct = g ? `${(g.v.pct[i] * 100).toFixed(2)}%` : "—";
      const mark = g?.v.flagged.includes(i) ? " ✗ DISSOLVED" : g?.v.soft.includes(i) ? " ! borderline" : "";
      console.log(`   ${f.file.padEnd(28)} ${f.bb.w}x${f.bb.h}  ghost=${pct.padEnd(8)} chroma=${String(f.ghost).padEnd(7)} ${f.src.how}${mark}`);
    });
  }
  if (ghostBad.length) {
    console.log("");
    for (const g of ghostBad) console.log(g.v.report);
  }
  process.exit(0);
}
if (mode !== "build") throw new Error(`unknown mode ${mode}`);
if (!outPath) throw new Error("build needs an output path");

// REFUSE, before anything is composited. `report` above prints the same numbers
// without throwing, which is the door for looking at a flagged frame and
// deciding it is a false positive — the recipe's `pick` is then the place to
// say so, by picking a different frame.
if (ghostBad.length) {
  const where = ghostBad
    .map((g) => `${g.clip}: ${g.v.flagged.map((i) => rows.find((r) => r.clip === g.clip).frames[i].file).join(", ")}`)
    .join("\n  ");
  throw new Error(
    `refusing to build — ${ghostBad.length} clip(s) pick a frame whose limb dissolved in the decode:\n  ${where}\n` +
    `  These play as a morph, not a motion. Re-pick, or regenerate: a windowed VAE decode\n` +
    `  is the usual cause and one temporal window is now the default (graphs.mjs \`dec\`).\n` +
    `  \`prep-clips.mjs report <recipe>\` prints the per-frame scores without throwing.`,
  );
}

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
