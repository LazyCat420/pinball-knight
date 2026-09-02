import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Scene } from "three";
import * as fs from "fs";
import * as path from "path";
import { state, resetState } from "../../state";
import { makeZombie } from "../../spawn/factory";
import { sheetFor, paintsFor, IMPORTED_ART, type SheetKey } from "../../boot/sheets";
import { importedPaints, type ImportedSheet } from "../../render/imported-paints";
import { buildSpriteSheet, createActorSprite } from "./sprite";
import { Animator } from "./animator";
import { updateZombies } from "../../entities/zombie";
import { killZombie, damageZombie } from "../../entities/combat";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { withRecoil } from "../../render/cel-painter";
import type { SheetManifest } from "../../tools/sprite-forge/manifest";
import type { Dir } from "./paint-types";

describe("All Monsters Imported Art Pipeline & Runtime Dependency Chain", () => {
  let restore: () => void;
  const spritesDir = path.resolve(__dirname, "../../../../../public/sprites");

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

  function loadLocalImportedSheet(name: string, dir: Dir): ImportedSheet | null {
    const jsonPath = path.join(spritesDir, `${name}-${dir}.json`);
    const pngPath = path.join(spritesDir, `${name}-${dir}.png`);
    if (!fs.existsSync(jsonPath) || !fs.existsSync(pngPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as SheetManifest;
    const img = {
      width: manifest.source[0],
      height: manifest.source[1],
      naturalWidth: manifest.source[0],
      naturalHeight: manifest.source[1],
    } as any;
    return { manifest, image: img };
  }

  for (const [key, name] of Object.entries(IMPORTED_ART) as [SheetKey, string][]) {
    it(`validates imported sprite sheet completeness and runtime animation for ${key} (${name})`, () => {
      const DIRS: Dir[] = ["S", "N", "E"];
      const loaded = DIRS.map((d) => loadLocalImportedSheet(name, d)).filter((s): s is ImportedSheet => s !== null);

      expect(loaded.length, `Expected at least one sprite sheet for ${name}`).toBeGreaterThan(0);

      const paints = importedPaints(loaded);
      expect(paints, `importedPaints must resolve for ${name}`).toBeDefined();
      expect(paints!.S.idle, `${name} must have S:idle`).toBeDefined();
      expect(paints!.S.walk, `${name} must have S:walk`).toBeDefined();

      const mergedPaints = paintsFor(key);
      const sheet = buildSpriteSheet(withRecoil(mergedPaints));

      expect(sheet.clips.has("S:idle"), `${key} sheet must contain S:idle clip`).toBe(true);
      expect(sheet.clips.has("S:walk"), `${key} sheet must contain S:walk clip`).toBe(true);
      expect(sheet.clips.has("S:death"), `${key} sheet must contain S:death clip`).toBe(true);

      const deathClip = sheet.clips.get("S:death")!;
      expect(deathClip.length, `${key} death clip must have at least 3 frames`).toBeGreaterThanOrEqual(3);

      const z = makeZombie(sheet, 10, 10, 1, { kind: key as any });
      state.zombies = [z];

      expect(z.anim.getClip()).toBe("idle");
      expect(z.anim.getFrameIdx()).toBe(0);

      // Walk in all directions and verify UV matrix integrity
      for (const facing of ["S", "E", "W", "N"] as const) {
        z.anim.setFacing(facing);
        z.anim.play("walk");
        expect(z.anim.getClip()).toBe("walk");
        z.anim.update(0.18);
        expect(z.anim.getFrameIdx()).toBeGreaterThanOrEqual(0);

        const tex = (z.sprite.mesh.material as any).map;
        expect(tex, "Material must have a valid CanvasTexture").toBeDefined();
        expect(Number.isFinite(tex.offset.x), "UV offset.x must be finite").toBe(true);
        expect(Number.isFinite(tex.offset.y), "UV offset.y must be finite").toBe(true);
        expect(Number.isFinite(tex.repeat.x), "UV repeat.x must be finite").toBe(true);
        expect(Number.isFinite(tex.repeat.y), "UV repeat.y must be finite").toBe(true);
        expect(Math.abs(tex.repeat.x)).toBeGreaterThan(0);
        expect(Math.abs(tex.repeat.y)).toBeGreaterThan(0);
      }

      // Attack
      z.anim.play("attack");
      expect(z.anim.getClip()).toBe("attack");
      z.anim.update(0.18);

      // Hurt / Stumble
      z.anim.play("stumble");
      expect(z.anim.getClip()).toBe("stumble");

      // Death transition
      killZombie(z);
      expect(z.mode).toBe("dead");
      expect(z.anim.getClip()).toBe("death");
      expect(z.anim.getFrameIdx()).toBe(0);

      // Monotonic progression from frame 0 to end of death (at 6 FPS, 4-5 frames take ~0.7-0.9s)
      for (let step = 0; step < 60; step++) {
        updateZombies(0.016);
        z.anim.update(0.016);
      }

      expect(z.anim.isFinished(), `${key} death animation must finish`).toBe(true);
      expect(z.anim.getFrameIdx(), `${key} must reach final death frame`).toBe(deathClip.length - 1);
    });
  }

  it("handles continuous combat loops and state transitions without frame desynchronization or UV corruption", () => {
    for (const [key, name] of Object.entries(IMPORTED_ART) as [SheetKey, string][]) {
      const DIRS: Dir[] = ["S", "N", "E"];
      const loaded = DIRS.map((d) => loadLocalImportedSheet(name, d)).filter((s): s is ImportedSheet => s !== null);
      if (!loaded.length) continue;

      const mergedPaints = paintsFor(key);
      const sheet = buildSpriteSheet(mergedPaints);
      const z = makeZombie(sheet, 5, 5, 1, { kind: key as any });
      state.zombies = [z];

      // Simulate 60 frames of chase -> windup -> attack -> recovery
      for (let f = 0; f < 60; f++) {
        z.mode = f % 20 < 10 ? "chase" : "windup";
        if (z.mode === "windup") {
          z.anim.play("attack");
        } else {
          z.anim.setFacing(f % 4 === 0 ? "E" : f % 4 === 1 ? "W" : f % 4 === 2 ? "N" : "S");
          z.anim.play("walk");
        }
        updateZombies(0.016);
        z.anim.update(0.016);

        const tex = (z.sprite.mesh.material as any).map;
        expect(Number.isFinite(tex.offset.x)).toBe(true);
        expect(Number.isFinite(tex.offset.y)).toBe(true);
      }
    }
  });
});
