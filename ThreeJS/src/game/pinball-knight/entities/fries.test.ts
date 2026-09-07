import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  FRIES_HP,
  FRIES_DAMAGE,
  FRIES_R,
  FRIES_FIRE_RANGE,
  FRIES_KITE_RANGE,
  FRIES_WINDUP,
  FRIES_COOLDOWN,
  FRIES_DART_SPEED,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import { launchFryBarrage, fryDartAssets, updateProjectiles } from "./projectiles";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeFriesPaints } from "../render/monsters/fries";
import { installSpriteTestDom } from "../testkit/atlas-census";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  const g: Grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
  // Floor is all walkable by default (value 1)
  g.t.fill(1);
  return g;
}

function mockMesh() {
  return {
    position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    scale: { setScalar: () => {} },
  };
}

describe("Fry Sentinel (Fries Monster) Mechanics, Sprite Sheet & Projectiles", () => {
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

  it("publishes valid fries-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/fries-S.json");
    expect(existsSync(jsonPath), "public/sprites/fries-S.json must exist").toBe(true);

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.name).toBe("fries");
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

  it("configures STATS.fries and constants correctly for kite ranged artillery", () => {
    const st = STATS.fries;
    expect(st.ranged).toBe(true);
    expect(st.contactRange).toBe(FRIES_FIRE_RANGE);
    expect(st.bodyR).toBe(FRIES_R);
    expect(st.windup).toBe(FRIES_WINDUP);
    expect(st.cooldown).toBe(FRIES_COOLDOWN);

    expect(FRIES_HP).toBe(5);
    expect(FRIES_DAMAGE).toBe(1);
    expect(FRIES_DART_SPEED).toBe(7.8);
    expect(FRIES_FIRE_RANGE).toBe(7.0);
    expect(FRIES_KITE_RANGE).toBe(3.5);

    expect(MOVEMENT_BY_KIND.fries).toBe("kite");
    expect(PAIN_BY_KIND.fries).toBe(0.5);
    expect(KIND_SKIN.fries?.scale).toBe(1.0);
  });

  it("registers fries in Bestiary, Reagents drops, Manifest, and Painters", () => {
    expect(KIND_INFO.fries.label).toBe("Fry Sentinel");
    expect(KIND_INFO.fries.icon).toBe("🍟");
    expect(KIND_INFO.fries.blurb).toContain("crinkle-cut");

    const drops = ENEMY_DROPS.fries;
    expect(drops).toBeDefined();
    expect(drops.some(d => d.id === "rotflesh")).toBe(true);
    expect(drops.some(d => d.id === "glass")).toBe(true);

    expect(IMPORTED_FACINGS.fries).toEqual(["S"]);
    expect(SHEET_PAINTERS.fries).toBeDefined();
    expect(KIND_PAINTS.fries).toBeDefined();
  });

  it("launches 3-shot head fry rocket barrage with spread on launchFryBarrage", () => {
    const sparkCalls: any[] = [];
    state.vfx = {
      sparks: (...args: any[]) => sparkCalls.push(args),
      burst: () => {},
    } as any;

    launchFryBarrage(5, 5, 0, 1);

    // Muzzle sparks fired
    expect(sparkCalls.length).toBeGreaterThanOrEqual(1);

    // 3 fry dart projectiles spawned
    expect(state.projectiles.length).toBe(3);
    for (const pr of state.projectiles) {
      expect(pr.kind).toBe("fry_dart");
      expect(pr.hostile).toBe(true);
      expect(pr.damage).toBe(FRIES_DAMAGE);
      expect(pr.vz).toBeGreaterThan(0);
      const speed = Math.hypot(pr.vx, pr.vz);
      expect(speed).toBeCloseTo(FRIES_DART_SPEED, 1);
    }
  });

  it("damages player and spawns crumb burst when fry_dart hits player", () => {
    const p = {
      x: 5,
      z: 5.2,
      hp: 10,
      iframes: 0,
      shieldT: 0,
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
      kind: "fry_dart",
      x: 5,
      z: 5.1,
      vx: 0,
      vz: FRIES_DART_SPEED,
      life: 1.0,
      maxLife: 1.0,
      damage: FRIES_DAMAGE,
      hostile: true,
      mesh: mockMesh() as any,
      dispose: () => {},
    });

    updateProjectiles(0.016);

    // Player took damage
    expect(p.hp).toBe(10 - FRIES_DAMAGE);
    // Golden fry crumb burst VFX triggered
    expect(burstCalls.length).toBeGreaterThanOrEqual(1);
    expect(burstCalls[0][3]).toBe(0xfacc15); // golden yellow
    // Projectile was despawned
    expect(state.projectiles.length).toBe(0);
  });

  it("procedural cel-painter makeFriesPaints builds all 4 action clips cleanly", () => {
    const paints = makeFriesPaints();
    expect(paints.S.idle).toBeDefined();
    expect(paints.S.walk).toBeDefined();
    expect(paints.S.attack).toBeDefined();
    expect(paints.S.death).toBeDefined();

    // Ensure they render onto a canvas context without runtime exceptions
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
