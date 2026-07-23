import { describe, it, expect } from "vitest";
import { materialBumperMult, lavaVaporizesOil, emitMaterialOnBounce } from "./marble";
import { state, type MarbleMaterial } from "../state";
import { LAVA_BUMPER_MULT, STONE_BUMPER_KICK_MULT } from "../constants";

function setPlayer(material: MarbleMaterial | null): void {
  state.player = {
    x: 0,
    z: 0,
    material,
    materialT: material ? 10 : 0,
    fuseMaterial: null,
    fuseT: 0,
    momSpeed: 8,
    momX: 1,
    momZ: 0,
    materialEmitT: 0,
    sprite: { mesh: {} },
  } as unknown as typeof state.player;
  state.zombies = [];
  state.floorFx = [];
  state.vfx = null;
  state.scene = { add() {}, remove() {} } as unknown as typeof state.scene; // spawnFloorFx needs a scene
  state.dbgMaterialEnabled = true;
  state.dbgMaterialOnBounce = true;
  state.dbgMaterialFloorFx = true;
  state.dbgMaterialTerrain = true;
}

describe("lava marble", () => {
  it("makes bumpers explosive (mult > 1), unlike stone which damps them", () => {
    setPlayer("lava");
    expect(materialBumperMult()).toBe(LAVA_BUMPER_MULT);
    expect(LAVA_BUMPER_MULT).toBeGreaterThan(1);
    setPlayer("stone");
    expect(materialBumperMult()).toBe(STONE_BUMPER_KICK_MULT);
    expect(STONE_BUMPER_KICK_MULT).toBeLessThan(1);
    setPlayer("water");
    expect(materialBumperMult()).toBe(1);
  });

  it("deposits a fire puddle on a fast bounce", () => {
    setPlayer("lava");
    expect(state.floorFx.length).toBe(0);
    emitMaterialOnBounce(-1, 0);
    expect(state.floorFx.length).toBe(1);
    expect(state.floorFx[0].kind).toBe("fire");
  });

  it("vaporizes oil into flame (terrain reaction), only as lava", () => {
    setPlayer("lava");
    expect(lavaVaporizesOil(0, 0)).toBe(true);
    expect(state.floorFx.some((fx) => fx.kind === "fire")).toBe(true);
    setPlayer("stone");
    expect(lavaVaporizesOil(0, 0)).toBe(false); // wrong material
  });

  it("no fire when the floor-fx layer is toggled off", () => {
    setPlayer("lava");
    state.dbgMaterialFloorFx = false;
    emitMaterialOnBounce(-1, 0);
    expect(state.floorFx.length).toBe(0);
  });
});
