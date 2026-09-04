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
  it("gives every actor its OWN quad, because the CEL lives in the uv", () => {
    // This used to assert the opposite, and sharing was right at the time: the
    // quad was a rectangle and the frame was chosen with `texture.offset`.
    //
    // It is now wrong, and the reason is the death animation. Measured on the
    // real GPU with `scripts/death-swarm.mjs`: with four goblins dying at once
    // every animator advanced 0→3 and every texture held the correct terminal
    // offset, while THREE OF THE FOUR went on drawing death cel 0 — the
    // per-object uv-transform uniform was not being re-uploaded. A uv written
    // into this mesh's own attribute buffer cannot be coalesced with its
    // neighbour's. See engine/render/sprite.ts `spriteGeometry`.
    const a = createActorSprite(fakeSheet(), false);
    const b = createActorSprite(fakeSheet(), false);
    expect(a.mesh.geometry).not.toBe(b.mesh.geometry);
  });

  it("moves each actor's uv when its frame changes, and leaves its neighbour alone", () => {
    // The property the whole fix exists for, in the cheapest form that can
    // still fail: two actors, one of them steps a frame, and the OTHER one's
    // uv must not move with it.
    const sheet = fakeSheet();
    const a = createActorSprite(sheet, false);
    const b = createActorSprite(sheet, false);
    a.setFrame(0);
    b.setFrame(0);
    const beforeB = Array.from((b.mesh.geometry.attributes.uv.array as Float32Array).slice(0, 8));
    a.setFrame(5);
    const afterA = Array.from((a.mesh.geometry.attributes.uv.array as Float32Array).slice(0, 8));
    const afterB = Array.from((b.mesh.geometry.attributes.uv.array as Float32Array).slice(0, 8));
    expect(afterA).not.toEqual(beforeB);
    expect(afterB).toEqual(beforeB);
  });

  it("leaves the texture matrix at identity, so the uv is the only thing steering", () => {
    // `offset` and `repeat` are still maintained for the debug decoders. If the
    // matrix were also live, the shader would apply the offset a SECOND time on
    // top of the uv and every sprite would sample the wrong cel.
    const a = createActorSprite(fakeSheet(), false);
    a.setFrame(5);
    const map = (a.mesh.material as THREE.MeshBasicMaterial).map!;
    expect(map.matrixAutoUpdate).toBe(false);
    expect(map.matrix.elements[6]).toBe(0);
    expect(map.matrix.elements[7]).toBe(0);
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

  it("one actor dying does NOT destroy its neighbour's buffers", () => {
    // The regression this guards: dispose() must free what the actor uniquely
    // owns and nothing else. It once freed the blob geometry and material,
    // which are shared, so the first kill blanked the whole horde.
    const a = createActorSprite(fakeSheet(), false);
    const b = createActorSprite(fakeSheet(), false);
    const geoB = b.mesh.geometry as THREE.BufferGeometry;
    const blobB = b.mesh.children[0] as THREE.Mesh;

    a.dispose();

    expect(geoB.attributes.position).toBeTruthy();
    expect(geoB.attributes.uv).toBeTruthy();
    expect((blobB.material as THREE.Material).type).toBe("MeshBasicMaterial");
  });

  it("disposes the quad it owns, so a floor of corpses does not leak one each", () => {
    // The cost of un-sharing the quad: it now has an owner, and an owner that
    // forgets to free it turns ~175 actors per floor into a permanent leak.
    const a = createActorSprite(fakeSheet(), false);
    let disposed = false;
    a.mesh.geometry.addEventListener("dispose", () => {
      disposed = true;
    });
    a.dispose();
    expect(disposed).toBe(true);
  });

  it("a brand-new actor after a full wipe still works", () => {
    const a = createActorSprite(fakeSheet(), false);
    a.dispose();
    const c = createActorSprite(fakeSheet(), false);
    expect((c.mesh.geometry as THREE.BufferGeometry).attributes.position).toBeTruthy();
  });
});
