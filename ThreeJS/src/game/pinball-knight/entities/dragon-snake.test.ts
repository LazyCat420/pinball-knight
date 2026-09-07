import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import * as THREE from "three";
import {
  createDragonSnake,
  updateDragonSnakeKinematics,
  checkDragonSnakeCollisions,
  updateDragonSnakeAttacks,
  onDragonSnakeDeath,
  disposeDragonSnake,
  DRAGON_DEFAULT_SEGMENTS,
  DRAGON_SEGMENT_DIST,
  DRAGON_BOUNCE_SPEED,
  type DragonSnakeBoss,
} from "./dragon-snake";
import { state, type Zombie, type Player } from "../state";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { spawnBoss, disposeBoss, bossActive } from "../boss";
import { BOSSES } from "../boss-kinds";
import { sheetFor } from "../boot/sheets";
import { createActorSprite } from "../engine/render/sprite";
import type { Grid } from "../maze/generator";

describe("Dragon Snake Boss Entity & Modular Serpentine Kinematics", () => {
  let restoreDom: () => void;
  let mockHead: Zombie;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    disposeBoss();
    state.scene = new THREE.Scene();
    state.zombies = [];
    state.shakeT = 0;
    state.vfx = new Proxy({}, {
      get: () => () => {},
    }) as any;
    state.floorFx = [];

    state.grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
    const headSheet = sheetFor("dragon_snake_head") ?? sheetFor("dragon")!;
    const sprite = createActorSprite(headSheet, false);
    mockHead = {
      x: 10,
      z: 10,
      hp: 100,
      maxHp: 100,
      speed: 2.0,
      boss: true,
      kind: "brute",
      mode: "idle",
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      aggro: true,
      burnT: 0,
      bobT: 0,
      anim: { setFacing: () => {}, play: () => {}, setRate: () => {}, update: () => {} } as any,
      sprite,
    } as unknown as Zombie;
  });

  it("creates modular dragon snake with head, 12 body segments, and terminal tail", () => {
    const dragon = createDragonSnake(mockHead, DRAGON_DEFAULT_SEGMENTS, 2.35);

    expect(dragon.head).toBe(mockHead);
    expect(dragon.segments.length).toBe(DRAGON_DEFAULT_SEGMENTS);
    expect(dragon.tail).toBeDefined();

    // Verify initial layout trailing backward from head
    for (let i = 0; i < dragon.segments.length; i++) {
      const seg = dragon.segments[i];
      expect(seg.index).toBe(i);
      expect(seg.mesh).toBeDefined();
      expect(state.scene?.children.includes(seg.mesh)).toBe(true);
      expect(seg.radius).toBeGreaterThan(0.5);
      expect(seg.x).toBeCloseTo(mockHead.x - (i + 1) * DRAGON_SEGMENT_DIST, 2);
      expect(seg.z).toBeCloseTo(mockHead.z, 2);
    }

    // Verify tail
    expect(dragon.tail.mesh).toBeDefined();
    expect(state.scene?.children.includes(dragon.tail.mesh)).toBe(true);
    expect(dragon.tail.x).toBeCloseTo(mockHead.x - (DRAGON_DEFAULT_SEGMENTS + 1) * DRAGON_SEGMENT_DIST, 2);
  });

  it("relaxes segment positions along invariant distance constraint during slither movement", () => {
    const dragon = createDragonSnake(mockHead, 6, 2.35);

    // Move head forward +X
    mockHead.x = 12;
    mockHead.z = 10;
    updateDragonSnakeKinematics(dragon, 0.016);

    // Segment 0 must be exactly DRAGON_SEGMENT_DIST away from Head
    const d0 = Math.hypot(mockHead.x - dragon.segments[0].x, mockHead.z - dragon.segments[0].z);
    expect(d0).toBeCloseTo(DRAGON_SEGMENT_DIST, 3);

    // Successive segments maintain DRAGON_SEGMENT_DIST from preceding joint
    for (let i = 1; i < dragon.segments.length; i++) {
      const prev = dragon.segments[i - 1];
      const curr = dragon.segments[i];
      const d = Math.hypot(prev.x - curr.x, prev.z - curr.z);
      expect(d).toBeCloseTo(DRAGON_SEGMENT_DIST, 3);
    }

    // Tail maintains DRAGON_SEGMENT_DIST from last segment
    const lastSeg = dragon.segments[dragon.segments.length - 1];
    const tailDist = Math.hypot(lastSeg.x - dragon.tail.x, lastSeg.z - dragon.tail.z);
    expect(tailDist).toBeCloseTo(DRAGON_SEGMENT_DIST, 3);
  });

  it("maintains smooth serpentine curvature across a 90-degree turn", () => {
    const dragon = createDragonSnake(mockHead, 6, 2.35);

    // Move head in a 90-degree bend (+Z instead of +X)
    mockHead.x = 10;
    mockHead.z = 12;
    updateDragonSnakeKinematics(dragon, 0.016);

    // Invariant spacing holds across turns
    let leaderX = mockHead.x;
    let leaderZ = mockHead.z;
    for (const seg of dragon.segments) {
      const dist = Math.hypot(leaderX - seg.x, leaderZ - seg.z);
      expect(dist).toBeCloseTo(DRAGON_SEGMENT_DIST, 3);
      leaderX = seg.x;
      leaderZ = seg.z;
    }
  });

  it("handles pinball bumper collision: deflects player, triggers sparks and screen shake", () => {
    const dragon = createDragonSnake(mockHead, 4, 2.35);
    state.zombies.push(mockHead);

    const seg0 = dragon.segments[0];
    const player: Player = {
      x: seg0.x + 0.1,
      z: seg0.z,
      hp: 6,
      maxHp: 6,
      momX: -1,
      momZ: 0,
      momSpeed: 10,
      iframes: 0,
      bounceCombo: 0,
      facing: "W",
    } as unknown as Player;
    state.player = player;

    const initialHp = mockHead.hp;
    checkDragonSnakeCollisions(dragon, player, 0.016);

    // Normal points along +X (dx = player.x - seg0.x = 0.1 > 0)
    expect(player.momX).toBeGreaterThan(0);
    expect(player.momSpeed).toBeGreaterThanOrEqual(DRAGON_BOUNCE_SPEED);
    expect(player.bounceCombo).toBe(1);
    expect(player.iframes).toBeGreaterThanOrEqual(0.25);
    expect(mockHead.hp).toBeLessThan(initialHp);
    expect(seg0.flinchT).toBeGreaterThan(0);
    expect(state.shakeT).toBeGreaterThan(0);
  });

  it("triggers enraged phase and fire breath attacks", () => {
    const dragon = createDragonSnake(mockHead, 4, 2.35);
    state.zombies.push(mockHead);

    // Test fire breath windup
    dragon.breathCooldown = 0.01;
    updateDragonSnakeAttacks(dragon, 0.02, { x: 15, z: 10 });
    expect(dragon.breathActiveT).toBeGreaterThan(0);
    expect(dragon.breathDirX).toBeCloseTo(1, 2);

    // Drop HP to 50% to trigger enrage
    mockHead.hp = 50;
    const initialSpeed = mockHead.speed;
    updateDragonSnakeAttacks(dragon, 0.016, { x: 15, z: 10 });
    expect(dragon.isEnraged).toBe(true);
    expect(mockHead.speed).toBeGreaterThan(initialSpeed);
  });

  it("cascades death crumple across segments and disposes all meshes cleanly", () => {
    const dragon = createDragonSnake(mockHead, 4, 2.35);
    expect(state.scene?.children.length).toBeGreaterThanOrEqual(5);

    // Death sequence
    onDragonSnakeDeath(dragon, 0.1);
    expect(dragon.dead).toBe(true);
    expect(dragon.deathT).toBeCloseTo(0.1, 2);

    // Disposal
    disposeDragonSnake(dragon);
    expect(dragon.segments.length).toBe(0);
    for (const seg of dragon.segments) {
      expect(state.scene?.children.includes(seg.mesh)).toBe(false);
    }
    expect(state.scene?.children.includes(dragon.tail.mesh)).toBe(false);
  });

  it("integrates seamlessly into spawnBoss when boss spec is dragon", () => {
    const grid: Grid = { w: 7, h: 7, t: new Uint8Array(49), shapes: new Uint8Array(49) };
    spawnBoss(grid, { i: 3, j: 3 }, 220, BOSSES.dragon, (x, z, hp) => {
      mockHead.x = x;
      mockHead.z = z;
      mockHead.hp = hp;
      state.zombies.push(mockHead);
      return mockHead;
    });

    expect(bossActive()).toBe(true);
    // 12 body segments + 1 tail = 13 meshes added to scene
    expect(state.scene?.children.length).toBeGreaterThanOrEqual(13);

    disposeBoss();
    expect(bossActive()).toBe(false);
  });
});
