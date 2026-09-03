import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { createCanvas, loadImage } from "canvas";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { importedPaints } from "../../render/imported-paints";
import { buildSpriteSheet } from "./sprite";
import { withRecoil } from "../../render/cel-painter";
import { state, type Zombie } from "../../state";
import { damageZombie } from "../../entities/combat";
import { updateZombies } from "../../entities/zombie";
import { makeDebugEnemy } from "../../dev/debug-actions";

describe("Goblin Death Animation Pipeline (TDD Red/Green)", () => {
  let restoreDom: () => void;

  beforeEach(async () => {
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
      mana: 100,
      momSpeed: 10,
      facing: "S",
    } as any;
    state.grid = {
      w: 20,
      h: 20,
      get: () => ({ kind: "floor" }),
    } as any;
  });

  afterEach(() => {
    state.scene = null;
    state.zombies = [];
    state.player = null;
    restoreDom?.();
  });

  it("progresses sequentially through all 4 death frames (0 -> 1 -> 2 -> 3) and holds frame 3", async () => {
    const manifest = JSON.parse(fs.readFileSync("public/sprites/goblin-S.json", "utf8"));
    const image = (await loadImage("public/sprites/goblin-S.png")) as any;
    const paints = importedPaints([{ manifest, image }]);
    expect(paints).toBeDefined();
    const sheet = buildSpriteSheet(withRecoil(paints!));

    const z = makeDebugEnemy("goblin", 0, 2);
    expect(z).toBeDefined();
    if (!z) return;
    z.sprite.setSheet(sheet);
    z.anim.reapply();
    state.zombies.push(z);

    // Initial state: alive, idle
    expect(z.mode).toBe("idle");
    expect(z.anim.getClip()).toBe("idle");

    // Fatal damage dealt via official combat pipeline
    damageZombie(z, 99, 0, 1, 0, true, "steel");
    expect(z.hp).toBeLessThanOrEqual(0);
    expect(z.mode).toBe("dead");
    expect(z.anim.getClip()).toBe("death");
    expect(z.anim.getFrameIdx()).toBe(0);
    expect(z.anim.isFinished()).toBe(false);

    // Advance simulation frames (dt = 1/60s = 0.0166s)
    // Death fps = 6 fps, so 1 frame = ~0.166s = ~10 simulation steps
    const frameProgression: number[] = [z.anim.getFrameIdx()];

    // Step ~60 simulation ticks (1.0 second total)
    for (let step = 0; step < 60; step++) {
      updateZombies(0.01666);
      const current = z.anim.getFrameIdx();
      if (current !== frameProgression[frameProgression.length - 1]) {
        frameProgression.push(current);
      }
    }

    // Verify that ALL 4 frames were visited in exact sequential order: [0, 1, 2, 3]
    expect(frameProgression).toEqual([0, 1, 2, 3]);

    // Verify it is finished and locked on frame 3
    expect(z.anim.isFinished()).toBe(true);
    expect(z.anim.getFrameIdx()).toBe(3);

    // Step further (another 60 ticks) — it must remain at frame 3 forever
    for (let step = 0; step < 60; step++) {
      updateZombies(0.01666);
      expect(z.anim.getFrameIdx()).toBe(3);
      expect(z.anim.isFinished()).toBe(true);
    }
  });

  it("handles multi-direction initial facings (S, N, E, W) without resetting frame 0", async () => {
    const manifest = JSON.parse(fs.readFileSync("public/sprites/goblin-S.json", "utf8"));
    const image = (await loadImage("public/sprites/goblin-S.png")) as any;
    const paints = importedPaints([{ manifest, image }]);
    const sheet = buildSpriteSheet(withRecoil(paints!));

    for (const facing of ["S", "N", "E", "W"] as const) {
      state.zombies = [];
      const z = makeDebugEnemy("goblin", 0, 2);
      expect(z).toBeDefined();
      if (!z) continue;
      z.sprite.setSheet(sheet);
      z.anim.setFacing(facing);
      state.zombies.push(z);

      damageZombie(z, 99, 0, 1, 0, true, "steel");
      expect(z.anim.getClip()).toBe("death");
      expect(z.anim.getFrameIdx()).toBe(0);

      const frames: number[] = [0];
      for (let step = 0; step < 60; step++) {
        updateZombies(0.01666);
        const cur = z.anim.getFrameIdx();
        if (cur !== frames[frames.length - 1]) frames.push(cur);
      }

      expect(frames, `Facing ${facing} must progress through [0, 1, 2, 3]`).toEqual([0, 1, 2, 3]);
      expect(z.anim.isFinished()).toBe(true);
    }
  });
});
