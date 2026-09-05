import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import * as THREE from "three";
import { BOSSES, BOSS_KINDS, bossForBiome, movesAt, type BossKind } from "./boss-kinds";
import { IMPORTED_ART, sheetFor, type SheetKey } from "./boot/sheets";
import { SHEET_PAINTERS } from "./render/sheet-painters";
import { state } from "./state";
import { installSpriteTestDom } from "./testkit/atlas-census";

describe("Boss Roster and Modular Boss Art Verification", () => {
  let restoreDom: () => void;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    state.sheets = {} as any;
    state.expansionSheets = {} as any;
    state.scene = new THREE.Scene();
  });

  it("registers all bosses in BOSSES table with valid specs", () => {
    const expectedBosses: BossKind[] = ["reaper_king", "broodmother", "overlord", "archivist", "dragon", "trex"];
    expect(BOSS_KINDS).toEqual(expect.arrayContaining(expectedBosses));

    for (const kind of expectedBosses) {
      const boss = BOSSES[kind];
      expect(boss).toBeDefined();
      expect(boss.kind).toBe(kind);
      expect(boss.art.sheetKey).toBeDefined();
      expect(boss.art.scale).toBeGreaterThan(1.5);
      expect(boss.hpMult).toBeGreaterThan(0);
      expect(boss.speedMult).toBeGreaterThan(0);
      expect(boss.phase2).toBeDefined();
      expect(boss.phase2.at).toBeGreaterThan(0);
    }
  });

  it("wires every boss sheetKey to IMPORTED_ART and SHEET_PAINTERS", () => {
    const bossSheetKeys: SheetKey[] = ["reaper", "broodmother", "overlord", "archivist", "dragon", "trex"];

    for (const key of bossSheetKeys) {
      expect(IMPORTED_ART[key], `IMPORTED_ART has entry for ${key}`).toBe(key);
      expect(SHEET_PAINTERS[key], `SHEET_PAINTERS has entry for ${key}`).toBeDefined();
    }
  });

  it("builds valid SpriteSheet with complete animation clips for each boss", () => {
    const bossSheetKeys: SheetKey[] = ["reaper", "broodmother", "overlord", "archivist", "dragon", "trex"];

    for (const key of bossSheetKeys) {
      const sheet = sheetFor(key);
      expect(sheet, `sheetFor('${key}') returned SpriteSheet`).toBeDefined();
      expect(sheet.texture, "Texture instance created").toBeDefined();
      expect(sheet.cols).toBeGreaterThan(0);
      expect(sheet.rows).toBeGreaterThan(0);

      // Check standard clips in clips map: `${dir}:${clip}`
      const clips = ["idle", "walk", "attack", "death"];
      for (const clip of clips) {
        const frameIndices = sheet.clips.get(`S:${clip}`);
        expect(frameIndices, `${key} has clip S:${clip}`).toBeDefined();
        expect(frameIndices?.length, `${key} clip S:${clip} has frames`).toBeGreaterThan(0);
      }
    }
  });

  it("routes floor biomes to appropriate boss guardians including fallback", () => {
    expect(bossForBiome("crypt").kind).toBe("reaper_king");
    expect(bossForBiome("warren").kind).toBe("broodmother");
    expect(bossForBiome("bloodworks").kind).toBe("overlord");
    expect(bossForBiome("arcane").kind).toBe("archivist");
    expect(bossForBiome("magma").kind).toBe("dragon");
    // Unknown biome falls back to reaper_king
    expect(bossForBiome("unknown_biome").kind).toBe("reaper_king");
  });

  it("escalates boss moveset at phase 2 threshold", () => {
    const dragon = BOSSES.dragon;
    const phase1Moves = movesAt(dragon, 1.0);
    expect(phase1Moves.barrage?.interval).toBe(2.4);

    const phase2Moves = movesAt(dragon, 0.4);
    expect(phase2Moves.barrage?.interval).toBe(1.6);
    expect(phase2Moves.slam?.echo).toBeDefined();
  });
});
