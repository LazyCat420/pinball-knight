/**
 * Unit & Integration Test Suite for Modular Three.js Monster Projectile VFX.
 *
 * Validates:
 * - Projectile archetype registry and configurations
 * - Factory mesh generation (compound 3D meshes for bullets, flames, globs, beams, blades, bombs)
 * - Muzzle flash, burst, and trail VFX triggering
 * - In-flight dynamics (heading alignment, tumble/spin, glow pulsing, fuse burning)
 * - Impact VFX (wall ricochet sparks, entity collision bursts, floor decals)
 * - Monster projectile spawners integration
 * - Resource cleanup and GPU cache disposal
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { state } from "../../state";
import { T_FLOOR, T_WALL } from "../../engine/grid";
import {
  getProjectileVfxConfig,
  buildProjectileBundle,
  createProjectileMesh,
  triggerMuzzleVfx,
  triggerImpactVfx,
  updateProjectileVfx,
  disposeProjectileFactoryCache,
  PROJECTILE_VFX_CONFIGS,
} from "./index";
import {
  fireCopBullet,
  spitGlob,
  spitWeb,
  flingPlate,
  hurlTimber,
  slingBomb,
  dropCorvidBomb,
  dropVultureBomb,
  dropFalconFireBomb,
  fireEyeBeams,
  flingBurgerDeconstruction,
  launchFryBarrage,
  launchMilkshakeSpray,
  launchMustardStream,
  launchKetchupSquirts,
  launchShuriken,
  launchZippoFlameBreath,
  spitPearl,
  shootOctoBullet,
  shootFishBullet,
  shootLionSpine,
  shootMagnumBullet,
  shootPufferSlug,
  burstPufferSpikes,
  burstIceShards,
  fireAuto9Burst,
  shootSpearBolt,
  shootElectricBullet,
  launchWaterMortar,
  launchOrnament,
  spawnShardBurst,
  golemShards,
  updateProjectiles,
  disposeProjectileAssets,
  clearProjectiles,
} from "../../entities/projectiles";

describe("Monster Projectile VFX System", () => {
  beforeEach(() => {
    state.projectiles = [];
    state.zombies = [];
    state.floorFx = [];
    state.shakeT = 0;
    state.scene = new THREE.Scene();
    state.vfx = {
      burst: () => {},
      sparks: () => {},
      smoke: () => {},
      blood: () => {},
      ember: () => {},
      dust: () => {},
      damage: () => {},
      ring: () => {},
      laserMark: () => {},
    } as any;
  });

  describe("VFX Registry & Archetype Configuration", () => {
    it("provides valid configurations for all registered monster projectile types", () => {
      const kinds = Object.keys(PROJECTILE_VFX_CONFIGS);
      expect(kinds.length).toBeGreaterThanOrEqual(25);

      for (const kind of kinds) {
        const config = getProjectileVfxConfig(kind);
        expect(config.kind).toBeDefined();
        expect(["bullet", "flame", "glob", "beam", "blade", "bomb", "condiment", "dumbbell"]).toContain(config.archetype);
        expect(config.colors.core).toBeGreaterThan(0);
        expect(config.dimensions.radius).toBeGreaterThan(0);
        expect(config.flight).toBeDefined();
        expect(config.impact).toBeDefined();
      }
    });

    it("falls back gracefully to default bullet config for unknown projectile kinds", () => {
      const fallback = getProjectileVfxConfig("unknown_alien_laser");
      expect(fallback.archetype).toBe("bullet");
      expect(fallback.colors.core).toBe(0xffffff);
    });
  });

  describe("Mesh Factory & Compound Bundles", () => {
    it("builds multi-layered bullet bundle with core and glow meshes", () => {
      const config = getProjectileVfxConfig("cop_bullet");
      const bundle = buildProjectileBundle(config);

      expect(bundle.root).toBeInstanceOf(THREE.Group);
      expect(bundle.coreMesh).toBeDefined();
      expect(bundle.glowMesh).toBeDefined();
      expect(bundle.root.children.length).toBeGreaterThanOrEqual(2);
    });

    it("builds flame teardrop bundle with glow mantle and incandescent core", () => {
      const config = getProjectileVfxConfig("zippo_flame");
      const bundle = buildProjectileBundle(config);

      expect(bundle.root).toBeInstanceOf(THREE.Group);
      expect(bundle.coreMesh).toBeDefined();
      expect(bundle.glowMesh).toBeDefined();
    });

    it("builds viscous glob bundle with specular highlight dot", () => {
      const config = getProjectileVfxConfig("glob");
      const bundle = buildProjectileBundle(config);

      expect(bundle.root).toBeInstanceOf(THREE.Group);
      expect(bundle.coreMesh).toBeDefined();
      expect(bundle.accentMesh).toBeDefined(); // specular sheen dot
    });

    it("builds iron bomb bundle with fuse spark neck", () => {
      const config = getProjectileVfxConfig("bomb");
      const bundle = buildProjectileBundle(config);

      expect(bundle.root).toBeInstanceOf(THREE.Group);
      expect(bundle.coreMesh).toBeDefined();
      expect(bundle.accentMesh).toBeDefined(); // collar
      expect(bundle.glowMesh).toBeDefined(); // fuse spark
    });

    it("builds 4-pointed shuriken ninja star bundle", () => {
      const config = getProjectileVfxConfig("shuriken");
      const bundle = buildProjectileBundle(config);

      expect(bundle.root).toBeInstanceOf(THREE.Group);
      expect(bundle.coreMesh).toBeDefined();
      expect(bundle.accentMesh).toBeDefined();
    });

    it("builds dumbbell bundle with chrome handle bar and dual hexagonal plates", () => {
      const config = getProjectileVfxConfig("dumbbell");
      const bundle = buildProjectileBundle(config);

      expect(bundle.root).toBeInstanceOf(THREE.Group);
      expect(bundle.coreMesh).toBeDefined();
      expect(bundle.glowMesh).toBeDefined();
      expect(bundle.root.children.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Muzzle & Impact VFX Handlers", () => {
    it("triggers muzzle flash without error when state.vfx is active or absent", () => {
      let burstCount = 0;
      let sparksCount = 0;
      state.vfx = {
        burst: () => { burstCount++; },
        sparks: () => { sparksCount++; },
        smoke: () => {},
      } as any;

      triggerMuzzleVfx(0, 0, 1, 0, "cop_bullet");
      expect(burstCount).toBe(1);
      expect(sparksCount).toBe(1);

      // Safe without state.vfx
      state.vfx = null;
      expect(() => triggerMuzzleVfx(0, 0, 1, 0, "cop_bullet")).not.toThrow();
    });

    it("triggers wall impact VFX and applies camera screen shake", () => {
      let burstCalled = false;
      state.vfx = {
        sparks: () => {},
        burst: () => { burstCalled = true; },
        smoke: () => {},
      } as any;

      const dummyPr = { kind: "bomb", vx: 5, vz: 0 } as any;
      triggerImpactVfx(2, 3, dummyPr, "wall");

      expect(burstCalled).toBe(true);
      expect(state.shakeT).toBeGreaterThan(0);
    });
  });

  describe("In-Flight Dynamics (updateProjectileVfx)", () => {
    it("orients directional projectiles along heading trajectory", () => {
      const mesh = createProjectileMesh("cop_bullet");
      const pr = {
        kind: "cop_bullet",
        x: 0,
        z: 0,
        vx: 10,
        vz: 0,
        life: 2.0,
        maxLife: 2.0,
        mesh,
      } as any;

      updateProjectileVfx(pr, 0.016);
      expect(pr.mesh.rotation.y).toBeCloseTo(Math.PI / 2, 2);
    });

    it("applies axis spin / tumble to spinning projectiles (e.g. timber, shuriken)", () => {
      const mesh = createProjectileMesh("shuriken");
      const pr = {
        kind: "shuriken",
        x: 0,
        z: 0,
        vx: 5,
        vz: 5,
        life: 1.0,
        maxLife: 1.0,
        mesh,
      } as any;

      const initialRotY = pr.mesh.rotation.y;
      updateProjectileVfx(pr, 0.05);
      expect(pr.mesh.rotation.y).not.toBe(initialRotY);
    });

    it("pulses bomb scale as fuse burns down", () => {
      const mesh = createProjectileMesh("bomb");
      const pr = {
        kind: "bomb",
        x: 0,
        z: 0,
        vx: 2,
        vz: 0,
        life: 0.2, // late fuse
        maxLife: 2.0,
        mesh,
      } as any;

      updateProjectileVfx(pr, 0.016);
      expect(pr.mesh.scale.x).toBeGreaterThan(1.0); // pulsed up in urgency
    });
  });

  describe("Monster Projectile Spawner Integration", () => {
    it("spawns Warden cop bullet with compound mesh and ricochet bounces", () => {
      fireCopBullet(1, 2, 0, 1);
      expect(state.projectiles.length).toBe(1);
      const pr = state.projectiles[0];
      expect(pr.kind).toBe("bullet");
      expect(pr.hostile).toBe(true);
      expect(pr.mesh.children.length).toBeGreaterThanOrEqual(2);
    });

    it("spawns Spitter acid glob with compound glob mesh", () => {
      spitGlob(0, 0, 1, 0);
      expect(state.projectiles.length).toBe(1);
      const pr = state.projectiles[0];
      expect(pr.kind).toBe("glob");
      expect(pr.hostile).toBe(true);
      expect(pr.mesh).toBeDefined();
    });

    it("spawns Jester plate disc and Rotortail timber", () => {
      flingPlate(0, 0, 0, 1);
      hurlTimber(0, 0, 1, 0);
      expect(state.projectiles.length).toBe(2);
      expect(state.projectiles[0].kind).toBe("disc");
      expect(state.projectiles[1].kind).toBe("timber");
    });

    it("spawns Zippo flame breath fan of 5 fire projectiles", () => {
      launchZippoFlameBreath(0, 0, 0, 1);
      expect(state.projectiles.length).toBe(5);
      for (const pr of state.projectiles) {
        expect(pr.kind).toBe("zippo_flame");
        expect(pr.mesh).toBeDefined();
      }
    });

    it("spawns Sumo Ninja shurikens, Clam pearl, and Shark Trapper hook", () => {
      launchShuriken(0, 0, 1, 0);
      expect(state.projectiles.length).toBe(2); // 2 stars

      spitPearl(0, 0, 0, 1);
      expect(state.projectiles.length).toBe(3);

      expect(state.projectiles[2].kind).toBe("pearl");
      expect(state.projectiles[2].bounces).toBeDefined();
    });

    it("spawns Fast Food projectile barrage (burger deconstruction, fry darts, shakes, condiments)", () => {
      flingBurgerDeconstruction(0, 0, 1, 0);
      expect(state.projectiles.length).toBe(3); // tomato, lettuce, sauce

      launchFryBarrage(0, 0, 1, 0);
      expect(state.projectiles.length).toBe(6); // + 3 fries

      launchMilkshakeSpray(0, 0, 1, 0);
      expect(state.projectiles.length).toBe(10); // + 4 toxic puffs
    });

    it("spawns Aquatic mobster arsenal (Octo 8-way, Fish bullet, Lion spine, Puffer slug)", () => {
      shootOctoBullet(0, 0, 1, 0);
      shootFishBullet(0, 0, 0, 1);
      shootLionSpine(0, 0, 1, 0);
      shootPufferSlug(0, 0, 0, 1);
      burstPufferSpikes(0, 0); // 8 spikes

      expect(state.projectiles.length).toBe(12);
    });

    it("spawns Frost Slime ice shard death shatter", () => {
      burstIceShards(0, 0);
      expect(state.projectiles.length).toBeGreaterThanOrEqual(6);
      expect(state.projectiles[0].kind).toBe("ice_shard");
      expect(state.projectiles[0].bounces).toBe(2);
    });
  });

  describe("updateProjectiles Simulation & Ricochet Impact Handling", () => {
    it("reflects velocity and plays wall impact VFX when bouncing bullet strikes a wall", () => {
      const w = 10, h = 10;
      const tiles = new Uint8Array(w * h).fill(T_FLOOR);
      tiles[0 * w + 5] = T_WALL; // North wall at tile (5, 0)
      state.grid = { w, h, t: tiles, shapes: new Uint8Array(w * h) } as any;

      fireCopBullet(0, -3.5, 0, -1);
      const pr = state.projectiles[0];
      expect(pr.vz).toBeLessThan(0);

      updateProjectiles(0.12); // move into wall
      expect(pr.bounced).toBe(true);
      expect(pr.vz).toBeGreaterThan(0); // reflected
    });
  });

  describe("Lifecycle Cleanup", () => {
    it("disposes factory cache and projectile assets cleanly without leaks", () => {
      createProjectileMesh("bullet");
      createProjectileMesh("flame");
      createProjectileMesh("glob");
      createProjectileMesh("bomb");

      expect(() => {
        disposeProjectileAssets();
        disposeProjectileFactoryCache();
      }).not.toThrow();
    });
  });
});
