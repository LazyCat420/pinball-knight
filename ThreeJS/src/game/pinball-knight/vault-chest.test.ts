import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";

// The vault payout builds real item sprites — a canvas the node environment does
// not have. Only the sprite factory is stubbed; the chest itself is built by the
// module under test, because the chest IS what this file is about.
vi.mock("./engine/render/sprite", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  createStaticSprite: () => ({ mesh: new THREE.Object3D(), dispose: () => {} }),
}));

import { installLampPuzzle, lightLamp, openVaultOnBossDefeat, updateLampPuzzle, disposeLampPuzzle } from "./lamp-puzzle";
import type { LampPuzzlePlan } from "./maze/lamp-puzzle";
import { state } from "./state";
import type { PinballPart } from "./state";

/**
 * THE REPORT THIS FILE EXISTS FOR
 *
 * "I beat the boss, there's a chest, and the chest can't be opened."
 *
 * Both halves were real. The vault takes the deepest OPEN tile on the floor,
 * which is where the stairs and the boss arena get carved — so the sealed chest
 * stands in the boss chamber and reads as the reward for the fight. It wasn't:
 * the only unlock was lighting every brazier, the chest has no collider so
 * bumping it does nothing, and the HUD never mentions braziers at all. A player
 * who never touched a brazier had no reachable state in which it opened.
 *
 * So there are two properties here, and they fail in different ways:
 *
 *   1. It has to LOOK like a chest — a lid that swings on a hinge, above the
 *      carcass, inside its tile. (§the object)
 *   2. Killing the floor's overlord has to open it, once. (§the key)
 *
 * §1 is geometry that is easy to get backwards and impossible to see from a
 * green suite: the lid is a half-cylinder whose surviving half depends on the
 * sign of one rotation, and the wrong sign buries the dome under the floor
 * where nothing else in the game would complain.
 */

const PLAN: LampPuzzlePlan = {
  lamps: [
    { i: 3, j: 3, kind: "lamp", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 },
    { i: 9, j: 3, kind: "lamp", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 },
    { i: 6, j: 9, kind: "lamp", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 },
  ],
  vault: { i: 6, j: 6 },
  loot: ["gold", "health", "gold"],
};

const grid = { w: 12, h: 12, t: new Uint8Array(144), shapes: new Uint8Array(144) };

function install(): THREE.Scene {
  const scene = new THREE.Scene();
  state.scene = scene;
  state.groundItems = [];
  state.pinballParts = [];
  installLampPuzzle(PLAN, grid, scene);
  return scene;
}

function chest(): THREE.Object3D {
  const c = state.lampPuzzle?.chest;
  if (!c) throw new Error("no chest");
  c.updateMatrixWorld(true);
  return c;
}

/** World-space AABB of a subtree, from its actual vertices. */
function boxOf(o: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(o);
}

beforeEach(() => {
  disposeLampPuzzle(state.scene ?? null);
  state.scene = null;
  state.groundItems = [];
  state.pinballParts = [];
  state.vfx = null;
});

describe("§the object — the chest reads as a chest", () => {
  it("sits ON the floor: nothing hangs below y=0", () => {
    install();
    expect(boxOf(chest()).min.y).toBeGreaterThanOrEqual(-0.02);
  });

  it("keeps to its own tile", () => {
    install();
    const b = boxOf(chest());
    const c = state.lampPuzzle!.vault;
    // A tile is 1 world unit. Half-extents must stay under half a tile or the
    // chest overlaps whatever the neighbouring tile holds.
    expect(Math.max(b.max.x - c.x, c.x - b.min.x)).toBeLessThan(0.5);
    expect(Math.max(b.max.z - c.z, c.z - b.min.z)).toBeLessThan(0.5);
  });

  it("puts the lid ABOVE the carcass, not through the floor", () => {
    // The dome is a half-cylinder; the surviving half is chosen by the sign of
    // rotation.z. Flip it and the lid renders BELOW the hinge, inside the floor,
    // with every other assertion in this file still green.
    install();
    const lid = chest().userData.lid as THREE.Object3D;
    const hinge = lid.getWorldPosition(new THREE.Vector3()).y;
    const dome = boxOf(lid.userData.dome as THREE.Object3D);
    expect(dome.min.y).toBeCloseTo(hinge, 2); // its flat face rests ON the rim
    expect(dome.max.y).toBeGreaterThan(hinge + 0.15); // and it domes up from there
    // The rest of the lid may hang BELOW the hinge — the hasp reaches down over
    // the lockplate on purpose — but nothing on it may come near the floor.
    expect(boxOf(lid).min.y).toBeGreaterThan(hinge / 2);
  });

  it("is a hinge, not a lifting box: opening swings the front edge up and BACK", () => {
    install();
    const lid = chest().userData.lid as THREE.Object3D;
    const front = new THREE.Vector3(0, 0, 0.5); // the lid's front lip, in hinge space
    const before = front.clone().applyMatrix4(lid.matrixWorld);

    openVaultOnBossDefeat();
    for (let k = 0; k < 60; k++) updateLampPuzzle(1 / 60); // a full second: the swing is 0.6s
    chest().updateMatrixWorld(true);
    const after = front.clone().applyMatrix4(lid.matrixWorld);

    expect(after.y - before.y).toBeGreaterThan(0.3); // it rose
    // …and travelled back over the hinge. The hinge is at the chest's local -z,
    // which the group's yaw carries into world x/z together, so measure the
    // distance from the lip to the hinge point instead of picking an axis.
    const hinge = lid.getWorldPosition(new THREE.Vector3());
    expect(after.distanceTo(hinge)).toBeLessThan(before.distanceTo(hinge) + 1e-6);
    expect(after.y).toBeGreaterThan(hinge.y); // leaning back, not folded down behind
  });

  it("lights its inside only once it is open", () => {
    install();
    const inner = chest().userData.inner as THREE.MeshStandardMaterial;
    expect(inner.emissiveIntensity).toBe(0);
    openVaultOnBossDefeat();
    updateLampPuzzle(0.6);
    expect(inner.emissiveIntensity).toBeGreaterThan(0.5);
  });
});

describe("§the key — the overlord opens it", () => {
  it("pays out the rolled loot on a boss kill, with no brazier lit", () => {
    install();
    expect(state.lampPuzzle!.lit).toBe(0);
    openVaultOnBossDefeat();
    expect(state.lampPuzzle!.unlocked).toBe(true);
    expect(state.groundItems.map((g) => g.id)).toEqual(PLAN.loot);
  });

  it("reports itself solved, so the probe and HUD cannot say 0/3 on an open vault", () => {
    install();
    openVaultOnBossDefeat();
    expect(state.lampPuzzle!.lit).toBe(state.lampPuzzle!.total);
  });

  it("pays ONCE — a second kill (or a co-op replica's echo) adds nothing", () => {
    install();
    openVaultOnBossDefeat();
    const n = state.groundItems.length;
    openVaultOnBossDefeat();
    expect(state.groundItems.length).toBe(n);
  });

  it("does not double-pay a vault the braziers already opened", () => {
    install();
    const parts = PLAN.lamps.map((l): PinballPart => ({ kind: "lamp", x: l.i, z: l.j, lit: false }) as PinballPart);
    state.pinballParts = parts;
    parts.forEach(lightLamp);
    expect(state.lampPuzzle!.unlocked).toBe(true);
    const n = state.groundItems.length;
    expect(n).toBe(PLAN.loot.length);
    openVaultOnBossDefeat();
    expect(state.groundItems.length).toBe(n);
  });

  it("is a no-op on a floor that rolled no puzzle", () => {
    state.lampPuzzle = null;
    expect(() => openVaultOnBossDefeat()).not.toThrow();
    expect(state.groundItems).toHaveLength(0);
  });
});
