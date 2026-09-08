import { describe, it, expect, beforeEach } from "vitest";
import {
  SPINNING_TOP_HP,
  SPINNING_TOP_R,
  SPINNING_TOP_CRUISE_SPEED,
  SPINNING_TOP_SLAM_SPEED,
  SPINNING_TOP_CHARGE_RANGE,
  SPINNING_TOP_WINDUP,
  SPINNING_TOP_SLAM_DURATION,
  SPINNING_TOP_WOBBLE_DURATION,
  SPINNING_TOP_SLAM_DAMAGE,
  SPINNING_TOP_SLAM_DEFLECT,
  SPINNING_TOP_COOLDOWN,
} from "../constants/enemies";
import {
  canSpinningTopCharge,
  initSpinningTop,
  startSpinningTopWindup,
  startSpinningTopSlam,
  startSpinningTopWobble,
  updateSpinningTop,
} from "./spinning-top";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { DMG_BY_KIND } from "./combat";
import { PAIN_BY_KIND } from "./stagger";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { STATS } from "./zombie";
import { SPAWNABLE } from "../debug-panel";
import { makeSpinningTopPaints } from "../render/monsters/spinning-top";
import type { Zombie, Player } from "../state";
import { state } from "../state";

describe("Spinning Top Monster — Tables & Registrations", () => {
  it("has correct stats and constants defined", () => {
    expect(SPINNING_TOP_HP).toBe(16);
    expect(SPINNING_TOP_R).toBe(0.42);
    expect(SPINNING_TOP_CRUISE_SPEED).toBe(0.9);
    expect(SPINNING_TOP_SLAM_SPEED).toBe(2.4);
    expect(SPINNING_TOP_CHARGE_RANGE).toBe(4.8);
    expect(SPINNING_TOP_WINDUP).toBe(0.6);
    expect(SPINNING_TOP_SLAM_DURATION).toBe(1.1);
    expect(SPINNING_TOP_WOBBLE_DURATION).toBe(1.8);
    expect(SPINNING_TOP_SLAM_DAMAGE).toBe(2);
    expect(SPINNING_TOP_SLAM_DEFLECT).toBe(6.5);
    expect(SPINNING_TOP_COOLDOWN).toBe(3.5);
  });

  it("is registered in bestiary with icon and label", () => {
    const info = KIND_INFO.spinning_top;
    expect(info).toBeDefined();
    expect(info.label).toBe("Whirligig Top");
    expect(info.icon).toBe("🪀");
  });

  it("is registered in reagent drops", () => {
    const drops = ENEMY_DROPS.spinning_top;
    expect(drops).toBeDefined();
    expect(drops.some((d) => d.id === "steelpin")).toBe(true);
    expect(drops.some((d) => d.id === "ironshard")).toBe(true);
    expect(drops.some((d) => d.id === "lodestone")).toBe(true);
  });

  it("is registered in KIND_SKIN and STATS", () => {
    expect(KIND_SKIN.spinning_top).toBeDefined();
    expect(KIND_SKIN.spinning_top?.scale).toBe(1.1);

    const stats = STATS.spinning_top;
    expect(stats).toBeDefined();
    expect(stats.bodyR).toBe(0.42);
    expect(stats.contactRange).toBe(4.8);
    expect(stats.windup).toBe(0.6);
    expect(stats.cooldown).toBe(3.5);
    expect(stats.ranged).toBe(false);
  });

  it("is registered in combat DMG_BY_KIND and stagger PAIN_BY_KIND", () => {
    expect(DMG_BY_KIND.spinning_top).toBe(2);
    expect(PAIN_BY_KIND.spinning_top).toBe(0.25);
    expect(MOVEMENT_BY_KIND.spinning_top).toBe("chase");
  });

  it("is spawnable from debug panel with formatted label within chip width", () => {
    const entry = SPAWNABLE.find((e) => e.kind === "spinning_top");
    expect(entry).toBeDefined();
    expect(entry?.label).toContain("SpinTop");
  });
});

describe("Spinning Top — State Machine & Slam Mechanics", () => {
  let mockZombie: Zombie;
  let mockPlayer: Player;

  beforeEach(() => {
    mockZombie = {
      kind: "spinning_top",
      x: 0,
      z: 0,
      anim: {
        setFacing: () => {},
        play: () => {},
      } as any,
      hp: 16,
      bodyR: 0.42,
      speed: 0.9,
    } as unknown as Zombie;

    mockPlayer = {
      x: 3,
      z: 0,
      hp: 10,
      momX: 0,
      momZ: 0,
      momSpeed: 0,
      bounceCombo: 0,
      bounceComboT: 0,
      iframes: 0,
      sprite: {
        setTint: () => {},
        mesh: {
          position: { set: () => {} },
        },
      } as any,
    } as unknown as Player;

    state.player = mockPlayer;
    const tiles = new Uint8Array(400).fill(1);
    state.grid = { w: 20, h: 20, t: tiles, shapes: new Uint8Array(400), arcs: [] } as any;
    state.gear = {} as any;
    state.levelHitsTaken = 0;
  });

  it("initializes spinning top state to cruise", () => {
    initSpinningTop(mockZombie);
    expect(mockZombie.topState).toBe("cruise");
    expect(mockZombie.topTimer).toBe(0);
    expect(mockZombie.topDashDirX).toBe(0);
    expect(mockZombie.topDashDirZ).toBe(0);
    expect(mockZombie.topRicochets).toBe(0);
  });

  it("evaluates canSpinningTopCharge based on distance and cooldown", () => {
    initSpinningTop(mockZombie);

    // Player within range (3.0 <= 4.8) and timer is 0
    expect(canSpinningTopCharge(mockZombie, mockPlayer)).toBe(true);

    // Player outside charge range
    mockPlayer.x = 10;
    expect(canSpinningTopCharge(mockZombie, mockPlayer)).toBe(false);

    // Player inside range but topTimer > 0 (cooling down)
    mockPlayer.x = 3;
    mockZombie.topTimer = 1.5;
    expect(canSpinningTopCharge(mockZombie, mockPlayer)).toBe(false);
  });

  it("starts windup and locks trajectory towards player", () => {
    initSpinningTop(mockZombie);
    // Player at (3, 0, 4) -> distance = 5
    mockPlayer.x = 3;
    mockPlayer.z = 4;

    startSpinningTopWindup(mockZombie, mockPlayer);
    expect(mockZombie.topState).toBe("windup");
    expect(mockZombie.topTimer).toBe(SPINNING_TOP_WINDUP);
    // Normalized direction should be (3/5, 4/5) = (0.6, 0.8)
    expect(mockZombie.topDashDirX).toBeCloseTo(0.6, 3);
    expect(mockZombie.topDashDirZ).toBeCloseTo(0.8, 3);
  });

  it("executes slam transition from windup expiration", () => {
    initSpinningTop(mockZombie);
    mockPlayer.x = 2;
    mockPlayer.z = 0;
    startSpinningTopWindup(mockZombie, mockPlayer);

    // Simulate windup duration ending
    updateSpinningTop(mockZombie, mockPlayer, 0.65);
    expect(mockZombie.topState).toBe("slam");
    expect(mockZombie.topTimer).toBe(SPINNING_TOP_SLAM_DURATION);
  });

  it("deals damage and applies pinball bumper deflection on player collision during slam", () => {
    initSpinningTop(mockZombie);
    mockZombie.x = 0;
    mockZombie.z = 0;
    mockPlayer.x = 0.3; // within collision radius
    mockPlayer.z = 0;

    startSpinningTopSlam(mockZombie, 1, 0);
    expect(mockZombie.topState).toBe("slam");

    const initialPlayerHp = mockPlayer.hp;
    updateSpinningTop(mockZombie, mockPlayer, 0.05);

    // Player takes slam damage (hitPlayer reduces player hp by DMG_BY_KIND.spinning_top = 2)
    expect(mockPlayer.hp).toBe(initialPlayerHp - SPINNING_TOP_SLAM_DAMAGE);
    // Player receives strong pinball impulse away from top
    expect(mockPlayer.momSpeed).toBeGreaterThanOrEqual(SPINNING_TOP_SLAM_DEFLECT);

    // Top enters dizzy wobble after slamming into player
    expect(mockZombie.topState).toBe("wobble");
    expect(mockZombie.topTimer).toBe(SPINNING_TOP_WOBBLE_DURATION);
  });

  it("handles slam wall ricochets when hitting arena boundaries", () => {
    initSpinningTop(mockZombie);
    mockZombie.x = 12.0; // wall boundary
    mockZombie.z = 0;
    mockZombie.topDashDirX = 0.8;
    mockZombie.topDashDirZ = 0.6;
    mockZombie.topState = "slam";
    mockZombie.topTimer = 1.0;
    mockZombie.topRicochets = 0;

    // Custom wall bounce simulation function that returns fixed collision
    const moveFn = (_g: any, cx: number, cz: number, _r: number, _dx: number, _dz: number) => {
      // Simulate wall along X axis blocking positive X
      return { x: cx, z: cz + 0.05 };
    };

    updateSpinningTop(mockZombie, mockPlayer, 0.05, moveFn);

    // Dash vector X should reflect
    expect(mockZombie.topDashDirX).toBeLessThan(0);
    expect(mockZombie.topRicochets).toBe(1);
  });

  it("recovers from wobble to cruise with cooldown after wobble duration expires", () => {
    initSpinningTop(mockZombie);
    startSpinningTopWobble(mockZombie);
    expect(mockZombie.topState).toBe("wobble");

    // Advance past wobble duration
    updateSpinningTop(mockZombie, mockPlayer, SPINNING_TOP_WOBBLE_DURATION + 0.1);
    expect(mockZombie.topState).toBe("cruise");
    expect(mockZombie.topTimer).toBe(SPINNING_TOP_COOLDOWN);
  });
});

describe("Spinning Top — Procedural Cel-Painter", () => {
  it("creates valid ActorPaints structure with S, N, E facings", () => {
    const paints = makeSpinningTopPaints();
    expect(paints).toBeDefined();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    const s = paints.S!;
    expect(s.idle!.length).toBe(4);
    expect(s.walk!.length).toBe(4);
    expect(s.attack!.length).toBe(4);
    expect(s.death!.length).toBe(4);
  });

  it("renders frame paints to mock canvas context without throwing", () => {
    const paints = makeSpinningTopPaints();
    const mockCtx = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      beginPath: () => {},
      ellipse: () => {},
      fill: () => {},
      stroke: () => {},
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "round",
    } as unknown as CanvasRenderingContext2D;

    const s = paints.S!;
    // Test each animation type
    expect(() => s.idle![0](mockCtx)).not.toThrow();
    expect(() => s.walk![0](mockCtx)).not.toThrow();
    expect(() => s.attack![0](mockCtx)).not.toThrow();
    expect(() => s.death![0](mockCtx)).not.toThrow();
    expect(() => s.death![3](mockCtx)).not.toThrow();
  });
});
