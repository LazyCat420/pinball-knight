import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  ZIPPO_HP,
  ZIPPO_DAMAGE,
  ZIPPO_R,
  ZIPPO_FIRE_RANGE,
  ZIPPO_KITE_RANGE,
  ZIPPO_WINDUP,
  ZIPPO_COOLDOWN,
  ZIPPO_FLAME_SPEED,
} from "../constants/enemies";
import { state, resetState, type Player } from "../state";
import { launchZippoFlameBreath, zippoFlameAssets, updateProjectiles } from "./projectiles";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeZippoPaints } from "../render/monsters/zippo";
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

describe("Pyro Zippo (1960s Cartoon Zippo Lighter) Mechanics, Sprite Sheet & Flame Breath", () => {
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
      damage: () => {},
    } as any;
  });

  it("publishes valid zippo-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/zippo-S.json");
    expect(existsSync(jsonPath), "public/sprites/zippo-S.json must exist").toBe(true);

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.name).toBe("zippo");
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

  it("configures STATS.zippo and constants correctly for 1960s cartoon lighter monster", () => {
    const st = STATS.zippo;
    expect(st.ranged).toBe(true);
    expect(st.contactRange).toBe(ZIPPO_FIRE_RANGE);
    expect(st.bodyR).toBe(ZIPPO_R);
    expect(st.windup).toBe(ZIPPO_WINDUP);
    expect(st.cooldown).toBe(ZIPPO_COOLDOWN);

    expect(ZIPPO_HP).toBe(6);
    expect(ZIPPO_R).toBe(0.36);
    expect(ZIPPO_DAMAGE).toBe(1);
    expect(ZIPPO_FLAME_SPEED).toBe(7.2);
    expect(ZIPPO_FIRE_RANGE).toBe(5.5);
    expect(ZIPPO_KITE_RANGE).toBe(3.2);

    expect(MOVEMENT_BY_KIND.zippo).toBe("kite");
    expect(PAIN_BY_KIND.zippo).toBe(0.50);
    expect(KIND_SKIN.zippo?.scale).toBe(1.0);
  });

  it("registers zippo in Bestiary, Reagents drops, Manifest, and Painters", () => {
    expect(KIND_INFO.zippo.label).toBe("Pyro Zippo");
    expect(KIND_INFO.zippo.icon).toBe("🔥");
    expect(KIND_INFO.zippo.blurb).toContain("flame face");

    const drops = ENEMY_DROPS.zippo;
    expect(drops).toBeDefined();
    expect(drops.some(d => d.id === "ironshard")).toBe(true);
    expect(drops.some(d => d.id === "glass")).toBe(true);

    expect(IMPORTED_FACINGS.zippo).toEqual(["S"]);
    expect(SHEET_PAINTERS.zippo).toBeDefined();
    expect(KIND_PAINTS.zippo).toBeDefined();
  });

  it("launches 5-shot expanding fire breath fan on launchZippoFlameBreath", () => {
    const sparkCalls: any[] = [];
    const smokeCalls: any[] = [];
    state.vfx = {
      sparks: (...args: any[]) => sparkCalls.push(args),
      smoke: (...args: any[]) => smokeCalls.push(args),
      burst: () => {},
    } as any;

    launchZippoFlameBreath(5, 5, 0, 1);

    // Muzzle sparks and smoke fired
    expect(sparkCalls.length).toBeGreaterThanOrEqual(1);
    expect(smokeCalls.length).toBeGreaterThanOrEqual(1);

    // 5 flame projectiles spawned in an expanding fan
    expect(state.projectiles.length).toBe(5);
    for (const pr of state.projectiles) {
      expect(pr.kind).toBe("zippo_flame");
      expect(pr.hostile).toBe(true);
      expect(pr.damage).toBe(ZIPPO_DAMAGE);
      expect(pr.life).toBeCloseTo(ZIPPO_FIRE_RANGE / ZIPPO_FLAME_SPEED, 3);
    }

    // Verify angles fan out across heading
    const vxs = state.projectiles.map(p => p.vx);
    expect(Math.min(...vxs)).toBeLessThan(0);
    expect(Math.max(...vxs)).toBeGreaterThan(0);
  });

  it("damages player and spawns fire burst when zippo_flame hits player", () => {
    const burstCalls: any[] = [];
    const sparkCalls: any[] = [];
    state.vfx = {
      burst: (...args: any[]) => burstCalls.push(args),
      sparks: (...args: any[]) => sparkCalls.push(args),
      smoke: () => {},
      blood: () => {},
      damage: () => {},
    } as any;

    const player: Player = {
      x: 5,
      z: 5,
      hp: 10,
      maxHp: 10,
      iframes: 0,
      shieldT: 0,
      stoneT: 0,
      armor: 0,
      helm: 0,
      speed: 4.2,
      facing: "S",
      goldRun: 0,
      goldBank: 0,
      floor: 1,
      kills: 0,
      runes: 0,
      alive: true,
      weapon: { id: "sword", label: "Sword", icon: "⚔️", kind: "melee", damage: 2, range: 1.2, cooldown: 0.35, speedMult: 1 },
      gear: { head: null, chest: null, boots: null, ring: null, amulet: null },
      sprite: { setTint: () => {}, mesh: mockMesh() } as any,
    } as unknown as Player;
    state.player = player;

    state.projectiles.push({
      kind: "zippo_flame",
      x: 5.05,
      z: 5.05,
      vx: 0,
      vz: 7.2,
      life: 1.0,
      maxLife: 1.0,
      damage: 1,
      hostile: true,
      mesh: mockMesh() as any,
      dispose: () => {},
    });

    updateProjectiles(0.016);

    // Player takes damage
    expect(player.hp).toBeLessThan(10);
    // Fiery burst effects triggered
    expect(burstCalls.length).toBeGreaterThanOrEqual(1);
    expect(sparkCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("procedural fallback cel painter makeZippoPaints paints all 4 animation clips across facings", () => {
    const paints = makeZippoPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    for (const facing of ["S", "N", "E"] as const) {
      const clips = paints[facing]!;
      expect(clips.idle!.length).toBe(4);
      expect(clips.walk!.length).toBe(4);
      expect(clips.attack!.length).toBe(4);
      expect(clips.death!.length).toBe(4);

      // Verify each frame paint function executes without throwing
      const dummyCanvas = document.createElement("canvas");
      dummyCanvas.width = 128;
      dummyCanvas.height = 128;
      const ctx = dummyCanvas.getContext("2d")!;

      for (const frame of [...clips.idle!, ...clips.walk!, ...clips.attack!, ...clips.death!]) {
        expect(() => frame(ctx)).not.toThrow();
      }
    }
  });
});
