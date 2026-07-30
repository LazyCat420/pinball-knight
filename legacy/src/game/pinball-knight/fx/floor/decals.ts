/**
 * The PRESENTATION half of the floor decals.
 *
 * ── THE SPLIT, AND WHY IT IS HERE ────────────────────────────────────────────
 * `entities/floor-fx.ts` owns real mechanics — burn damage-over-time, the chill
 * channel, the skid, oil ignition — and `floor-fx.test.ts` asserts them. Those
 * are simulation and they stay put. What moves into `fx/` is only the LOOK: what
 * material a kind wears, and how it is driven per frame.
 *
 * So this module answers exactly two questions:
 *   · does this kind have a shader, and if so which one; and
 *   · how do the live ones get their clock.
 *
 * ── WHY A REGISTRY AND NOT A SWITCH ─────────────────────────────────────────
 * A kind with no entry here keeps the old Canvas2D texture path. That is
 * deliberate: `groove` is a CUT in the stone and `shard-field` is glitter —
 * neither is a fluid, neither wants a noise field, and a groove trail stamps
 * ~50 decals a second, which is the one place per-instance graph building would
 * actually cost something. Absence from this table is a decision, not an
 * omission.
 *
 * ── THE CLOCK IS REAL TIME, NOT SIM TIME ────────────────────────────────────
 * `updateFloorFx` runs on the fixed sim step, which STOPS during a hit-freeze.
 * That is right for damage ticks and wrong for a flame: a fire that holds
 * perfectly still for 100ms every time you connect a hit reads as a dropped
 * frame. So the visual clock is advanced from `sim/loop.ts` on real frame time,
 * for the same reason `fx/system.ts` ticks its particles there — and the two now
 * agree, which they did not before.
 */
import type * as THREE from "three";
import type { FloorFxKind } from "../../state";
import { createFireMaterial } from "../elements/fire";
import { createWaterMaterial } from "../elements/water";
import { createFrostMaterial } from "../elements/frost";
import { createOilMaterial, createTarMaterial } from "../elements/goo";
import { createRodMaterial } from "../elements/rod";
import type { ElementMaterial } from "../elements/element";

/**
 * Shader-backed kinds. Each entry builds a FRESH material — see the note in
 * `elements/element.ts` for why cloning would fuse every instance's phase and
 * fade together.
 */
const FACTORIES: Partial<Record<FloorFxKind, () => ElementMaterial>> = {
  fire: () => createFireMaterial({ orientation: "floor" }),
  slick: () => createWaterMaterial(),
  frost: () => createFrostMaterial(),
  oil: () => createOilMaterial(),
  tar: () => createTarMaterial(),
  rod: () => createRodMaterial(),
};

/**
 * Peak alpha per shader kind.
 *
 * Water is raised from the flat tint's 0.45 to 0.62. The old value was chosen
 * for a SOLID colour, where 45% of one blue still reads as blue; a banded
 * surface at 45% lets the floor's own hue through strongly enough to win — on a
 * mossy biome the puddle came out green. 0.62 keeps some floor showing (it is a
 * shallow puddle, not paint) while letting the water's own ramp dominate.
 */
const ALPHA: Partial<Record<FloorFxKind, number>> = {
  fire: 0.85,
  slick: 0.62,
  // Carried over from the painted materials, except where a banded surface needs
  // more presence than a flat tint did at the same number (see slick above).
  oil: 0.85, // near-opaque: it must HIDE the floor to read as a pool, not a stain
  tar: 0.95, // the most opaque thing on the floor — nothing shows through tar
  frost: 0.7,
  rod: 0.9,
};

/** True when `kind` wears a shader rather than a painted canvas. */
export function hasElementShader(kind: FloorFxKind): boolean {
  return FACTORIES[kind] !== undefined;
}

/** Every shader-backed kind — the prewarm sweep needs the list, not the tests. */
export function elementShaderKinds(): FloorFxKind[] {
  return Object.keys(FACTORIES) as FloorFxKind[];
}

export function elementAlpha(kind: FloorFxKind, fallback: number): number {
  return ALPHA[kind] ?? fallback;
}

/**
 * Build the decal material for `kind`, or null if it has no shader.
 *
 * The handle is parked on `mesh.userData.element` by `attachElement` so the
 * per-frame tick can find it without widening the `FloorFx` record in state.ts —
 * the same trick `render/pinball-parts.ts` uses for its brazier flame.
 */
export function makeElementMaterial(kind: FloorFxKind): ElementMaterial | null {
  const f = FACTORIES[kind];
  if (!f) return null;
  const el = f();
  // Decorrelate. Without a seed every decal in a room shares one clock, and a
  // corridor of fires flickers in perfect unison — the artefact the torch
  // flip-book already avoids with a per-torch phase.
  el.uSeed.value = Math.random() * 1000;
  return el;
}

/** Park the handle on the mesh and register it for the visual tick. */
export function attachElement(mesh: THREE.Mesh, el: ElementMaterial): void {
  mesh.userData.element = el;
  live.add(el);
}

/** Read the handle back, if this mesh has one. */
export function elementOf(mesh: THREE.Mesh): ElementMaterial | null {
  return (mesh.userData.element as ElementMaterial | undefined) ?? null;
}

/**
 * Set a decal's master fade.
 *
 * Why this exists at all: a node material's alpha comes from its graph, so the
 * old `material.opacity = x` is a silent NO-OP on a shader decal — it would fade
 * nothing and the decal would sit at full strength until it despawned. Every
 * fade path has to come through here.
 */
export function setElementOpacity(mesh: THREE.Mesh, v: number): void {
  const el = elementOf(mesh);
  if (el) el.uOpacity.value = v;
}

/** How hot / how agitated this decal is, 0..1+. */
export function setElementIntensity(mesh: THREE.Mesh, v: number): void {
  const el = elementOf(mesh);
  if (el) el.uIntensity.value = v;
}

/**
 * Seconds since this decal landed — SIM time, deliberately.
 *
 * The two clocks are kept apart on purpose. A decal's gameplay LIFETIME is
 * simulation (it drives water's expanding impact ring, which must stay in step
 * with the splash that caused it), while the noise scroll is real time so the
 * surface keeps moving through a hit-freeze. Deriving one from the other looks
 * fine in a screenshot and is wrong in motion.
 */
export function setElementAge(mesh: THREE.Mesh, age: number): void {
  const el = elementOf(mesh) as { uAge?: { value: number } } | null;
  if (el?.uAge) el.uAge.value = age;
}

/**
 * Live materials, so the tick does not have to walk the scene graph.
 *
 * A Set of handles, released by `releaseElement`. Held STRONGLY on purpose: a
 * decal's dispose path is explicit (`floor-fx.ts` despawn), so a leak here would
 * be a real bug worth seeing rather than something a WeakSet should paper over.
 */
const live = new Set<ElementMaterial>();

export function releaseElement(mesh: THREE.Mesh): void {
  const el = elementOf(mesh);
  if (!el) return;
  live.delete(el);
  delete mesh.userData.element;
  el.dispose();
}

/** Count of live shader decals — for tests and the debug panel. */
export function liveElementCount(): number {
  return live.size;
}

/**
 * Where the room's nearest torch is, and how hard it is currently burning.
 *
 * `sim/loop.ts` already sorts the torch anchors by distance to the player every
 * frame in order to park six PointLights on the closest ones. Reusing the
 * nearest of those, rather than re-sorting or adding a light probe, is what buys
 * water its sliding specular glint for the cost of one uniform.
 */
let torchLevel = 1;
const torchAt = { x: 0, y: 1.2, z: 0 };

export function setElementTorch(level: number, x?: number, y?: number, z?: number): void {
  torchLevel = level;
  if (x !== undefined) {
    torchAt.x = x;
    torchAt.y = y ?? 1.2;
    torchAt.z = z ?? 0;
  }
}

/**
 * Freeze the visual clock.
 *
 * This lives in the shipped tick rather than in the dev lab because the lab
 * CANNOT do it correctly from outside. The lab's first attempt re-pinned `uTime`
 * from its own `requestAnimationFrame` callback, which is registered after the
 * game loop's — so each frame the loop advanced the clock and rendered, and only
 * then did the lab reset it. The rendered frames still moved. The measurement
 * that depends on this (`scripts/fx-motion.mjs`) reported a frozen control that
 * kept moving, and its signal-to-noise gate went red until this existed.
 *
 * A gate on the increment is the only version that actually holds the frame.
 */
let clockFrozen = false;

export function setElementClockFrozen(v: boolean): void {
  clockFrozen = v;
}

export function isElementClockFrozen(): boolean {
  return clockFrozen;
}

/**
 * Advance every live decal's visual clock. Called once per RENDERED frame from
 * `sim/loop.ts` with REAL frame time — the same clock the particles use, so a
 * flame keeps licking through a hit-freeze instead of holding a pose for 100ms
 * every time the player connects a hit.
 */
export function tickElements(dt: number): void {
  if (clockFrozen) return;
  for (const el of live) {
    el.uTime.value += dt;
    const w = el as { uTorch?: { value: number }; uTorchPos?: { value: { x: number; y: number; z: number } } };
    if (w.uTorch) w.uTorch.value = torchLevel;
    if (w.uTorchPos) {
      w.uTorchPos.value.x = torchAt.x;
      w.uTorchPos.value.y = torchAt.y;
      w.uTorchPos.value.z = torchAt.z;
    }
  }
}

/** Drop everything — floor teardown. Materials are disposed by their owners. */
export function clearElements(): void {
  live.clear();
}
