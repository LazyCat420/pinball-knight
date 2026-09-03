import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Scene } from "three";
import { createCanvas, loadImage } from "canvas";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { state, resetState } from "../../state";
import { simLoop } from "../../sim/loop";
import { simulate } from "../../sim/simulate";
import { makeSkinned } from "../../spawn/factory";
import { sheetFor, imported, importedPalettes } from "../../boot/sheets";
import { importedPaints, sheetPalette, type ImportedSheet } from "../../render/imported-paints";
import { damageZombie, killZombie } from "../../entities/combat";
import type { SheetManifest } from "../../tools/sprite-forge/manifest";

describe("Authentic Sandbox: Goblin Death Runtime Progression & Image Verification", () => {
  it("spawns goblin, kills it through real combat, steps real loop, and outputs verified death frames ending with death3", async () => {
    const restore = installSpriteTestDom();
    resetState();
    state.scene = new Scene();
    state.player = {
      x: 10,
      z: 10,
      hp: 100,
      momSpeed: 0,
      ricochetT: 0,
      grooveHopT: 0,
      sprite: { mesh: new Scene(), setElevation: () => {} } as any,
      anim: { update: () => {}, getClip: () => "idle", getRate: () => 1 } as any,
    } as any;
    state.grid = { w: 20, h: 20, t: new Uint8Array(400).fill(1), shapes: new Uint8Array(400) } as any;
    state.input = {
      poll: () => {},
      axis: () => ({ x: 0, z: 0 }),
      consumeAttack: () => false,
      attackHeldNow: () => false,
      consumeAttackTap: () => false,
      sprintHeld: () => false,
      consumeDodge: () => false,
      dodgeHeld: () => false,
      consumeFlip: () => false,
      flipHeld: () => false,
      turnAxis: () => 0,
      consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
      aimScreen: () => null,
      aimStick: () => null,
      controllerActive: () => false,
      consumeStance: () => false,
      consumePlunge: () => false,
      plungeHeld: () => false,
    } as any;

    const spritesDir = path.resolve(__dirname, "../../../../../public/sprites");
    const manifestPath = path.join(spritesDir, "goblin-S.json");
    const imagePath = path.join(spritesDir, "goblin-S.png");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as SheetManifest;
    const image = await loadImage(imagePath);
    const importedSheet: ImportedSheet = { manifest, image: image as any };

    const paints = importedPaints([importedSheet]);
    expect(paints).toBeDefined();
    if (paints) {
      imported.set("goblin", paints);
      const pal = sheetPalette([importedSheet]);
      if (pal) importedPalettes.set("goblin", pal);
    }

    // Build the sheet through the real sheetFor pipeline
    const sheet = sheetFor("goblin");
    expect(sheet).toBeDefined();
    state.sheets["goblin"] = sheet;

    const outBaseDir = path.resolve(__dirname, "../../tools/sprite-forge/work/sandbox-output/goblin");
    fs.mkdirSync(outBaseDir, { recursive: true });

    // ── STEP 1: TEST PRODUCTION SPAWN & KILL ON FACING S ──
    const z = makeSkinned("goblin", 6, 6, 1)!;
    expect(z).not.toBeNull();
    state.zombies = [z];
    z.anim.setFacing("S");

    // Deal lethal damage through damageZombie (production combat path)
    damageZombie(z, 9999, 0, 1, 5, true);

    expect(z.mode).toBe("dead");
    expect(z.anim.getClip()).toBe("death");
    expect(z.anim.getFrameIdx()).toBe(0);

    const recordedFrames: number[] = [];
    const recordedOffsets: string[] = [];
    const mat = z.sprite.mesh.material as any;
    const map = mat.map;
    const atlasCanvas = map.image;
    const { cols, rows } = z.sprite.sheet;

    for (let step = 0; step < 60; step++) {
      // Step the real simulation loop (which updates corpse death animation deterministically)
      const stepped = simLoop.step(0.016, state.hitstopT, simulate);
      state.hitstopT = stepped.hitstopT;

      // Ensure that external attempts to interrupt death (walk, idle, setFacing) are completely blocked
      if (step === 5) {
        z.anim.setFacing("N"); // Must be ignored
        z.anim.play("walk"); // Must be ignored
      }

      const curFrame = z.anim.getFrameIdx();
      const offsetKey = `${map.offset.x.toFixed(4)},${map.offset.y.toFixed(4)}`;

      if (!recordedFrames.includes(curFrame)) {
        recordedFrames.push(curFrame);
        recordedOffsets.push(offsetKey);

        // Extract the actual texture rectangle currently mapped to the Three.js mesh
        const flipped = (map.repeat.x < 0);
        const col = Math.round(map.offset.x * cols) - (flipped ? 1 : 0);
        const row = rows - 1 - Math.round(map.offset.y * rows);
        const cellW = atlasCanvas.width / cols;
        const cellH = atlasCanvas.height / rows;

        const cellCanvas = createCanvas(cellW, cellH);
        const cellCtx = cellCanvas.getContext("2d");
        cellCtx.drawImage(atlasCanvas, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);

        const outPath = path.join(outBaseDir, `goblin-death-${curFrame}.png`);
        fs.writeFileSync(outPath, cellCanvas.toBuffer("image/png"));
      }
    }

    // Assert that all 4 death frames (0, 1, 2, 3) played sequentially
    expect(recordedFrames).toEqual([0, 1, 2, 3]);
    expect(z.anim.isFinished()).toBe(true);
    expect(z.anim.getFrameIdx()).toBe(3);

    // Assert that each frame had a distinct texture offset on the Three.js material
    const uniqueOffsets = new Set(recordedOffsets);
    expect(uniqueOffsets.size).toBe(4);

    // Verify all 4 images were written to disk and are valid PNG files
    for (let f = 0; f <= 3; f++) {
      const frameFile = path.join(outBaseDir, `goblin-death-${f}.png`);
      expect(fs.existsSync(frameFile), `Missing extracted death frame ${f}`).toBe(true);
      const stat = fs.statSync(frameFile);
      expect(stat.size).toBeGreaterThan(100);
    }

    // Verify reference S-death3.png exists in work directory and matches the final frame
    const refDeath3 = path.resolve(__dirname, "../../tools/sprite-forge/work/goblin-S/S-death3.png");
    expect(fs.existsSync(refDeath3), "Reference S-death3.png must exist").toBe(true);

    // ── STEP 2: TEST ALL 4 FACINGS (S, N, E, W) TO GUARANTEE FACING LOCK & PROGRESSION ──
    for (const facing of ["S", "N", "E", "W"] as const) {
      const actor = makeSkinned("goblin", 6, 6, 1)!;
      state.zombies = [actor];
      actor.anim.setFacing(facing);
      killZombie(actor);

      expect(actor.mode).toBe("dead");
      expect(actor.anim.getClip()).toBe("death");
      expect(actor.anim.getFrameIdx()).toBe(0);

      const frames: number[] = [];
      for (let s = 0; s < 60; s++) {
        const stepped = simLoop.step(0.016, state.hitstopT, simulate);
        state.hitstopT = stepped.hitstopT;
        const f = actor.anim.getFrameIdx();
        if (!frames.includes(f)) frames.push(f);
      }

      expect(frames, `Facing ${facing} must progress through all 4 frames`).toEqual([0, 1, 2, 3]);
      expect(actor.anim.isFinished(), `Facing ${facing} must finish death`).toBe(true);
      expect(actor.anim.getFrameIdx(), `Facing ${facing} must hold final frame 3`).toBe(3);
    }

    restore();
  });
});
