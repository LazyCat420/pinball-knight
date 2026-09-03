import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Scene } from "three";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { state, resetState } from "../../state";
import { makeSkinned } from "../../spawn/factory";
import { sheetFor } from "../../boot/sheets";
import { damageZombie, killZombie } from "../../entities/combat";
import { updateZombies } from "../../entities/zombie";
import { animationPresentation } from "../../presentation/animation-system";

describe("Single-Clock Architecture & Death Progression Orchestration", () => {
  beforeEach(() => {
    installSpriteTestDom();
    resetState();
    state.scene = new Scene();
    state.zombies = [];
    state.vfx = new Proxy({}, { get: () => () => {} }) as any;
    state.player = {
      x: 0,
      z: 0,
      momSpeed: 12,
      hp: 10,
      anim: { update: () => {} } as any,
    } as any;
    state.grid = { w: 20, h: 20, t: new Uint8Array(400).fill(1), shapes: new Uint8Array(400) } as any;
  });

  it("updates animators exactly once per rendered frame with no double-ticks", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 1, 0, 1)!;
    state.zombies.push(g);

    const initialTicks = g.anim.debugTicks().ticks;

    // Simulate 30 rendered frames through the central presentation system
    for (let f = 0; f < 30; f++) {
      animationPresentation.update(0.016);
    }

    const finalTicks = g.anim.debugTicks().ticks;
    expect(finalTicks - initialTicks).toBe(30);
  });

  it("advances goblin death through 4 stages and permanently holds the final melted frame", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 1, 0, 1)!;
    state.zombies.push(g);

    // Lethal hit
    damageZombie(g, 100, 0, 1, 1, true);

    expect(g.mode).toBe("dead");
    expect(g.anim.getClip()).toBe("death");
    expect(g.anim.getFrameIdx()).toBe(0);

    const seenFrames = new Set<number>();
    seenFrames.add(g.anim.getFrameIdx());

    // Step the presentation clock across 60 frames (~1.0 sec, death is 6 fps = ~0.66s)
    for (let f = 0; f < 60; f++) {
      updateZombies(0.016);
      animationPresentation.update(0.016);
      seenFrames.add(g.anim.getFrameIdx());
    }

    // Must have visited all 4 frames: 0, 1, 2, 3
    expect(seenFrames.has(0)).toBe(true);
    expect(seenFrames.has(1)).toBe(true);
    expect(seenFrames.has(2)).toBe(true);
    expect(seenFrames.has(3)).toBe(true);

    // Must be finished and holding the final melted frame
    expect(g.anim.getFrameIdx()).toBe(3);
    expect(g.anim.isFinished()).toBe(true);

    // Subsequent ticks must maintain frame 3 and never resurrect or reset to 0
    for (let f = 0; f < 30; f++) {
      updateZombies(0.016);
      animationPresentation.update(0.016);
    }
    expect(g.anim.getFrameIdx()).toBe(3);
    expect(g.anim.isFinished()).toBe(true);

    // Re-firing killZombie or damageZombie must not reset to 0
    killZombie(g);
    expect(g.anim.getFrameIdx()).toBe(3);
  });

  it("enforces static architecture constraint: no direct .anim.update() calls in gameplay/entities/coop", () => {
    const srcRoot = path.resolve(__dirname, "../../");
    const checkDirs = ["entities", "spawn", "sim"];
    const checkFiles = ["coop.ts", "boss.ts"];

    const illegalCalls: string[] = [];

    function scanFile(filePath: string) {
      if (!filePath.endsWith(".ts") || filePath.endsWith(".test.ts") || filePath.endsWith(".d.ts")) return;
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        // Exclude intentional deterministic corpse death animation advancement in zombie.ts
        if (filePath.endsWith("entities/zombie.ts") && line.includes("z.anim.update(dt)")) return;
        if (line.includes(".anim.update(") || line.includes(".anim?.update?.(")) {
          illegalCalls.push(`${path.relative(srcRoot, filePath)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    function scanDir(dirPath: string) {
      if (!fs.existsSync(dirPath)) return;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dirPath, ent.name);
        if (ent.isDirectory()) scanDir(full);
        else scanFile(full);
      }
    }

    for (const d of checkDirs) scanDir(path.join(srcRoot, d));
    for (const f of checkFiles) scanFile(path.join(srcRoot, f));

    expect(illegalCalls, "Direct .anim.update() calls found in gameplay code outside presentation system").toEqual([]);
  });
});
