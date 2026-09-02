import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Scene } from "three";
import { createCanvas, loadImage } from "canvas";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { state, resetState } from "../../state";
import { makeZombie } from "../../spawn/factory";
import { sheetFor, paintsFor, imported, importedPalettes, type SheetKey } from "../../boot/sheets";
import { importedPaints, sheetPalette, type ImportedSheet } from "../../render/imported-paints";
import { buildSpriteSheet } from "./sprite";
import { Animator } from "./animator";
import { updateZombies } from "../../entities/zombie";
import { killZombie } from "../../entities/combat";
import { withRecoil } from "../../render/cel-painter";
import type { SheetManifest } from "../../tools/sprite-forge/manifest";

describe("Sandbox Visual Trace for Goblin & Monster Death Animations", () => {
  it("renders, steps, extracts and verifies every single death frame from 0 to 3 for goblin", async () => {
    const restore = installSpriteTestDom();
    resetState();
    state.scene = new Scene();
    state.player = {
      x: 10,
      z: 10,
      hp: 100,
      anim: { update: () => {} } as any,
    } as any;
    state.grid = { w: 20, h: 20, tiles: new Uint8Array(400).fill(1) } as any;

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

    const mergedPaints = paintsFor("goblin");
    const sheet = buildSpriteSheet(withRecoil(mergedPaints));
    console.log("Sheet built: frameCount =", sheet.frameCount, "cols =", sheet.cols, "rows =", sheet.rows);

    const deathIndices = sheet.clips.get("S:death")!;
    console.log("S:death indices:", deathIndices);
    expect(deathIndices.length).toBe(4);

    const z = makeZombie(sheet, 6, 6, 1, { kind: "goblin" });
    state.zombies = [z];

    killZombie(z);
    expect(z.mode).toBe("dead");
    expect(z.anim.getClip()).toBe("death");
    expect(z.anim.getFrameIdx()).toBe(0);

    // ../../ lands on `pinball-knight/`, whose `tools/sprite-forge/work` is
    // where every other forge artefact goes. FIVE levels up landed on the repo
    // root instead and wrote an untracked `ThreeJS/tools/` that nobody reads —
    // and that leaves the tree dirty, which the ship guard refuses to deploy.
    const outDir = path.resolve(__dirname, "../../tools/sprite-forge/work/sandbox-output");
    fs.mkdirSync(outDir, { recursive: true });

    const canvas = (sheet.texture as any).image;
    console.log("Atlas canvas dimensions:", canvas.width, "x", canvas.height);

    let recordedFrames: number[] = [];
    const frameSnapshots: string[] = [];

    for (let step = 0; step < 60; step++) {
      const prevFrame = z.anim.getFrameIdx();
      updateZombies(0.016);
      z.anim.update(0.016);
      const curFrame = z.anim.getFrameIdx();

      if (curFrame !== prevFrame || step === 0 || z.anim.isFinished()) {
        console.log(`Step ${step.toString().padStart(2, " ")} (t = ${(step * 0.016).toFixed(3)}s): clip = ${z.anim.getClip()}, frameIdx = ${curFrame}, finished = ${z.anim.isFinished()}`);
        if (!recordedFrames.includes(curFrame)) {
          recordedFrames.push(curFrame);

          const globalFrameIndex = deathIndices[curFrame];
          const col = globalFrameIndex % sheet.cols;
          const row = Math.floor(globalFrameIndex / sheet.cols);
          const cellW = canvas.width / sheet.cols;
          const cellH = canvas.height / sheet.rows;

          const cellCanvas = createCanvas(cellW, cellH);
          const cellCtx = cellCanvas.getContext("2d");
          cellCtx.drawImage(canvas, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);

          const outPath = path.join(outDir, `goblin-death-${curFrame}.png`);
          fs.writeFileSync(outPath, cellCanvas.toBuffer("image/png"));
          frameSnapshots.push(outPath);
          console.log(`  -> Extracted death frame ${curFrame} (atlas cell [${col}, ${row}]) to ${outPath}`);
        }
      }
    }

    expect(recordedFrames).toEqual([0, 1, 2, 3]);
    expect(z.anim.isFinished()).toBe(true);
    expect(z.anim.getFrameIdx()).toBe(3);

    // Verify all 4 extracted files exist and are non-empty
    for (const p of frameSnapshots) {
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(500);
    }

    restore();
  });
});
