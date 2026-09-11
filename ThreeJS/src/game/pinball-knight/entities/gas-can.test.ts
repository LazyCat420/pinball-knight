import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import {
  GAS_CAN_HP,
  GAS_CAN_R,
  GAS_CAN_SPEED_FACTOR,
  GAS_CAN_FROM_LEVEL,
  GAS_CAN_DAMAGE,
  GAS_CAN_SPILL_RADIUS,
  GAS_CAN_SPILL_LIFE,
  ZIPPO_HP,
} from "../constants/enemies";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { DMG_BY_KIND, killZombie, setGasCanDeathHandler } from "./combat";
import { PAIN_BY_KIND } from "./stagger";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { STATS, updateZombies } from "./zombie";
import { SPAWNABLE } from "../debug-panel";
import { makeGasCanPaints } from "../render/monsters/gas-can";
import { spawnFloorFx, updateFloorFx } from "./floor-fx";
import type { Zombie, Player } from "../state";
import type { Grid } from "../maze/generator";
import { state } from "../state";

describe("Gas Can Monster — Tables & Registrations", () => {
  it("has correct stats and constants defined", () => {
    expect(GAS_CAN_HP).toBe(14);
    expect(GAS_CAN_R).toBe(0.42);
    expect(GAS_CAN_SPEED_FACTOR).toBe(0.85);
    expect(GAS_CAN_FROM_LEVEL).toBe(2);
    expect(GAS_CAN_DAMAGE).toBe(1);
    expect(GAS_CAN_SPILL_RADIUS).toBe(2.6);
    expect(GAS_CAN_SPILL_LIFE).toBe(20.0);
  });

  it("is registered in bestiary with icon and label", () => {
    const info = KIND_INFO.gas_can;
    expect(info).toBeDefined();
    expect(info.label).toBe("Toon Gas Can");
    expect(info.icon).toBe("⛽");
    expect(info.blurb).toContain("rubber-hose");
  });

  it("is registered in reagent drops with ironshard and slimegel", () => {
    const drops = ENEMY_DROPS.gas_can;
    expect(drops).toBeDefined();
    expect(drops.some((d) => d.id === "ironshard")).toBe(true);
    expect(drops.some((d) => d.id === "slimegel")).toBe(true);
  });

  it("is configured in KIND_SKIN with appropriate scale", () => {
    const skin = KIND_SKIN.gas_can;
    expect(skin).toBeDefined();
    expect(skin?.scale).toBe(1.05);
  });

  it("has combat damage, stagger, movement, and zombie stats configured", () => {
    expect(DMG_BY_KIND.gas_can).toBe(GAS_CAN_DAMAGE);
    expect(PAIN_BY_KIND.gas_can).toBe(0.40);
    expect(MOVEMENT_BY_KIND.gas_can).toBe("chase");
    expect(STATS.gas_can.ranged).toBe(false);
    expect(STATS.gas_can.bodyR).toBe(GAS_CAN_R);
    expect(STATS.gas_can.windup).toBe(0.40);
  });

  it("is present in the debug panel spawnable roster", () => {
    const entry = SPAWNABLE.find((e) => e.kind === "gas_can");
    expect(entry).toBeDefined();
    expect(entry?.label).toContain("GasCan");
  });

  it("generates procedural cel-paints for all facings and clips", () => {
    const paints = makeGasCanPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    for (const facing of [paints.S, paints.N, paints.E]) {
      expect(facing.idle?.length).toBeGreaterThan(0);
      expect(facing.walk?.length).toBeGreaterThan(0);
      expect(facing.attack?.length).toBeGreaterThan(0);
      expect(facing.death?.length).toBeGreaterThan(0);
    }
  });
});

describe("Gas Can & Zippo Duo — Death, Panic & Fire Ignition Spread", () => {
  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.projectiles = [];
    state.zombies = [];
    state.floorFx = [];
    const t = new Uint8Array(400);
    t.fill(1);
    state.grid = {
      w: 20,
      h: 20,
      t,
      shapes: new Uint8Array(400),
    } as unknown as Grid;
    state.player = {
      x: 10,
      z: 10,
      hp: 10,
      maxHp: 10,
      facing: "S",
      invulnT: 0,
      momSpeed: 0,
      dead: false,
    } as unknown as Player;
  });

  it("spills oil slick and panics paired Zippo when gas can is killed", () => {
    let oilSpilled = false;
    let spillX = 0;
    let spillZ = 0;

    setGasCanDeathHandler((x, z) => {
      oilSpilled = true;
      spillX = x;
      spillZ = z;
      spawnFloorFx("oil", x, z, GAS_CAN_SPILL_RADIUS, GAS_CAN_SPILL_LIFE);
    });

    const mockZippo = {
      nid: "zippo_1",
      kind: "zippo",
      x: 6.0,
      z: 5.0,
      hp: ZIPPO_HP,
      speed: 1.2,
      mode: "chase",
      panicT: 0,
      sprite: {
        mesh: { position: { x: 6.0, y: 0, z: 5.0, set: () => {} } },
        setTint: () => {},
        setBlobVisible: () => {},
      },
      anim: {
        play: () => {},
        setFacing: () => {},
        getFacing: () => "S",
        currentClip: "idle",
      },
    } as unknown as Zombie;

    const mockGasCan = {
      nid: "gas_can_1",
      pairedBuddyNid: "zippo_1",
      kind: "gas_can",
      x: 5.0,
      z: 5.0,
      hp: 0,
      speed: 1.0,
      mode: "chase",
      sprite: {
        mesh: { position: { x: 5.0, y: 0, z: 5.0, set: () => {} } },
        setTint: () => {},
        setBlobVisible: () => {},
      },
      anim: {
        play: () => {},
        setFacing: () => {},
        getFacing: () => "S",
        currentClip: "idle",
      },
    } as unknown as Zombie;

    state.zombies = [mockGasCan, mockZippo];

    // Kill the gas canister
    killZombie(mockGasCan);
    expect(mockGasCan.mode).toBe("dead");
    expect(oilSpilled).toBe(true);
    expect(spillX).toBe(5.0);
    expect(spillZ).toBe(5.0);

    // Verify oil puddle was spawned
    const oilPuddle = state.floorFx.find((fx) => fx.kind === "oil");
    expect(oilPuddle).toBeDefined();
    expect(oilPuddle?.radius).toBe(GAS_CAN_SPILL_RADIUS);

    // Verify paired Zippo freaked out and entered panic state
    expect(mockZippo.panicT).toBeGreaterThan(0);

    // Simulate panic ticking down until Zippo trips and ignites the gasoline
    mockZippo.panicT = 0.05;
    updateZombies(0.1); // panic finishes -> trips and falls over!

    expect(mockZippo.mode).toBe("dead");

    // A fire puddle is created where the lighter collapsed
    const fireFloor = state.floorFx.filter((fx) => fx.kind === "fire");
    expect(fireFloor.length).toBeGreaterThanOrEqual(1);

    // Run floor FX update to process ignition
    updateFloorFx(0.016);

    // Oil pool ignited into spreading blaze!
    const ignitedOil = state.floorFx.filter((fx) => fx.kind === "oil");
    const totalFires = state.floorFx.filter((fx) => fx.kind === "fire");
    expect(ignitedOil.length).toBe(0); // All oil caught fire
    expect(totalFires.length).toBeGreaterThanOrEqual(2); // Initial fire + ignited gas puddle
  });
});
