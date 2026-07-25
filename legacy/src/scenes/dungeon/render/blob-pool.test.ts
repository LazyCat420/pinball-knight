import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createBlobPool } from "./blob-pool";

function pool(initial = 4) {
  const scene = new THREE.Scene();
  return { scene, p: createBlobPool(scene, new THREE.Texture(), initial) };
}

/** Read a slot's translation back out of the instance matrix. */
function posOf(mesh: THREE.InstancedMesh, slot: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(slot, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

/** Read a slot's scale — zero means hidden. */
function scaleOf(mesh: THREE.InstancedMesh, slot: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(slot, m);
  return new THREE.Vector3().setFromMatrixScale(m);
}

describe("blob pool draws every shadow in one object", () => {
  it("adds exactly ONE mesh to the scene for any number of blobs", () => {
    const { scene, p } = pool();
    for (let i = 0; i < 4; i++) p.claim();
    // The whole point: 175 shadows used to be 175 meshes.
    expect(scene.children.filter((c) => c instanceof THREE.InstancedMesh)).toHaveLength(1);
  });

  it("parks unclaimed slots far below the floor", () => {
    // An unclaimed slot must not draw a shadow at the world origin — that
    // would put a floating dark blob in the middle of every floor.
    const { p } = pool();
    expect(posOf(p.mesh, 0).y).toBeLessThan(-100);
  });
});

describe("slot lifecycle", () => {
  it("places a claimed slot where asked", () => {
    const { p } = pool();
    const s = p.claim();
    p.place(s, 3, 0.02, -7);
    const at = posOf(p.mesh, s);
    expect(at.x).toBeCloseTo(3, 5);
    expect(at.z).toBeCloseTo(-7, 5);
  });

  it("hides with zero scale and restores the remembered position", () => {
    // Ramp hops hide the shadow mid-flight; showing it again must not require
    // the caller to re-send a position it already gave us.
    const { p } = pool();
    const s = p.claim();
    p.place(s, 5, 0.02, 5);
    p.setVisible(s, false);
    expect(scaleOf(p.mesh, s).x).toBeCloseTo(0, 5);
    p.setVisible(s, true);
    expect(scaleOf(p.mesh, s).x).toBeCloseTo(1, 5);
    expect(posOf(p.mesh, s).x).toBeCloseTo(5, 5);
  });

  it("recycles released slots instead of growing forever", () => {
    // A floor can spawn and kill thousands of zombies; the buffer must not
    // grow once per corpse.
    const { p } = pool();
    const a = p.claim();
    p.release(a);
    const b = p.claim();
    expect(b).toBe(a);
  });

  it("parks a released slot so a dead actor leaves no shadow", () => {
    const { p } = pool();
    const s = p.claim();
    p.place(s, 2, 0.02, 2);
    p.release(s);
    expect(posOf(p.mesh, s).y).toBeLessThan(-100);
  });
});

describe("growth preserves live blobs", () => {
  it("keeps existing positions when the pool outgrows its capacity", () => {
    // The regression this guards: growing reallocates the InstancedMesh, and
    // failing to copy the old matrices would teleport every living actor's
    // shadow to the origin the moment one extra zombie spawned.
    const { p } = pool(2);
    const a = p.claim();
    p.place(a, 9, 0.02, -4);
    // Force past the initial capacity.
    for (let i = 0; i < 8; i++) p.claim();
    const at = posOf(p.mesh, a);
    expect(at.x).toBeCloseTo(9, 5);
    expect(at.z).toBeCloseTo(-4, 5);
  });

  it("still returns usable slots after growing", () => {
    const { p } = pool(2);
    for (let i = 0; i < 10; i++) p.claim();
    const s = p.claim();
    p.place(s, 1, 0.02, 1);
    expect(posOf(p.mesh, s).x).toBeCloseTo(1, 5);
  });

  it("keeps ONE mesh in the scene after growing", () => {
    const { scene, p } = pool(2);
    for (let i = 0; i < 12; i++) p.claim();
    expect(scene.children.filter((c) => c instanceof THREE.InstancedMesh)).toHaveLength(1);
  });
});
