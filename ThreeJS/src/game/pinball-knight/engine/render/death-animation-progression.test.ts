import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Animator } from "./animator";
import type { SheetManifest } from "../../tools/sprite-forge/manifest";
import type { ActorSprite } from "./sprite";

const SPRITES_DIR = "/home/lazycat/github/projects/sun/pinball-knight/ThreeJS/public/sprites";

const MONSTER_AND_BOSS_SHEETS = [
  "goblin-S",
  "slime-S",
  "spider-S",
  "demon-S",
  "sporeling-S",
  "croaker-S",
  "chomper-S",
  "crawler-S",
  "necro-S",
  "crystalback-S",
  "mimic-S",
  "ghost-S",
  "bat-S",
  "golem-S",
  "magnet-S",
  "webspinner-S",
  "hound-S",
  "pin-S",
  "warden-S",
  "reaper-S",
  "broodmother-S",
  "overlord-S",
  "archivist-S",
  "dragon-S",
];

describe("Monster and Boss Death Animation Progression", () => {
  it("every monster and boss has a valid death animation manifest with 0-3 frames", () => {
    for (const sheetName of MONSTER_AND_BOSS_SHEETS) {
      const manifestPath = join(SPRITES_DIR, `${sheetName}.json`);
      expect(existsSync(manifestPath), `Manifest exists for ${sheetName}`).toBe(true);

      const manifest: SheetManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.rows, `Manifest has rows for ${sheetName}`).toBeDefined();

      const deathRow = manifest.rows.find((r) => r.clip === "death");
      expect(deathRow, `Manifest has death row for ${sheetName}`).toBeDefined();
      expect(
        deathRow!.cells.length,
        `${sheetName} death frames count should be >= 3 (got ${deathRow!.cells.length})`,
      ).toBeGreaterThanOrEqual(3);

      // Verify that each death frame has a non-empty cell rectangle [x0, y0, x1, y1]
      for (let i = 0; i < deathRow!.cells.length; i++) {
        const [x0, y0, x1, y1] = deathRow!.cells[i];
        expect(x1, `${sheetName} death cell ${i} x1 > x0`).toBeGreaterThan(x0);
        expect(y1, `${sheetName} death cell ${i} y1 > y0`).toBeGreaterThan(y0);
      }
    }
  });

  it("animator advances death from frame 0 through 3 and holds on the final frame (S-death3)", () => {
    for (const sheetName of MONSTER_AND_BOSS_SHEETS) {
      const manifestPath = join(SPRITES_DIR, `${sheetName}.json`);
      const manifest: SheetManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const deathRow = manifest.rows.find((r) => r.clip === "death")!;
      const frameCount = deathRow.cells.length;
      const frameIndices = deathRow.cells.map((_, i) => i);

      let currentFrame = -1;
      let currentFlipped = false;

      const mockSprite: Partial<ActorSprite> = {
        sheet: {
          clips: new Map<string, number[]>([
            [`${manifest.dir}:death`, frameIndices],
          ]),
          beats: {},
        } as any,
        setFrame(f: number) {
          currentFrame = f;
        },
        setFlipped(fl: boolean) {
          currentFlipped = fl;
        },
      };

      const anim = new Animator(mockSprite as ActorSprite);
      anim.setFacing(manifest.dir as any);
      anim.play("death", { force: true });

      // Frame at start must be the first frame (frame 0)
      expect(currentFrame, `${sheetName} death begins on first death frame 0`).toBe(frameIndices[0]);
      expect(anim.isFinished(), `${sheetName} death is not finished at frame 0`).toBe(false);

      // Step forward with dt in 0.05s increments (simulating game loop updates)
      const visitedFrames: number[] = [currentFrame];
      for (let step = 0; step < 100; step++) {
        anim.update(0.05);
        if (!visitedFrames.includes(currentFrame)) {
          visitedFrames.push(currentFrame);
        }
      }

      // Assert all death frames (0, 1, 2, 3) were sequentially traversed
      for (let i = 0; i < frameCount; i++) {
        expect(
          visitedFrames,
          `${sheetName} visited death frame ${i}`,
        ).toContain(frameIndices[i]);
      }

      // Final state must hold on the last frame (frame 3 / S-death3) indefinitely
      const lastDeathFrame = frameIndices[frameCount - 1];
      expect(currentFrame, `${sheetName} holds indefinitely on last death frame`).toBe(lastDeathFrame);
      expect(anim.isFinished(), `${sheetName} marks clip as finished`).toBe(true);

      // Additional updates after finish should NOT restart or jump away from the last frame
      for (let step = 0; step < 50; step++) {
        anim.update(0.1);
        expect(currentFrame, `${sheetName} remains held on last death frame`).toBe(lastDeathFrame);
      }
    }
  });
});
