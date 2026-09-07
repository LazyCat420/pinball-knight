import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  MILKSHAKE_HP,
  MILKSHAKE_DAMAGE,
  MILKSHAKE_R,
  MILKSHAKE_FIRE_RANGE,
  MILKSHAKE_KITE_RANGE,
  MILKSHAKE_WINDUP,
  MILKSHAKE_COOLDOWN,
  MILKSHAKE_SPRAY_SPEED,
} from "../constants/enemies";
import { state, resetState, type Player } from "../state";
import { launchMilkshakeSpray, shakeSprayAssets, updateProjectiles } from "./projectiles";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeMilkshakePaints } from "../render/monsters/milkshake";
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

describe("Toxic Shake (Milkshake Monster) Mechanics, Sprite Sheet & Projectiles", () => {
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

  it("publishes valid milkshake-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/milkshake-S.json");
    expect(existsSync(jsonPath), "public/sprites/milkshake-S.json must exist").toBe(true);

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.name).toBe("milkshake");
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

  it("configures STATS.milkshake and constants correctly for kite ranged spray artillery", () => {
    const st = STATS.milkshake;
    expect(st.ranged).toBe(true);
    expect(st.contactRange).toBe(MILKSHAKE_FIRE_RANGE);
    expect(st.bodyR).toBe(MILKSHAKE_R);
    expect(st.windup).toBe(MILKSHAKE_WINDUP);
    expect(st.cooldown).toBe(MILKSHAKE_COOLDOWN);

    expect(MILKSHAKE_HP).toBe(6);
    expect(MILKSHAKE_DAMAGE).toBe(1);
    expect(MILKSHAKE_SPRAY_SPEED).toBe(7.0);
    expect(MILKSHAKE_FIRE_RANGE).toBe(6.5);
    expect(MILKSHAKE_KITE_RANGE).toBe(3.0);

    expect(MOVEMENT_BY_KIND.milkshake).toBe("kite");
    expect(PAIN_BY_KIND.milkshake).toBe(0.55);
    expect(KIND_SKIN.milkshake?.scale).toBe(1.0);
  });

  it("registers milkshake in Bestiary, Reagents drops, Manifest, and Painters", () => {
    expect(KIND_INFO.milkshake.label).toBe("Toxic Shake");
    expect(KIND_INFO.milkshake.icon).toBe("🥤");
    expect(KIND_INFO.milkshake.blurb).toContain("dishwasher gloves");

    const drops = ENEMY_DROPS.milkshake;
    expect(drops).toBeDefined();
    expect(drops.some(d => d.id === "slimegel")).toBe(true);
    expect(drops.some(d => d.id === "glass")).toBe(true);

    expect(IMPORTED_FACINGS.milkshake).toEqual(["S"]);
    expect(SHEET_PAINTERS.milkshake).toBeDefined();
    expect(KIND_PAINTS.milkshake).toBeDefined();
  });

  it("launches 4-shot toxic milkshake globule spray on launchMilkshakeSpray", () => {
    const sparkCalls: any[] = [];
    state.vfx = {
      sparks: (...args: any[]) => sparkCalls.push(args),
      burst: () => {},
    } as any;

    launchMilkshakeSpray(5, 5, 0, 1);

    // Muzzle toxic sparks fired
    expect(sparkCalls.length).toBeGreaterThanOrEqual(1);

    // 4 spray projectiles spawned
    expect(state.projectiles.length).toBe(4);
    for (const pr of state.projectiles) {
      expect(pr.kind).toBe("shake_spray");
      expect(pr.hostile).toBe(true);
      expect(pr.damage).toBe(MILKSHAKE_DAMAGE);
      expect(pr.vz).toBeGreaterThan(0);
      const speed = Math.hypot(pr.vx, pr.vz);
      expect(speed).toBeCloseTo(MILKSHAKE_SPRAY_SPEED, 1);
    }
  });

  it("damages player, slows them, and spawns toxic green burst when shake_spray hits player", () => {
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
    state.vfx = {
      burst: (...args: any[]) => burstCalls.push(args),
      sparks: () => {},
      blood: () => {},
      damage: () => {},
    } as any;

    state.projectiles.push({
      kind: "shake_spray",
      x: 5,
      z: 5.1,
      vx: 0,
      vz: MILKSHAKE_SPRAY_SPEED,
      life: 1.0,
      maxLife: 1.0,
      damage: MILKSHAKE_DAMAGE,
      hostile: true,
      mesh: mockMesh() as any,
      dispose: () => {},
    });

    updateProjectiles(0.016);

    // Player took damage
    expect(p.hp).toBe(10 - MILKSHAKE_DAMAGE);
    // Toxic green burst VFX triggered
    expect(burstCalls.length).toBeGreaterThanOrEqual(1);
    expect(burstCalls[0][3]).toBe(0x84cc16); // toxic lime green
    // Projectile was despawned
    expect(state.projectiles.length).toBe(0);
  });

  it("procedural cel-painter makeMilkshakePaints builds all 4 action clips cleanly", () => {
    const paints = makeMilkshakePaints();
    expect(paints.S.idle).toBeDefined();
    expect(paints.S.walk).toBeDefined();
    expect(paints.S.attack).toBeDefined();
    expect(paints.S.death).toBeDefined();

    const fakeCtx = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      beginPath: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      ellipse: () => {},
      rect: () => {},
      roundRect: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      quadraticCurveTo: () => {},
      fillRect: () => {},
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;

    for (const clipList of [paints.S.idle, paints.S.walk, paints.S.attack, paints.S.death]) {
      expect(clipList).toBeDefined();
      if (!clipList) continue;
      for (const frame of clipList) {
        expect(() => frame(fakeCtx)).not.toThrow();
      }
    }
  });
});
