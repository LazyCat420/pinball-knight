/**
 * DON QUIXOTE — turn the 2026-08-02 drop into one inbox sheet.
 *
 * The drop is four separate 1024x1024 pages, one per clip, each a 4x2 grid of
 * 256x512 cells. Two of the pages are keyed on magenta and one (`walk_fixed`) on
 * GREEN panels over a teal page — so the matte has to key three colours, not
 * one, and normalise them all to the #FF00FF the inbox expects.
 *
 * The sheet is written ALREADY KEYED — real alpha, not a magenta field. A
 * magenta field would be flood-filled from the border by `matte`, and the gap
 * between this knight's legs is SEALED by his own silhouette in two of the
 * walk poses: the fill cannot reach it, and the first published pass shipped a
 * magenta wedge between his boots. Emitting alpha ourselves skips the matte
 * entirely (`cutSheet` mattes only a sheet that arrives opaque).
 *
 * Only the TOP row of each page is taken. The bottom row is the same four
 * poses shifted down inside the cell, and mixing the two baselines in one clip
 * makes the knight bounce a whole body-height per cycle.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require("canvas");
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..");
const INBOX = join(BASE, "inbox");
const SRC = join(BASE, "sources", "don_quixote-2026-08-02");

const KEY = "don_quixote";
/**
 * The drop's cells are 256 WIDE and 512 TALL — four columns and two rows over
 * a 1024x1024 page. Reading them as 256 squares cuts every knight off at the
 * chest, which is exactly what the first pass shipped.
 */
const CELL_W = 256;
const CELL_H = 512;
const DESC =
  "Don Quixote, the chivalrous mad jouster — dented plate, a barber's basin helmet with a feather, and a couched tournament lance he charges with until a wall stops him";

/** clip row -> the page it is cut from. */
const ROWS = [
  { clip: "idle", file: "don_quixote_idle_6frames.png" },
  { clip: "walk", file: "don_quixote_walk_fixed_6frames.png" },
  { clip: "attack", file: "don_quixote_attack_6frames.png" },
  { clip: "death", file: "don_quixote_hurt_6frames.png" },
];

/**
 * Every background this drop uses. `walk_fixed` puts a green panel on a teal
 * page; the rest are flat magenta. Keyed generously — the knight carries no
 * green and no teal, so a wide radius costs nothing and catches the fringing
 * around each panel edge.
 */
const BACKDROPS = [
  { rgb: [252, 0, 250], tol: 70 }, // magenta page
  { rgb: [3, 248, 3], tol: 80 }, // green panel (walk)
  { rgb: [0, 138, 141], tol: 60 }, // teal page (walk)
  { rgb: [0, 166, 78], tol: 60 }, // green/teal blend along the panel borders
];

function isBackdrop(r, g, b) {
  for (const bd of BACKDROPS) {
    const dr = r - bd.rgb[0];
    const dg = g - bd.rgb[1];
    const db = b - bd.rgb[2];
    if (dr * dr + dg * dg + db * db <= bd.tol * bd.tol) return true;
  }
  return false;
}

/**
 * Keep only the biggest connected figure in each 256-wide cell and matte the
 * rest away.
 *
 * The `walk_fixed` page draws each pose inside a bordered panel, and that
 * border is a 1-2px line in the SAME blue-grey family as the knight's plate —
 * close enough that a colour key wide enough to remove it takes his pauldrons
 * with it. A chroma key cannot separate them; connectivity can, because the
 * border touches nothing.
 */
/** Blank one texel to fully transparent. */
function clear(d, i) {
  d[i] = 0;
  d[i + 1] = 0;
  d[i + 2] = 0;
  d[i + 3] = 0;
}

function keepLargestBlobPerCell(d, width, height) {
  const isBg = (i) => d[i + 3] === 0;
  for (let cell = 0; cell < 4; cell++) {
    const cx0 = cell * 256;
    const cx1 = cx0 + 256;
    const label = new Int32Array(256 * height).fill(-1);
    const sizes = [];
    const stack = [];
    let next = 0;
    for (let y = 0; y < height; y++) {
      for (let x = cx0; x < cx1; x++) {
        const li = y * 256 + (x - cx0);
        if (label[li] !== -1 || isBg((y * width + x) * 4)) continue;
        const id = next++;
        let size = 0;
        stack.push(x, y);
        label[li] = id;
        while (stack.length) {
          const py = stack.pop();
          const px = stack.pop();
          size++;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < cx0 || nx >= cx1 || ny < 0 || ny >= height) continue;
            const nli = ny * 256 + (nx - cx0);
            if (label[nli] !== -1 || isBg((ny * width + nx) * 4)) continue;
            label[nli] = id;
            stack.push(nx, ny);
          }
        }
        sizes[id] = size;
      }
    }
    let best = -1;
    for (let id = 0; id < sizes.length; id++) if (best < 0 || sizes[id] > sizes[best]) best = id;
    for (let y = 0; y < height; y++) {
      for (let x = cx0; x < cx1; x++) {
        if (label[y * 256 + (x - cx0)] === best) continue;
        clear(d, (y * width + x) * 4);
      }
    }
  }
}

async function main() {
  mkdirSync(INBOX, { recursive: true });

  const sheet = createCanvas(CELL_W * 4, CELL_H * 4);
  const sctx = sheet.getContext("2d");
  sctx.clearRect(0, 0, sheet.width, sheet.height);

  for (let row = 0; row < ROWS.length; row++) {
    const page = await loadImage(join(SRC, ROWS[row].file));
    const cut = createCanvas(CELL_W * 4, CELL_H);
    const cctx = cut.getContext("2d");
    // TOP row only — see the header.
    cctx.drawImage(page, 0, 0, CELL_W * 4, CELL_H, 0, 0, CELL_W * 4, CELL_H);

    const img = cctx.getImageData(0, 0, CELL_W * 4, CELL_H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      // The green panel leaves a one-pixel halo bonded to the knight's own
      // outline, which no backdrop radius can take without taking his plate
      // with it. He carries no green at all, so green DOMINANCE is a safe
      // second test where proximity to the key colour is not.
      const greenHalo = g - Math.max(r, b) > 25;
      if (isBackdrop(r, g, b) || greenHalo || d[i + 3] < 20) clear(d, i);
    }
    keepLargestBlobPerCell(d, CELL_W * 4, CELL_H);
    cctx.putImageData(img, 0, 0);
    sctx.drawImage(cut, 0, row * CELL_H);
  }

  // Tight per-cell rects over the composed sheet, so the slicer registers each
  // pose on its own ink rather than on the 256px cell it happens to sit in.
  const full = sctx.getImageData(0, 0, sheet.width, sheet.height).data;
  const rects = [];
  const palette = new Map();
  for (let row = 0; row < 4; row++) {
    const rowRects = [];
    for (let col = 0; col < 4; col++) {
      const x0 = col * CELL_W;
      const y0 = row * CELL_H;
      let minX = CELL_W, minY = CELL_H, maxX = 0, maxY = 0, found = false;
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          const idx = ((y0 + y) * sheet.width + (x0 + x)) * 4;
          if (full[idx + 3] === 0) continue;
          const r = full[idx], g = full[idx + 1], b = full[idx + 2];
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          // Vote in a COARSE cube (5 bits a channel). Counting exact RGB
          // hands all sixteen slots to the armour, whose anti-aliased greys
          // are thousands of near-identical colours that each out-count the
          // one crimson sash.
          const q = ((r & 0xf8) << 16) | ((g & 0xf8) << 8) | (b & 0xf8);
          palette.set(q, (palette.get(q) ?? 0) + 1);
        }
      }
      if (!found) throw new Error(`empty cell at row ${row} col ${col} — the key ate the knight`);
      rowRects.push([
        x0 + Math.max(0, minX - 1),
        y0 + Math.max(0, minY - 1),
        x0 + Math.min(CELL_W - 1, maxX + 1),
        y0 + Math.min(CELL_H - 1, maxY + 1),
      ]);
    }
    rects.push(rowRects);
  }

  // The sixteen colour NEIGHBOURHOODS the art spends its pixels on, not a guess.
  const top = [...palette.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([hex]) => "#" + hex.toString(16).padStart(6, "0"));

  // Inbox only. The ORIGINALS in `sources/` are the archive; the composed
  // sheet is derived from them by this script, and a second tracked copy of
  // 2.4MB that nothing reads is just two things to keep in step.
  writeFileSync(join(INBOX, `${KEY}-S.png`), sheet.toBuffer("image/png"));
  writeFileSync(
    join(INBOX, `${KEY}-S.json`),
    JSON.stringify(
      {
        sheet: `${KEY}-S`,
        author: "LazyCat420 & Nano Banana",
        notes: DESC,
        grid: [4, 4],
        rows: ROWS.map((r) => r.clip),
        palette: top,
        rects,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`prepared ${KEY}-S (${rects.length} clips x ${rects[0].length} frames)`);
  console.log(`palette: ${top.join(" ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
