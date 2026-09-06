/**
 * Tests for the WARDEN Cop Guard rebuild:
 * - Ranged profile and custom Wolfenstein cop cel-painter & portrait
 * - Service pistol bullet with intentional aim offset ("he always misses" directly)
 * - Wall ricochet mechanics (velocity reflection, spark/sfx cues, bounce counter)
 * - Post-bounce damage to the player and collateral damage to other monsters
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { state, type Zombie } from "../state";
import { STATS } from "./zombie";
import { fireCopBullet, updateProjectiles, clearProjectiles } from "./projectiles";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeWardenPaints } from "../render/monsters/warden";
import {
  WARDEN_FIRE_RANGE,
  WARDEN_ATTACK_COOLDOWN,
  WARDEN_BULLET_SPEED,
  WARDEN_BULLET_DAMAGE,
  WARDEN_BULLET_BOUNCES,
} from "../constants";
import { T_FLOOR, T_WALL } from "../engine/grid";

describe("warden cop rebuild", () => {
  beforeEach(() => {
    state.projectiles = [];
    state.zombies = [];
    state.scene = new THREE.Scene();
    state.vfx = {
      burst: () => {},
      sparks: () => {},
      smoke: () => {},
      blood: () => {},
      ember: () => {},
      dust: () => {},
      damage: () => {},
    } as any;
  });

  it("is registered as a ranged combatant with dedicated cop cel-painter", () => {
    // 1. Ranged combat profile
    expect(STATS.warden.ranged).toBe(true);
    expect(STATS.warden.contactRange).toBe(WARDEN_FIRE_RANGE);
    expect(STATS.warden.cooldown).toBe(WARDEN_ATTACK_COOLDOWN);

    // 2. Dedicated procedural cel-painter
    expect(SHEET_PAINTERS.warden).toBe(makeWardenPaints);
    expect(KIND_PAINTS.warden).toBe(makeWardenPaints);
  });

  it("fires high-velocity cop bullet that ricochets off walls", () => {
    // Mock grid: 10x10 room filled with walkable floor (T_FLOOR)
    const w = 10, h = 10;
    const tiles = new Uint8Array(w * h).fill(T_FLOOR);
    // Set tile (5, 0) to wall (T_WALL)
    tiles[0 * w + 5] = T_WALL;

    state.grid = {
      w,
      h,
      t: tiles,
      shapes: new Uint8Array(w * h),
    } as any;

    // Fire cop bullet from (0, -3.5) moving toward north wall at (5, 0) (heading: dx=0, dz=-1)
    fireCopBullet(0, -3.5, 0, -1);

    expect(state.projectiles.length).toBe(1);
    const pr = state.projectiles[0];
    expect(pr.kind).toBe("bullet");
    expect(pr.hostile).toBe(true);
    expect(pr.damage).toBe(WARDEN_BULLET_DAMAGE);
    expect(pr.bounces).toBe(WARDEN_BULLET_BOUNCES);
    expect(pr.bounced).toBe(false);
    expect(pr.vz).toBe(-WARDEN_BULLET_SPEED);

    // Distance to wall tile (z=-4.5) is ~1.0 unit. At speed 9.5, dt=0.11 moves ~1.04 units into wall.
    updateProjectiles(0.11);

    // Must have bounced off the wall!
    expect(pr.bounced, "bullet must mark bounced = true on wall impact").toBe(true);
    expect(pr.bounces).toBe(WARDEN_BULLET_BOUNCES - 1);
    expect(pr.vz, "z velocity must reflect positive away from wall").toBeGreaterThan(0);
  });

  it("direct unbounced shot does not hurt player, but ricochet rebound hits player", () => {
    // Mock grid where room is walkable, wall at tile (5, 0)
    const w = 10, h = 10;
    const tiles = new Uint8Array(w * h).fill(T_FLOOR);
    tiles[0 * w + 5] = T_WALL;

    state.grid = {
      w,
      h,
      t: tiles,
      shapes: new Uint8Array(w * h),
    } as any;

    // Player standing at center (0, 0)
    state.player = {
      x: 0,
      z: 0,
      hp: 10,
      iframes: 0,
      shieldT: 0,
      sprite: {
        setTint: () => {},
        mesh: { position: { set: () => {} } },
      },
    } as any;

    // 1. Unbounced shot passing right through player's spot
    fireCopBullet(0, 0, 0, -1);
    const pr = state.projectiles[0];
    expect(pr.bounced).toBe(false);

    // Initial check: direct unbounced shot must NOT damage player
    updateProjectiles(0.01);
    expect(state.player).toBeDefined();
    expect(state.player!.hp, "direct shot must not damage player before bouncing").toBe(10);
    expect(state.projectiles.length, "unbounced shot must not be consumed by player").toBe(1);

    // Now artificially simulate wall bounce
    pr.bounced = true;
    pr.x = 0;
    pr.z = 0;

    // Bounced shot colliding with player
    updateProjectiles(0.01);
    expect(state.player!.hp, "bounced bullet must damage player").toBeLessThan(10);
    expect(state.projectiles.length, "bounced bullet must be consumed on hit").toBe(0);
  });

  it("ricochet bullet damages other monsters upon contact", () => {
    state.grid = {
      w: 10,
      h: 10,
      t: new Uint8Array(100).fill(T_FLOOR),
      shapes: new Uint8Array(100),
    } as any;

    const dummyEnemy: Zombie = {
      x: 4.0,
      z: 4.0,
      hp: 10,
      bodyR: 0.4,
      burnT: 0,
      mode: "chase",
      kind: "goblin",
      sprite: {
        mesh: { position: { set: () => {} } },
        setTint: () => {},
      },
      anim: { play: () => {} },
    } as any;

    state.zombies = [dummyEnemy];

    fireCopBullet(4.0, 4.0, 1, 0);
    const pr = state.projectiles[0];
    // Mark as bounced
    pr.bounced = true;

    updateProjectiles(0.01);

    expect(dummyEnemy.hp, "bounced bullet must damage monster on collision").toBeLessThan(10);
    expect(state.projectiles.length, "bullet consumed upon enemy hit").toBe(0);
  });
});
