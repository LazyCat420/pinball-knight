import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { Scene } from "three";
import { state, resetState } from "../state";
import { makeZombie } from "../spawn/factory";
import { sheetFor, IMPORTED_ART, type SheetKey } from "../boot/sheets";
import { killZombie } from "./combat";
import { updateZombies } from "./zombie";
import { installSpriteTestDom } from "../testkit/atlas-census";

describe("Monster Death Animation S-death0-3 Progression", () => {
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

  const TEST_KINDS: SheetKey[] = [
    "goblin",
    "slime",
    "spider",
    "spitter",
    "sporeling",
    "chomper",
    "croaker",
    "rotortail",
    "warden",
    "necromancer",
    "crystalback",
    "mimic",
    "ghost",
    "bat",
    "golem",
    "magnet",
    "webspinner",
    "hound",
    "pin",
  ];

  for (const kind of TEST_KINDS) {
    it(`plays all 4 death frames in sequence for ${kind}`, () => {
      const sheet = sheetFor(kind);
      expect(sheet).toBeDefined();

      const deathClips = sheet.clips.get("S:death");
      expect(deathClips, `${kind} must author death frames for S:death`).toBeDefined();
      expect(deathClips!.length, `${kind} must have at least 4 death frames`).toBeGreaterThanOrEqual(4);

      const z = makeZombie(sheet, 5, 5, 1, { kind: kind as any });
      state.zombies.push(z);

      expect(z.anim.getClip()).toBe("idle");

      // Trigger death
      killZombie(z);

      expect(z.mode).toBe("dead");
      expect(z.anim.getClip()).toBe("death");
      expect(z.anim.getFrameIdx()).toBe(0);

      // Advance through all death frames sequentially
      for (let f = 1; f < deathClips!.length; f++) {
        z.anim.update(0.17);
        expect(z.anim.getFrameIdx(), `${kind} death frame ${f}`).toBe(f);
      }

      // Step past final frame -> must hold the final death frame (does not wrap to 0)
      z.anim.update(0.17);
      expect(z.anim.getFrameIdx(), `${kind} holds last death frame`).toBe(deathClips!.length - 1);
      expect(z.anim.isFinished(), `${kind} death animation marked finished`).toBe(true);
    });
  }
});
