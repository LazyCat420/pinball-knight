import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { Scene } from "three";
import { state, resetState } from "../../state";
import { makeZombie } from "../../spawn/factory";
import { sheetFor, type SheetKey } from "../../boot/sheets";
import { killZombie, damageZombie } from "../../entities/combat";
import { updateZombies } from "../../entities/zombie";
import { installSpriteTestDom } from "../../testkit/atlas-census";

describe("Monster Death Runtime Lifecycle & Dependency Chain", () => {
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
    state.player = {
      x: 5,
      z: 5,
      hp: 100,
      facing: "S",
      anim: { update() {} } as any,
      momSpeed: 0,
      bounceCombo: 0,
      iframes: 0,
    } as any;
  });

  const TEST_KINDS: SheetKey[] = ["goblin", "bat", "spider", "brute", "golem", "slime", "chomper"];

  for (const kind of TEST_KINDS) {
    it(`progresses smoothly through all 4 death frames (0 -> 1 -> 2 -> 3) for ${kind}`, () => {
      const sheet = sheetFor(kind);
      expect(sheet).toBeDefined();

      const z = makeZombie(sheet, 6, 6, 1, { kind: kind as any });
      state.zombies = [z];

      expect(z.mode).toBe("idle");
      expect(z.anim.getClip()).toBe("idle");

      killZombie(z);

      expect(z.mode).toBe("dead");
      expect(z.anim.getClip()).toBe("death");
      expect(z.anim.getFrameIdx()).toBe(0);
      expect(z.anim.isFinished()).toBe(false);

      // Frame progression across simulation and presentation steps:
      // At 6 FPS, each frame takes 1/6s (~0.1667s).
      // Step ~0.18s -> must be on Frame 1
      for (let t = 0; t < 11; t++) {
        updateZombies(0.016);
        z.anim.update(0.016);
      }
      expect(z.anim.getFrameIdx(), "Must advance to death frame 1").toBe(1);

      // Step another ~0.18s -> must be on Frame 2
      for (let t = 0; t < 11; t++) {
        updateZombies(0.016);
        z.anim.update(0.016);
      }
      expect(z.anim.getFrameIdx(), "Must advance to death frame 2").toBe(2);

      // Step another ~0.18s -> must be on Frame 3 or higher
      for (let t = 0; t < 11; t++) {
        updateZombies(0.016);
        z.anim.update(0.016);
      }
      expect(z.anim.getFrameIdx(), "Must advance to death frame 3").toBeGreaterThanOrEqual(3);

      // Advance to full completion (covering 4-frame and 5-frame death sequences)
      for (let t = 0; t < 15; t++) {
        updateZombies(0.016);
        z.anim.update(0.016);
      }
      expect(z.anim.isFinished(), "Must mark finished on terminal frame").toBe(true);

      const finalFrame = z.anim.getFrameIdx();

      // Subsequent ticks and redundant kill/damage attempts must NEVER reset frame to 0
      for (let t = 0; t < 30; t++) {
        damageZombie(z, 50, 0, 1, 1);
        updateZombies(0.016);
        z.anim.update(0.016);
      }
      expect(z.anim.getFrameIdx(), "Must remain on last frame and not snap to 0").toBe(finalFrame);
      expect(z.anim.isFinished()).toBe(true);
    });
  }

  it("prevents redundant play('death') calls from interrupting an ongoing death animation", () => {
    const sheet = sheetFor("goblin");
    const z = makeZombie(sheet, 6, 6, 1, { kind: "goblin" });
    state.zombies = [z];

    killZombie(z);
    expect(z.anim.getFrameIdx()).toBe(0);

    // Advance to frame 2
    for (let t = 0; t < 22; t++) {
      updateZombies(0.016);
      z.anim.update(0.016);
    }
    expect(z.anim.getFrameIdx()).toBe(2);

    // Calling play('death', { force: true }) or killZombie again must NOT reset frameIdx to 0
    z.anim.play("death", { force: true });
    expect(z.anim.getFrameIdx()).toBe(2);

    killZombie(z);
    expect(z.anim.getFrameIdx()).toBe(2);
  });
});
