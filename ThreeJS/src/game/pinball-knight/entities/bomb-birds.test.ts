import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { STATS } from "./zombie";
import { HP_BY_KIND } from "../spawn/factory";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import {
  CORVID_BOMBER_HP,
  CORVID_BOMBER_HOVER_Y,
  CORVID_BOMB_FUSE,
  CORVID_BLAST_RADIUS,
  CORVID_BLAST_DAMAGE,
  CORVID_BLAST_ENEMY_DAMAGE,
  VULTURE_HP,
  VULTURE_HOVER_Y,
  VULTURE_SLUDGE_RADIUS,
  VULTURE_ROT_LIFE,
  GULL_HP,
  GULL_HOVER_Y,
  GULL_BLAST_DAMAGE,
  GULL_BLAST_ENEMY_DAMAGE,
  FALCON_HP,
  FALCON_HOVER_Y,
  FALCON_BLAST_RADIUS,
  FALCON_FIRE_LIFE,
} from "../constants/enemies";
import { state, resetState } from "../state";
import {
  dropCorvidBomb,
  detonateCorvidBomb,
  dropVultureBomb,
  detonateVultureSludge,
  dropGullClusterBomb,
  detonateGullEgg,
  detonateGullMini,
  dropFalconFireBomb,
  detonateFalconFire,
  updateProjectiles,
} from "./projectiles";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { keysForFloor } from "../boot/sheets";
import { installSpriteTestDom } from "../testkit/atlas-census";
import type { Grid } from "../maze/generator";
import * as THREE from "three";
import type { Player } from "../state";

function makeFakeVfx(overrides: Record<string, any> = {}) {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => {};
    },
  }) as any;
}

function makeFakePlayer(x = 10, z = 10): Player {
  return {
    x,
    z,
    hp: 100,
    maxHp: 100,
    momSpeed: 5,
    momX: 0,
    momZ: 0,
    iframes: 0,
    facing: "S",
    sprite: {
      setTint: () => {},
      mesh: new THREE.Mesh(),
    },
  } as unknown as Player;
}

function makeGrid(): Grid {
  const g: Grid = { w: 30, h: 30, t: new Uint8Array(900), shapes: new Uint8Array(900) };
  g.t.fill(1); // fully walkable floor
  return g;
}

describe("4 Bomb-Dropping Birds — Roster Integration", () => {
  const birds = [
    "corvid_bomber",
    "vulture_scavenger",
    "gull_bomber",
    "sky_falcon",
  ] as const;

  it("registers all 4 bird kinds across all required engine systems", () => {
    for (const kind of birds) {
      expect(STATS[kind], `STATS missing ${kind}`).toBeDefined();
      expect(STATS[kind].ranged, `${kind} must be ranged`).toBe(true);
      expect(HP_BY_KIND[kind], `HP_BY_KIND missing ${kind}`).toBeGreaterThan(0);
      expect(KIND_INFO[kind], `KIND_INFO missing ${kind}`).toBeDefined();
      expect(ENEMY_DROPS[kind], `ENEMY_DROPS missing ${kind}`).toBeDefined();
      expect(MOVEMENT_BY_KIND[kind], `MOVEMENT_BY_KIND missing ${kind}`).toBeDefined();
      expect(PAIN_BY_KIND[kind], `PAIN_BY_KIND missing ${kind}`).toBeGreaterThan(0);
      expect(SHEET_PAINTERS[kind], `SHEET_PAINTERS missing ${kind}`).toBeDefined();
      expect(KIND_PAINTS[kind], `KIND_PAINTS missing ${kind}`).toBeDefined();
    }
  });

  it("assigns distinct tactical movement kinds and flight hover heights", () => {
    expect(MOVEMENT_BY_KIND.corvid_bomber).toBe("flanker");
    expect(CORVID_BOMBER_HOVER_Y).toBe(0.85);

    expect(MOVEMENT_BY_KIND.vulture_scavenger).toBe("orbiter");
    expect(VULTURE_HOVER_Y).toBe(1.25);

    expect(MOVEMENT_BY_KIND.gull_bomber).toBe("strafer");
    expect(GULL_HOVER_Y).toBe(0.65);

    expect(MOVEMENT_BY_KIND.sky_falcon).toBe("kite");
    expect(FALCON_HOVER_Y).toBe(0.95);
  });

  it("introduces birds at appropriate floor levels", () => {
    const floor2 = keysForFloor(2);
    expect(floor2).toContain("corvid_bomber");
    expect(floor2).toContain("gull_bomber");

    const floor3 = keysForFloor(3);
    expect(floor3).toContain("vulture_scavenger");
    expect(floor3).toContain("sky_falcon");
  });
});

describe("Bomb Projectiles & Detonation Mechanics", () => {
  beforeEach(() => {
    resetState();
    state.grid = makeGrid();
    state.scene = {
      add: () => {},
      remove: () => {},
    } as unknown as typeof state.scene;
    state.projectiles = [];
    state.zombies = [];
    state.floorFx = [];
    state.vfx = makeFakeVfx();
    state.player = makeFakePlayer(10, 10);
  });

  it("Corvid Bomber drops cast-iron timed delay bomb that harms horde and spares Reaper", () => {
    dropCorvidBomb(10, 10, 0, 0);

    expect(state.projectiles.length).toBe(1);
    const p = state.projectiles[0];
    expect(p.kind).toBe("corvid_bomb");
    expect(p.life).toBe(CORVID_BOMB_FUSE);

    // Setup enemies: a goblin and a reaper within blast radius
    state.zombies = [
      {
        id: 1,
        kind: "goblin",
        x: 10.5,
        z: 10,
        r: 0.3,
        hp: 20,
        maxHp: 20,
        mode: "chase",
        sprite: {
          setTint: () => {},
          setBlobVisible: () => {},
          mesh: new THREE.Mesh(),
        },
      } as any,
      {
        id: 2,
        kind: "reaper", // Death Dealer is immune to friendly bomb fire
        x: 10.2,
        z: 10,
        r: 0.5,
        hp: 100,
        maxHp: 100,
        mode: "chase",
      } as any,
    ];

    detonateCorvidBomb(10, 10);

    // Player at (10, 10) takes bomb blast damage
    expect(state.player!.hp).toBeLessThan(100);
    // Goblin was hurt
    expect(state.zombies[0].hp).toBeLessThan(20);
    // Reaper was spared
    expect(state.zombies[1].hp).toBe(100);
  });

  it("Vulture Scavenger drops sludge bomb and leaves rot floor hazard", () => {
    dropVultureBomb(12, 12);

    expect(state.projectiles.length).toBe(1);
    const p = state.projectiles[0];
    expect(p.kind).toBe("vulture_sludge_bomb");

    detonateVultureSludge(12, 12);
    expect(state.floorFx.length).toBeGreaterThanOrEqual(1);
    expect(state.floorFx.some((fx) => fx.kind === "rot")).toBe(true);
  });

  it("Gull Bomber drops cluster egg bomb that splits into mini-bombs on detonation", () => {
    dropGullClusterBomb(15, 15, 0.5, 0.5);

    expect(state.projectiles.length).toBe(1);
    const p = state.projectiles[0];
    expect(p.kind).toBe("gull_egg_bomb");

    detonateGullEgg(15, 15);
    // Splits into 3 mini bombs
    const minis = state.projectiles.filter((proj) => proj.kind === "gull_mini_bomb");
    expect(minis.length).toBe(3);

    // Detonate one mini
    const initialPlayerHp = state.player!.hp;
    state.player!.x = minis[0].x;
    state.player!.z = minis[0].z;
    detonateGullMini(minis[0].x, minis[0].z);
    expect(state.player!.hp).toBeLessThan(initialPlayerHp);
  });

  it("Sky Falcon drops napalm fire bomb leaving burning floor hazards", () => {
    dropFalconFireBomb(20, 20, 1.0, 0);

    expect(state.projectiles.length).toBe(1);
    const p = state.projectiles[0];
    expect(p.kind).toBe("falcon_fire_bomb");

    detonateFalconFire(20, 20);
    expect(state.floorFx.some((fx) => fx.kind === "fire")).toBe(true);
  });

  it("updateProjectiles detonates bombs on fuse expiration", () => {
    dropCorvidBomb(10, 10, 0, 0);
    const p = state.projectiles[0];
    p.life = 0.01;

    updateProjectiles(0.05);

    // Bomb detonated on expiry
    expect(state.player!.hp).toBeLessThan(100);
  });
});

describe("Cel-Painter Production", () => {
  let restoreDom: () => void;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  it("builds valid multi-directional animation frames for all 4 birds", () => {
    const painters = [
      SHEET_PAINTERS.corvid_bomber(),
      SHEET_PAINTERS.vulture_scavenger(),
      SHEET_PAINTERS.gull_bomber(),
      SHEET_PAINTERS.sky_falcon(),
    ];

    for (const actorPaints of painters) {
      for (const dir of ["S", "N", "E"] as const) {
        const dirClips = actorPaints[dir];
        expect(dirClips, `Missing dir ${dir}`).toBeDefined();
        expect(dirClips?.idle?.length).toBeGreaterThanOrEqual(4);
        expect(dirClips?.walk?.length).toBeGreaterThanOrEqual(4);
        expect(dirClips?.attack?.length).toBeGreaterThanOrEqual(4);
        expect(dirClips?.death?.length).toBeGreaterThanOrEqual(4);
      }
    }
  });
});
