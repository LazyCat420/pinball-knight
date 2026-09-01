import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Animator } from "./animator";
import {
  makeGoblinPaints,
  makeBatPaints,
  makePinPaints,
  makeChomperPaints,
  makeMagnetPaints,
  makeWebspinnerPaints,
  makeGolemPaints,
  makeSlimePaints,
  makeSpiderPaints,
  makeZombiePaints,
  makeReaperPaints,
  ZOMBIE_VARIANTS,
} from "../../render/cel-painter";
import { makeFishFeetPaints } from "../../render/monsters/fish_feet";
import { makeJesterPaints } from "../../render/monsters/jester";
import { makeRotortailPaints } from "../../render/monsters/rotortail";
import { makeCroakerPaints } from "../../render/monsters/croaker";
import { makeStiltneckPaints } from "../../render/monsters/stiltneck";
import { startSpriteSheet } from "./sprite";
import { installSpriteTestDom } from "../../testkit/atlas-census";

function mockSprite(paints: ReturnType<typeof makeGoblinPaints>) {
  const build = startSpriteSheet(paints);
  build.finish();
  const sheet = build.sheet;
  let currentFrame = 0;
  return {
    sprite: {
      mesh: {} as any,
      sheet,
      setFrame(f: number) {
        currentFrame = f;
      },
      setFlipped() {},
      setTint() {},
      setSheet() {},
      getCurrentFrame: () => currentFrame,
    },
    sheet,
  };
}

describe("All Monsters 4-Stage Death Animation Progression", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = installSpriteTestDom();
  });
  afterAll(() => {
    restore();
  });

  const monsterFactories = [
    { name: "goblin", fn: () => makeGoblinPaints() },
    { name: "bat", fn: () => makeBatPaints() },
    { name: "pin", fn: () => makePinPaints() },
    { name: "chomper", fn: () => makeChomperPaints() },
    { name: "magnet", fn: () => makeMagnetPaints() },
    { name: "webspinner", fn: () => makeWebspinnerPaints() },
    { name: "golem", fn: () => makeGolemPaints() },
    { name: "slime", fn: () => makeSlimePaints() },
    { name: "spider", fn: () => makeSpiderPaints() },
    { name: "fish_feet", fn: () => makeFishFeetPaints() },
    { name: "jester", fn: () => makeJesterPaints() },
    { name: "rotortail", fn: () => makeRotortailPaints() },
    { name: "croaker", fn: () => makeCroakerPaints() },
    { name: "stiltneck", fn: () => makeStiltneckPaints() },
    { name: "zombie", fn: () => makeZombiePaints(ZOMBIE_VARIANTS[0]) },
    { name: "reaper", fn: () => makeReaperPaints() },
  ];

  for (const { name, fn } of monsterFactories) {
    it(`plays all 4 death frames (0 -> 1 -> 2 -> 3) for ${name}`, () => {
      const paints = fn();
      const { sprite, sheet } = mockSprite(paints);
      const sDeathFrames = sheet.clips.get("S:death");
      expect(sDeathFrames, `${name} must have an S:death clip`).toBeDefined();
      expect(sDeathFrames!.length, `${name} must have at least 4 death frames`).toBeGreaterThanOrEqual(4);

      const anim = new Animator(sprite as any, { facing: "S" });
      anim.play("death");
      expect(anim.getFrameIdx()).toBe(0);
      expect(anim.isFinished()).toBe(false);

      // Step at 6 FPS (1 frame = 1/6s ~= 0.1667s)
      anim.update(0.18);
      expect(anim.getFrameIdx()).toBe(1);
      expect(anim.isFinished()).toBe(false);

      anim.update(0.18);
      expect(anim.getFrameIdx()).toBe(2);
      expect(anim.isFinished()).toBe(false);

      anim.update(0.18);
      expect(anim.getFrameIdx()).toBe(3);

      // Advance further and ensure it holds on final frame and finishes
      anim.update(0.5);
      expect(anim.getFrameIdx()).toBe(sDeathFrames!.length - 1);
      expect(anim.isFinished()).toBe(true);
    });
  }
});
