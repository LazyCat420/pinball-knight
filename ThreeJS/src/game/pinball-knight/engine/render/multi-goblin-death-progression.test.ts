import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../state";
import { makeSkinned } from "../../spawn/factory";
import { sheetFor } from "../../boot/sheets";
import { killZombie } from "../../entities/combat";
import { animationPresentation } from "../../presentation/animation-system";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import * as THREE from "three";

describe("Multi-Goblin Death Animation Progression", () => {
  let restoreDom: () => void;

  beforeEach(() => {
    restoreDom = installSpriteTestDom();
    state.scene = new THREE.Scene();
    state.zombies = [];
    state.player = null;
    state.grid = {
      cols: 20,
      rows: 20,
      tiles: new Uint8Array(400),
      wallN: new Uint8Array(400),
      wallW: new Uint8Array(400),
      doorH: new Uint8Array(400),
      doorV: new Uint8Array(400),
    } as any;
  });

  afterEach(() => {
    restoreDom();
    state.zombies = [];
  });

  it("advances all 8 goblins simultaneously through all death cels to locked terminal frame", () => {
    sheetFor("goblin");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Spawn 8 distinct goblins
    const goblins = [];
    for (let i = 0; i < 8; i++) {
      const g = makeSkinned("goblin", i, 0, 1);
      expect(g).toBeDefined();
      if (g) {
        state.zombies.push(g);
        goblins.push(g);
      }
    }
    expect(goblins).toHaveLength(8);

    // Track frame progression per goblin
    const framesVisited = goblins.map(() => new Set<number>());

    // Kill all 8 goblins simultaneously
    for (let i = 0; i < 8; i++) {
      killZombie(goblins[i]);
      expect(goblins[i].mode).toBe("dead");
      expect(goblins[i].anim.getClip()).toBe("death");
      framesVisited[i].add(goblins[i].anim.getFrameIdx());
    }

    // Step animationPresentation clock across 60 frames (~1.0s)
    for (let f = 0; f < 60; f++) {
      animationPresentation.update(0.016);
      for (let i = 0; i < 8; i++) {
        framesVisited[i].add(goblins[i].anim.getFrameIdx());
      }
    }

    // Assert ALL 8 goblins stepped through frames 0, 1, 2, 3 and finished
    for (let i = 0; i < 8; i++) {
      expect(framesVisited[i].has(0), `Goblin #${i} must visit frame 0`).toBe(true);
      expect(framesVisited[i].has(1), `Goblin #${i} must visit frame 1`).toBe(true);
      expect(framesVisited[i].has(2), `Goblin #${i} must visit frame 2`).toBe(true);
      expect(framesVisited[i].has(3), `Goblin #${i} must visit frame 3`).toBe(true);
      expect(goblins[i].anim.getFrameIdx(), `Goblin #${i} must hold terminal cel 3`).toBe(3);
      expect(goblins[i].anim.isFinished(), `Goblin #${i} must be finished`).toBe(true);
    }

    // Assert console logging occurred for start, step, and done
    const logs = consoleSpy.mock.calls.map((c) => c[0]);
    const startLogs = logs.filter((l) => typeof l === "string" && l.includes("[death:start]"));
    const doneLogs = logs.filter((l) => typeof l === "string" && l.includes("[death:done]"));
    expect(startLogs).toHaveLength(8);
    expect(doneLogs).toHaveLength(8);

    consoleSpy.mockRestore();
  });

  it("progresses staggered kills across 8 goblins independently without crosstalk", () => {
    sheetFor("goblin");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const goblins = [];
    for (let i = 0; i < 8; i++) {
      const g = makeSkinned("goblin", i, 0, 1);
      if (g) {
        state.zombies.push(g);
        goblins.push(g);
      }
    }

    // Wave 1: Kill first 4 goblins at t=0
    for (let i = 0; i < 4; i++) {
      killZombie(goblins[i]);
    }

    // Advance 15 frames (~0.25s) — wave 1 is midway dying, wave 2 is alive
    for (let f = 0; f < 15; f++) {
      animationPresentation.update(0.016);
    }

    for (let i = 0; i < 4; i++) {
      expect(goblins[i].anim.getClip()).toBe("death");
      expect(goblins[i].anim.getFrameIdx()).toBeGreaterThanOrEqual(1);
    }
    for (let i = 4; i < 8; i++) {
      expect(goblins[i].anim.getClip()).toBe("idle");
      expect(goblins[i].mode).toBe("idle");
    }

    // Wave 2: Kill remaining 4 goblins at t=0.25s
    for (let i = 4; i < 8; i++) {
      killZombie(goblins[i]);
    }

    // Advance remaining frames until all 8 complete
    for (let f = 0; f < 60; f++) {
      animationPresentation.update(0.016);
    }

    for (let i = 0; i < 8; i++) {
      expect(goblins[i].anim.getFrameIdx()).toBe(3);
      expect(goblins[i].anim.isFinished()).toBe(true);
    }

    consoleSpy.mockRestore();
  });
});
