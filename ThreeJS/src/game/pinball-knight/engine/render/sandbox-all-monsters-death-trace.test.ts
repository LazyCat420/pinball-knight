import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Scene } from "three";
import { createCanvas, loadImage } from "canvas";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { state, resetState } from "../../state";
import { makeZombie } from "../../spawn/factory";
import { paintsFor, imported, importedPalettes, type SheetKey } from "../../boot/sheets";
import { importedPaints, sheetPalette, type ImportedSheet } from "../../render/imported-paints";
import { buildSpriteSheet } from "./sprite";
import { simLoop } from "../../sim/loop";
import { simulate } from "../../sim/simulate";
import { killZombie } from "../../entities/combat";
import { withRecoil } from "../../render/cel-painter";
import type { SheetManifest } from "../../tools/sprite-forge/manifest";
import type { Dir } from "./paint-types";

const MONSTER_SHEET_MAP: Record<string, string> = {
  goblin: "goblin",
  fish_feet: "fish_feet",
  brute: "brute",
  jester: "jester",
  rotortail: "crawler",
  croaker: "croaker",
  zombie: "zombie",
  slime: "slime",
  spider: "spider",
  spitter: "demon",
  sporeling: "sporeling",
  chomper: "chomper",
  warden: "warden",
  necromancer: "necro",
  crystalback: "crystalback",
  mimic: "mimic",
  ghost: "ghost",
  bat: "bat",
  golem: "golem",
  magnet: "magnet",
  webspinner: "webspinner",
  hound: "hound",
  pin: "pin",
  reaper: "reaper",
  broodmother: "broodmother",
  overlord: "overlord",
  archivist: "archivist",
  dragon: "dragon",
  boss: "overlord",
};

describe("Sandbox Visual Frame-by-Frame Trace for All Monsters", () => {
  it("verifies and extracts full death progression from live ActorSprite UV offsets for all monsters", async () => {
    const restore = installSpriteTestDom();
    const spritesDir = path.resolve(__dirname, "../../../../../public/sprites");
    const outBaseDir = path.resolve(__dirname, "../../tools/sprite-forge/work/sandbox-output");
    fs.mkdirSync(outBaseDir, { recursive: true });

    const DIRS: Dir[] = ["S", "E", "N"];

    for (const [key, name] of Object.entries(MONSTER_SHEET_MAP)) {
      resetState();
      state.scene = new Scene();
      state.player = {
        x: 10,
        z: 10,
        hp: 100,
        momSpeed: 0,
        anim: { update: () => {} } as any,
      } as any;
      state.grid = { w: 20, h: 20, t: new Uint8Array(400).fill(1), shapes: new Uint8Array(400) } as any;

      // Load all available directional manifests for this monster
      const loaded: ImportedSheet[] = [];
      for (const d of DIRS) {
        const jsonPath = path.join(spritesDir, `${name}-${d}.json`);
        const pngPath = path.join(spritesDir, `${name}-${d}.png`);
        if (fs.existsSync(jsonPath) && fs.existsSync(pngPath)) {
          const manifest = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as SheetManifest;
          const image = await loadImage(pngPath);
          loaded.push({ manifest, image: image as any });
        }
      }

      expect(loaded.length, `Expected at least one sprite sheet for ${key} (${name})`).toBeGreaterThan(0);

      const paints = importedPaints(loaded);
      expect(paints, `importedPaints failed for ${key}`).toBeDefined();
      if (paints) {
        imported.set(key as SheetKey, paints);
        const pal = sheetPalette(loaded);
        if (pal) importedPalettes.set(key as SheetKey, pal);
      }

      const mergedPaints = paintsFor(key as SheetKey);
      const sheet = buildSpriteSheet(withRecoil(mergedPaints));

      const z = makeZombie(sheet, 6, 6, 1, { kind: key as any });
      state.zombies = [z];

      killZombie(z);
      expect(z.mode).toBe("dead");
      expect(z.anim.getClip()).toBe("death");
      expect(z.anim.getFrameIdx()).toBe(0);

      const monsterOutDir = path.join(outBaseDir, key);
      fs.mkdirSync(monsterOutDir, { recursive: true });

      const mat = z.sprite.mesh.material as any;
      const map = mat.map;
      const atlasCanvas = map.image;
      const { cols, rows } = z.sprite.sheet;
      const deathIndices = (sheet.clips.get("S:death") ?? sheet.clips.get("E:death") ?? sheet.clips.get("N:death"))!;
      expect(deathIndices, `Missing death clip indices for ${key}`).toBeDefined();
      const recordedFrames: number[] = [];

      for (let step = 0; step < 60; step++) {
        simLoop.step(0.016, state.hitstopT, simulate);
        z.anim.update(0.016);
        const curFrame = z.anim.getFrameIdx();

        if (!recordedFrames.includes(curFrame)) {
          recordedFrames.push(curFrame);

          // Decode UV coordinates directly from the live Three.js material map
          const flipped = (map.repeat.x < 0);
          const col = Math.round(map.offset.x * cols) - (flipped ? 1 : 0);
          const row = rows - 1 - Math.round(map.offset.y * rows);
          const cellW = atlasCanvas.width / cols;
          const cellH = atlasCanvas.height / rows;

          const cellCanvas = createCanvas(cellW, cellH);
          const cellCtx = cellCanvas.getContext("2d");
          cellCtx.drawImage(atlasCanvas, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);

          const outPath = path.join(monsterOutDir, `${key}-death-${curFrame}.png`);
          fs.writeFileSync(outPath, cellCanvas.toBuffer("image/png"));
        }
      }

      const expectedFrames = Array.from({ length: deathIndices.length }, (_, i) => i);
      expect(recordedFrames, `${key} must play all ${deathIndices.length} frames`).toEqual(expectedFrames);
      expect(z.anim.isFinished(), `${key} must finish death`).toBe(true);
      expect(z.anim.getFrameIdx(), `${key} must remain on final death frame ${deathIndices.length - 1}`).toBe(deathIndices.length - 1);

      // Verify that all frames were generated and are valid PNGs on disk
      for (let f = 0; f < deathIndices.length; f++) {
        const frameFile = path.join(monsterOutDir, `${key}-death-${f}.png`);
        expect(fs.existsSync(frameFile), `Missing rendered frame file: ${frameFile}`).toBe(true);
        expect(fs.statSync(frameFile).size).toBeGreaterThan(100);
      }
    }
    restore();
  });
});
