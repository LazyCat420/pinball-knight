import { describe, it, expect } from "vitest";
import { materialPlayerR, materialBumperScatterMult, materialFlatRestitution, emitMaterialOnBounce } from "./marble";
import { state, type MarbleMaterial } from "../state";
import {
  SHADOW_PLAYER_R,
  SHADOW_BUMPER_SCATTER_MULT,
  SHADOW_RESTITUTION,
  SHADOW_LURE_TIME,
  PLAYER_R,
} from "../constants";

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
  state.grid = null;
  state.vfx = null;
  state.dbgMaterialEnabled = true;
  state.dbgMaterialOnBounce = true;
}

describe("shadow marble", () => {
  it("shrinks the collider and flips restitution above 1 (slips + accelerates)", () => {
    setPlayer("shadow");
    expect(materialPlayerR()).toBe(SHADOW_PLAYER_R);
    expect(SHADOW_PLAYER_R).toBeLessThan(PLAYER_R);
    expect(materialFlatRestitution()).toBe(SHADOW_RESTITUTION);
    expect(SHADOW_RESTITUTION).toBeGreaterThan(1);
    setPlayer("stone");
    expect(materialPlayerR()).toBe(PLAYER_R); // only shadow shrinks
  });

  it("doubles bumper scatter only as shadow", () => {
    setPlayer("shadow");
    expect(materialBumperScatterMult()).toBe(SHADOW_BUMPER_SCATTER_MULT);
    setPlayer("storm");
    expect(materialBumperScatterMult()).toBe(1);
  });

  it("a bounce lures nearby foes onto the decoy, not distant ones", () => {
    setPlayer("shadow");
    const near = { x: 2, z: 0, mode: "walk", kind: "zombie", lureT: 0 } as unknown as (typeof state.zombies)[number];
    const far = { x: 30, z: 0, mode: "walk", kind: "zombie", lureT: 0 } as unknown as (typeof state.zombies)[number];
    state.zombies.push(near, far);
    emitMaterialOnBounce(-1, 0); // wall normal (arg unused by the shadow path)
    expect((near as unknown as { lureT: number }).lureT).toBe(SHADOW_LURE_TIME);
    expect((near as unknown as { lureX: number }).lureX).toBe(0); // clone at the player
    expect((far as unknown as { lureT: number }).lureT).toBe(0); // out of range
  });

  it("no decoy when the on-bounce layer is off", () => {
    setPlayer("shadow");
    state.dbgMaterialOnBounce = false;
    const z = { x: 2, z: 0, mode: "walk", kind: "zombie", lureT: 0 } as unknown as (typeof state.zombies)[number];
    state.zombies.push(z);
    emitMaterialOnBounce(-1, 0);
    expect((z as unknown as { lureT: number }).lureT).toBe(0);
  });
});
