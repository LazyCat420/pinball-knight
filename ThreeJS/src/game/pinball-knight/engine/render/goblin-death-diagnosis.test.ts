import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { Scene } from "three";
import { state, resetState } from "../../state";
import { makeSkinned } from "../../spawn/factory";
import { sheetFor, loadMonsterSheet } from "../../boot/sheets";
import { killZombie, damageZombie } from "../../entities/combat";
import { updateZombies } from "../../entities/zombie";
import { animationPresentation } from "../../presentation/animation-system";
import { installSpriteTestDom } from "../../testkit/atlas-census";

import * as fs from "node:fs";
import * as path from "node:path";

describe("Goblin Real Death Progression Diagnosis", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = installSpriteTestDom();
    // Provide fetch returning real files from disk
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, ...args: any[]) => {
      const urlStr = String(url);
      if (urlStr.includes("goblin-S.json")) {
        const json = fs.readFileSync(path.resolve("public/sprites/goblin-S.json"), "utf8");
        return new Response(json, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (urlStr.includes("goblin-S.png")) {
        const png = fs.readFileSync(path.resolve("public/sprites/goblin-S.png"));
        return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return originalFetch(url, ...args);
    };
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

  it("diagnoses goblin death progression when using imported art and full presentation tick", async () => {
    // 1. Load imported sheet for goblin
    const loaded = await loadMonsterSheet("goblin");
    console.log("loadMonsterSheet('goblin') result:", loaded);

    // 2. Build goblin
    const g = makeSkinned("goblin", 5, 5, 1);
    expect(g).not.toBeNull();
    state.zombies = [g!];

    console.log("Goblin initial clip:", g!.anim.getClip());
    console.log("Goblin initial facing:", g!.anim.getFacing());
    console.log("Goblin initial indices:", (g!.anim as any).indices());
    console.log("Goblin sheet clips:", Object.keys((g!.sprite as any).sheet.clips));

    // 3. Kill goblin
    killZombie(g!);
    console.log("After killZombie:");
    console.log("  mode:", g!.mode);
    console.log("  clip:", g!.anim.getClip());
    console.log("  facing:", g!.anim.getFacing());
    console.log("  indices:", (g!.anim as any).indices());
    console.log("  frameIdx:", g!.anim.getFrameIdx());
    console.log("  finished:", g!.anim.isFinished());

    const framesVisited: Array<{ step: number; frameIdx: number; texOffset: any; finished: boolean }> = [];
    framesVisited.push({
      step: 0,
      frameIdx: g!.anim.getFrameIdx(),
      texOffset: { ...(g!.sprite as any).mesh.material.map?.offset },
      finished: g!.anim.isFinished(),
    });

    // 4. Step 60 frames (1 second at 60fps)
    for (let f = 1; f <= 60; f++) {
      updateZombies(0.016);
      animationPresentation.update(0.016);
      const curFrame = g!.anim.getFrameIdx();
      const last = framesVisited[framesVisited.length - 1];
      if (last.frameIdx !== curFrame || last.finished !== g!.anim.isFinished()) {
        framesVisited.push({
          step: f,
          frameIdx: curFrame,
          texOffset: { ...(g!.sprite as any).mesh.material.map?.offset },
          finished: g!.anim.isFinished(),
        });
      }
    }

    console.log("Frames visited during death progression:", JSON.stringify(framesVisited, null, 2));

    for (const dir of ["S", "N", "E", "W"] as const) {
      const g = makeSkinned("goblin", 5, 5, 1);
      expect(g).not.toBeNull();
      state.zombies = [g!];
      g!.anim.setFacing(dir);
      expect(g!.anim.getFacing()).toBe(dir);

      killZombie(g!);
      expect(g!.mode).toBe("dead");
      expect(g!.anim.getClip()).toBe("death");
      expect(g!.anim.getFrameIdx()).toBe(0);

      const frames = new Set<number>();
      frames.add(g!.anim.getFrameIdx());

      for (let f = 1; f <= 60; f++) {
        updateZombies(0.016);
        animationPresentation.update(0.016);
        frames.add(g!.anim.getFrameIdx());
      }

      console.log(`Facing ${dir} visited frames:`, Array.from(frames), "finished:", g!.anim.isFinished());
      expect(frames.has(0)).toBe(true);
      expect(frames.has(1)).toBe(true);
      expect(frames.has(2)).toBe(true);
      expect(frames.has(3)).toBe(true);
      expect(g!.anim.isFinished()).toBe(true);
    }
  });
});
