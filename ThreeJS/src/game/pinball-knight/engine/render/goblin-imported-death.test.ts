import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importedPaints, type ImportedSheet } from "../../render/imported-paints";
import { buildSpriteSheet, createActorSprite } from "./sprite";
import { MonsterAnimator } from "./monster-animator";
import { installSpriteTestDom } from "../../testkit/atlas-census";

describe("Goblin Imported Art Death Clip Diagnostics", () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore = installSpriteTestDom();
  });
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("checks what clips are built from actual goblin-S.json", () => {
    const jsonPath = resolve(__dirname, "../../../../../public/sprites/goblin-S.json");
    const manifest = JSON.parse(readFileSync(jsonPath, "utf-8"));
    
    // Fake image canvas
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    
    const importedSheet: ImportedSheet = {
      manifest,
      image: canvas as any,
    };
    
    const paints = importedPaints([importedSheet]);
    expect(paints).not.toBeNull();
    console.log("Paints keys for S:", Object.keys(paints!.S));
    console.log("Paints keys for N:", Object.keys(paints!.N));
    console.log("Paints keys for E:", Object.keys(paints!.E));
    console.log("Death frames count S:", paints!.S.death?.length);
    console.log("Death frames count N:", paints!.N.death?.length);
    console.log("Death frames count E:", paints!.E.death?.length);

    const sheet = buildSpriteSheet(paints!);
    console.log("Sheet clip keys:", Array.from(sheet.clips.keys()));
    console.log("S:death indices:", sheet.clips.get("S:death"));
    console.log("N:death indices:", sheet.clips.get("N:death"));
    console.log("E:death indices:", sheet.clips.get("E:death"));

    const sprite = createActorSprite(sheet, false);
    const anim = new MonsterAnimator(sprite);

    // Test with S facing
    anim.setFacing("S");
    anim.triggerDeath("S");
    console.log("After triggerDeath(S):", {
      state: anim.getState(),
      clip: anim.getClip(),
      facing: anim.getFacing(),
      indices: anim.debugIndices(),
      frameIdx: anim.getFrameIdx(),
    });

    // Advance 0.2s (more than 1 step at 6fps)
    anim.update(0.2);
    console.log("After update(0.2) facing S:", {
      state: anim.getState(),
      clip: anim.getClip(),
      indices: anim.debugIndices(),
      frameIdx: anim.getFrameIdx(),
      finished: anim.isFinished(),
    });

    // Now test with N facing!
    const spriteN = createActorSprite(sheet, false);
    const animN = new MonsterAnimator(spriteN);
    animN.setFacing("N");
    animN.triggerDeath("N");
    console.log("After triggerDeath(N):", {
      state: animN.getState(),
      clip: animN.getClip(),
      facing: animN.getFacing(),
      indices: animN.debugIndices(),
      frameIdx: animN.getFrameIdx(),
    });
    animN.update(0.2);
    console.log("After update(0.2) facing N:", {
      state: animN.getState(),
      clip: animN.getClip(),
      indices: animN.debugIndices(),
      frameIdx: animN.getFrameIdx(),
      finished: animN.isFinished(),
    });

    // Now test with W facing!
    const spriteW = createActorSprite(sheet, false);
    const animW = new MonsterAnimator(spriteW);
    animW.setFacing("W");
    animW.triggerDeath("W");
    console.log("After triggerDeath(W):", {
      state: animW.getState(),
      clip: animW.getClip(),
      facing: animW.getFacing(),
      indices: animW.debugIndices(),
      frameIdx: animW.getFrameIdx(),
    });
    animW.update(0.2);
    console.log("After update(0.2) facing W:", {
      state: animW.getState(),
      clip: animW.getClip(),
      indices: animW.debugIndices(),
      frameIdx: animW.getFrameIdx(),
      finished: animW.isFinished(),
    });
  });
});
