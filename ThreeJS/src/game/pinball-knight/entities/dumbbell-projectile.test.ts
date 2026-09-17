import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { state } from "../state";
import { createProjectileMesh } from "./projectiles";
import { getProjectileVfxConfig } from "../fx/projectiles/registry";
import { buildProjectileBundle } from "../fx/projectiles/factory";
import { hurlDumbbell, updateProjectiles } from "./projectiles";
import { BRUTE_DUMBBELL_DAMAGE, BRUTE_DUMBBELL_BOUNCES, BRUTE_DUMBBELL_DEFLECT } from "../constants";

describe("Dumbbell Projectile Mechanics & Physics", () => {
  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.projectiles = [];
    state.zombies = [];
    state.grid = {
      w: 10,
      h: 10,
      t: new Uint8Array(100).fill(1), // all floor
      shapes: new Uint8Array(100).fill(0),
    };
    state.player = {
      x: 5,
      z: 5,
      hp: 10,
      maxHp: 10,
      momX: 0,
      momZ: 0,
      momSpeed: 0,
      iframes: 0,
      sprite: {
        mesh: new THREE.Object3D(),
        setTint: () => {},
      },
    } as any;
    state.shakeT = 0;
  });

  afterEach(() => {
    state.scene = null;
    state.projectiles = [];
    state.grid = null;
    state.player = null;
  });

  it("builds the dumbbell mesh bundle with two hexagonal plates and chrome handle bar", () => {
    const config = getProjectileVfxConfig("dumbbell");
    expect(config).toBeDefined();
    expect(config.archetype).toBe("dumbbell");

    const bundle = buildProjectileBundle(config);
    expect(bundle.root).toBeInstanceOf(THREE.Group);
    // Group contains bar and 2 plates
    expect(bundle.root.children.length).toBeGreaterThanOrEqual(3);

    const mesh = createProjectileMesh("dumbbell");
    expect(mesh).toBeDefined();
  });

  it("spawns a thrown dumbbell with heavy stats, tumbling rotation, and wall ricochet capability", () => {
    hurlDumbbell(2, 2, 1, 0);

    expect(state.projectiles.length).toBe(1);
    const pr = state.projectiles[0];
    expect(pr.kind).toBe("dumbbell");
    expect(pr.damage).toBe(BRUTE_DUMBBELL_DAMAGE);
    expect(pr.bounces).toBe(BRUTE_DUMBBELL_BOUNCES);
    expect(pr.hostile).toBe(true);
    expect(pr.vx).toBeGreaterThan(0);
    expect(pr.vz).toBe(0);

    // Step physics: tumbling rotation increases along rotation.x
    const rotX0 = pr.mesh.rotation.x;
    updateProjectiles(0.05);
    expect(pr.mesh.rotation.x).toBeGreaterThan(rotX0);
  });

  it("rebounds off a masonry wall, decrements bounces counter, and triggers collision effects", () => {
    // Grid is 10x10 with world coordinates x in [-5, 5], z in [-5, 5]
    // Tile (i=6, j=5) is at x in [1, 2), z in [0, 1)
    state.grid!.t[5 * 10 + 6] = 0; // tile (6, 5) is wall

    // Spawn dumbbell at x=0.0, z=0.5 travelling toward wall (+X)
    hurlDumbbell(0.0, 0.5, 1, 0);
    const pr = state.projectiles[0];
    const initialVx = pr.vx;

    // Run updates until it reaches and hits the wall
    for (let step = 0; step < 10; step++) {
      updateProjectiles(0.05);
      if (pr.bounced) break;
    }

    // Wall hit should invert vx and decrement bounces
    expect(pr.bounced).toBe(true);
    expect(pr.vx).toBeLessThan(0);
    expect(pr.vx).toBeCloseTo(-initialVx, 1);
    expect(pr.bounces).toBe(BRUTE_DUMBBELL_BOUNCES - 1);
  });

  it("damages the player on contact, delivers backward pinball deflection impulse, and shakes the screen", () => {
    state.player!.x = 3.0;
    state.player!.z = 2.0;

    // Spawn dumbbell near player moving toward them (+X)
    hurlDumbbell(2.1, 2.0, 1, 0);

    for (let step = 0; step < 10; step++) {
      updateProjectiles(0.05);
      if (state.player!.hp < 10) break;
    }

    // Player should have taken damage
    expect(state.player!.hp).toBe(10 - BRUTE_DUMBBELL_DAMAGE);
    // Player should be hurled backward along dumbbell trajectory (+X)
    expect(state.player!.momX).toBeGreaterThan(0);
    expect(state.player!.momSpeed).toBeGreaterThanOrEqual(BRUTE_DUMBBELL_DEFLECT);
    // Screen shake should have triggered
    expect(state.shakeT).toBeGreaterThan(0.2);
  });
});
