import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importedPaints, type ImportedSheet } from "../../render/imported-paints";
import { buildSpriteSheet, createActorSprite } from "./sprite";
import { MonsterAnimator } from "./monster-animator";
import { installSpriteTestDom } from "../../testkit/atlas-census";

describe("Goblin Imported Art Death Clip Assertions", () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore = installSpriteTestDom();
  });
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("proves actual goblin-S.json loads >= 4 death cels and advances to the final cel without resetting", () => {
    const jsonPath = resolve(__dirname, "../../../../../public/sprites/goblin-S.json");
    const manifest = JSON.parse(readFileSync(jsonPath, "utf-8"));

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;

    const importedSheet: ImportedSheet = {
      manifest,
      image: canvas as any,
    };

    const paints = importedPaints([importedSheet]);
    expect(paints).not.toBeNull();
    expect(paints!.S.death?.length, "S:death must have >= 4 frames").toBeGreaterThanOrEqual(4);

    const sheet = buildSpriteSheet(paints!);
    const deathIndices = sheet.clips.get("S:death");
    expect(deathIndices, "S:death clip must exist in built sheet").toBeDefined();
    expect(deathIndices!.length, "S:death indices count").toBeGreaterThanOrEqual(4);

    // Test for all 4 facings (S, N, E, W)
    for (const facing of ["S", "N", "E", "W"] as const) {
      const sprite = createActorSprite(sheet, false);
      const anim = new MonsterAnimator(sprite);

      anim.setFacing(facing);
      anim.triggerDeath(facing);

      expect(anim.getState(), `${facing}: initial death state`).toBe("dying");
      expect(anim.getClip(), `${facing}: clip name`).toBe("death");
      expect(anim.getFrameIdx(), `${facing}: initial frameIdx must be 0`).toBe(0);
      expect(anim.isFinished(), `${facing}: cannot be finished at frame 0`).toBe(false);

      const indices = anim.debugIndices();
      expect(indices.length, `${facing}: death indices must not be empty`).toBeGreaterThanOrEqual(4);

      // Step by 0.2s (enough for 1 frame at 6 fps)
      anim.update(0.2);
      expect(anim.getFrameIdx(), `${facing}: must advance to frame 1 after 0.2s`).toBe(1);

      // Step until death completes (e.g. 2.0s total)
      for (let i = 0; i < 20; i++) {
        anim.update(0.1);
      }

      expect(anim.getFrameIdx(), `${facing}: final frameIdx must be last cel`).toBe(indices.length - 1);
      expect(anim.isFinished(), `${facing}: must be finished at last cel`).toBe(true);
      expect(anim.getState(), `${facing}: state must be dead`).toBe("dead");

      // Verify further updates HOLD the last frame (no loop, no reset to 0)
      anim.update(1.0);
      expect(anim.getFrameIdx(), `${facing}: must permanently hold last cel`).toBe(indices.length - 1);
      expect(anim.isFinished(), `${facing}: must remain finished`).toBe(true);
    }
  });
});
