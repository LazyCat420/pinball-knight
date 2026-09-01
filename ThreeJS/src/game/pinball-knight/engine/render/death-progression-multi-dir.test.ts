import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { Scene } from "three";
import { state, resetState } from "../../state";
import { makeZombie } from "../../spawn/factory";
import { sheetFor, type SheetKey } from "../../boot/sheets";
import { killZombie } from "../../entities/combat";
import { updateZombies } from "../../entities/zombie";
import { installSpriteTestDom } from "../../testkit/atlas-census";

describe("Monster Death Animation Multi-Directional Progression", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = installSpriteTestDom();
  });
  afterAll(() => {
    restore();
  });

  beforeEach(() => {
    resetState();
    state.scene = new Scene();
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400),
      shapes: new Uint8Array(400),
    };
  });

  const ALL_KINDS: SheetKey[] = [
    "goblin", "bat", "ghost", "warden", "reaper", "slime", "spider", "spitter",
    "sporeling", "chomper", "croaker", "rotortail", "necromancer", "crystalback",
    "mimic", "golem", "magnet", "webspinner", "hound", "pin", "dragon", "broodmother"
  ];

  for (const kind of ALL_KINDS) {
    describe(`${kind} death progression across facings`, () => {
      for (const dir of ["S", "N", "E", "W"] as const) {
        it(`progresses from frame 0 to frame 3 and holds when facing ${dir}`, () => {
          const sheet = sheetFor(kind);
          expect(sheet).toBeDefined();

          const z = makeZombie(sheet, 5, 5, 1, { kind: kind as any });
          state.zombies = [z];

          z.anim.setFacing(dir);
          killZombie(z);

          expect(z.mode).toBe("dead");
          expect(z.anim.getClip()).toBe("death");
          expect(z.anim.getFrameIdx()).toBe(0);

          // Step physics & animation over 1 second (60 frames at ~60fps)
          for (let f = 0; f < 60; f++) {
            updateZombies(0.016);
            z.anim.update(0.016);
          }

          // Must have reached the final death frame and hold finished indefinitely
          expect(z.anim.isFinished(), `${kind} facing ${dir} must mark animation finished`).toBe(true);
          expect(z.anim.getFrameIdx(), `${kind} facing ${dir} must hold last death frame`).toBeGreaterThanOrEqual(3);

          // Additional ticks must NOT reset frameIdx
          for (let f = 0; f < 30; f++) {
            updateZombies(0.016);
            z.anim.update(0.016);
          }
          expect(z.anim.getFrameIdx(), `${kind} facing ${dir} never resurrects or resets to 0`).toBeGreaterThanOrEqual(3);
          expect(z.anim.isFinished(), `${kind} facing ${dir} remains finished`).toBe(true);
        });
      }
    });
  }
});
