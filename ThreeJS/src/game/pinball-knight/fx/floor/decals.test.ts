/**
 * The decal plumbing — and specifically the two failures that render perfectly.
 *
 * Both of the bugs guarded here produce a screenshot a reviewer would sign off:
 *
 *  1. **A frozen shader.** If nothing advances `uTime`, the fire is a beautiful
 *     still image. A single-frame comparison PASSES it. So the wiring itself is
 *     asserted at the source level — if a refactor drops the `tickElements` call
 *     out of the frame loop, this goes red instead of the effect going quietly
 *     dead.
 *  2. **A no-op fade.** A node material's alpha comes from its graph, so the old
 *     `material.opacity = x` silently does nothing. A decal would sit at full
 *     strength for its whole life and then vanish. Nothing throws.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { FLOOR_FX_KINDS } from "../../entities/floor-fx";
import type { FloorFxKind } from "../../state";
import {
  attachElement,
  clearElements,
  elementAlpha,
  elementOf,
  elementShaderKinds,
  hasElementShader,
  liveElementCount,
  makeElementMaterial,
  releaseElement,
  setElementAge,
  setElementIntensity,
  setElementOpacity,
  setElementTorch,
  tickElements,
} from "./decals";

const HERE = join(process.cwd(), "src/game/pinball-knight");

function decal(kind: "fire" | "slick"): THREE.Mesh {
  const el = makeElementMaterial(kind)!;
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 8), el.material);
  attachElement(mesh, el);
  return mesh;
}

beforeEach(() => clearElements());

describe("the shader registry", () => {
  it("covers fire and water, and deliberately not the groove or fissure", () => {
    expect(hasElementShader("fire")).toBe(true);
    expect(hasElementShader("slick")).toBe(true);
    // `groove` and `fissure` are cuts and fractures in stone, not fluids.
    // Their absence from element shaders is a deliberate performance decision.
    expect(hasElementShader("coffee")).toBe(false);
    expect(hasElementShader("groove")).toBe(false);
    expect(hasElementShader("fissure")).toBe(false);
    expect(hasElementShader("shard-field")).toBe(false);
  });

  it("reports its kinds so the prewarm sweep can find them", () => {
    expect(elementShaderKinds().sort()).toEqual(["fire", "frost", "molten", "oil", "rod", "slick", "tar"]);
  });

  it("covers every FLUID kind — only the non-substances are left on canvas", () => {
    // Stated as a complement rather than a list, so adding a new FloorFxKind
    // forces a decision here instead of silently defaulting to the canvas path.
    // `groove` and `fissure` are stone scars, `shard-field` is glitter,
    // `coffee` uses a dedicated canvas painter with crema swirl & steam motes,
    // and `rot` is a decomposing sludge puddle decal.
    const canvas = FLOOR_FX_KINDS().filter((k: FloorFxKind) => !hasElementShader(k));
    expect(canvas.sort()).toEqual(["coffee", "fissure", "groove", "rot", "shard-field"]);
  });

  it("builds a working material for every registered kind", () => {
    // The registry is the only thing standing between a kind and a black quad:
    // a factory that throws or returns a graph three cannot compile shows up as
    // nothing rendered, with no error.
    for (const kind of elementShaderKinds()) {
      const el = makeElementMaterial(kind);
      expect(el, `${kind} produced no material`).not.toBeNull();
      expect(el!.material.colorNode, `${kind} built no colour graph`).toBeTruthy();
      expect(el!.material.transparent).toBe(true);
      expect(el!.material.depthWrite).toBe(false);
      el!.dispose();
    }
  });

  it("keeps tar the most opaque and additive reserved for the glowing kinds", () => {
    // Tar's whole job is to look inert and hide the floor; oil's is to look
    // inviting. If tar ever becomes the more translucent of the two, the pair
    // stops teaching the player anything.
    expect(elementAlpha("tar", 0)).toBeGreaterThan(elementAlpha("slick", 0));
    const additive = 2; // THREE.AdditiveBlending
    const normal = 1; // THREE.NormalBlending
    const blendOf = (k: "fire" | "frost" | "rod" | "oil" | "tar" | "slick" | "molten") => {
      const el = makeElementMaterial(k)!;
      const b = el.material.blending;
      el.dispose();
      return b;
    };
    // Glowing: fire, frost (glows COLD) and the rod all feed the bloom.
    for (const k of ["fire", "frost", "rod"] as const) expect(blendOf(k), k).toBe(additive);
    // Surfaces: additive water would read as lava, additive oil as a lava slick,
    // and additive tar would defeat the entire point of tar.
    for (const k of ["slick", "oil", "tar"] as const) expect(blendOf(k), k).toBe(normal);
    // …and MOLTEN is a surface too, which is the whole distinction between it
    // and the fire puddle it sits next to. A melt scar is floor that SLUMPED —
    // it has to darken the tile. Additive cannot darken anything, so an
    // additive molten is just a fire puddle wearing a different name, which is
    // exactly what the lava trail was before this kind existed.
    expect(blendOf("molten")).toBe(normal);
  });

  it("keeps fire's peak alpha well above water's", () => {
    // Fire is additive and must dominate; water is a surface tint. If these ever
    // converge, one of the two is wearing the wrong material.
    expect(elementAlpha("fire", 0)).toBeGreaterThan(elementAlpha("slick", 0));
  });

  it("falls through to the painted path for unregistered kinds", () => {
    expect(makeElementMaterial("groove")).toBeNull();
  });
});

describe("per-instance independence", () => {
  it("gives every decal its own seed, so a corridor does not flicker in unison", () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 12; i++) seeds.add(makeElementMaterial("fire")!.uSeed.value);
    // Seeded from Math.random(); 12 draws colliding is effectively impossible.
    expect(seeds.size).toBeGreaterThan(10);
  });

  it("fades one decal without touching its siblings", () => {
    const a = decal("fire");
    const b = decal("fire");
    setElementOpacity(a, 0.25);
    expect(elementOf(a)!.uOpacity.value).toBe(0.25);
    // The reason materials are rebuilt rather than cloned: a NodeMaterial clone
    // shares its uniform NODES, so this would read 0.25 and every fire in the
    // room would fade together.
    expect(elementOf(b)!.uOpacity.value).toBe(1);
  });

  it("carries intensity and age per decal", () => {
    const a = decal("fire");
    const b = decal("slick");
    setElementIntensity(a, 1.4);
    setElementAge(b, 2.5);
    expect(elementOf(a)!.uIntensity.value).toBe(1.4);
    expect((elementOf(b) as unknown as { uAge: { value: number } }).uAge.value).toBe(2.5);
  });

  it("ignores age on a kind that has no impact ring", () => {
    // fire has no uAge; the setter must be a no-op, not a crash.
    const a = decal("fire");
    expect(() => setElementAge(a, 3)).not.toThrow();
  });
});

describe("the visual clock", () => {
  it("advances every live decal", () => {
    const a = decal("fire");
    const b = decal("slick");
    tickElements(0.5);
    tickElements(0.25);
    expect(elementOf(a)!.uTime.value).toBeCloseTo(0.75, 6);
    expect(elementOf(b)!.uTime.value).toBeCloseTo(0.75, 6);
  });

  it("stops advancing a released decal", () => {
    const a = decal("fire");
    const el = elementOf(a)!;
    releaseElement(a);
    tickElements(1);
    expect(el.uTime.value).toBe(0);
    expect(liveElementCount()).toBe(0);
    expect(elementOf(a)).toBeNull();
  });

  it("pushes the torch position and level into water only", () => {
    const w = decal("slick");
    const f = decal("fire");
    setElementTorch(0.5, 3, 1.2, -4);
    tickElements(0.016);
    const el = elementOf(w) as unknown as {
      uTorch: { value: number };
      uTorchPos: { value: { x: number; z: number } };
    };
    expect(el.uTorch.value).toBe(0.5);
    expect(el.uTorchPos.value.x).toBe(3);
    expect(el.uTorchPos.value.z).toBe(-4);
    // Fire has no torch handles; the tick must skip them silently.
    expect((elementOf(f) as unknown as { uTorch?: unknown }).uTorch).toBeUndefined();
  });

  /**
   * THE NEGATIVE CONTROL FOR A FROZEN SHADER.
   *
   * Everything above proves `tickElements` works when called. This proves it is
   * actually called — the failure the unit tests structurally cannot see. Delete
   * the call from the frame loop and the effects freeze while every other test
   * in this file still passes, so the assertion has to be about the source.
   *
   * Same technique as `engine/purity.test.ts`: read the file, assert on it.
   */
  it("is driven from the rendered-frame loop, on REAL frame time", () => {
    const loop = readFileSync(join(HERE, "sim/loop.ts"), "utf8");
    expect(loop).toMatch(/tickElements\(frame\)/);
    // `frame` is the real elapsed time; `dt` in this file is the fixed sim step.
    // Ticking on the sim step would freeze every flame during a hit-freeze.
    expect(loop).not.toMatch(/tickElements\(dt\)/);
  });

  it("does not reach for TSL's own time uniform anywhere in fx/", () => {
    // `time` from three/tsl is fed by nodeFrame.update(), which three calls only
    // from its INTERNAL rAF loop. This game drives its own rAF and never calls
    // setAnimationLoop — the drawCall-accumulation bug documented in sim/loop.ts
    // is the same root cause, measured. A shader clocked on `time` renders a
    // perfectly static flame with zero errors.
    for (const f of ["elements/fire.ts", "elements/water.ts", "elements/noise.ts", "floor/decals.ts"]) {
      const src = readFileSync(join(HERE, "fx", f), "utf8");
      // Only the specifier list, not the prose — "compile-time" and "real time"
      // are all over the comments in these files by design.
      const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"three\/tsl"/g)]
        .flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
      expect(imports, `${f} imports TSL time`).not.toContain("time");
    }
  });
});
