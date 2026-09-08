import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { STATS } from "./zombie";
import {
  DRACULA_HP,
  DRACULA_R,
  DRACULA_SPEED_FACTOR,
  DRACULA_DRAIN_RANGE,
  DRACULA_DRAIN_TICK,
  DRACULA_DRAIN_DURATION,
  DRACULA_DRAIN_DAMAGE,
  DRACULA_DRAIN_HEAL,
  DRACULA_DRAIN_COOLDOWN,
  DRACULA_BAT_HP,
  DRACULA_BAT_R,
  DRACULA_BAT_SPEED_FACTOR,
  DRACULA_BAT_DAMAGE,
  DRACULA_BAT_SCALE,
  DRACULA_BAT_TINT,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { HP_BY_KIND, queueDraculaBat, drainPendingDraculaBats } from "../spawn/factory";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeDraculaPaints } from "../render/monsters/dracula";
import { isPlayerInDrainRange, updateDraculaSiphon } from "./dracula";
import { killZombie, setDraculaTransformHandler } from "./combat";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { createCanvas } from "canvas";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  const g: Grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
  g.t.fill(1); // walkable
  return g;
}

function makeMockZombie(overrides: Partial<Zombie> = {}): Zombie {
  return {
    nid: 1,
    x: 10,
    z: 10,
    speed: 1.5,
    hp: DRACULA_HP,
    maxHp: DRACULA_HP,
    kind: "dracula",
    mode: "active",
    facing: "S",
    anim: {
      play: () => {},
      setFacing: () => {},
      getFacing: () => "S",
    },
    sprite: {
      setTint: () => {},
      setBlobVisible: () => {},
      mesh: {
        scale: {
          x: 1,
          y: 1,
          z: 1,
          set: () => {},
          multiplyScalar: () => {},
        },
        position: { x: 10, y: 0, z: 10, set: () => {} },
      },
    },
    ...overrides,
  } as unknown as Zombie;
}

describe("Count Dracula & Dracula Bat Final Form Mechanics", () => {
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
      mote: () => {},
      heal: () => {},
      damage: () => {},
      dust: () => {},
    } as unknown as typeof state.vfx;

    state.player = {
      x: 10,
      z: 10,
      hp: 10,
      maxHp: 10,
      facing: "S",
      momSpeed: 0,
      flattenT: 0,
      petrifiedT: 0,
      cooldown: 0,
      iframes: 0,
      shieldT: 0,
      oilT: 0,
      webbedT: 0,
      squashT: 0,
      bounceCombo: 0,
      bounceComboT: 0,
      attackT: -1,
      didHit: false,
      rideT: -1,
      anim: {
        play: () => {},
        setFacing: () => {},
      },
      sprite: {
        setTint: () => {},
        mesh: {
          scale: {
            x: 1,
            y: 1,
            z: 1,
            set: () => {},
          },
          position: { set: () => {} },
        },
      },
    } as unknown as Player;
  });

  it("registers Count Dracula and Dracula Bat across all engine and bestiary tables", () => {
    expect(DRACULA_HP).toBe(22);
    expect(DRACULA_R).toBe(0.45);
    expect(DRACULA_SPEED_FACTOR).toBe(0.95);
    expect(DRACULA_DRAIN_RANGE).toBe(1.8);
    expect(DRACULA_DRAIN_DAMAGE).toBe(1);
    expect(DRACULA_DRAIN_HEAL).toBe(1);

    expect(DRACULA_BAT_HP).toBe(12);
    expect(DRACULA_BAT_R).toBe(0.35);
    expect(DRACULA_BAT_SPEED_FACTOR).toBe(1.45);
    expect(DRACULA_BAT_DAMAGE).toBe(2);
    expect(DRACULA_BAT_SCALE).toBe(1.35);
    expect(DRACULA_BAT_TINT).toBe(0xff2244);

    expect(STATS.dracula.bodyR).toBe(DRACULA_R);
    expect(STATS.dracula.contactRange).toBe(DRACULA_DRAIN_RANGE);
    expect(STATS.dracula.ranged).toBe(true);

    expect(STATS.dracula_bat.bodyR).toBe(DRACULA_BAT_R);
    expect(STATS.dracula_bat.ranged).toBe(false);

    expect(HP_BY_KIND.dracula).toBe(DRACULA_HP);
    expect(HP_BY_KIND.dracula_bat).toBe(DRACULA_BAT_HP);

    expect(MOVEMENT_BY_KIND.dracula).toBe("chase");
    expect(MOVEMENT_BY_KIND.dracula_bat).toBe("kite");

    expect(PAIN_BY_KIND.dracula).toBe(0.30);
    expect(PAIN_BY_KIND.dracula_bat).toBe(0.20);

    expect(KIND_INFO.dracula.label).toBe("Count Dracula");
    expect(KIND_INFO.dracula.icon).toBe("🧛");
    expect(KIND_INFO.dracula_bat.label).toBe("Dracula Bat");
    expect(KIND_INFO.dracula_bat.icon).toBe("🦇");

    expect(ENEMY_DROPS.dracula).toBeDefined();
    expect(ENEMY_DROPS.dracula_bat).toBeDefined();
    expect(ENEMY_DROPS.dracula.some((d) => d.id === "fang")).toBe(true);
    expect(ENEMY_DROPS.dracula_bat.some((d) => d.id === "batwing")).toBe(true);

    expect(KIND_SKIN.dracula?.scale).toBe(1.15);
    expect(KIND_SKIN.dracula_bat?.sheetKey).toBe("bat");
    expect(KIND_SKIN.dracula_bat?.scale).toBe(1.35);

    expect(IMPORTED_FACINGS.dracula).toEqual(["S"]);
    expect(SHEET_PAINTERS.dracula).toBe(makeDraculaPaints);
    expect(KIND_PAINTS.dracula).toBe(makeDraculaPaints);
  });

  it("correctly identifies whether the player is in drain range", () => {
    const drac = { x: 10, z: 10 };
    // Inside 1.8 range (distance 1.2) -> true
    expect(isPlayerInDrainRange(drac, { x: 10, z: 11.2 }, 1.8)).toBe(true);
    // Right on boundary (distance 1.8) -> true
    expect(isPlayerInDrainRange(drac, { x: 10, z: 11.8 }, 1.8)).toBe(true);
    // Outside range (distance 2.5) -> false
    expect(isPlayerInDrainRange(drac, { x: 10, z: 12.5 }, 1.8)).toBe(false);
  });

  it("channels blood siphon, draining player HP and healing Dracula on pulse ticks", () => {
    const z = makeMockZombie({ x: 10, z: 10, hp: 15, maxHp: 22 });
    const p = state.player!;
    p.x = 10;
    p.z = 11.2; // in range
    p.hp = 8;

    // First frame: initiates siphon channel
    updateDraculaSiphon(z, p, 0.05);
    expect(z.draculaDrainActive).toBe(true);
    expect(z.draculaDrainT).toBe(DRACULA_DRAIN_DURATION);

    // Advance past one siphon tick (0.4s)
    const tickTime = DRACULA_DRAIN_TICK + 0.05;
    updateDraculaSiphon(z, p, tickTime);

    // Player lost HP, Dracula gained HP
    expect(p.hp).toBe(8 - DRACULA_DRAIN_DAMAGE);
    expect(z.hp).toBe(15 + DRACULA_DRAIN_HEAL);
  });

  it("breaks blood siphon when player exceeds the tether leash distance", () => {
    const z = makeMockZombie({ x: 10, z: 10, hp: 20 });
    const p = state.player!;
    p.x = 10;
    p.z = 11.0;

    // Start channel
    updateDraculaSiphon(z, p, 0.1);
    expect(z.draculaDrainActive).toBe(true);

    // Player flees far beyond tether distance (DRACULA_DRAIN_RANGE * 1.35 ~ 2.43)
    p.z = 13.5;
    updateDraculaSiphon(z, p, 0.1);

    expect(z.draculaDrainActive).toBe(false);
    expect(z.draculaDrainT).toBe(DRACULA_DRAIN_COOLDOWN);
  });

  it("interrupts siphon channel when Dracula is staggered by player attacks", () => {
    const z = makeMockZombie({ x: 10, z: 10 });
    const p = state.player!;
    p.x = 10;
    p.z = 11.0;

    updateDraculaSiphon(z, p, 0.1);
    expect(z.draculaDrainActive).toBe(true);

    // Dracula suffers stagger
    z.staggerT = 0.5;
    updateDraculaSiphon(z, p, 0.1);

    expect(z.draculaDrainActive).toBe(false);
    expect(z.draculaDrainT).toBe(DRACULA_DRAIN_COOLDOWN);
  });

  it("transforms Dracula into Dracula Bat final form on humanoid defeat", () => {
    let batTransformCalled = false;
    let spawnCoord = { x: 0, z: 0, speed: 0 };
    setDraculaTransformHandler((x, z, speed) => {
      batTransformCalled = true;
      spawnCoord = { x, z, speed };
      queueDraculaBat(x, z, speed);
    });

    const z = makeMockZombie({ x: 12.5, z: 14.2, speed: 2.0 });
    killZombie(z);

    expect(batTransformCalled).toBe(true);
    expect(spawnCoord.x).toBe(12.5);
    expect(spawnCoord.z).toBe(14.2);

    // Bat spawn is deferred to prevent getting clipped by the killing blow
    expect(state.zombies.length).toBe(0);

    // When sim drains deferred bats:
    // Create a mock bat sheet
    const mockClips = new Map<string, number[]>([
      ["S:idle", [0]],
      ["S:walk", [0]],
      ["S:attack", [0]],
      ["S:death", [0]],
    ]);
    const mockTex = () => ({
      repeat: { set() {} },
      offset: { set() {} },
      needsUpdate: false,
    });
    state.sheets.bat = {
      canvas: createCanvas(64, 64),
      cellPx: 32,
      cols: 2,
      rows: 2,
      clips: mockClips,
      frames: {},
      texture: {
        clone: mockTex,
        repeat: { set() {} },
        offset: { set() {} },
      },
    } as unknown as typeof state.sheets.bat;

    drainPendingDraculaBats();

    expect(state.zombies.length).toBe(1);
    const bat = state.zombies[0];
    expect(bat.kind).toBe("dracula_bat");
    expect(bat.hp).toBe(DRACULA_BAT_HP);
    expect(bat.baseTint).toBe(DRACULA_BAT_TINT);
    expect(bat.x).toBe(12.5);
    expect(bat.z).toBe(14.2);
  });

  it("generates valid procedural cel-painter clips for Dracula fallback", () => {
    const paints = makeDraculaPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    const south = paints.S!;
    expect(south.idle!.length).toBeGreaterThan(0);
    expect(south.walk!.length).toBeGreaterThan(0);
    expect(south.attack!.length).toBeGreaterThan(0);
    expect(south.death!.length).toBeGreaterThan(0);

    // Verify frames execute without throwing
    const canvas = createCanvas(128, 128);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    expect(() => south.idle![0](ctx)).not.toThrow();
    expect(() => south.attack![0](ctx)).not.toThrow();
    expect(() => south.death![0](ctx)).not.toThrow();
  });
});
