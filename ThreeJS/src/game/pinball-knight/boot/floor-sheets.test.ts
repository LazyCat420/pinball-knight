/**
 * The descent hold paints every atlas the floor can spawn; play paints none.
 *
 * Measured 2026-09-10 (docs/perf/maze-lag-audit.md): a paint-canvas readback
 * is 0.3 ms on a quiet page and 4–95 ms while the dungeon renders, so the old
 * idle-slice backfill turned every painted frame into a hitch. These tests pin
 * the replacement: `buildFloorSheets` builds exactly the floor's roster, yields
 * between slices so the loading screen can present, and stops cleanly when the
 * floor is abandoned.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { PALETTE_HEX, PALETTE_SIZE, paletteToFloatArray, paletteCss } from "../render/palette";
import { setEnginePalette } from "../engine/palette-source";
import { invalidatePaletteCaches } from "../engine/render/sprite";
import { buildFloorSheets, keysForFloor, knightWarmIds, knightWarmTargets, resetImportedMonsterArtForTest } from "./sheets";
import { state } from "../state";
import { freshWeapon } from "../items";

// The same canvas document lazy-sheets.test.ts uses: node-canvas behind
// document.createElement, and the real dungeon palette installed.
const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
  invalidatePaletteCaches();
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

beforeEach(() => {
  resetImportedMonsterArtForTest();
  state.sheets = {} as typeof state.sheets;
  state.zombieVariantSheets = [];
  state.active = true;
});

describe("buildFloorSheets", () => {
  it("builds every key the floor can spawn and no other, yielding between slices", async () => {
    const yields: number[] = [];
    const built = await buildFloorSheets(1, (done) => { yields.push(done); });
    const expected = keysForFloor(1);
    expect(new Set(built)).toEqual(new Set(expected));
    for (const key of expected) expect(state.sheets[key], key).toBeDefined();
    expect(Object.keys(state.sheets).sort()).toEqual([...expected].sort());
    // Every atlas costs more than one 12 ms slice, so the bar got at least one
    // frame per atlas — a build that never yields would freeze the screen.
    expect(yields.length).toBeGreaterThanOrEqual(expected.length);
    expect(yields[yields.length - 1]).toBe(expected.length);
  });

  it("skips atlases that already exist", async () => {
    await buildFloorSheets(1);
    const before = { ...state.sheets };
    const again = await buildFloorSheets(1);
    expect(again).toEqual([]);
    for (const key of keysForFloor(1)) expect(state.sheets[key]).toBe(before[key]);
  });

  it("stops without publishing a half-painted atlas when the floor is abandoned", async () => {
    let calls = 0;
    const built = await buildFloorSheets(1, () => { calls++; }, () => calls < 2);
    expect(built.length).toBeLessThan(keysForFloor(1).length);
    for (const key of keysForFloor(1)) {
      if (!built.includes(key)) expect(state.sheets[key]).toBeUndefined();
    }
  });
});

describe("knightWarmIds", () => {
  it("names both slots and every weapon on the ground, once each", () => {
    state.weaponSlots = [freshWeapon("sword"), freshWeapon("bow")];
    state.groundItems = [
      { kind: "weapon", id: "bow" },
      { kind: "weapon", id: "warhammer" },
      { kind: "potion", id: "heal" },
    ] as unknown as typeof state.groundItems;
    expect(knightWarmIds().sort()).toEqual(["bow", "sword", "warhammer"]);
  });
});

describe("knightWarmTargets", () => {
  it("adds the slot weapons at each look one piece of ground gear away, once each", () => {
    state.weaponSlots = [freshWeapon("sword"), null];
    state.gear = { ...state.gear, helmet: 0, armor: 0, boots: 0 };
    state.groundItems = [
      { kind: "weapon", id: "bow" },
      { kind: "gear", id: "helmet" },
      { kind: "gear", id: "helmet" },
      { kind: "gear", id: "boots" },
      { kind: "potion", id: "heal" },
    ] as unknown as typeof state.groundItems;
    const targets = knightWarmTargets();
    const keys = targets.map((t) => `${t.id}|${+t.look.helmet}${+t.look.armor}${+t.look.boots}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("sword|000");
    expect(keys).toContain("sword|100");
    expect(keys).toContain("sword|001");
    expect(keys).not.toContain("sword|010");
    // The bow on the floor is warmed at the current look only.
    expect(keys.filter((k) => k.startsWith("bow|"))).toEqual(["bow|000"]);
    // Gear already worn adds nothing.
    state.gear = { ...state.gear, helmet: 1 };
    const worn = knightWarmTargets().map((t) => `${t.id}|${+t.look.helmet}${+t.look.armor}${+t.look.boots}`);
    expect(worn.filter((k) => k.startsWith("sword|")).sort()).toEqual(["sword|100", "sword|101"]);
  });
});
