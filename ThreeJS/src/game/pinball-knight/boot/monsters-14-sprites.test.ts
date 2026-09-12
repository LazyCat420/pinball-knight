import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createCanvas, loadImage, Image: CanvasImage } = require("canvas");

import {
  IMPORTED_ART,
  sheetFor,
  type SheetKey,
} from "./sheets";
import { authoredFacingsFor } from "./manifest-inventory";
import { setEnginePalette } from "../engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteToFloatArray, paletteCss } from "../render/palette";
import { loadImportedSheet, importedPaints } from "../render/imported-paints";

const PUBLIC_SPRITES = join(process.cwd(), "public", "sprites");

const MONSTER_KEYS: SheetKey[] = [
  "dumpster_dan",
  "pit_peeper",
  "corvid_bomber",
  "vulture_scavenger",
  "gull_bomber",
  "sky_falcon",
  "magma_slime",
  "toxic_slime",
  "frost_slime",
  "void_slime",
  "riot_cop",
  "highway_patrol",
  "detective_cop",
  "robo_cop",
];

class ShimmableImage extends CanvasImage {
  set src(val: string) {
    const match = val.match(/\/sprites\/([^?#]+)/);
    const resolved = match ? join(PUBLIC_SPRITES, match[1]) : val;
    super.src = resolved;
  }
}

const realDoc = (globalThis as { document?: unknown }).document;
const realFetch = globalThis.fetch;
const realImage = (globalThis as { Image?: unknown }).Image;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  (globalThis as { Image?: unknown }).Image = ShimmableImage;
  globalThis.fetch = async (url: any, ...args: any[]) => {
    const urlStr = String(url);
    const match = urlStr.match(/\/sprites\/([^?#]+)/);
    if (match) {
      const file = join(PUBLIC_SPRITES, match[1]);
      if (existsSync(file)) {
        if (file.endsWith(".json")) {
          return new Response(readFileSync(file, "utf8"), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } else {
          return new Response(readFileSync(file), {
            status: 200,
            headers: { "Content-Type": "image/png" },
          });
        }
      }
    }
    return realFetch(url, ...args);
  };

  setEnginePalette({
    size: PALETTE_SIZE,
    toFloatArray: paletteToFloatArray,
    hex: () => PALETTE_HEX,
    css: paletteCss,
    occlusionIndex: 30,
  });
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
  globalThis.fetch = realFetch;
  (globalThis as { Image?: unknown }).Image = realImage;
});

describe("14 Monsters (Peeper, Dumpster, and Raven down to Robo) Sprite Pipeline", () => {
  it("all 14 monsters have published PNG and JSON manifests in public/sprites/", () => {
    for (const key of MONSTER_KEYS) {
      const pngFile = join(PUBLIC_SPRITES, `${key}-S.png`);
      const jsonFile = join(PUBLIC_SPRITES, `${key}-S.json`);
      expect(existsSync(pngFile), `Missing published PNG for ${key}: ${pngFile}`).toBe(true);
      expect(existsSync(jsonFile), `Missing published JSON for ${key}: ${jsonFile}`).toBe(true);

      const manifest = JSON.parse(readFileSync(jsonFile, "utf8"));
      expect(manifest.name).toBe(key);
      expect(manifest.dir).toBe("S");
      expect(manifest.rows.length).toBeGreaterThanOrEqual(4);

      const clips = manifest.rows.map((r: { clip: string }) => r.clip);
      expect(clips).toContain("idle");
      expect(clips).toContain("walk");
      expect(clips).toContain("attack");
      expect(clips).toContain("death");

      for (const row of manifest.rows) {
        expect(row.cells.length, `${key} ${row.clip} has 0 frames`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("dumpster_dan has ZERO un-keyed #FF00FF magenta pixels in the hotdog/cap enclosure", async () => {
    const pngPath = join(PUBLIC_SPRITES, "dumpster_dan-S.png");
    const img = await loadImage(pngPath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;

    let unkeyedMagenta = 0;
    // Check region between cap and hotdog (around x: 405..440, y: 545..580)
    for (let y = 545; y <= 580; y++) {
      for (let x = 405; x <= 440; x++) {
        const idx = (y * img.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        if (a > 128 && r > 240 && g < 15 && b > 240) {
          unkeyedMagenta++;
        }
      }
    }
    expect(unkeyedMagenta, "dumpster_dan-S still has un-keyed magenta pixels").toBe(0);
  });

  it("pit_peeper has ZERO un-keyed #FF00FF magenta pixels in the death frame mouth", async () => {
    const pngPath = join(PUBLIC_SPRITES, "pit_peeper-S.png");
    const img = await loadImage(pngPath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;

    let unkeyedMagenta = 0;
    // Check death mouth pocket (around x: 620..655, y: 835..870)
    for (let y = 835; y <= 870; y++) {
      for (let x = 620; x <= 655; x++) {
        const idx = (y * img.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        if (a > 128 && r > 240 && g < 15 && b > 240) {
          unkeyedMagenta++;
        }
      }
    }
    expect(unkeyedMagenta, "pit_peeper-S still has un-keyed magenta pixels in mouth").toBe(0);

    // Verify palette has orange tones
    const jsonPath = join(PUBLIC_SPRITES, "pit_peeper-S.json");
    const manifest = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(manifest.palette).toBeDefined();
    const hasWarmOrange = manifest.palette.some(
      (c: string) => c.toLowerCase() === "#ea580c" || c.toLowerCase() === "#f97316" || c.toLowerCase() === "#fb923c"
    );
    expect(hasWarmOrange, "pit_peeper-S palette is missing warm orange belly tones").toBe(true);
  });

  it("all 12 new monsters are registered in IMPORTED_ART and authored facings", () => {
    const new12 = MONSTER_KEYS.slice(2);
    for (const key of new12) {
      expect(IMPORTED_ART[key], `IMPORTED_ART is missing ${key}`).toBe(key);
      const facings = authoredFacingsFor(key);
      expect(facings, `${key} missing authored facings`).toContain("S");
    }
  });

  it("engine importedPaints successfully compiles all 14 monster sheets with valid clips", async () => {
    for (const key of MONSTER_KEYS) {
      const sheet = await loadImportedSheet(key, "S");
      expect(sheet, `loadImportedSheet failed for ${key}`).not.toBeNull();
      if (!sheet) continue;

      const paints = importedPaints([sheet]);
      expect(paints, `importedPaints returned null for ${key}`).not.toBeNull();
      if (!paints) continue;

      expect(paints.S.idle).toBeDefined();
      expect(paints.S.walk).toBeDefined();
      expect(paints.S.attack).toBeDefined();
      expect(paints.S.death).toBeDefined();
    }
  });

  it("sheetFor(kind) loads full texture atlas on demand with non-zero frame dimensions", () => {
    for (const key of MONSTER_KEYS) {
      const atlas = sheetFor(key);
      expect(atlas, `sheetFor(${key}) returned falsy`).toBeDefined();
      expect(atlas.frameCount, `${key} frameCount <= 0`).toBeGreaterThan(0);
      expect(atlas.cols, `${key} cols <= 0`).toBeGreaterThan(0);
      expect(atlas.clips.size, `${key} has no clips`).toBeGreaterThan(0);
    }
  });
});
