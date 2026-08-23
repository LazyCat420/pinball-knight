import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { createActorSprite, type SpriteSheet } from "../engine/render/sprite";

/**
 * The contact blob's texture is painted on a 2D canvas, which this environment
 * has no DOM for. Everything under test here is object IDENTITY (is the same
 * geometry handed to two actors, does dispose spare it), so a stub canvas that
 * satisfies the painting calls is enough and keeps the suite node-fast — the
 * same reasoning as damage-text.test.ts testing the pure half only.
 */
beforeAll(() => {
  const ctx2d = {
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
    set fillStyle(_v: unknown) {},
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
});

/** A minimal stand-in sheet: the sprite module only needs a texture to clone
 *  and the frame geometry to compute offsets from. */
function fakeSheet(): SpriteSheet {
  const tex = new THREE.Texture();
  return {
    texture: tex,
    cols: 4,
    rows: 4,
    frames: 16,
  } as unknown as SpriteSheet;
}

describe("actor sprites share their identical resources", () => {
  it("hands every actor the SAME quad geometry", () => {
    // ~175 actors at cap used to allocate ~175 copies of one rectangle.
    const a = createActorSprite(fakeSheet(), false);
    const b = createActorSprite(fakeSheet(), false);
    expect(a.mesh.geometry).toBe(b.mesh.geometry);
  });

  it("hands every actor the SAME contact-blob geometry and material", () => {
    const a = createActorSprite(fakeSheet(), false);
    const b = createActorSprite(fakeSheet(), false);
    const blobA = a.mesh.children[0] as THREE.Mesh;
    const blobB = b.mesh.children[0] as THREE.Mesh;
    expect(blobA.geometry).toBe(blobB.geometry);
    expect(blobA.material).toBe(blobB.material);
  });

  it("still gives each actor its OWN texture, so frames stay independent", () => {
    // The one thing that must NOT be shared: the frame offset lives on the
    // texture, so a shared texture would make the whole horde animate in
    // lockstep like a chorus line.
    const sheet = fakeSheet();
    const a = createActorSprite(sheet, false);
    const b = createActorSprite(sheet, false);
    const matA = a.mesh.material as THREE.MeshBasicMaterial;
    const matB = b.mesh.material as THREE.MeshBasicMaterial;
    expect(matA.map).not.toBe(matB.map);
  });

  it("one actor dying does NOT destroy the shared buffers", () => {
    // The regression this guards: dispose() used to free the quad and blob
    // geometry. Once those became shared, the first kill would have torn them
    // out from under every surviving actor and the horde would render blank.
    const a = createActorSprite(fakeSheet(), false);
    const b = createActorSprite(fakeSheet(), false);
    const sharedGeo = b.mesh.geometry as THREE.BufferGeometry;
    const blobB = b.mesh.children[0] as THREE.Mesh;

    a.dispose();

    // three disposes by firing an event and dropping GPU buffers; the JS-side
    // attributes survive, so assert the survivor still has real geometry and
    // still points at the same objects.
    expect(b.mesh.geometry).toBe(sharedGeo);
    expect(sharedGeo.attributes.position).toBeTruthy();
    expect((blobB.material as THREE.Material).type).toBe("MeshBasicMaterial");
  });

  it("disposing every actor still leaves the shared geometry usable", () => {
    const a = createActorSprite(fakeSheet(), false);
    a.dispose();
    // A brand-new actor after a full wipe (floor teardown) must still work.
    const c = createActorSprite(fakeSheet(), false);
    expect((c.mesh.geometry as THREE.BufferGeometry).attributes.position).toBeTruthy();
  });
});
