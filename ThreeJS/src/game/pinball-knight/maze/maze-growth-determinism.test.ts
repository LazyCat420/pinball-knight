import { describe, expect, it, vi } from "vitest";
import { growMazeAround, carveStroke, type TrackMask } from "./track-carve";
import { type Grid, T_FLOOR } from "./generator";
import { mulberry32 } from "../../../utils/rng";

// Two valid sorting implementations may perform different comparisons. Neither
// is allowed to change a seeded maze or the remaining RNG stream.
const nativeSort = Array.prototype.sort;
function insertionSort<T>(this: T[], compare?: (a: T, b: T) => number): T[] {
  if (!compare) return nativeSort.call(this) as T[];
  for (let i = 1; i < this.length; i++) {
    const item = this[i];
    let j = i;
    while (j > 0 && compare(this[j - 1], item) > 0) {
      this[j] = this[j - 1];
      j--;
    }
    this[j] = item;
  }
  return this;
}

function grow(seed: number, alternateSort: boolean) {
  const g: Grid = { w: 31, h: 25, t: new Uint8Array(775), shapes: new Uint8Array(775) };
  const mask: TrackMask = { lane: new Uint8Array(775), sealed: new Uint8Array(775), dist: new Float32Array(775).fill(Infinity) };
  carveStroke(g, mask, 15, 1, 15, 23, 1);
  const rng = mulberry32(seed);
  const spy = alternateSort ? vi.spyOn(Array.prototype, "sort").mockImplementation(insertionSort) : null;
  try {
    growMazeAround(g, mask, rng, { fill: .8 });
  } finally {
    spy?.mockRestore();
  }
  return { tiles: g.t, nextDraw: rng() };
}

describe("maze growth RNG is independent of sorting implementation", () => {
  for (const seed of [1, 42, 424242]) {
    it(`preserves tiles and subsequent draws for seed ${seed}`, () => {
      const a = grow(seed, false);
      expect(a.tiles.filter((t) => t === T_FLOOR).length).toBeGreaterThan(100);
      expect(grow(seed, true)).toEqual(a);
    });
  }
});
