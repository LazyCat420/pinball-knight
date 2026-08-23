/**
 * The puff pool — and the one trap that renders catastrophically.
 *
 * `SpriteNodeMaterial.positionNode` is the sprite's CENTRE and nothing else. The
 * material supplies the quad corners itself, so adding `positionLocal` leaks the
 * ±0.5 corner into the centre in UNSCALED WORLD UNITS — every particle becomes a
 * ~1-world-unit slab regardless of its size. That is documented in
 * `fx/pools/particle-pool.ts` because it already happened once there; a new pool copying the
 * wiring is exactly where it would happen again, so the wiring is asserted.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PuffPool, SMOKE, STEAM, makeSmokePool, makeSteamPool } from "./puffs";
import { palLin } from "./color";

function spawnOne(p: PuffPool, life = 1): void {
  p.spawn(0, 0, 0, 0, 0, 0, [1, 1, 1], 8, life, SMOKE.rise, SMOKE.drag);
}

describe("PuffPool", () => {
  it("wires positionNode as the BARE offset attribute", () => {
    const p = makeSmokePool(4);
    const mat = (p.points.material as unknown as { positionNode: { name?: string } | null }).positionNode;
    expect(mat, "positionNode was not set — particles would all sit at the origin").toBeTruthy();
    p.dispose();
  });

  it("keeps the instanced attributes the shader reads", () => {
    const p = makeSmokePool(4);
    const g = p.points.geometry;
    // `aAge` and `aSeed` are what make the erosion work; a pool missing them
    // builds and renders, just with a frozen threshold and identical shapes.
    for (const name of ["aOffset", "aColor", "aSize", "aAlpha", "aAge", "aSeed"]) {
      expect(g.getAttribute(name), `${name} missing`).toBeTruthy();
    }
    // NOT "position" — that name belongs to the quad's own four vertices.
    expect(g.getAttribute("position").count, "the quad should still be a quad").toBe(4);
    p.dispose();
  });

  it("is visible and unculled, so the descent prewarm can reach it", () => {
    // `compileAsync` returns early on `visible === false` and frustum-tests
    // meshes. A pool that fails either is compiled COLD on its first puff, in the
    // middle of whatever caused it. This is why the puff pools are deliberately
    // NOT added to `warmupReveal` — they never needed revealing.
    for (const p of [makeSmokePool(4), makeSteamPool(4)]) {
      expect(p.points.visible).toBe(true);
      expect(p.points.frustumCulled).toBe(false);
      p.dispose();
    }
  });

  it("retires a puff when its life runs out", () => {
    const p = makeSmokePool(4);
    spawnOne(p, 0.5);
    expect(p.liveCount()).toBe(1);
    p.update(0.6);
    expect(p.liveCount()).toBe(0);
    p.dispose();
  });

  it("advances aAge from 0 toward 1 across the life", () => {
    // The erosion threshold is driven ENTIRELY by this. If it never moves, the
    // puff holds one shape and pops out of existence — which looks like a bug in
    // the shader rather than in the pool.
    const p = makeSmokePool(4);
    spawnOne(p, 1);
    const age = () => p.points.geometry.getAttribute("aAge").getX(0);
    expect(age()).toBe(0);
    p.update(0.5);
    expect(age()).toBeGreaterThan(0.4);
    expect(age()).toBeLessThan(0.6);
    p.dispose();
  });

  it("gives every puff a different seed", () => {
    const p = makeSmokePool(16);
    for (let i = 0; i < 8; i++) spawnOne(p);
    const seeds = new Set<number>();
    for (let i = 0; i < 8; i++) seeds.add(p.points.geometry.getAttribute("aSeed").getX(i));
    expect(seeds.size).toBeGreaterThan(6);
    p.dispose();
  });

  it("RISES rather than falls", () => {
    // Kept as its own `rise` field rather than a negative gravity precisely so
    // the sign cannot be misread — smoke that sinks is the most obvious possible
    // wrongness and the easiest to introduce.
    const p = makeSmokePool(4);
    spawnOne(p, 5);
    const y = () => p.points.geometry.getAttribute("aOffset").getY(0);
    const y0 = y();
    for (let i = 0; i < 30; i++) p.update(0.016);
    expect(y(), "smoke sank").toBeGreaterThan(y0);
    p.dispose();
  });

  it("EXPANDS as it ages, unlike a spark which shrinks", () => {
    const p = makeSmokePool(4);
    spawnOne(p, 2);
    const size = () => p.points.geometry.getAttribute("aSize").getX(0);
    const s0 = size();
    for (let i = 0; i < 40; i++) p.update(0.016);
    expect(size()).toBeGreaterThan(s0);
    p.dispose();
  });

  it("wraps its ring buffer instead of growing", () => {
    const p = makeSmokePool(3);
    for (let i = 0; i < 10; i++) spawnOne(p, 5);
    expect(p.liveCount()).toBe(3);
    p.dispose();
  });

  it("blends steam additively and smoke normally", () => {
    // The single cue that separates them at a glance: steam's pale core crosses
    // the pass's bloom threshold and halos; smoke occludes.
    const smoke = makeSmokePool(2);
    const steam = makeSteamPool(2);
    expect((smoke.points.material as THREE.Material).blending).toBe(THREE.NormalBlending);
    expect((steam.points.material as THREE.Material).blending).toBe(THREE.AdditiveBlending);
    smoke.dispose();
    steam.dispose();
  });

  it("keeps smoke CLEARLY brighter than the stone it drifts in front of", () => {
    // The regression this exists for: the first version used stone dark (2),
    // stone mid (3) and steel dark (19) because that is what smoke IS — and those
    // are the exact entries the Cold Crypt's floor and walls are painted from. The
    // smoke was the colour of its own background and was effectively invisible; a
    // whole-frame diff measured it changing 1.16% of channels while being
    // impossible to find by eye.
    //
    // Smoke in a dark room is visible because it SCATTERS torchlight. Dark smoke
    // is right against a bright sky and wrong against dark stone.
    const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const floorish = Math.max(luma(palLin(2)), luma(palLin(3)), luma(palLin(19)));
    for (const c of SMOKE.colors) {
      expect(luma(c), "a smoke colour is no brighter than the dungeon's stone").toBeGreaterThan(floorish * 2);
    }
  });

  it("keeps steam paler than smoke, so the two never trade places", () => {
    const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const meanLuma = (cs: readonly (readonly number[])[]) => cs.reduce((a, c) => a + luma(c), 0) / cs.length;
    expect(meanLuma(STEAM.colors)).toBeGreaterThan(meanLuma(SMOKE.colors));
  });

  it("makes puffs big enough to HAVE a shape for the erosion to eat", () => {
    // A spark reads at 3-5px because it is a point of light. A puff whose alpha is
    // a noise threshold needs enough texels for the HOLES to be legible.
    //
    // 30 is not a round number picked for comfort: 16-26 shipped and was
    // measurably invisible — a whole-frame diff put the smoke below the ambient
    // torch flicker, and it took a deliberately absurd 200px run to prove the
    // pipeline worked. Anything that drops these back under ~30 is reintroducing
    // that bug, which no unit test of the pool itself can see.
    expect(SMOKE.size[0]).toBeGreaterThanOrEqual(30);
    expect(STEAM.size[0]).toBeGreaterThanOrEqual(30);
  });

  it("gives steam a shorter life and a faster rise than smoke", () => {
    // Steam is a brief scald; smoke lingers. If these ever converge the two stop
    // being distinguishable and the palette difference is doing all the work.
    expect(STEAM.rise).toBeGreaterThan(SMOKE.rise);
    expect(STEAM.life[1]).toBeLessThan(SMOKE.life[1]);
  });
});
