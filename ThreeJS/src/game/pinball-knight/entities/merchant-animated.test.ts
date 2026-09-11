import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import * as THREE from "three";
import { spawnMerchant, updateNpcs, disposeNpcs, setMerchantCaughtHandler } from "./npc";
import { state } from "../state";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { type Grid } from "../maze/generator";

describe("Roaming Maze Merchant Animated Entity", () => {
  let restoreDom: () => void;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    disposeNpcs();
    state.scene = new THREE.Scene();
    state.npcs = [];
    state.elapsed = 1.0;
    // Simple 5x5 grid
    state.grid = {
      w: 5,
      h: 5,
      t: new Uint8Array(25).fill(1), // all walkable floor
      shapes: new Uint8Array(25),
    };
    state.player = {
      x: 0,
      z: 0,
      r: 0.35,
      hp: 6,
      maxHp: 6,
      sprite: { mesh: new THREE.Mesh(), dispose: () => {} } as any,
    } as any;
  });

  it("spawns roaming merchant in roll phase", () => {
    spawnMerchant(2, 2);
    expect(state.npcs.length).toBe(1);
    const m = state.npcs[0];
    expect(m.kind).toBe("merchant");
    expect(m.phase).toBe("roll");
    expect(m.sprite).toBeDefined();
  });

  it("updates merchant position and sets caught state when player is close", () => {
    let caughtCalled = false;
    setMerchantCaughtHandler(() => {
      caughtCalled = true;
    });

    spawnMerchant(2, 2);
    const m = state.npcs[0];
    // Put player right on top of merchant
    state.player!.x = m.x;
    state.player!.z = m.z;

    updateNpcs(0.1);
    expect(caughtCalled).toBe(true);
    expect(m.shopped).toBe(true);
  });
});
