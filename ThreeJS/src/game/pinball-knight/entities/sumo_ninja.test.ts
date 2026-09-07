import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  SUMO_NINJA_HP,
  SUMO_NINJA_DAMAGE,
  SUMO_NINJA_R,
  SUMO_NINJA_FIRE_RANGE,
  SUMO_NINJA_KITE_RANGE,
  SUMO_NINJA_WINDUP,
  SUMO_NINJA_COOLDOWN,
  SUMO_NINJA_SHURIKEN_SPEED,
} from "../constants/enemies";
import { state, resetState, type Player } from "../state";
import { launchShuriken, shurikenAssets, updateProjectiles } from "./projectiles";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeSumoNinjaPaints } from "../render/monsters/sumo_ninja";
import { installSpriteTestDom } from "../testkit/atlas-census";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  const g: Grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
  g.t.fill(1); // walkable
  return g;
}

function mockMesh() {
  return {
    position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    scale: { setScalar: () => {} },
  };
}

describe("Drunk Sumo Ninja (sumo_ninja) Mechanics, Sprite Sheet & Shuriken Projectiles", () => {
  let restoreDom: () => void;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    resetState();
    state.grid = makeGrid();
    state.scene = {
      add: () => {},
      remove: () => {},
    } as unknown as typeof state.scene;
    state.projectiles = [];
    state.zombies = [];
    state.vfx = {
      burst: () => {},
      smoke: () => {},
      sparks: () => {},
      blood: () => {},
    } as any;
  });

  it("publishes valid sumo_ninja-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/sumo_ninja-S.json");
    expect(existsSync(jsonPath), "public/sprites/sumo_ninja-S.json must exist").toBe(true);

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.name).toBe("sumo_ninja");
    expect(data.dir).toBe("S");

    const clipNames = data.rows.map((r: { clip: string }) => r.clip);
    expect(clipNames).toEqual(["idle", "walk", "attack", "death"]);
    expect(data.rows.length).toBe(4);

    for (const row of data.rows) {
      expect(row.cells.length).toBe(4);
      for (const cell of row.cells) {
        expect(cell.length).toBe(4);
        expect(cell[2]).toBeGreaterThan(cell[0]);
        expect(cell[3]).toBeGreaterThan(cell[1]);
      }
    }
  });

  it("configures STATS.sumo_ninja and constants correctly for tanky drunk stumbling ranged enemy", () => {
    const st = STATS.sumo_ninja;
    expect(st.ranged).toBe(true);
    expect(st.contactRange).toBe(SUMO_NINJA_FIRE_RANGE);
    expect(st.bodyR).toBe(SUMO_NINJA_R);
    expect(st.windup).toBe(SUMO_NINJA_WINDUP);
    expect(st.cooldown).toBe(SUMO_NINJA_COOLDOWN);

    expect(SUMO_NINJA_HP).toBe(11);
    expect(SUMO_NINJA_R).toBe(0.46);
    expect(SUMO_NINJA_DAMAGE).toBe(1);
    expect(SUMO_NINJA_SHURIKEN_SPEED).toBe(9.5);
    expect(SUMO_NINJA_FIRE_RANGE).toBe(7.0);
    expect(SUMO_NINJA_KITE_RANGE).toBe(2.2);

    expect(MOVEMENT_BY_KIND.sumo_ninja).toBe("kite");
    expect(PAIN_BY_KIND.sumo_ninja).toBe(0.35);
    expect(KIND_SKIN.sumo_ninja?.scale).toBe(1.0);
  });

  it("registers sumo_ninja in Bestiary, Reagents drops, Manifest, and Painters", () => {
    expect(KIND_INFO.sumo_ninja.label).toBe("Drunk Sumo Ninja");
    expect(KIND_INFO.sumo_ninja.icon).toBe("🥷");
    expect(KIND_INFO.sumo_ninja.blurb).toContain("ninja stars");

    const drops = ENEMY_DROPS.sumo_ninja;
    expect(drops).toBeDefined();
    expect(drops.some(d => d.id === "ironshard")).toBe(true);
    expect(drops.some(d => d.id === "steelpin")).toBe(true);

    expect(IMPORTED_FACINGS.sumo_ninja).toEqual(["S"]);
    expect(SHEET_PAINTERS.sumo_ninja).toBeDefined();
    expect(KIND_PAINTS.sumo_ninja).toBeDefined();
  });

  it("launches 2-shot spinning ninja star spread on launchShuriken", () => {
    const sparkCalls: any[] = [];
    state.vfx = {
      sparks: (...args: any[]) => sparkCalls.push(args),
      burst: () => {},
    } as any;

    launchShuriken(5, 5, 0, 1);

    // Muzzle glint sparks fired
    expect(sparkCalls.length).toBeGreaterThanOrEqual(1);

    // 2 shuriken projectiles spawned
    expect(state.projectiles.length).toBe(2);
    for (const pr of state.projectiles) {
      expect(pr.kind).toBe("shuriken");
      expect(pr.hostile).toBe(true);
      expect(pr.damage).toBe(SUMO_NINJA_DAMAGE);
      expect(pr.vz).toBeGreaterThan(0);
      const speed = Math.hypot(pr.vx, pr.vz);
      expect(speed).toBeCloseTo(SUMO_NINJA_SHURIKEN_SPEED, 1);
    }
  });

  it("damages player and spawns metallic clink burst when shuriken hits player", () => {
    const p = {
      x: 5,
      z: 5.2,
      hp: 10,
      iframes: 0,
      shieldT: 0,
      webT: 0,
      sprite: { setTint: () => {}, mesh: mockMesh() },
    } as unknown as Player;
    state.player = p;

    const burstCalls: any[] = [];
    const bloodCalls: any[] = [];
    state.vfx = {
      burst: (...args: any[]) => burstCalls.push(args),
      blood: (...args: any[]) => bloodCalls.push(args),
      sparks: () => {},
      damage: () => {},
    } as any;

    state.projectiles.push({
      kind: "shuriken",
      x: 5,
      z: 5.1,
      vx: 0,
      vz: SUMO_NINJA_SHURIKEN_SPEED,
      life: 1.0,
      maxLife: 1.0,
      damage: SUMO_NINJA_DAMAGE,
      hostile: true,
      mesh: mockMesh() as any,
      dispose: () => {},
    });

    // Update projectiles for 1 frame (16ms)
    updateProjectiles(0.016);

    // Player took damage
    expect(p.hp).toBe(10 - SUMO_NINJA_DAMAGE);

    // Metallic burst & blood spawned
    expect(burstCalls.length).toBeGreaterThanOrEqual(1);
    expect(burstCalls[0][3]).toBe(0xe2e8f0); // metallic silver burst
    expect(bloodCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("renders procedural cel-paints for all states and directions without throwing", () => {
    const paints = makeSumoNinjaPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    for (const dir of ["S", "N", "E"] as const) {
      const set = paints[dir];
      expect(set.idle.length).toBe(4);
      expect(set.walk.length).toBe(4);
      expect(set.attack.length).toBe(4);
      expect(set.death.length).toBe(4);

      // Verify each frame executes on canvas context
      for (const clip of [set.idle, set.walk, set.attack, set.death]) {
        for (const frame of clip) {
          const cv = document.createElement("canvas");
          cv.width = 128;
          cv.height = 128;
          const ctx = cv.getContext("2d")!;
          expect(() => frame(ctx)).not.toThrow();
        }
      }
    }
  });
});
