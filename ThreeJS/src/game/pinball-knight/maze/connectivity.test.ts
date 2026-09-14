import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { connectAll } from "./connectivity";
import { type Grid, T_FLOOR, isWalkable } from "./generator";
import { bfsDistancesOwned } from "../engine/flow-field";

function blank(w: number, h: number): Grid {
  return { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };
}
const noRng = () => { throw new Error("Connectivity must not consume RNG"); };

function expectConnected(g: Grid, start: number): void {
  const dist = bfsDistancesOwned(g, start % g.w, Math.floor(start / g.w));
  let stranded = 0;
  for (let k = 0; k < g.t.length; k++) {
    if (isWalkable(g, k % g.w, Math.floor(k / g.w)) && dist[k] < 0) stranded++;
  }
  expect(stranded).toBe(0);
}

describe("connectivity repair", () => {
  it("preserves the pre-optimization corridors on 100 seeded masked/unmasked grids", () => {
    // Captured from main 11ba7ede before replacing its connectivity algorithm.
    const hash = createHash("sha256");
    for (let seed = 1; seed <= 100; seed++) {
      let r = seed;
      const rng = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
      const g = blank(11 + seed % 19, 13 + seed % 23);
      const avoid = new Uint8Array(g.t.length);
      for (let j = 1; j < g.h - 1; j++) for (let i = 1; i < g.w - 1; i++) {
        g.t[j * g.w + i] = rng() < .32 ? T_FLOOR : 0;
        avoid[j * g.w + i] = rng() < .3 ? 1 : 0;
      }
      connectAll(g, noRng, seed % 2 ? avoid : undefined);
      expectConnected(g, g.t.indexOf(T_FLOOR));
      hash.update(g.t);
    }
    expect(hash.digest("hex")).toBe("77982273c6d9935e85685d19a28add7fd616a9c004790596f25f75f8f2c22272");
  });

  it("joins over 400 isolated pockets without carving the boundary", () => {
    const g = blank(65, 65);
    for (let j = 1; j < g.h - 1; j += 2) for (let i = 1; i < g.w - 1; i += 2) g.t[j * g.w + i] = T_FLOOR;
    expect(g.t.filter(t => t === T_FLOOR).length).toBe(1024);
    connectAll(g, noRng);
    expectConnected(g, g.w + 1);
    for (let i = 0; i < g.w; i++) expect(g.t[i] + g.t[(g.h - 1) * g.w + i]).toBe(0);
    for (let j = 0; j < g.h; j++) expect(g.t[j * g.w] + g.t[j * g.w + g.w - 1]).toBe(0);
    const before = g.t.slice();
    connectAll(g, noRng);
    expect(g.t).toEqual(before);
  });

  it("routes around protected walls, but retries when a complete barrier separates pockets", () => {
    const g = blank(9, 7);
    g.t[3 * g.w + 2] = g.t[3 * g.w + 6] = T_FLOOR;
    const avoid = new Uint8Array(g.t.length);
    avoid[3 * g.w + 4] = 1;
    connectAll(g, noRng, avoid);
    expect(g.t[3 * g.w + 4]).toBe(0);
    expectConnected(g, 3 * g.w + 2);
    const sealed = blank(9, 7);
    sealed.t[3 * g.w + 2] = sealed.t[3 * g.w + 6] = T_FLOOR;
    for (let j = 1; j < g.h - 1; j++) avoid[j * g.w + 4] = 1;
    connectAll(sealed, noRng, avoid);
    expectConnected(sealed, 3 * g.w + 2);
    expect(sealed.t[3 * g.w + 4]).toBe(T_FLOOR);
  });

  it("leaves empty and already connected maps unchanged", () => {
    for (const fill of [0, T_FLOOR]) {
      const g = blank(8, 6); g.t.fill(fill);
      const before = g.t.slice();
      connectAll(g, noRng);
      expect(g.t).toEqual(before);
    }
  });
});
