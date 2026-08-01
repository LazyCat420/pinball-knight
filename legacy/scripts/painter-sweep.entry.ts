/**
 * DOES PERTURBING THE JESTER MAKE A NEW CREATURE, OR THE SAME ONE IN A HAT?
 *
 * Yardstick from painter-diversity.entry.ts, over the 20 shipped creatures
 * (aligned silhouette distance, 1 - IoU):
 *
 *     median between creatures   0.414   <- a genuinely different monster
 *     p05                        0.220
 *     closest shipping pair      0.042   <- spitter vs zombie, and the game
 *                                           already treats those as distinct
 *
 * So the bar: perturbation has to push the silhouette out toward 0.2-0.4. If it
 * clusters near 0.042 the dataset is twenty creatures with variations, and
 * training a model on it is not worth a month.
 *
 * THE NEGATIVE CONTROL IS THE POINT. Perturbing only the COLOUR ramps must move
 * the silhouette by ~0. If it doesn't, the metric is picking up something other
 * than shape and every number here is worthless.
 */
import { createCanvas } from "canvas";
import { writeFileSync } from "node:fs";
import { installSpriteTestDom, paintAtlas } from "../src/game/pinball-knight/testkit/atlas-census";
import { withRecoil } from "../src/game/pinball-knight/render/cel-painter";
import {
  makeJesterPaints, __perturb, __defaults, GEOM_KEYS, COLOUR_KEYS,
} from "../src/game/pinball-knight/render/monsters/jester.perturb";

const GRID = 63;
const undo = installSpriteTestDom();

type Mask = Uint8Array;
const maskOf = (img: any): Mask => {
  const m = new Uint8Array(GRID * GRID);
  for (let i = 0; i < GRID * GRID; i++) m[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;
  return m;
};
function aligned(m: Mask, N = 32): Mask {
  let x0 = GRID, y0 = GRID, x1 = -1, y1 = -1;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (m[y * GRID + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const out = new Uint8Array(N * N);
  if (x1 < 0) return out;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    out[y * N + x] = m[(y0 + Math.min(h - 1, Math.floor((y + .5) / N * h))) * GRID
                     + x0 + Math.min(w - 1, Math.floor((x + .5) / N * w))];
  return out;
}
/**
 * Connected components of the silhouette, 4-connectivity.
 *
 * ⚠️ THE DIVERSITY METRIC ALONE IS A TRAP. Silhouette distance goes UP when a
 * creature comes APART — perturbing HEAD_Y, HIP_Y and SPRING_IDLE independently
 * detaches the body from its own spring, and IoU scores that as maximum
 * novelty. Eyeballing the contact sheet is what caught it. Coherence is the
 * cheap objective version of that eyeball: the jester is ONE blob, and a sample
 * that is several blobs is wreckage, not a new monster.
 */
function components(m: Mask, W = 32): number {
  const seen = new Uint8Array(m.length);
  let n = 0;
  const stack: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue;
    n++; stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop() as number, x = p % W, y = (p / W) | 0;
      if (x > 0 && m[p-1] && !seen[p-1]) { seen[p-1] = 1; stack.push(p-1); }
      if (x < W-1 && m[p+1] && !seen[p+1]) { seen[p+1] = 1; stack.push(p+1); }
      if (y > 0 && m[p-W] && !seen[p-W]) { seen[p-W] = 1; stack.push(p-W); }
      if (y < W-1 && m[p+W] && !seen[p+W]) { seen[p+W] = 1; stack.push(p+W); }
    }
  }
  return n;
}

const dist = (a: Mask, b: Mask): number => {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) { if (a[k] & b[k]) i++; if (a[k] | b[k]) u++; }
  return u ? 1 - i / u : 0;
};

let seed = 20260801;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const DEFAULTS = __defaults();
function render(): { m: Mask; a: Mask; opaque: number } {
  const p = withRecoil(makeJesterPaints());
  const img = paintAtlas((p as any).S.idle[0], GRID);
  const m = maskOf(img);
  let n = 0; for (const v of m) n += v;
  return { m, a: aligned(m), opaque: n };
}

/** Reset every knob, then apply an override set. */
function setP(over: Record<string, unknown>): void {
  __perturb({ ...DEFAULTS, ...over });
}

/** Jitter the geometry knobs by +-`amp` (relative), keeping them positive. */
function geomJitter(amp: number): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of GEOM_KEYS) {
    const base = DEFAULTS[k] as number;
    o[k] = Math.max(1, base * (1 + (rnd() * 2 - 1) * amp));
  }
  return o;
}
/** Swap the colour ramps around the palette — the NEGATIVE CONTROL. */
function colourJitter(): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const fams = [[6,7,8],[10,11,12],[14,15,16],[19,20,21],[23,24,25],[26,27,28],[29,30,31]];
  for (const k of COLOUR_KEYS) {
    const base = DEFAULTS[k];
    o[k] = Array.isArray(base) ? fams[Math.floor(rnd() * fams.length)] : Math.floor(rnd() * 32);
  }
  return o;
}

setP({});
const BASE = render();
const BASE_COMPS = components(BASE.a);

const stat = (xs: number[]): string => {
  const s = [...xs].sort((a, b) => a - b);
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `mean ${m.toFixed(3)}  p05 ${s[Math.floor(.05*s.length)].toFixed(3)}` +
         `  median ${s[Math.floor(.5*s.length)].toFixed(3)}  p95 ${s[Math.floor(.95*s.length)].toFixed(3)}  max ${s[s.length-1].toFixed(3)}`;
};

const N = 200;
console.log(`jester perturbation sweep — ${N} samples per arm, grid ${GRID}`);
console.log(`base silhouette: ${BASE.opaque} opaque texels, ${BASE_COMPS} connected blob(s)\n`);

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────
{
  const d: number[] = [];
  for (let i = 0; i < N; i++) { setP(colourJitter()); d.push(dist(BASE.a, render().a)); }
  console.log(`NEGATIVE CONTROL  colour ramps only`);
  console.log(`  ${stat(d)}`);
  console.log(`  -> must be ~0. Anything else and the metric is not measuring shape.\n`);
}

// ── GEOMETRY, at several amplitudes ─────────────────────────────────────────
const collected: Record<string, Mask[]> = {};
for (const amp of [0.15, 0.30, 0.50]) {
  const d: number[] = [], keep: Mask[] = [];
  let dead = 0;
  for (let i = 0; i < N; i++) {
    setP(geomJitter(amp));
    const r = render();
    if (r.opaque < 40) { dead++; continue; }   // degenerate / off-cel
    d.push(dist(BASE.a, r.a));
    keep.push(r.a);
  }
  collected[String(amp)] = keep;
  const comps = keep.map((k) => components(k));
  const coherent = comps.filter((c) => c <= BASE_COMPS).length;
  console.log(`GEOMETRY  +-${(amp*100).toFixed(0)}%   (${dead} degenerate of ${N})`);
  console.log(`  COHERENT (<=${BASE_COMPS} blobs, like the base): ${coherent}/${keep.length} = ${(coherent/keep.length*100).toFixed(0)}%` +
              `   mean blobs ${(comps.reduce((a,b)=>a+b,0)/comps.length).toFixed(2)}`);
  // ...and the diversity of ONLY the coherent ones, which is the number that
  // actually matters for a training set.
  const ok = keep.filter((_, i) => comps[i] <= BASE_COMPS);
  const pwOk: number[] = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < Math.min(ok.length, i + 25); j++)
    pwOk.push(dist(ok[i], ok[j]));
  if (pwOk.length) console.log(`  spread among COHERENT only: ${stat(pwOk)}`);
  console.log(`  vs base:  ${stat(d)}`);
  // spread AMONG the perturbations, not just against base — a cloud that all
  // moved the same direction is one new creature, not many.
  const pw: number[] = [];
  for (let i = 0; i < keep.length; i++) for (let j = i + 1; j < Math.min(keep.length, i + 25); j++)
    pw.push(dist(keep[i], keep[j]));
  console.log(`  among themselves: ${stat(pw)}\n`);
}

// ── HOW MANY DISTINCT CREATURES DOES ONE PAINTER YIELD? ─────────────────────
// Greedy dedupe at 0.042 -- the distance at which THIS GAME already ships two
// monsters (spitter, zombie) as separate creatures. Using the game's own
// standard rather than a threshold picked to flatter the answer.
for (const amp of ["0.3", "0.5"]) {
  const pool = collected[amp];
  const uniq: Mask[] = [];
  for (const m of pool) if (uniq.every((u) => dist(u, m) > 0.042)) uniq.push(m);
  console.log(`DISTINCT at the game's own floor (0.042), +-${(+amp*100).toFixed(0)}%: ` +
    `${uniq.length} of ${pool.length} samples survive dedupe`);
}
console.log();

// ── CONTACT SHEET, so a human can say whether they are CREATURES or WRECKAGE ─
{
  const COLS = 8, ROWS = 4, Z = 3, PAD = 4;
  const cv = createCanvas(COLS * (GRID * Z + PAD) + PAD, ROWS * (GRID * Z + PAD) + PAD);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  seed = 4242;
  for (let i = 0; i < COLS * ROWS; i++) {
    setP(i === 0 ? {} : geomJitter(i < COLS * 2 ? 0.30 : 0.50));
    const img = paintAtlas((withRecoil(makeJesterPaints()) as any).S.idle[0], GRID);
    const cell = createCanvas(GRID, GRID);
    cell.getContext("2d").putImageData(img, 0, 0);
    ctx.drawImage(cell, PAD + (i % COLS) * (GRID * Z + PAD), PAD + Math.floor(i / COLS) * (GRID * Z + PAD), GRID * Z, GRID * Z);
  }
  writeFileSync(process.env.SWEEP_OUT || "scratchpad/perturbed.png", cv.toBuffer("image/png"));
  console.log("contact sheet -> " + (process.env.SWEEP_OUT || "scratchpad/perturbed.png"));
  console.log("  row 1 col 1 = unperturbed base; rows 1-2 = +-30%; rows 3-4 = +-50%\n");
}

console.log(`YARDSTICK (20 shipped creatures, same metric):`);
console.log(`  median between creatures 0.414   p05 0.220   closest pair 0.042`);
undo();
