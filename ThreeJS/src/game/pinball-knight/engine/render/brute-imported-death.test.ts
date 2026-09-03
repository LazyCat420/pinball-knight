import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importedPaints, type ImportedSheet } from "../../render/imported-paints";
import { buildSpriteSheet, createActorSprite } from "./sprite";
import { MonsterAnimator } from "./monster-animator";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { paintsFor, imported } from "../../boot/sheets";

describe("Brute Imported Art Death Fallback Assertions", () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore = installSpriteTestDom();
    imported.clear();
  });
  afterEach(() => {
    imported.clear();
    restore?.();
    restore = null;
  });

  it("proves brute-S.json lacks death row but paintsFor('brute') safely falls back to procedural death cels", () => {
    const jsonPath = resolve(__dirname, "../../../../../public/sprites/brute-S.json");
    const manifest = JSON.parse(readFileSync(jsonPath, "utf-8"));

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;

    const importedSheet: ImportedSheet = {
      manifest,
      image: canvas as any,
    };

    // 1. Verify brute manifest specifically lacks death row
    const artPaints = importedPaints([importedSheet]);
    expect(artPaints).not.toBeNull();
    expect(artPaints!.S.death, "brute-S imported sheet must have undefined death").toBeUndefined();

    // 2. Register imported art and verify paintsFor merges procedural death cels
    imported.set("brute", artPaints!);
    const merged = paintsFor("brute");
    expect(merged.S.death, "merged S:death must exist from procedural painter").toBeDefined();
    expect(merged.S.death!.length, "merged S:death must have frames").toBeGreaterThanOrEqual(2);

    // 3. Build sheet and test MonsterAnimator playback across all facings
    const sheet = buildSpriteSheet(merged);
    const deathIndices = sheet.clips.get("S:death");
    expect(deathIndices, "S:death clip must exist in built sheet").toBeDefined();
    expect(deathIndices!.length, "S:death indices count").toBeGreaterThanOrEqual(2);

    for (const facing of ["S", "N", "E", "W"] as const) {
      const sprite = createActorSprite(sheet, false);
      const anim = new MonsterAnimator(sprite);

      anim.setFacing(facing);
      anim.triggerDeath(facing);

      expect(anim.getState(), `${facing}: initial death state`).toBe("dying");
      expect(anim.getClip(), `${facing}: clip name`).toBe("death");
      expect(anim.getFrameIdx(), `${facing}: initial frameIdx`).toBe(0);
      expect(anim.isFinished(), `${facing}: cannot be finished at frame 0`).toBe(false);

      const indices = anim.debugIndices();
      expect(indices.length, `${facing}: death indices must not be empty`).toBeGreaterThanOrEqual(2);

      // Verify indices do NOT match idle clip (idle has 2 frames)
      const idleIndices = sheet.clips.get(`${facing === "W" ? "E" : facing}:idle`);
      if (idleIndices && idleIndices.length > 0 && deathIndices && deathIndices.length !== idleIndices.length) {
        expect(indices).not.toEqual(idleIndices);
      }

      // Step until death completes
      for (let i = 0; i < 20; i++) {
        anim.update(0.1);
      }

      expect(anim.getFrameIdx(), `${facing}: final frameIdx must be last cel`).toBe(indices.length - 1);
      expect(anim.isFinished(), `${facing}: must be finished at last cel`).toBe(true);
      expect(anim.getState(), `${facing}: state must be dead`).toBe("dead");

      // Verify permanent lock on final cel
      anim.update(1.0);
      expect(anim.getFrameIdx(), `${facing}: must permanently hold last cel`).toBe(indices.length - 1);
      expect(anim.isFinished(), `${facing}: must remain finished`).toBe(true);
    }
  });
});
