import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCanvas } from "canvas";
import * as THREE from "three";
import { acquireActorSprite, clearActorSpritePool, createActorSprite, releaseActorSprite, type ActorSprite, type SpriteSheet } from "./sprite";

const realDoc = globalThis.document;
beforeAll(() => { globalThis.document = { createElement: () => createCanvas(1, 1) } as unknown as Document; });
afterAll(() => { clearActorSpritePool(); globalThis.document = realDoc; });

function warmedSheet(cols: number, rows: number): SpriteSheet {
  const texture = new THREE.CanvasTexture(createCanvas(cols * 8, rows * 8) as unknown as HTMLCanvasElement);
  texture.repeat.set(1 / cols, 1 / rows);
  // Rendering/prewarming the source atlas updates this matrix before cloning.
  texture.updateMatrix();
  return { texture, cols, rows, frameCount: cols * rows, clips: new Map() };
}

function expectFrame(sprite: ActorSprite, frame: number, flipped = false) {
  sprite.setFrame(frame);
  sprite.setFlipped(flipped);
  const map = (sprite.mesh.material as THREE.MeshBasicMaterial).map!;
  const uv = sprite.mesh.geometry.getAttribute("uv");
  const centre = new THREE.Vector2((uv.getX(0) + uv.getX(3)) / 2, (uv.getY(0) + uv.getY(3)) / 2);
  // This is the actual shader sampling coordinate: geometry UV then texture matrix.
  centre.applyMatrix3(map.matrix);
  expect(centre.x).toBeCloseTo((frame % sprite.sheet.cols + 0.5) / sprite.sheet.cols);
  expect(centre.y).toBeCloseTo(1 - (Math.floor(frame / sprite.sheet.cols) + 0.5) / sprite.sheet.rows);
}

describe("actor sampling after source atlas prewarming", () => {
  it("selects the correct cell on a newly spawned actor", () => {
    const sheet = warmedSheet(8, 3);
    const sprite = createActorSprite(sheet, false);
    try { expectFrame(sprite, 13); expectFrame(sprite, 22, true); }
    finally { sprite.dispose(); sheet.texture.dispose(); }
  });
  it("selects the correct cell after a live imported-sheet replacement", () => {
    const first = warmedSheet(4, 2), next = warmedSheet(9, 3);
    const sprite = createActorSprite(first, false);
    try { sprite.setSheet(next); expectFrame(sprite, 19, true); }
    finally { sprite.dispose(); first.texture.dispose(); next.texture.dispose(); }
  });
  it("selects the new monster's cell after pooled reuse", () => {
    clearActorSpritePool();
    const first = warmedSheet(4, 2), next = warmedSheet(7, 3);
    const old = acquireActorSprite(first, false);
    old.setFlipped(true);
    releaseActorSprite(old);
    const reused = acquireActorSprite(next, false);
    try { expect(reused).toBe(old); expectFrame(reused, 0); expectFrame(reused, 16); }
    finally { reused.dispose(); first.texture.dispose(); next.texture.dispose(); }
  });
});
