/**
 * LOAD WARM-UP — what the descent screen must have compiled before it closes.
 *
 * The bug these exist to prevent is invisible in every sense. `compileAsync`
 * walks `_projectObject`, which returns early on `object.visible === false`
 * (three: renderers/common/Renderer.js), and every pooled effect in this game
 * is constructed invisible. So the prewarm reached the pools, skipped all of
 * them, and reported success — while the first slash, bolt, ring, blade, sigil,
 * damage number and dash-ghost of a run each still compiled a pipeline in the
 * middle of a fight. Nothing threw; it just hitched.
 *
 * There is no renderer here, so these cannot assert "a pipeline was compiled".
 * What they CAN pin is the precondition that was missing: at reveal time one
 * representative of every pooled material is visible and unculled, and
 * afterwards every flag is back exactly where it was. That second half is not
 * paranoia — BoltPool ships with `frustumCulled` already false, so a restore
 * that assumed the three.js defaults would silently re-enable culling on it.
 *
 * DOM-free vitest environment, so `document` is shimmed with node-canvas — the
 * same trick render/monster-portrait.test.ts uses. `head.appendChild` is part
 * of the shim because the damage-text pool pulls in the pixel font injector.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createCanvas } from "canvas";
import * as THREE from "three";

const realDoc = (globalThis as { document?: unknown }).document;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(8, 8) : {}),
    head: { appendChild: () => {} },
    // Deliberately NO `fonts`: awaitPixelFonts early-returns without it, which
    // keeps this suite off the async font path entirely.
  };
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

/** Every object in the scene graph, with the two flags the reveal touches. */
function snapshotFlags(root: THREE.Object3D): Map<THREE.Object3D, { visible: boolean; frustumCulled: boolean }> {
  const m = new Map<THREE.Object3D, { visible: boolean; frustumCulled: boolean }>();
  root.traverse((o) => m.set(o, { visible: o.visible, frustumCulled: o.frustumCulled }));
  return m;
}

describe("vfx.warmupReveal exposes one representative per pool", () => {
  it("reveals exactly the pooled families the prewarm would otherwise skip", async () => {
    const { createVfx } = await import("./render/vfx");
    const scene = new THREE.Scene();
    const vfx = createVfx(scene);

    const before = snapshotFlags(scene);
    // Six pools ship their slots invisible (slash, bolt, ring, blade, sigil,
    // damage text) and the dash ghost has no live instance at load time, so it
    // gets a prototype. Anything less than 7 means a family is still cold.
    const hiddenBefore = [...before.values()].filter((s) => !s.visible).length;
    expect(hiddenBefore).toBeGreaterThanOrEqual(7);

    const restore = vfx.warmupReveal();
    const during = snapshotFlags(scene);

    const revealed = [...during.entries()].filter(([o, s]) => s.visible && !before.get(o)!.visible);
    expect(revealed).toHaveLength(7);
    // Unculled matters as much as visible: _projectObject frustum-tests meshes,
    // and a pool slot sitting at the origin is off-camera on most floors.
    for (const [o] of revealed) expect(o.frustumCulled, `${o.type} still frustum-culled`).toBe(false);

    restore();
    const after = snapshotFlags(scene);
    expect(after.size).toBe(before.size);
    for (const [o, s] of after) {
      expect(s, `${o.type} not restored`).toEqual(before.get(o));
    }

    vfx.dispose();
  });

  it("restores the ORIGINAL flags, not the three.js defaults", async () => {
    const { createVfx } = await import("./render/vfx");
    const scene = new THREE.Scene();
    const vfx = createVfx(scene);

    // BoltPool disables culling at construction (its line endpoints move, so
    // the bounding sphere lies). If the restore hardcoded `frustumCulled = true`
    // this is the assertion that catches it.
    const bolt = scene.children
      .flatMap((c) => c.children)
      .find((o) => (o as THREE.Line).isLine) as THREE.Line | undefined;
    expect(bolt, "no bolt line found in the vfx scene graph").toBeDefined();
    expect(bolt!.frustumCulled).toBe(false);

    vfx.warmupReveal()();
    expect(bolt!.frustumCulled).toBe(false);
    expect(bolt!.visible).toBe(false);

    vfx.dispose();
  });
});

describe("warmFloorFxReveal forces the lazy decal materials into existence", () => {
  it("adds one proxy per kind, reveals them, and hides them again", async () => {
    const { warmFloorFxReveal, disposeFloorFxAssets, FLOOR_FX_KINDS } = await import("./entities/floor-fx");
    const scene = new THREE.Scene();
    // DERIVED, not a literal. This assertion was `toHaveLength(5)` and broke the
    // day three new kinds landed — which is a test failing because the feature
    // WORKED. The point of the warm-up is "one proxy per kind, whatever the
    // kinds are", so that is what it now asserts.
    const kinds = FLOOR_FX_KINDS().length;

    const restore = warmFloorFxReveal(scene);
    const proxies = scene.children.filter((o) => (o as THREE.Mesh).isMesh);
    expect(proxies).toHaveLength(kinds);
    for (const p of proxies) {
      expect(p.visible).toBe(true);
      expect(p.frustumCulled).toBe(false);
    }

    restore();
    for (const p of proxies) expect(p.visible).toBe(false);

    // Called once per floor. If it built a fresh set each time, a deep run
    // would carpet the scene with dead proxies.
    const restore2 = warmFloorFxReveal(scene);
    expect(scene.children.filter((o) => (o as THREE.Mesh).isMesh)).toHaveLength(kinds);
    restore2();

    disposeFloorFxAssets();
  });
});

describe("floor-fx population is capped", () => {
  beforeEach(async () => {
    const { state } = await import("./state");
    state.scene = new THREE.Scene();
    state.dbgMaterialFloorFx = true;
    state.floorFx = [];
  });

  it("pins the array at FLOOR_FX_MAX and evicts the OLDEST", async () => {
    const { spawnFloorFx } = await import("./entities/floor-fx");
    const { FLOOR_FX_MAX } = await import("./constants");
    const { state } = await import("./state");

    const OVER = 50;
    // "slick" takes the untextured branch of matFor, which keeps this test off
    // the canvas path; the cap itself is kind-agnostic.
    for (let i = 0; i < FLOOR_FX_MAX + OVER; i++) spawnFloorFx("slick", i, 0, 0.5, 10);

    expect(state.floorFx).toHaveLength(FLOOR_FX_MAX);
    // Oldest-first eviction: x doubles as a spawn ordinal here.
    expect(state.floorFx[0].x).toBe(OVER);
    // carveGroove reads state.floorFx[length - 1] immediately after spawning to
    // stamp the cut's direction. Evicting from the FRONT is what keeps that
    // read pointing at the entry just made.
    expect(state.floorFx[state.floorFx.length - 1].x).toBe(FLOOR_FX_MAX + OVER - 1);
  });

  it("removes the evicted mesh from the scene instead of leaking it", async () => {
    const { spawnFloorFx } = await import("./entities/floor-fx");
    const { FLOOR_FX_MAX } = await import("./constants");
    const { state } = await import("./state");

    for (let i = 0; i < FLOOR_FX_MAX + 25; i++) spawnFloorFx("slick", i, 0, 0.5, 10);
    expect(state.scene!.children).toHaveLength(FLOOR_FX_MAX);
  });

  it("disposes the cloned material of an evicted entry", async () => {
    const { spawnFloorFx } = await import("./entities/floor-fx");
    const { FLOOR_FX_MAX } = await import("./constants");
    const { state } = await import("./state");

    spawnFloorFx("slick", -1, 0, 0.5, 10);
    const victim = state.floorFx[0].mesh.material as THREE.Material;
    let disposed = false;
    victim.addEventListener("dispose", () => {
      disposed = true;
    });

    // Push it off the front. Every spawn clones a material, so a bare splice
    // here would leak one per stamp — ~50/s while the ball is riding.
    for (let i = 0; i < FLOOR_FX_MAX; i++) spawnFloorFx("slick", i, 0, 0.5, 10);

    expect(state.floorFx.some((f) => f.x === -1)).toBe(false);
    expect(disposed, "evicted decal's material was never disposed").toBe(true);
  });
});
