import { describe, expect, it, beforeEach } from "vitest";
import { state, type Zombie, type GroundItem } from "../state";
import {
  MATERIALS,
  MATERIAL_LIST,
  isMaterial,
  materialClip,
  materialBumperMult,
  materialRamDamageMult,
  updateMagnetPull,
  applyMaterial,
} from "./marble";
import { applyPotion } from "../economy/shop";
import { updateCoins } from "../economy/coins";
import {
  MAGNET_PULL_RADIUS,
  MAGNET_MONSTER_PULL,
  MAGNET_METAL_CRUSH_MULT,
  MAGNET_RAIL_BOOST,
} from "../constants";

describe("🧲 Magnet Ball Material & Mechanics", () => {
  beforeEach(() => {
    state.dbgMaterialEnabled = true;
    state.zombies = [];
    state.groundItems = [];
    state.player = {
      x: 10,
      z: 10,
      hp: 100,
      maxHp: 100,
      material: null,
      materialT: 0,
      fuseMaterial: null,
      fuseT: 0,
      momSpeed: 8,
      momX: 1,
      momZ: 0,
      oilT: 0,
      ironT: 0,
      magBootsT: 0,
      magnetAuraT: 0,
      anim: {
        play: () => {},
        setRate: () => {},
      },
      sprite: {
        setTint: () => {},
        mesh: {
          scale: { set: () => {} },
          position: { set: () => {}, x: 10, y: 0, z: 10 },
        },
      },
    } as unknown as typeof state.player;
  });

  it("registers magnet in MATERIAL_LIST and isMaterial", () => {
    expect(MATERIAL_LIST).toContain("magnet");
    expect(isMaterial("magnet")).toBe(true);
    expect(MATERIALS.magnet.label).toBe("Magnet");
    expect(MATERIALS.magnet.icon).toBe("🧲");
  });

  it("maps to magnetball clip name", () => {
    applyMaterial("magnet");
    expect(materialClip()).toBe("magnetball");
  });

  it("applies rail boost on bumper kick", () => {
    applyMaterial("magnet");
    expect(materialBumperMult()).toBe(MAGNET_RAIL_BOOST);
  });

  it("applies metal crush multiplier against metal monsters", () => {
    applyMaterial("magnet");
    const metalMonster = { kind: "rotortail" } as Zombie;
    const warden = { kind: "warden" } as Zombie;
    const golem = { kind: "golem" } as Zombie;
    const crawler = { kind: "magnet" } as Zombie;
    const fleshMonster = { kind: "zombie" } as Zombie;

    expect(materialRamDamageMult(metalMonster)).toBe(MAGNET_METAL_CRUSH_MULT);
    expect(materialRamDamageMult(warden)).toBe(MAGNET_METAL_CRUSH_MULT);
    expect(materialRamDamageMult(golem)).toBe(MAGNET_METAL_CRUSH_MULT);
    expect(materialRamDamageMult(crawler)).toBe(MAGNET_METAL_CRUSH_MULT);
    expect(materialRamDamageMult(fleshMonster)).toBe(1);
    expect(materialRamDamageMult()).toBe(1);
  });

  it("pulls metal-based monsters toward player in updateMagnetPull", () => {
    applyMaterial("magnet");
    const metal = {
      x: 12,
      z: 10,
      kind: "rotortail",
      mode: "chase",
      sprite: { mesh: { position: { set: () => {} } } },
    } as unknown as Zombie;
    const flesh = {
      x: 12,
      z: 10,
      kind: "zombie",
      mode: "chase",
      sprite: { mesh: { position: { set: () => {} } } },
    } as unknown as Zombie;

    state.zombies = [metal, flesh];
    updateMagnetPull(0.1);

    // Metal monster should be pulled toward player (x: 10)
    expect(metal.x).toBeLessThan(12);
    // Non-metal monster position should remain unchanged
    expect(flesh.x).toBe(12);
  });

  it("vacuums metallic loot items toward player", () => {
    applyMaterial("magnet");
    const item = {
      x: 12,
      z: 10,
      kind: "weapon",
      id: "sword",
      sprite: { mesh: { position: { x: 12, z: 10 } } },
    } as unknown as GroundItem;

    state.groundItems = [item];
    updateMagnetPull(0.1);

    expect(item.x).toBeLessThan(12);
  });

  it("widens coin capture range to MAGNET_PULL_RADIUS", () => {
    applyMaterial("magnet");
    const coin = {
      x: 13,
      z: 10,
      kind: "coin",
      coin: { age: 1, phase: "rest", vx: 0, vy: 0, vz: 0, y: 0 },
      sprite: { mesh: { position: { set: () => {} } } },
    } as unknown as GroundItem;

    state.groundItems = [coin];
    updateCoins(0.016);

    // Initial distance is 3 tiles, well within MAGNET_PULL_RADIUS (4.8)
    expect(coin.coin?.phase).toBe("magnet");
  });

  it("applyPotion('magnetcore') equips the magnet ball and sets magBootsT", () => {
    applyPotion("magnetcore");
    expect(state.player?.material).toBe("magnet");
    expect(state.player?.magBootsT).toBeGreaterThan(0);
  });
});
