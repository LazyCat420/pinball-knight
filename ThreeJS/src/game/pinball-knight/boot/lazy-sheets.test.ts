/**
 * LAZY ATLASES MUST NOT BECOME MISSING MONSTERS.
 *
 * `buildMonsterSheets()` used to build all 22 atlases synchronously at
 * `launchDungeonGame` — one 6,075 ms task, the freeze in the "browser lags very
 * bad" report (LOAD_PLAN.md §3). It now builds only what floor 1 can spawn and
 * backfills the rest during idle time, with `sheetFor()` building on demand for
 * anything the backfill has not reached.
 *
 * That trades a load stall for a NEW failure mode, and it is a silent one.
 * Before this change the spawn table was full of `state.xSheet &&` guards that
 * could never be false; afterwards a falsy read stops meaning "art is missing"
 * and starts meaning "art has not been asked for yet" — and the guard deletes
 * the spawn instead of building the sheet. A brute would quietly become a
 * zombie, an exit arena would quietly not exist, and nothing would throw.
 * Compare [[a-mechanic-can-pass-every-test-and-never-occur]].
 *
 * So the invariant under test is not "atlases are lazy" (a perf claim, measured
 * elsewhere) but "every kind that can spawn can still get its art" — which is
 * the property the guards used to provide and now must come from sheetFor.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { PALETTE_HEX, PALETTE_SIZE, paletteToFloatArray, paletteCss } from "../render/palette";
import { setEnginePalette } from "../engine/palette-source";
import { invalidatePaletteCaches } from "../engine/render/sprite";
import { sheetFor, SHEET_KEY_BY_KIND, type SheetKey, keysForFloor } from "./sheets";
import { hasAuthoredFacing, authoredFacingsFor } from "./manifest-inventory";
import { skinSheet } from "../spawn/factory";
import { KIND_SKIN } from "../spawn/kind-skin";
import type { EnemyKind } from "../state";
import { state } from "../state";

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

const ALL_KEYS: SheetKey[] = [
  "zombie", "spider", "brute", "warden", "spitter", "ghost", "bat", "slime", "boss",
  "goblin", "pin", "golem", "chomper", "magnet", "webspinner", "sporeling",
  "hound", "jester", "croaker", "rotortail", "stiltneck", "fish_feet",
  "necromancer", "crystalback", "mimic", "reaper", "bloater", "platypus",
  "espresso", "jade_buddha",
];

/**
 * Empty the atlas map — the state a spawn sees before the backfill has reached
 * that kind, and after a teardown.
 *
 * This was itself a hand-written list of twenty-two assignments, and it was
 * missing `warden`: the cold-state tests below never actually cleared the
 * warden's sheet, so for that one kind they proved nothing. Same failure as
 * the production lists this refactor replaced, in the test that exists to
 * catch it.
 */
function clearAllSheets(): void {
  state.sheets = {};
  state.zombieVariantSheets = [];
}

describe("sheetFor builds on demand", () => {
  it("returns a real atlas for every sheet key, from a cold state", () => {
    // Cold: nothing prebuilt, exactly the position a spawn is in when the idle
    // backfill has not reached that kind yet.
    clearAllSheets();
    for (const key of ALL_KEYS) {
      const sheet = sheetFor(key);
      expect(sheet, `sheetFor("${key}") returned nothing`).toBeTruthy();
      expect(sheet.texture, `sheetFor("${key}") has no texture`).toBeTruthy();
      expect(sheet.frameCount, `sheetFor("${key}") packed no frames`).toBeGreaterThan(0);
    }
  });

  it("memoises — a second request returns the SAME atlas, not a rebuild", () => {
    // Without this, every spawn repaints an atlas and the "lazy" version is
    // slower than the eager one it replaced.
    const first = sheetFor("ghost");
    const second = sheetFor("ghost");
    expect(second).toBe(first);
  });

  it("caches into the map teardown already clears", () => {
    // The memo deliberately IS `state.sheets`. A separate cache would survive
    // dispose.ts and leak an atlas per floor change.
    delete state.sheets.webspinner;
    const built = sheetFor("webspinner");
    expect(state.sheets.webspinner).toBe(built);

    // Simulating teardown must actually force a rebuild.
    delete state.sheets.webspinner;
    expect(sheetFor("webspinner")).not.toBe(built);
  });
});

describe("every spawnable kind can reach art", () => {
  it("resolves a sheet for every KIND_SKIN kind, bespoke or borrowed", () => {
    // The skin thunks used to read `state.xSheet` directly and makeSkinned
    // returns null on a falsy sheet — i.e. the enemy silently does not spawn.
    //
    // Since the RESKIN/EXPANSION_SKIN merge this covers the BORROWED-atlas
    // kinds too, which had no cold-state test of their own: a bloater whose
    // slime sheet is unbuilt must bake its dye off a freshly built base, not
    // give up.
    //
    // ⚠️ COLD STATE IS THE WHOLE TEST. An earlier `it` in this file builds
    // these atlases, so without the reset below every thunk finds a populated
    // field and the assertion passes whether or not it goes through sheetFor —
    // which is precisely the regression it exists to catch. Verified by
    // reintroducing the raw-field read: with the reset it fails, without it
    // does not.
    clearAllSheets();
    for (const kind of Object.keys(KIND_SKIN) as EnemyKind[]) {
      expect(skinSheet(kind), `KIND_SKIN.${kind} resolved no sheet from a cold state`).toBeTruthy();
    }
  });

  it("maps every own-atlas EnemyKind to a buildable key", () => {
    clearAllSheets();
    for (const [kind, key] of Object.entries(SHEET_KEY_BY_KIND)) {
      expect(ALL_KEYS, `SHEET_KEY_BY_KIND.${kind} points at unknown key "${key}"`).toContain(key);
      expect(sheetFor(key), `kind "${kind}" could not get art`).toBeTruthy();
    }
  });
});

describe("manifest inventory & floor loading", () => {
  it("only reports authored facings, eliminating blind 404 probes", () => {
    expect(hasAuthoredFacing("goblin", "S")).toBe(true);
    expect(hasAuthoredFacing("goblin", "N")).toBe(false);
    expect(hasAuthoredFacing("goblin", "E")).toBe(false);
    expect(authoredFacingsFor("goblin")).toEqual(["S"]);

    expect(hasAuthoredFacing("zombie", "E")).toBe(true);
    expect(hasAuthoredFacing("zombie", "S")).toBe(false);
    expect(authoredFacingsFor("zombie")).toEqual(["E"]);

    expect(hasAuthoredFacing("fish_feet", "S")).toBe(true);
    expect(hasAuthoredFacing("fish_feet", "E")).toBe(true);
    expect(hasAuthoredFacing("fish_feet", "N")).toBe(false);
  });

  it("keysForFloor scales with level depth without loading the entire 29-monster roster up-front", () => {
    const f1 = keysForFloor(1);
    expect(f1).toContain("zombie");
    expect(f1).toContain("goblin");
    expect(f1).toContain("spider");
    expect(f1).not.toContain("dragon");
    expect(f1).not.toContain("reaper");
    expect(f1).not.toContain("archivist");

    const f5 = keysForFloor(5);
    expect(f5).toContain("dragon");
    expect(f5).toContain("reaper");
  });
});
