import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS, updateZombies } from "./zombie";
import {
  CRAB_HP,
  CRAB_R,
  CRAB_SPEED_FACTOR,
  CRAB_SLASH_RANGE,
  CRAB_WINDUP,
  CRAB_COOLDOWN,
  CRAB_SLASH_DAMAGE,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import { MOVEMENT_BY_KIND, MOMENTUM_GATES } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { HP_BY_KIND } from "../spawn/factory";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeCrabPaints } from "../render/monsters/crab";
import { damageZombie, hitPlayer } from "./combat";
import { installSpriteTestDom } from "../testkit/atlas-census";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  const g: Grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
  g.t.fill(1); // walkable
  return g;
}

describe("Dapper Knife Crab ('Sir Pinch-a-Lot') Monster Mechanics, Scissor Slash & Carapace Deflection", () => {
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

  it("publishes valid crab-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/crab-S.json");
    expect(existsSync(jsonPath), "public/sprites/crab-S.json must exist").toBe(true);

    const raw = readFileSync(jsonPath, "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("crab");
    expect(manifest.dir).toBe("S");

    const clips = manifest.rows.map((r: any) => r.clip);
    expect(clips).toContain("idle");
    expect(clips).toContain("walk");
    expect(clips).toContain("attack");
    expect(clips).toContain("death");

    for (const row of manifest.rows) {
      expect(row.cells.length).toBe(4);
    }
  });

  it("registers crab across all core compile-enforced tables", () => {
    // 1. STATS
    expect(STATS.crab).toBeDefined();
    expect(STATS.crab.ranged).toBe(false);
    expect(STATS.crab.bodyR).toBe(CRAB_R);
    expect(STATS.crab.contactRange).toBe(CRAB_SLASH_RANGE);
    expect(STATS.crab.windup).toBe(CRAB_WINDUP);
    expect(STATS.crab.cooldown).toBe(CRAB_COOLDOWN);

    // 2. MOVEMENT_BY_KIND
    expect(MOVEMENT_BY_KIND.crab).toBe("flanker");

    // 3. PAIN_BY_KIND
    expect(PAIN_BY_KIND.crab).toBe(0.30);

    // 4. MOMENTUM_GATES
    expect(MOMENTUM_GATES.crab).toBeDefined();
    expect(MOMENTUM_GATES.crab?.gatesDamage).toBe(true);
    expect(MOMENTUM_GATES.crab?.soft).toBe(0.35);

    // 5. BESTIARY (KIND_INFO)
    expect(KIND_INFO.crab).toBeDefined();
    expect(KIND_INFO.crab.label).toBe("Sir Pinch-a-Lot");
    expect(KIND_INFO.crab.icon).toBe("🦀");

    // 6. ENEMY_DROPS
    expect(ENEMY_DROPS.crab).toBeDefined();
    expect(ENEMY_DROPS.crab.length).toBeGreaterThanOrEqual(2);

    // 7. KIND_SKIN
    expect(KIND_SKIN.crab).toBeDefined();
    expect(KIND_SKIN.crab?.scale).toBe(1.1);

    // 8. HP_BY_KIND
    expect(HP_BY_KIND.crab).toBe(CRAB_HP);

    // 9. IMPORTED_FACINGS
    expect(IMPORTED_FACINGS.crab).toEqual(["S"]);

    // 10. SHEET_PAINTERS & PORTRAIT
    expect(SHEET_PAINTERS.crab).toBe(makeCrabPaints);
    expect(KIND_PAINTS.crab).toBe(makeCrabPaints);
  });

  it("deflects low-momentum strikes through hardened carapace, but opens vulnerability window on windup", () => {
    const dummyAnim = {
      set: () => {},
      update: () => {},
      play: () => {},
      setFacing: () => {},
      currentClip: "idle",
      frameIndex: 0,
    } as any;

    const dummySprite = {
      mesh: { position: { set: () => {} }, scale: { set: () => {} } },
      setFrame: () => {},
      setTint: () => {},
    } as any;

    const crabZombie: Zombie = {
      kind: "crab",
      x: 10,
      z: 10,
      hp: CRAB_HP,
      mode: "chase",
      speed: 1,
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      burnT: 0,
      sprite: dummySprite,
      anim: dummyAnim,
      aggro: true,
    };
    state.zombies = [crabZombie];

    // Strike 1: Low momentum (0.5 u/s) during chase mode -> carapace gate deflects
    damageZombie(crabZombie, 3, 0, 1, 0.5);
    expect(crabZombie.hp).toBe(CRAB_HP); // Completely deflected

    // Strike 2: During attack windup mode -> carapace pops open, dealing direct damage!
    crabZombie.mode = "windup";
    damageZombie(crabZombie, 3, 0, 1, 0.5);
    expect(crabZombie.hp).toBe(CRAB_HP - 3); // Vulnerability strike penetrated
  });

  it("cuts player momentum by 50% upon landing scissor-slash attack", () => {
    state.player = {
      x: 10,
      z: 10.8,
      hp: 10,
      maxHp: 10,
      facing: "S",
      attackT: -1,
      momSpeed: 10.0,
      momX: 0,
      momZ: 1,
      sprite: { setTint: () => {}, mesh: { position: { set: () => {} } } } as any,
      anim: {} as any,
    } as unknown as Player;

    const crabZombie: Zombie = {
      kind: "crab",
      x: 10,
      z: 10,
      hp: CRAB_HP,
      mode: "windup",
      speed: 1,
      windupT: 0.51, // Completed windup
      cooldown: 0,
      flashT: 0,
      burnT: 0,
      sprite: { setFrame: () => {}, setTint: () => {} } as any,
      anim: { set: () => {}, update: () => {}, setFacing: () => {}, play: () => {} } as any,
      aggro: true,
    };
    state.zombies = [crabZombie];

    // Trigger updateZombies to execute the melee attack
    updateZombies(0.016);

    // Player should have taken damage
    expect(state.player.hp).toBeLessThan(10);
    // Player momentum should be hobbled down to ~50%
    expect(state.player.momSpeed).toBeCloseTo(5.0, 1);
  });
});
