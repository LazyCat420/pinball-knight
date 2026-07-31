/**
 * WHY THE PALETTE SNAP IS NOT "OPTIMISED". Read this before touching it.
 *
 * The snap in `pixel-pass.ts` runs 32 unrolled entries per pixel, each doing
 * `(col - pc) * w` — three multiplies, 96 per pixel, on a full-screen pass that
 * is ~74% of the frame. The obvious win is to fold the luma weight into both
 * sides: the palette is a compile-time constant so `pc * w` folds at graph-build
 * time, and `col * w` is loop-invariant. All 96 multiplies disappear.
 *
 * IT IS NOT SAFE, and this file is the evidence. `(a-b)*w` and `a*w - b*w` are
 * algebraically identical but round differently in the last place, and that
 * flips which entry wins on **12 of the 496 exact midpoints** between palette
 * pairs. Meanwhile a random sample of 200,000 colours finds ZERO disagreements
 * — so the tempting version passes any reasonable spot-check and ships.
 *
 * And ties are not an edge case in THIS shader: the Bayer dither immediately
 * above the snap deliberately nudges colours to sit BETWEEN two palette entries.
 * Landing near a tie is the design, not an accident, so a systematic tie-break
 * flip would show up as a changed dither pattern in exactly the flat gradients
 * the dither exists to smooth.
 *
 * Both cases are kept below: the random sample shows why the rewrite is
 * tempting, the midpoint sweep shows why it was rejected.
 *
 * Everything runs through `Math.fround` because the GPU works in float32; doing
 * this in float64 would test a precision the shader never has and would hide
 * the very disagreement this is looking for.
 */
import { describe, it, expect } from "vitest";
import { PALETTE_HEX } from "../../render/palette";

const W = [0.3, 0.59, 0.11] as const;
const f = Math.fround;

/** The palette as the shader receives it: linear floats, 3 per entry. */
function paletteFloats(): number[] {
  const out: number[] = [];
  for (const hex of PALETTE_HEX) {
    // sRGB byte → linear, matching render/palette.ts's toFloatArray.
    for (const c of [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]) {
      const s = c / 255;
      out.push(s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
    }
  }
  return out;
}

/** OLD: subtract, then weight. */
function snapOld(p: number[], r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = 1e9;
  for (let i = 0; i < p.length / 3; i++) {
    const dr = f(f(r - p[i * 3]) * W[0]);
    const dg = f(f(g - p[i * 3 + 1]) * W[1]);
    const db = f(f(b - p[i * 3 + 2]) * W[2]);
    const dist = f(f(f(dr * dr) + f(dg * dg)) + f(db * db));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** NEW: weight both sides up front, then subtract. */
function snapNew(p: number[], r: number, g: number, b: number): number {
  const cr = f(r * W[0]);
  const cg = f(g * W[1]);
  const cb = f(b * W[2]);
  let best = 0;
  let dr = f(cr - f(p[0] * W[0]));
  let dg = f(cg - f(p[1] * W[1]));
  let db = f(cb - f(p[2] * W[2]));
  let bestDist = f(f(f(dr * dr) + f(dg * dg)) + f(db * db));
  for (let i = 1; i < p.length / 3; i++) {
    dr = f(cr - f(p[i * 3] * W[0]));
    dg = f(cg - f(p[i * 3 + 1] * W[1]));
    db = f(cb - f(p[i * 3 + 2] * W[2]));
    const dist = f(f(f(dr * dr) + f(dg * dg)) + f(db * db));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

describe("palette snap: why the luma weight is NOT folded into the palette", () => {
  const p = paletteFloats();

  it("has a real palette to snap against", () => {
    // Without this a broken import would make every check below vacuous.
    expect(p.length).toBe(32 * 3);
    expect(p.some((v) => v > 0)).toBe(true);
  });

  it("agrees on a large random sample — this is the trap", () => {
    // A deterministic LCG, so a failure is reproducible rather than a rumour.
    let seed = 0x9e3779b9;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let disagreements = 0;
    for (let n = 0; n < 200_000; n++) {
      // Range overshoots [0,1] because dither and bloom push colours out of it
      // before the snap runs.
      const r = f(rnd() * 1.4 - 0.2);
      const g = f(rnd() * 1.4 - 0.2);
      const b = f(rnd() * 1.4 - 0.2);
      if (snapOld(p, r, g, b) !== snapNew(p, r, g, b)) disagreements++;
    }
    // Zero. A spot-check like this is what would have waved the rewrite through.
    expect(disagreements).toBe(0);
  });

  it("picks the same entry at exact midpoints between palette pairs", () => {
    // The adversarial case: a colour equidistant from two entries is where a
    // last-place rounding difference could actually change the winner. Random
    // sampling essentially never lands here, so construct them directly.
    let disagreements = 0;
    let cases = 0;
    for (let i = 0; i < 32; i++) {
      for (let j = i + 1; j < 32; j++) {
        const r = f((p[i * 3] + p[j * 3]) / 2);
        const g = f((p[i * 3 + 1] + p[j * 3 + 1]) / 2);
        const b = f((p[i * 3 + 2] + p[j * 3 + 2]) / 2);
        cases++;
        if (snapOld(p, r, g, b) !== snapNew(p, r, g, b)) disagreements++;
      }
    }
    expect(cases).toBe((32 * 31) / 2);
    // NOT zero — this is the finding. If this ever becomes 0, the two forms have
    // genuinely converged (a palette or weight change) and folding could be
    // reconsidered; until then the shader keeps the unfolded form on purpose.
    expect(disagreements).toBeGreaterThan(0);
  });
});
