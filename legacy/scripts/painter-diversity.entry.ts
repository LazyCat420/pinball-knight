/**
 * IS PERTURBING A PAINTER A NEW CREATURE, OR THE SAME ONE IN A HAT?
 *
 * The falsification test for training a sprite model on synthetic painter data.
 * 20 creatures x 1,080 frames is a small dataset; the whole plan rests on
 * parametric perturbation multiplying it into something a generative model can
 * actually learn from. If perturbation only recolours, the dataset is twenty
 * creatures with variations and the ambitious plan is dead — better to know
 * that in a day than a month.
 *
 * THE YARDSTICK. "Diverse" has no meaning without a scale, so the scale is the
 * distance between the creatures that already exist. Perturbing the jester has
 * to move it about as far as the jester sits from the hound; anything much less
 * is a hat.
 *
 * THE METRIC IS SILHOUETTE, NOT COLOUR. Recolouring is the cheap axis and the
 * game already exploits it (rotortail and jester ship as reskins). Two sprites
 * with the same silhouette are the same creature wearing different paint, so
 * the distance is 1 - IoU over binary alpha masks.
 *
 * Reported two ways, because they answer different questions:
 *   raw       masks compared where they land -> shape AND size AND stance
 *   aligned   each mask cropped to its ink bbox and rescaled -> pure SHAPE
 * Size is a real part of a creature's identity (golem vs bat), so raw is not a
 * confound to be removed — but a metric that ONLY sees size would call a
 * scaled-up jester a new monster, which is why both are printed.
 */
import { installSpriteTestDom, rosterSubjects, paintAtlas } from "../src/game/pinball-knight/testkit/atlas-census";

const GRID = 63;
const undo = installSpriteTestDom();

type Mask = Uint8Array;

function maskOf(img: any): Mask {
  const m = new Uint8Array(GRID * GRID);
  for (let i = 0; i < GRID * GRID; i++) m[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

/** Crop to ink and rescale to a fixed box — compares SHAPE with size divided out. */
function aligned(m: Mask, N = 32): Mask {
  let x0 = GRID, y0 = GRID, x1 = -1, y1 = -1;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (m[y * GRID + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const out = new Uint8Array(N * N);
  if (x1 < 0) return out;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = x0 + Math.min(w - 1, Math.floor((x + 0.5) / N * w));
    const sy = y0 + Math.min(h - 1, Math.floor((y + 0.5) / N * h));
    out[y * N + x] = m[sy * GRID + sx];
  }
  return out;
}

function dist(a: Mask, b: Mask): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] & b[i]) inter++; if (a[i] | b[i]) uni++; }
  return uni ? 1 - inter / uni : 0;
}

const subjects = rosterSubjects();
const raw: { key: string; m: Mask; a: Mask }[] = [];
for (const s of subjects) {
  const f = (s.paints as any).S?.idle?.[0];
  if (!f) continue;
  const m = maskOf(paintAtlas(f, GRID));
  raw.push({ key: s.key, m, a: aligned(m) });
}

const pairsRaw: number[] = [], pairsAli: number[] = [];
const nearest: Record<string, [string, number]> = {};
for (let i = 0; i < raw.length; i++) {
  let bk = "", bd = 1e9;
  for (let j = 0; j < raw.length; j++) {
    if (i === j) continue;
    const dr = dist(raw[i].m, raw[j].m), da = dist(raw[i].a, raw[j].a);
    if (i < j) { pairsRaw.push(dr); pairsAli.push(da); }
    if (da < bd) { bd = da; bk = raw[j].key; }
  }
  nearest[raw[i].key] = [bk, bd];
}

const q = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(`THE YARDSTICK — ${raw.length} shipped creatures, idle frame, grid ${GRID}`);
console.log(`  pairs: ${pairsRaw.length}\n`);
console.log(`                    mean    p05    p25   median    p95`);
const row = (n: string, xs: number[]): string =>
  `  ${n.padEnd(16)}${mean(xs).toFixed(3).padStart(6)}${q(xs,.05).toFixed(3).padStart(7)}` +
  `${q(xs,.25).toFixed(3).padStart(7)}${q(xs,.5).toFixed(3).padStart(9)}${q(xs,.95).toFixed(3).padStart(7)}`;
console.log(row("raw (shape+size)", pairsRaw));
console.log(row("aligned (shape)", pairsAli));

console.log(`\nCLOSEST EXISTING PAIRS (aligned) — the floor a perturbation must clear`);
const sorted = Object.entries(nearest).sort((a, b) => a[1][1] - b[1][1]).slice(0, 6);
for (const [k, [o, d]] of sorted) console.log(`  ${k.padEnd(12)} nearest ${o.padEnd(12)} d=${d.toFixed(3)}`);

console.log(`\nBAR: a perturbation is a NEW CREATURE if it moves the silhouette by about`);
console.log(`     the median between-creature distance (aligned ${q(pairsAli,.5).toFixed(3)}),`);
console.log(`     and is a HAT if it stays under the closest existing pair (${sorted[0][1][1].toFixed(3)}).`);
undo();
