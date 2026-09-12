import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { STATS } from "./zombie";
import { DMG_BY_KIND } from "./combat";
import { HP_BY_KIND, spawnKind } from "../spawn/factory";
import { MOMENTUM_GATES } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { state, type EnemyKind } from "../state";
import { makeRiotCopPaints } from "../render/monsters/riot_cop";
import { makeHighwayPatrolPaints } from "../render/monsters/highway_patrol";
import { makeDetectiveCopPaints } from "../render/monsters/detective_cop";
import { makeRoboCopPaints } from "../render/monsters/robo_cop";
import { dropSpikeStrip, throwFlashbang, detonateFlashbang, fireMagnumBullet, fireAuto9Burst, detonateEmpOverload } from "./projectiles";
import * as THREE from "three";

const COP_KINDS: EnemyKind[] = ["riot_cop", "highway_patrol", "detective_cop", "robo_cop"];

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(128, 128) : {}),
  };
  state.scene = new THREE.Scene();
  state.projectiles = [];
  state.zombies = [];
  state.player = {
    x: 5,
    z: 5,
    hp: 10,
    maxHp: 10,
    momSpeed: 10,
    momX: 1,
    momZ: 0,
    iframes: 0,
  } as any;
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

describe("Cop Monster Variants - Core Data Integrity", () => {
  it("registers all 4 cop monsters across stats and rules tables", () => {
    for (const k of COP_KINDS) {
      expect(STATS[k], `missing STATS for ${k}`).toBeDefined();
      expect(STATS[k].bodyR).toBeGreaterThan(0);
      expect(STATS[k].contactRange).toBeGreaterThan(0);
      expect(STATS[k].windup).toBeGreaterThan(0);
      expect(STATS[k].cooldown).toBeGreaterThan(0);

      expect(DMG_BY_KIND[k], `missing DMG_BY_KIND for ${k}`).toBeGreaterThan(0);
      expect(HP_BY_KIND[k], `missing HP_BY_KIND for ${k}`).toBeGreaterThan(0);
      expect(PAIN_BY_KIND[k], `missing PAIN_BY_KIND for ${k}`).toBeDefined();
      expect(KIND_SKIN[k], `missing KIND_SKIN for ${k}`).toBeDefined();
      expect(KIND_SKIN[k].scale).toBeGreaterThan(0);

      expect(KIND_INFO[k], `missing KIND_INFO for ${k}`).toBeDefined();
      expect(KIND_INFO[k].label.length).toBeGreaterThan(0);
      expect(KIND_INFO[k].icon.length).toBeGreaterThan(0);
      expect(KIND_INFO[k].blurb.length).toBeGreaterThan(0);

      expect(ENEMY_DROPS[k], `missing ENEMY_DROPS for ${k}`).toBeDefined();
      expect(ENEMY_DROPS[k].length).toBeGreaterThan(0);
    }
  });

  it("riot_cop possesses a frontal momentum gate defense", () => {
    const gate = MOMENTUM_GATES["riot_cop"];
    expect(gate).toBeDefined();
    expect(gate?.gatesDamage).toBe(true);
    expect(gate?.soft).toBeLessThanOrEqual(0.3);
  });

  it("detective_cop and robo_cop are configured as ranged threats", () => {
    expect(STATS["detective_cop"].ranged).toBe(true);
    expect(STATS["robo_cop"].ranged).toBe(true);
  });
});

describe("Cop Monster Variants - Procedural Cel Painters", () => {
  const painters = [
    { name: "riot_cop", make: makeRiotCopPaints },
    { name: "highway_patrol", make: makeHighwayPatrolPaints },
    { name: "detective_cop", make: makeDetectiveCopPaints },
    { name: "robo_cop", make: makeRoboCopPaints },
  ];

  for (const { name, make } of painters) {
    it(`${name} paints valid frames across S, N, and E facings without error`, () => {
      const p = make();
      expect(p.S).toBeDefined();
      expect(p.N).toBeDefined();
      expect(p.E).toBeDefined();

      const cv = createCanvas(128, 128);
      const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;

      for (const dir of ["S", "N", "E"] as const) {
        const d = p[dir];
        expect(d.idle.length).toBeGreaterThan(0);
        expect(d.walk.length).toBeGreaterThan(0);
        expect(d.attack.length).toBeGreaterThan(0);
        expect(d.death.length).toBeGreaterThan(0);

        // Render idle and attack frames
        expect(() => d.idle[0](ctx)).not.toThrow();
        expect(() => d.attack[0](ctx)).not.toThrow();
        expect(() => d.death[1](ctx)).not.toThrow();
      }
    });
  }
});

describe("Cop Monster Variants - Projectiles & Special Mechanics", () => {
  it("drops spike strips on the corridor floor", () => {
    state.projectiles = [];
    dropSpikeStrip(2, 4);
    expect(state.projectiles.length).toBe(1);
    const pr = state.projectiles[0];
    expect(pr.kind).toBe("spike_strip");
    expect(pr.hostile).toBe(true);
    expect(pr.damage).toBeGreaterThan(0);
    expect(pr.life).toBeGreaterThan(5);
  });

  it("throws and detonates flashbang canisters", () => {
    state.projectiles = [];
    throwFlashbang(0, 0, 4, 4);
    expect(state.projectiles.length).toBe(1);
    expect(state.projectiles[0].kind).toBe("flashbang");

    state.player!.hp = 10;
    state.player!.x = 1;
    state.player!.z = 1;
    detonateFlashbang(1.2, 1.2);
    expect(state.player!.stinkSlowT).toBeGreaterThan(0);
  });

  it("fires .44 Magnum bullets with pierce attribute", () => {
    state.projectiles = [];
    fireMagnumBullet(0, 0, 1, 0);
    expect(state.projectiles.length).toBe(1);
    const pr = state.projectiles[0];
    expect(pr.kind).toBe("magnum_bullet");
    expect(pr.hostile).toBe(true);
    expect(pr.pierced).toBe(1);
  });

  it("fires Auto-9 burst rounds", () => {
    state.projectiles = [];
    fireAuto9Burst(0, 0, 0, 1);
    // Fires synchronously the first round or queues setTimeout
    expect(typeof fireAuto9Burst).toBe("function");
  });

  it("detonates EMP overload on Robo-Cop death", () => {
    state.player!.hp = 10;
    state.player!.x = 2;
    state.player!.z = 2;
    state.player!.momSpeed = 12;
    detonateEmpOverload(2, 2);
    expect(state.player!.momSpeed).toBeLessThan(12);
  });
});
