import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import * as THREE from "three";
import { BOSSES, BOSS_KINDS, bossForBiome, guardianFor, guardiansOf, movesAt, type BossKind } from "./boss-kinds";
import { CYCLE_FLOORS, THEMES, themeFor } from "./maze/prefabs";
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

  /**
   * ── REACHABILITY, NOT ROUTING ──────────────────────────────────────────────
   *
   * What used to be here called `bossForBiome("magma")` and asserted it
   * returned the dragon. That passed for as long as the roster had a magma row
   * — which is to say it proved the ROW existed and nothing whatsoever about
   * whether any floor could produce it. It could not: the generator's themes
   * were crypt/warren/bloodworks/arcane, so no depth at any seed ever asked for
   * a magma guardian, and the Ancient Dragon was unspawnable for as long as he
   * had existed. The T-Rex was unreachable for a second reason the same test
   * could not see — he claims `bloodworks`, which the Overlord already held,
   * and the lookup was a `.find()`.
   *
   * These drive the real chain instead — depth in, guardian out — and compare
   * SETS in both directions. A count would not do: a roster that loses two
   * bosses and invents two others keeps its length.
   */
  describe("every guardian is reachable by descending", () => {
    /** Passes needed for the most-contested biome to hand out every guardian. */
    const passesNeeded = Math.max(...THEMES.map((t) => guardiansOf(t.name).length));
    const deepest = CYCLE_FLOORS * passesNeeded;

    it("produces every boss in the roster, and no boss outside it", () => {
      const reached = new Map<string, number>();
      for (let f = 1; f <= deepest; f++) {
        const kind = guardianFor(f).kind;
        if (!reached.has(kind)) reached.set(kind, f);
      }
      for (const kind of BOSS_KINDS) {
        expect(
          reached.has(kind),
          `${kind} guards biome "${BOSSES[kind].biome}" and NO depth in 1..${deepest} produces it`,
        ).toBe(true);
      }
      for (const kind of reached.keys()) {
        expect(BOSS_KINDS as string[], `depth produced ${kind}, which is not in the roster`).toContain(kind);
      }
    });

    it("guards each floor with the boss of that floor's own biome", () => {
      // The property that makes the roster mean anything: you fight the thing
      // whose horde you just cut through.
      for (let f = 1; f <= deepest; f++) {
        expect(guardianFor(f).biome, `floor ${f}`).toBe(themeFor(f).name);
      }
    });

    it("hands a biome's second guardian over on a later pass", () => {
      // The T-Rex's only route in. If a future edit gives him his own biome
      // this stays green through `guardiansOf`, which is the point — it asserts
      // the MECHANISM is exercised, not that the T-Rex specifically shares.
      for (const theme of THEMES) {
        const guardians = guardiansOf(theme.name);
        for (const [pass, spec] of guardians.entries()) {
          const floor = pass * CYCLE_FLOORS + theme.from;
          expect(guardianFor(floor).kind, `floor ${floor} (${theme.name}, pass ${pass})`).toBe(spec.kind);
        }
      }
    });

    it("gives every boss a biome the generator actually builds", () => {
      // The direction that would have caught the dragon on the day he landed.
      const built = new Set(THEMES.map((t) => t.name));
      for (const kind of BOSS_KINDS) {
        expect(built.has(BOSSES[kind].biome), `${kind} guards "${BOSSES[kind].biome}", which is not a theme`).toBe(true);
      }
    });

    it("falls back to the King for a biome with no guardian", () => {
      // A biome added without a guardian must still gate its exit rather than
      // ship a floor whose stairs never unlock.
      expect(bossForBiome("unknown_biome").kind).toBe("reaper_king");
      expect(bossForBiome("unknown_biome", 3).kind).toBe("reaper_king");
    });
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
