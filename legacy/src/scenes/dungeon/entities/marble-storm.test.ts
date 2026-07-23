import { describe, it, expect } from "vitest";
import { materialLanePull, materialSteerMult, materialSlam } from "./marble";
import { state, type MarbleMaterial } from "../state";
import { STORM_LANE_PULL_MULT, STORM_STEER_MULT, STORM_CLAP_STUN } from "../constants";

function setPlayer(material: MarbleMaterial | null): void {
  state.player = {
    x: 0,
    z: 0,
    material,
    materialT: material ? 10 : 0,
    fuseMaterial: null,
    fuseT: 0,
    momSpeed: 8,
    rageT: 0,
  } as unknown as typeof state.player;
  state.zombies = [];
  state.vfx = null;
  state.dbgMaterialEnabled = true;
  state.dbgMaterialSlam = true;
}

describe("storm marble", () => {
  it("rails corridors: doubles the lane pull only as storm", () => {
    setPlayer("storm");
    expect(materialLanePull()).toBe(STORM_LANE_PULL_MULT);
    setPlayer("stone");
    expect(materialLanePull()).toBe(1);
    setPlayer(null);
    expect(materialLanePull()).toBe(1);
  });

  it("steers sharper as storm, slippier as water", () => {
    setPlayer("storm");
    expect(materialSteerMult()).toBe(STORM_STEER_MULT);
    expect(STORM_STEER_MULT).toBeGreaterThan(1); // storm is MORE responsive
    setPlayer("water");
    expect(materialSteerMult()).toBeLessThan(1); // water is slippery
    setPlayer("diamond");
    expect(materialSteerMult()).toBe(1);
  });

  it("thunderclap slam STUNS nearby foes (slip with zero drift)", () => {
    setPlayer("storm");
    const near = { x: 1, z: 0, mode: "walk", kind: "zombie", slipT: 0, slipVX: 9, slipVZ: 9 } as unknown as (typeof state.zombies)[number];
    const far = { x: 20, z: 0, mode: "walk", kind: "zombie", slipT: 0 } as unknown as (typeof state.zombies)[number];
    state.zombies.push(near, far);
    materialSlam();
    // near foe frozen in place; far foe untouched
    expect((near as unknown as { slipT: number }).slipT).toBe(STORM_CLAP_STUN);
    expect((near as unknown as { slipVX: number }).slipVX).toBe(0); // drift zeroed = stand still
    expect((far as unknown as { slipT: number }).slipT).toBe(0);
  });

  it("no clap when the slam layer is toggled off", () => {
    setPlayer("storm");
    state.dbgMaterialSlam = false;
    const z = { x: 1, z: 0, mode: "walk", kind: "zombie", slipT: 0 } as unknown as (typeof state.zombies)[number];
    state.zombies.push(z);
    materialSlam();
    expect((z as unknown as { slipT: number }).slipT).toBe(0);
  });
});
