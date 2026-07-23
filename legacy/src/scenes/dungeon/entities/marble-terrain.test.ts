import { describe, it, expect, beforeEach } from "vitest";
import {
  tryWaterSteam,
  stoneMagstripCap,
  stoneIgnoresOil,
  stoneBridgesPit,
  waterQuenchesFire,
  tryDiamondDischarge,
} from "./marble";
import { state, type MarbleMaterial } from "../state";
import { STONE_MAGSTRIP_CAP, WATER_STEAM_LAUNCH } from "../constants";

/**
 * Material × terrain reactions are pure gameplay logic (VFX is optional-chained
 * off, so a null vfx is fine). Drive them directly with a stub player + horde.
 */
function setup(material: MarbleMaterial | null, opts: { momSpeed?: number; terrain?: boolean } = {}): void {
  state.player = {
    x: 0,
    z: 0,
    hp: 10,
    material,
    materialT: material ? 10 : 0,
    momSpeed: opts.momSpeed ?? 8,
    momX: 1,
    momZ: 0,
  } as unknown as typeof state.player;
  state.zombies = [];
  state.vfx = null;
  state.dbgMaterialEnabled = true;
  state.dbgMaterialTerrain = opts.terrain ?? true;
  state.dbgMaterialFloorFx = true;
  state.scene = null; // spawnFloorFx no-ops without a scene
}

describe("material × terrain reactions", () => {
  beforeEach(() => setup(null));

  it("gates every reaction behind the active material", () => {
    setup("stone");
    expect(stoneMagstripCap()).toBe(STONE_MAGSTRIP_CAP);
    expect(stoneIgnoresOil()).toBe(true);
    expect(waterQuenchesFire(0, 0)).toBe(false); // wrong material
    expect(tryWaterSteam()).toBe(false);
    expect(tryDiamondDischarge(0, 0)).toBe(false);

    setup("water");
    expect(stoneMagstripCap()).toBeNull();
    expect(stoneIgnoresOil()).toBe(false);
    expect(waterQuenchesFire(0, 0)).toBe(true);
    expect(tryDiamondDischarge(0, 0)).toBe(false); // still wrong material

    setup("diamond");
    expect(tryDiamondDischarge(0, 0)).toBe(true); // absorbs the shock
    expect(tryWaterSteam()).toBe(false);
  });

  it("the whole layer is off when the terrain toggle is off", () => {
    setup("water", { terrain: false });
    expect(tryWaterSteam()).toBe(false);
    expect(waterQuenchesFire(0, 0)).toBe(false);
    setup("stone", { terrain: false });
    expect(stoneMagstripCap()).toBeNull();
    expect(stoneIgnoresOil()).toBe(false);
    setup("diamond", { terrain: false });
    expect(tryDiamondDischarge(0, 0)).toBe(false);
  });

  it("nothing reacts with no material or materials globally disabled", () => {
    setup(null);
    expect(tryWaterSteam()).toBe(false);
    expect(stoneMagstripCap()).toBeNull();
    setup("water");
    state.dbgMaterialEnabled = false;
    expect(tryWaterSteam()).toBe(false);
    expect(waterQuenchesFire(0, 0)).toBe(false);
  });

  it("water steam turns the trap into a launch", () => {
    setup("water", { momSpeed: 2 }); // dragged to a crawl normally
    expect(tryWaterSteam()).toBe(true);
    expect(state.player!.momSpeed).toBe(WATER_STEAM_LAUNCH);
  });

  it("water steam never SLOWS a ball already faster than the launch", () => {
    setup("water", { momSpeed: WATER_STEAM_LAUNCH + 6 });
    expect(tryWaterSteam()).toBe(true);
    expect(state.player!.momSpeed).toBe(WATER_STEAM_LAUNCH + 6); // max(), not a set
  });

  it("stone bridges a pit only while rolling", () => {
    setup("stone", { momSpeed: 6 });
    expect(stoneBridgesPit()).toBe(true);
    setup("stone", { momSpeed: 0 });
    expect(stoneBridgesPit()).toBe(false); // standing still — falls in
  });
});
