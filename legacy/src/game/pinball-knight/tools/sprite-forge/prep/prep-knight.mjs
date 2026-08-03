/**
 * Red-plume knight roster  ->  inbox/pinball_knight-{S,N}.png (+ sidecars).
 *
 * The knight's generated sheets differ from the jester's in every way that
 * matters to a prep stage, which is why this is not a PLAN entry in
 * prep-sheet.mjs:
 *
 *   · GREEN chroma, not magenta (two stragglers still magenta) — and a green
 *     key needs a DESPILL pass, because the field bleeds a green fringe into
 *     the figure's anti-aliased edge that the key's own threshold must not
 *     reach (widening it would eat the art; see prep-sheet's magenta lesson).
 *   · BLUE LABEL BANNERS ("Common Idle", "Jump Sequence") — full-width bars
 *     with white text. keyBands clears one colour per row, which would leave
 *     the text floating; a banner row has to be zeroed whole.
 *   · WHITE FRAME DIGITS inside cells ("1".."8") — isolated text components
 *     that share no edge with the figure, so dropBleed never sees them.
 *   · TWO FACINGS PER SHEET: top row(s) face the camera (S), bottom rows face
 *     away (N). One source sheet feeds two inbox sheets.
 *
 * Slicing, bleed-dropping and stacked-pose splitting are prep-sheet's own,
 * imported — the defects they fix are shared.
 *
 *   node src/game/pinball-knight/tools/sprite-forge/prep/prep-knight.mjs report
 *   node src/game/pinball-knight/tools/sprite-forge/prep/prep-knight.mjs build
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isChroma, keyBands, sliceGrid, dropBleed, splitStacked } from "./prep-sheet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Sources live under sources/, NEVER under work/: `npm run sprites` rm -rf's
// `work/<name>/` before writing frames there, and when these sheets lived at
// work/pinball_knight the forge deleted all fourteen of them.
const SRC = join(HERE, "..", "sources", "pinball_knight-2026-08-02");
const INBOX = join(HERE, "..", "inbox");

/**
 * Green-family test — high G dominating both other channels, plus the
 * ZERO-RED rule: the banner→field transition rows blend to dark teals like
 * rgb(0,96,64) that fail the dominance test, but no colour the knight
 * actually wears has r<25 alongside a saturated green or blue (steel, gold,
 * skin and the red plume all carry red; the outline is dark in ALL channels).
 * Without this rule those rows survived as 12px-tall full-width "frames".
 */
export function isGreenChroma(r, g, b) {
  if (g > 100 && g > r * 1.6 && g > b * 1.6) return true;
  // r<35 rather than a tighter cut: the roll sheet's teal cell borders sit at
  // rgb(27,102,92), and the knight's own darkest steel keeps r well above 40.
  return r < 35 && (g > 55 || b > 55) && g >= b * 0.5;
}

/**
 * Zero whole rows owned by a LABEL BANNER. Saturated blue is nothing the
 * knight wears (his armour blue is desaturated steel), so a row where the
 * saturated-blue family owns >35% of the width is a banner — and the entire
 * row goes, text and all.
 */
export function stripBanners(data, w, h) {
  let rows = 0;
  for (let y = 0; y < h; y++) {
    let blue = 0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      if (b > 120 && b > r + 40 && b > g + 30) blue++;
    }
    if (blue > w * 0.35) {
      for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = 0;
      rows++;
    }
  }
  return rows;
}

/**
 * keyBands for COLUMNS: the roll sheet rules its cells with 2-3px vertical
 * border lines whose blend colours dodge every per-colour test (measured teal
 * rgb(27,102,92) beside near-black rgb(0,51,46) in one line). What no figure
 * does is put ONE flat colour down 55% of the sheet's height — the same
 * structural rule prep-sheet's keyBands applies to rows, on the other axis.
 */
export function keyColumnBands(data, w, h) {
  let cleared = 0;
  for (let x = 0; x < w; x++) {
    const tally = new Map();
    for (let y = 0; y < h; y++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] === 0) continue;
      const k = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    let best = 0, bk = -1;
    for (const [k, n] of tally) if (n > best) { best = n; bk = k; }
    if (bk < 0 || best < h * 0.55) continue;
    for (let y = 0; y < h; y++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] === 0) continue;
      const k = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
      if (k === bk) { data[p + 3] = 0; cleared++; }
    }
  }
  return cleared;
}

/**
 * Drop CHROMA SPECKS: tiny isolated components that are dark-green residue of
 * the key (anti-aliased digit/separator edges land at colours like rgb(0,10,0)
 * — too dark for the chroma test, too far from the figure for dropBleed, and
 * 48 such pixels held a marble's frame box at 432px tall). Gated on the
 * green channel dominating, so a detached orange ember survives and the
 * knight's cool-grey outline (b >= g) never matches.
 */
export function dropChromaSpecks(data, w, h, maxSize = 200) {
  const seen = new Uint8Array(w * h);
  let dropped = 0;
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      if (seen[sy * w + sx] || data[(sy * w + sx) * 4 + 3] <= 127) continue;
      const px = [];
      const stack = [[sx, sy]];
      seen[sy * w + sx] = 1;
      let greenish = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        px.push([cx, cy]);
        const p = (cy * w + cx) * 4;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        if (g >= r && g >= b && g - Math.min(r, b) >= 5 && Math.max(r, g, b) < 120) greenish++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (seen[ny * w + nx] || data[(ny * w + nx) * 4 + 3] <= 127) continue;
          seen[ny * w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (px.length > maxSize || greenish / px.length < 0.7) continue;
      for (const [cx, cy] of px) data[(cy * w + cx) * 4 + 3] = 0;
      dropped += px.length;
    }
  }
  return dropped;
}

/**
 * The slate-blue FRAME family: every sheet arrives with a ~6px border frame at
 * rgb(≈36,95,140) — the same family as the label banners. The band tests miss
 * it because its gradient straddles a 4-bit quantisation boundary and the
 * per-column tally splits below threshold. Per-pixel is safe here: the
 * knight's steel is blue-GREY (b−r ≈ 50 at every value level), never this
 * saturated toward blue.
 */
export function isFrameBlue(r, g, b) {
  return b > 105 && b > r + 60 && g < b && g > r;
}

/** Key both chroma families, then DESPILL the green fringe the key leaves. */
export function keyKnight(data) {
  let keyed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (isGreenChroma(r, g, b) || isChroma(r, g, b) || isFrameBlue(r, g, b)) {
      data[i + 3] = 0;
      keyed++;
    } else if (g > Math.max(r, b) + 25) {
      // fringe: a pixel greener than any colour in the knight's palette
      data[i + 1] = Math.max(r, b) + 10;
    }
  }
  return keyed;
}

/**
 * Drop TEXT components inside a cell: near-white or near-black, small next to
 * the figure, and floating free of it. Fire specks are orange and survive;
 * armour highlights are part of the body's component and survive.
 */
export function dropText(data, w, cell, maxShare = 0.08) {
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
      let textish = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        px.push([cx, cy]);
        const p = ((y0 + cy) * w + x0 + cx) * 4;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        const lo = Math.min(r, g, b), hi = Math.max(r, g, b);
        if ((lo > 180 && hi - lo < 50) || hi < 70) textish++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          if (seen[ny * cw + nx] || data[((y0 + ny) * w + x0 + nx) * 4 + 3] <= 127) continue;
          seen[ny * cw + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      comps.push({ px, textish });
    }
  }
  if (comps.length < 2) return 0;
  const biggest = Math.max(...comps.map((c) => c.px.length));
  let dropped = 0;
  for (const c of comps) {
    if (c.px.length >= biggest * maxShare) continue;
    if (c.textish / c.px.length < 0.7) continue;
    for (const [cx, cy] of c.px) data[((y0 + cy) * w + x0 + cx) * 4 + 3] = 0;
    dropped += c.px.length;
  }
  return dropped;
}

async function loadSheet(base) {
  const file = readdirSync(SRC).find((f) => f.startsWith(base));
  if (!file) throw new Error(`no sheet starting with "${base}" in ${SRC}`);
  const img = await loadImage(join(SRC, file));
  const c = createCanvas(img.width, img.height);
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const im = x.getImageData(0, 0, img.width, img.height);
  stripBanners(im.data, img.width, img.height);
  keyKnight(im.data);
  keyBands(im.data, img.width, img.height);
  keyColumnBands(im.data, img.width, img.height);
  dropChromaSpecks(im.data, img.width, img.height);
  return { im, width: img.width, height: img.height, file };
}

/** Contiguous true runs of `occ`, at least `min` long. */
function inkRuns(occ, min) {
  const out = [];
  let s = -1;
  for (let i = 0; i < occ.length; i++) {
    if (occ[i]) { if (s < 0) s = i; }
    else if (s >= 0) { if (i - s >= min) out.push([s, i - 1]); s = -1; }
  }
  if (s >= 0 && occ.length - s >= min) out.push([s, occ.length - 1]);
  return out;
}

/**
 * A RAGGED sheet: rows found by ink, and each row cut by its OWN ink gaps.
 *
 * ⚠️ THIS EXISTS BECAUSE `sliceGrid` FORCES ONE COLUMN COUNT ON EVERY ROW, and
 * `13_side_profile_E.png` does not have one. It lays out 5 idle poses, 6 walk
 * poses and 4 attack poses — and it was declared `[6, 3]`, so the cutter
 * searched ±11% of the sheet width for the emptiest column near each of six
 * imaginary boundaries and sliced THROUGH the art. The result had the right
 * total (18) and nothing checked the shape:
 *
 *     [1]   5×13    a speck
 *     [2] 307×214   two poses welded into one frame
 *     [3]  45×162   a bare sword blade
 *
 * The PLAN then picked frames 0-3 / 6-11 / 12-15 out of that, so the published
 * idle row was a knight, a knight, half a knight and a floating sword — the
 * player's "the idle is disappearing".
 *
 * No grid is forced here, and none is needed: measured on the keyed sheet, the
 * three bands slice into exactly 5 / 6 / 4 runs of 111-244 px separated by
 * gaps of 21-81 px, with no fragment and no weld. The swords stay with their
 * knights because a sword TOUCHES its hand — connectivity is the property that
 * actually holds, and a column count is not.
 */
function sliceRagged(sheet, minRunFrac = 0.02) {
  const { im, width, height } = sheet;
  const opaque = (x, y) => im.data[(y * width + x) * 4 + 3] > 127;
  const rowOcc = new Uint8Array(height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (opaque(x, y)) { rowOcc[y] = 1; break; }

  const out = [];
  for (const [ry0, ry1] of inkRuns(rowOcc, Math.round(height * 0.04))) {
    const colOcc = new Uint8Array(width);
    for (let x = 0; x < width; x++)
      for (let y = ry0; y <= ry1; y++) if (opaque(x, y)) { colOcc[x] = 1; break; }
    for (const [cx0, cx1] of inkRuns(colOcc, Math.round(width * minRunFrac))) {
      let x0 = width, y0 = height, x1 = -1, y1 = -1;
      for (let y = ry0; y <= ry1; y++)
        for (let x = cx0; x <= cx1; x++)
          if (opaque(x, y)) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      if (x1 >= 0) out.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
  }
  return out;
}

/** `cols === 0` selects the ragged slice above; anything else is the grid cut. */
function sliceKnight(sheet, cols, rows) {
  const { im, width, height } = sheet;
  const cut = () => (cols === 0 ? sliceRagged(sheet) : sliceGrid(im.data, width, height, cols, rows));
  for (const c of cut()) {
    dropBleed(im.data, width, c);
    dropText(im.data, width, c);
  }
  if (cols === 0) return cut();
  return cut().flatMap((c) => splitStacked(im.data, width, c));
}

/**
 * clip -> source sheet, its grid, and the CURATED frame indices per facing.
 *
 * Frames index the slice in reading order (top row first). The knight's
 * sheets put the camera-facing row(s) on top and the away-facing rows below,
 * so S picks from the top half and N from the bottom.
 *
 * `run` reuses the walk frames — the animator ramps the playback rate as the
 * sprint winds up, and a sprint that swapped to the PROCEDURAL knight
 * mid-charge would read as a different character. Physically duplicated
 * rather than aliased: a sidecar names each physical row once.
 *
 * N has no authored stumble/death/roll — those rows reuse the S frames, the
 * standard two-facing compromise: a burn-collapse that faces the camera while
 * the knight walks away beats a style-pop to the procedural painter mid-death
 * (the merge in knight-sheets.ts fills clips per FACING, so a clip missing
 * from the N sheet would fall back to the painter's N, not to imported S).
 */
/**
 * The commit block this prep writes into every sidecar it produces.
 *
 * ⚠️ IT IS WRITTEN HERE BECAUSE THIS SCRIPT OVERWRITES THE SIDECAR. `build`
 * rewrites `inbox/pinball_knight-{S,N}.json` wholesale, so a `commit` block
 * added by hand after a prep run survives exactly until the next one — and then
 * `npm run sprites` republishes the player UNCOMMITTED and 43,000 colours deep,
 * with no error anywhere, because publishing an un-gridded sheet is a perfectly
 * legal thing for the forge to do. The knight's sidecars had already lost it
 * (checked: `commit` is absent at `92e2eeb`, `a11dfa8` and on `main`); the
 * committed art only survived because the promoted PNG in `inbox/` still
 * carried the ×8 lattice for `detectPixelGrid` to find.
 *
 * `rot` is banned because the crush's luma-weighted snap discounts blue to
 * 0.11, so warm-grey armor matches the zombie ramp — see `commit.ts`'s `ban`.
 */
const COMMIT = { bans: ["rot"] };

const PLAN = {
  S: [
    ["idle", "01_idle", [4, 2], [0, 1, 2, 3]],
    // `face:` — the walk sheet's camera-facing row wears a CLOSED VISOR, and at
    // 63 texels a grey grille plus a gold chest blob is indistinguishable from
    // the back's grey helm plus gold shield pin: the player read every walk
    // toward the camera as walking away. The open-face head from the idle
    // sheet (frame 0, eyes open) is transplanted onto each walk frame — skin
    // pixels are the one front-tell that survives the crush.
    //
    // ⚠️ `faceMirror` — THE DONOR AND THE TARGET FACE OPPOSITE WAYS. The idle
    // figure stands square to the camera with its head turned to the viewer's
    // LEFT; the walk row is a ¾ profile STRIDING RIGHT (visor grille on the
    // right, leading boot to the right). Pasting the donor unflipped shipped a
    // knight whose head looked back over his shoulder in every walk and run
    // frame — measured on the published S sheet, face centroid 2.6-3.2 texels
    // LEFT of the head bbox centre while the feet led 1.3-2.3 texels RIGHT of
    // the torso. The engine draws W as E flipped, so what the player reported
    // is the mirror of that: "the feet are left and the head is right".
    ["walk", "03_walk", [3, 2], [0, 1, 2], undefined, { face: ["01_idle", 0], faceMirror: true }],
    ["run", "03_walk", [3, 2], [0, 1, 2], undefined, { face: ["01_idle", 0], faceMirror: true }],
    ["attack", "09_attack", [4, 2], [0, 1, 2, 3]],
    ["stumble", "05_touched_lava", [2, 2], [0, 1]],
    ["death", "05_touched_lava", [2, 2], [1, 2, 3]],
    ["roll", "12_roll", [7, 1], [1, 2, 3, 4, 2, 1], 0],
  ],
  N: [
    ["idle", "01_idle", [4, 2], [4, 5, 6, 7]],
    ["walk", "03_walk", [3, 2], [3, 4, 5]],
    ["run", "03_walk", [3, 2], [3, 4, 5]],
    ["attack", "10_attack_weaponless_6", [3, 2], [3, 4, 5]],
    ["stumble", "05_touched_lava", [2, 2], [0, 1]],
    ["death", "05_touched_lava", [2, 2], [1, 2, 3]],
    ["roll", "12_roll", [7, 1], [1, 2, 3, 4, 2, 1], 0],
  ],
  // ⚠️ RAGGED (`cols: 0`), NOT `[6, 3]`. This sheet lays out 5 idle / 6 walk /
  // 4 attack poses; declaring six columns cut through the art and published a
  // bare sword blade as an idle frame — see `sliceRagged`. The picks below
  // index the ragged slice's 15 frames in reading order, and every one of them
  // is used: 0-4 idle, 5-10 walk, 11-14 attack.
  //
  // No `face:` here. The transplant exists because the S/N walk rows wear a
  // CLOSED VISOR; this sheet is drawn with the visor up and the face already
  // points the way the knight walks, which is the property the transplant was
  // faking. It is also the sheet the engine uses for E and (flipped) W, so it
  // is where the head/feet agreement is most visible.
  E: [
    ["idle", "13_side_profile_E", [0, 3], [0, 1, 2, 3, 4]],
    ["walk", "13_side_profile_E", [0, 3], [5, 6, 7, 8, 9, 10]],
    ["run", "13_side_profile_E", [0, 3], [5, 6, 7, 8, 9, 10]],
    ["attack", "13_side_profile_E", [0, 3], [11, 12, 13, 14]],
    ["stumble", "05_touched_lava", [2, 2], [0, 1]],
    ["death", "05_touched_lava", [2, 2], [1, 2, 3]],
    ["roll", "12_roll", [7, 1], [1, 2, 3, 4, 2, 1], 0],
  ],
};

/**
 * Helmet bbox: opaque pixels in the top `frac` of the frame. Both sheets draw
 * the head as a rigid unit ending at the gorget, so the top ~38% bounds it.
 */
function headBox(sheet, f, frac = 0.38) {
  const yEnd = f.y0 + Math.round(f.h * frac);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = f.y0; y < yEnd; y++) {
    for (let x = f.x0; x <= f.x1; x++) {
      if (sheet.im.data[(y * sheet.width + x) * 4 + 3] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Replace the target frame's helmet with the donor's, nearest-scaled to the
 * target helmet's exact bbox — full coverage, no grille rim left behind, and
 * the ≤4% aspect distortion disappears under the k-centroid resample.
 *
 * `mirror` flips the donor horizontally on the way in. A transplant carries the
 * donor's FACING with it, and a head is the one part of a figure whose facing
 * the player reads directly — so a donor picked for its open visor rather than
 * for its heading has to be turned to match the body it lands on. See the
 * `faceMirror` note in `PLAN`.
 */
export function transplantHead(target, tf, donor, df, mirror = false) {
  const tb = headBox(target, tf);
  const db = headBox(donor, df);
  if (!tb || !db) return false;
  for (let y = tb.y0; y <= tb.y1; y++)
    for (let x = tb.x0; x <= tb.x1; x++) target.im.data[(y * target.width + x) * 4 + 3] = 0;
  for (let ty = 0; ty < tb.h; ty++) {
    for (let tx = 0; tx < tb.w; tx++) {
      const rx = mirror ? tb.w - 1 - tx : tx;
      const sx = db.x0 + Math.min(db.w - 1, Math.floor((rx * db.w) / tb.w));
      const sy = db.y0 + Math.min(db.h - 1, Math.floor((ty * db.h) / tb.h));
      const from = (sy * donor.width + sx) * 4;
      if (donor.im.data[from + 3] <= 127) continue;
      const to = ((tb.y0 + ty) * target.width + (tb.x0 + tx)) * 4;
      target.im.data[to] = donor.im.data[from];
      target.im.data[to + 1] = donor.im.data[from + 1];
      target.im.data[to + 2] = donor.im.data[from + 2];
      target.im.data[to + 3] = donor.im.data[from + 3];
    }
  }
  return true;
}

const mode = process.argv[2];

if (mode === "report") {
  const bases = [...new Set(Object.values(PLAN).flat().map(([, b]) => b))];
  for (const base of bases) {
    const sheet = await loadSheet(base);
    const grid = Object.values(PLAN).flat().find(([, b]) => b === base)[2];
    const frames = sliceKnight(sheet, grid[0], grid[1]);
    console.log(`${sheet.file}  grid ${grid[0]}x${grid[1]}  -> ${frames.length} frames`);
    frames.forEach((f, i) => console.log(`   [${i}] ${f.w}x${f.h} @ ${f.x0},${f.y0}`));
  }
}

if (mode === "build") {
  const cache = new Map();
  const get = async (base, grid) => {
    if (!cache.has(base)) {
      const sheet = await loadSheet(base);
      cache.set(base, { sheet, frames: sliceKnight(sheet, grid[0], grid[1]) });
    }
    return cache.get(base);
  };
  const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

  // `run` shares the walk frames, so the same sheet region would be
  // transplanted twice; harmless but wasteful — do each frame once.
  const transplanted = new Set();
  for (const dir of Object.keys(PLAN)) {
    const rows = [];
    for (const [clip, base, grid, pick, anchor, opts] of PLAN[dir]) {
      const { sheet, frames } = await get(base, grid);
      const missing = pick.filter((i) => !frames[i]);
      if (missing.length) throw new Error(`${base}: PLAN wants frame(s) ${missing} but only ${frames.length} sliced`);
      if (opts?.face) {
        const [donorBase, donorIdx] = opts.face;
        const donorGrid = Object.values(PLAN).flat().find(([, b]) => b === donorBase)[2];
        const donor = await get(donorBase, donorGrid);
        for (const i of pick) {
          const key = `${base}:${frames[i].x0},${frames[i].y0}`;
          if (transplanted.has(key)) continue;
          transplanted.add(key);
          if (!transplantHead(sheet, frames[i], donor.sheet, donor.frames[donorIdx], !!opts.faceMirror)) {
            throw new Error(`${base}[${i}]: face transplant found no head bbox`);
          }
        }
      }
      rows.push({ clip, base, sheet, anchor, frames: pick.map((i) => frames[i]), all: frames });
    }

    // One scale per SOURCE SHEET from its median frame height — the same rule
    // and the same reasoning as prep-sheet.mjs (drift is between generations,
    // pose variation inside a sheet is signal).
    //
    // 512, not 320: the roster's figures slice out at ~414-486 px, so a 320
    // cell normalised them to ~250 px — a 0.55× NEAREST downscale that threw
    // away almost half the source's rows before the forge ever saw it. At 512
    // the normalise is a mild 0.82-0.96×, and the commit's k-centroid gets
    // ~6.4 source px per texel to vote with instead of ~4.
    const CELL_H = 512;
    const TARGET = CELL_H * 0.78;
    // A sheet whose picked frames CHANGE BODY (the roll: knight -> marble)
    // would normalise its median to mid-transformation and render the crouch
    // TALLER than the idle knight. Such a sheet names an ANCHOR frame — its
    // standing pose, scaled to the target like everyone's median — and the
    // marble sizes itself honestly relative to that.
    const scaleOf = new Map();
    for (const base of new Set(rows.map((r) => r.base))) {
      const forBase = rows.filter((r) => r.base === base);
      const anchored = forBase.find((r) => r.anchor !== undefined);
      if (anchored) {
        scaleOf.set(base, TARGET / anchored.all[anchored.anchor].h);
      } else {
        const hs = forBase.flatMap((r) => r.frames.map((f) => f.h));
        scaleOf.set(base, TARGET / median(hs));
      }
    }

    const allW = rows.flatMap((r) => r.frames.map((f) => f.w * scaleOf.get(r.base)));
    const CELL_W = Math.ceil((Math.max(...allW) * 1.08) / 2) * 2;
    const COLS = Math.max(...rows.map((r) => r.frames.length));

    const out = createCanvas(CELL_W * COLS, CELL_H * rows.length);
    const ox2 = out.getContext("2d");
    // Smoothed, not nearest: this hop scales CONTINUOUS generated art by a
    // fraction near 1, where point sampling just deletes rows at random. The
    // deliberate pixelisation happens once, later, in the commit's k-centroid —
    // feeding it a nearest-decimated source starves it of the votes it counts.
    ox2.imageSmoothingEnabled = true;
    ox2.quality = "best";

    /**
     * WHERE EACH POSE WENT — the fact the forge cannot recover from pixels.
     *
     * ⚠️ THIS IS THE FIX FOR "THE IDLE IS DISAPPEARING". Downstream, the forge
     * finds cells by splitting a row at its blank COLUMNS, which is the only
     * signal a bare PNG carries — and it is wrong for any pose that contains a
     * blank column. The side-profile (E) knight holds his sword out from the
     * hip, so a full-height gap runs between blade and body and the row sliced:
     *
     *     E idle    4 poses -> 5 cells   286, 9, 275, 169, 82 px wide
     *     E walk    6 poses -> 7 cells
     *     E attack  4 poses -> 5 cells
     *
     * The 9px cell is a BARE SWORD BLADE, published as an animation frame; the
     * idle clip played knight, knight, half a knight, a floating sword.
     *
     * It cannot be repaired by a better heuristic downstream. Measured on this
     * layout, the gap either side of a detached blade (118-322 px) sits INSIDE
     * the range of real frame boundaries (241-463 px), so no threshold and no
     * merge-the-closest-pair rule separates them. The information is simply not
     * in the image — but it IS right here, where the pose was placed. Writing
     * the rect down costs one line and makes the slice exact.
     */
    const rects = [];
    rows.forEach((row, ri) => {
      const rowRects = [];
      rects.push(rowRects);
      row.frames.forEach((f, ci) => {
        const tmp = createCanvas(f.w, f.h);
        const tx = tmp.getContext("2d");
        const sub = tx.createImageData(f.w, f.h);
        for (let y = 0; y < f.h; y++) {
          for (let x = 0; x < f.w; x++) {
            const from = ((f.y0 + y) * row.sheet.width + (f.x0 + x)) * 4;
            const to = (y * f.w + x) * 4;
            sub.data[to] = row.sheet.im.data[from];
            sub.data[to + 1] = row.sheet.im.data[from + 1];
            sub.data[to + 2] = row.sheet.im.data[from + 2];
            sub.data[to + 3] = row.sheet.im.data[from + 3];
          }
        }
        tx.putImageData(sub, 0, 0);

        let s = scaleOf.get(row.base);
        if (f.h * s > CELL_H * 0.93) s = (CELL_H * 0.93) / f.h;
        if (f.w * s > CELL_W * 0.94) s = Math.min(s, (CELL_W * 0.94) / f.w);
        const dw = Math.max(1, Math.round(f.w * s));
        const dh = Math.max(1, Math.round(f.h * s));
        const px = ci * CELL_W + Math.round((CELL_W - dw) / 2);
        const py = ri * CELL_H + (CELL_H - 10) - dh; // feet on a common baseline
        ox2.drawImage(tmp, px, py, dw, dh);
        rowRects.push([px, py, px + dw - 1, py + dh - 1]);
      });
    });

    const png = join(INBOX, `pinball_knight-${dir}.png`);
    writeFileSync(png, out.toBuffer("image/png"));
    writeFileSync(
      join(INBOX, `pinball_knight-${dir}.json`),
      JSON.stringify({ rows: PLAN[dir].map(([clip]) => clip), rects, commit: COMMIT }, null, 2) + "\n",
    );
    console.log(`${png}  ${out.width}x${out.height}  cell ${CELL_W}x${CELL_H}`);
    rows.forEach((r) => console.log(`  ${r.clip.padEnd(8)} ${String(r.frames.length).padStart(2)} frames  scale ${scaleOf.get(r.base).toFixed(3)}`));
  }
}
