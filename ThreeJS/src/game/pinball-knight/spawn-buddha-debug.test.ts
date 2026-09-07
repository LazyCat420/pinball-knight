import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state } from "./state";
import { makeDebugEnemy, debugSpawnEnemy, debugClearEnemies } from "./dev/debug-actions";
import { KIND_SKIN } from "./spawn/kind-skin";
import { spawnKind } from "./spawn/factory";
import { installSpriteTestDom } from "./testkit/atlas-census";

describe("Buddha Boss Spawning in Admin Debugger / God Mode", () => {
  let restoreDom: () => void;

  beforeEach(() => {
    restoreDom = installSpriteTestDom();
    state.scene = {
      add: () => {},
      remove: () => {},
    } as any;
    state.zombies = [];
    state.player = {
      x: 0,
      z: 0,
      hp: 100,
      active: true,
      facing: "S",
    } as any;
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(1),
      shapes: new Uint8Array(400),
      arcs: [],
    } as any;
  });

  afterEach(() => {
    state.scene = null;
    state.zombies = [];
    state.player = null;
    state.grid = null;
    restoreDom?.();
  });

  it("checks KIND_SKIN entry for jade_buddha", () => {
    expect(KIND_SKIN["jade_buddha"], "KIND_SKIN must have an entry for jade_buddha").toBeDefined();
    expect(KIND_SKIN["jade_buddha"]?.scale).toBe(2.15);
  });

  it("checks spawnKind('jade_buddha') returns a valid Zombie actor", () => {
    const actor = spawnKind("jade_buddha", 2, 2, 1, 99);
    expect(actor, "spawnKind('jade_buddha') should return a non-null Zombie").not.toBeNull();
  });

  it("makeDebugEnemy('jade_buddha') successfully returns a valid spawned Zombie", () => {
    const actor = makeDebugEnemy("jade_buddha", 2, 2);
    expect(actor, "makeDebugEnemy('jade_buddha') should not return null").not.toBeNull();
    expect(actor?.kind).toBe("jade_buddha");
  });

  it("debugSpawnEnemy('jade_buddha') adds a rendered Buddha into state.zombies and engages boss controller", () => {
    expect(state.zombies.length).toBe(0);
    debugSpawnEnemy("jade_buddha", 1);
    expect(state.zombies.length, "One Buddha should be spawned into state.zombies").toBe(1);
    const buddha = state.zombies[0];
    expect(buddha.kind).toBe("jade_buddha");
    expect(buddha.boss).toBe(true);
    expect(buddha.bossKind).toBe("jade_buddha");
    expect(buddha.bodyR).toBeGreaterThan(0.7);
    expect(buddha.hp).toBe(50);
  });

  it("debugClearEnemies cleans up Buddha and disposes boss state", () => {
    debugSpawnEnemy("jade_buddha", 1);
    expect(state.zombies.length).toBe(1);

    debugClearEnemies();
    expect(state.zombies.length).toBe(0);
  });
});
