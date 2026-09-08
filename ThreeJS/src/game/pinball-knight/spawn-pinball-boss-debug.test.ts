import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state } from "./state";
import { makeDebugEnemy, debugSpawnEnemy, debugClearEnemies } from "./dev/debug-actions";
import { KIND_SKIN } from "./spawn/kind-skin";
import { spawnKind } from "./spawn/factory";
import { installSpriteTestDom } from "./testkit/atlas-census";
import { bossActive, bossLabel } from "./boss";
import { SPAWNABLE } from "./debug-panel";
import { KIND_IDS } from "./bestiary";

describe("Tilt Titan Pinball Boss Spawning in Admin Debugger / God Mode", () => {
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
    debugClearEnemies();
    state.scene = null;
    state.zombies = [];
    state.player = null;
    state.grid = null;
    restoreDom?.();
  });

  it("checks KIND_SKIN entry for pinball_boss", () => {
    expect(KIND_SKIN["pinball_boss"], "KIND_SKIN must have an entry for pinball_boss").toBeDefined();
    expect(KIND_SKIN["pinball_boss"]?.scale).toBe(2.2);
  });

  it("checks spawnKind('pinball_boss') returns a valid Zombie actor", () => {
    const actor = spawnKind("pinball_boss" as any, 2, 2, 1, 99);
    expect(actor, "spawnKind('pinball_boss') should return a non-null Zombie").not.toBeNull();
  });

  it("makeDebugEnemy('pinball_boss') successfully returns a valid spawned Zombie", () => {
    const actor = makeDebugEnemy("pinball_boss" as any, 2, 2);
    expect(actor, "makeDebugEnemy('pinball_boss') should not return null").not.toBeNull();
    expect(actor?.kind).toBe("pinball_boss");
  });

  it("debugSpawnEnemy('pinball_boss') adds a rendered Tilt Titan into state.zombies and engages boss controller", () => {
    expect(state.zombies.length).toBe(0);
    expect(bossActive()).toBe(false);

    debugSpawnEnemy("pinball_boss" as any, 1);
    expect(state.zombies.length, "One Tilt Titan should be spawned into state.zombies").toBe(1);
    const titan = state.zombies[0];
    expect(titan.kind).toBe("pinball_boss");
    expect(titan.boss).toBe(true);
    expect(titan.bossKind).toBe("pinball_boss");
    expect(titan.bodyR).toBeGreaterThan(0.7);
    expect(bossActive()).toBe(true);
    expect(bossLabel()).toBe("TILT TITAN");
  });

  it("debugClearEnemies cleans up Tilt Titan and disposes boss state", () => {
    debugSpawnEnemy("pinball_boss" as any, 1);
    expect(state.zombies.length).toBe(1);
    expect(bossActive()).toBe(true);

    debugClearEnemies();
    expect(state.zombies.length).toBe(0);
    expect(bossActive()).toBe(false);
  });

  it("verifies pinball_boss is included in bestiary KIND_IDS and debug SPAWNABLE roster", () => {
    expect((KIND_IDS as string[])).toContain("pinball_boss");
    const chip = SPAWNABLE.find((s) => s.kind === "pinball_boss");
    expect(chip, "SPAWNABLE must include pinball_boss chip").toBeDefined();
    expect(chip?.label.length).toBeLessThanOrEqual(16);
  });
});
