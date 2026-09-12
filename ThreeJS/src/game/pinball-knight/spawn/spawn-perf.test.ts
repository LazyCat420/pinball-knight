import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import * as THREE from "three";
import { state } from "../state";
import { previewHordeKind, isKindMobile } from "./factory";
import { acquireActorSprite, releaseActorSprite, clearActorSpritePool, type SpriteSheet } from "../engine/render/sprite";

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

function fakeSheet(): SpriteSheet {
  const canvas = { width: 128, height: 128 } as unknown as HTMLCanvasElement;
  const texture = new THREE.CanvasTexture(canvas);
  return {
    texture,
    clips: new Map<string, number[]>([["S:idle", [0]]]),
    frameCount: 1,
    cols: 1,
    rows: 1,
  };
}

describe("spawn performance & candidate pre-filtering", () => {
  beforeEach(() => {
    clearActorSpritePool();
  });

  it("identifies stationary and dormant enemies correctly via isKindMobile", () => {
    expect(isKindMobile("chomper")).toBe(false);
    expect(isKindMobile("golem")).toBe(false);
    expect(isKindMobile("crystalback")).toBe(false);
    expect(isKindMobile("computer_screen")).toBe(false);
    expect(isKindMobile("mimic")).toBe(false);

    expect(isKindMobile("zombie")).toBe(true);
    expect(isKindMobile("goblin")).toBe(true);
    expect(isKindMobile("brute")).toBe(true);
    expect(isKindMobile("spider")).toBe(true);
    expect(isKindMobile("junkbot")).toBe(true);
  });

  it("previewHordeKind returns candidate kind without constructing meshes", () => {
    const kindF1 = previewHordeKind(12345, 1);
    expect(typeof kindF1).toBe("string");
    expect(kindF1).toBeTruthy();

    const kindF3 = previewHordeKind(99999, 3);
    expect(typeof kindF3).toBe("string");
    expect(kindF3).toBeTruthy();
  });

  it("acquireActorSprite reuses pooled sprites and resets properties", () => {
    const sheet1 = fakeSheet();
    const sheet2 = fakeSheet();

    const s1 = acquireActorSprite(sheet1, false);
    expect(s1).toBeTruthy();
    s1.mesh.scale.set(2, 2, 2);
    s1.setTint(0xff0000);
    s1.setFlipped(true);

    // Release back to pool
    releaseActorSprite(s1);

    // Next acquire should reuse the same sprite object
    const s2 = acquireActorSprite(sheet2, false);
    expect(s2).toBe(s1);
    expect(s2.mesh.scale.x).toBe(1);
    expect(s2.mesh.scale.y).toBe(1);
    expect(s2.mesh.scale.z).toBe(1);
    expect(s2.sheet).toBe(sheet2);
  });

  it("clearActorSpritePool drains and disposes all pooled sprites", () => {
    const sheet = fakeSheet();
    const s = acquireActorSprite(sheet, false);
    let disposed = false;
    s.mesh.geometry.addEventListener("dispose", () => {
      disposed = true;
    });

    releaseActorSprite(s);
    expect(disposed).toBe(false);

    clearActorSpritePool();
    expect(disposed).toBe(true);
  });
});
