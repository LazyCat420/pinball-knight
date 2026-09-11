import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { state, resetState, type Player } from "../state";
import { STATS } from "./zombie";
import { HP_BY_KIND, spawnKind } from "../spawn/factory";
import { KIND_SKIN } from "../spawn/kind-skin";
import { DMG_BY_KIND, killZombie } from "./combat";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { ENEMY_DROPS } from "../reagents";
import { KIND_INFO } from "../bestiary";
import { KIND_STYLE } from "../render/card-styles";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeBlasterFrankPaints } from "../render/monsters/blaster-frank";
import { launchSkyVolley, fireWildBullet, updateProjectiles, clearProjectiles } from "./projectiles";
import { installSpriteTestDom } from "../testkit/atlas-census";

describe("Blaster Frank (Danny DeVito Monster) - Registration, Mechanics & Combat", () => {
  let restoreDom: () => void;

  beforeEach(() => {
    restoreDom = installSpriteTestDom();
    resetState();
    state.scene = new THREE.Scene();
    state.player = {
      x: 10,
      z: 10,
      hp: 10,
      maxHp: 10,
      momSpeed: 0,
      momX: 0,
      momZ: 0,
      cooldown: 0,
      iframes: 0,
      oilT: 0,
      webbedT: 0,
      sprite: { setTint: () => {}, mesh: new THREE.Mesh() },
    } as unknown as Player;
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(1),
      shapes: new Uint8Array(400),
      arcs: [],
    } as any;
  });

  afterEach(() => {
    clearProjectiles();
    state.scene = null;
    state.zombies = [];
    state.player = null;
    state.grid = null;
    restoreDom?.();
  });

  it("is registered in STATS with accurate combat tuning", () => {
    const s = STATS.blaster_frank;
    expect(s).toBeDefined();
    expect(s.bodyR).toBe(0.42);
    expect(s.contactRange).toBe(6.0);
    expect(s.windup).toBe(0.50);
    expect(s.cooldown).toBe(2.8);
    expect(s.ranged).toBe(true);
  });

  it("has HP, damage, and skin scale registered", () => {
    expect(HP_BY_KIND.blaster_frank).toBe(24);
    expect(DMG_BY_KIND.blaster_frank).toBe(2);
    expect(KIND_SKIN.blaster_frank?.scale).toBe(0.95);
  });

  it("has kite movement policy and stagger pain rating", () => {
    expect(MOVEMENT_BY_KIND.blaster_frank).toBe("kite");
    expect(PAIN_BY_KIND.blaster_frank).toBe(0.55);
  });

  it("drops ironshard and steelpin reagents", () => {
    const drops = ENEMY_DROPS.blaster_frank;
    expect(drops).toBeDefined();
    expect(drops.length).toBe(2);
    expect(drops.some((d) => d.id === "ironshard")).toBe(true);
    expect(drops.some((d) => d.id === "steelpin")).toBe(true);
  });

  it("has complete bestiary KIND_INFO entry", () => {
    const info = KIND_INFO.blaster_frank;
    expect(info).toBeDefined();
    expect(info.label).toBe("Blaster Frank");
    expect(info.icon).toBe("🔫");
    expect(info.blurb).toContain("blasting");
  });

  it("has card style set to iron", () => {
    expect(KIND_STYLE.blaster_frank).toBe("iron");
  });

  it("has working procedural cel-painter producing all animation frames", () => {
    const painter = KIND_PAINTS.blaster_frank;
    expect(painter).toBeDefined();
    const paints = makeBlasterFrankPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    expect(paints.S.idle?.length).toBe(4);
    expect(paints.S.walk?.length).toBe(4);
    expect(paints.S.attack?.length).toBe(4);
    expect(paints.S.death?.length).toBe(4);

    // Test execution of a frame paint
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    paints.S.idle?.[0]?.(ctx);
    paints.S.attack?.[1]?.(ctx);
    paints.S.death?.[3]?.(ctx);
  });

  it("spawns Blaster Frank successfully via spawnKind", () => {
    const z = spawnKind("blaster_frank", 12, 14, 2.5, 3);
    expect(z).not.toBeNull();
    if (z) {
      expect(z.kind).toBe("blaster_frank");
      expect(z.hp).toBe(24);
      expect(z.x).toBe(12);
      expect(z.z).toBe(14);
    }
  });

  it("launches sky volley with 3 falling sky_bullet projectiles", () => {
    expect(state.projectiles.length).toBe(0);
    launchSkyVolley(10, 10, 12, 12);
    expect(state.projectiles.length).toBe(3);

    for (const pr of state.projectiles) {
      expect(pr.kind).toBe("sky_bullet");
      expect(pr.hostile).toBe(true);
      expect(pr.damage).toBe(2);
      expect(pr.targetX).toBeDefined();
      expect(pr.targetZ).toBeDefined();
      expect(pr.life).toBeGreaterThan(0.5);
    }
  });

  it("fires wild ricocheting stray bullet in any direction", () => {
    expect(state.projectiles.length).toBe(0);
    fireWildBullet(5, 5, Math.PI / 4);
    expect(state.projectiles.length).toBe(1);
    const pr = state.projectiles[0];
    expect(pr.kind).toBe("bullet");
    expect(pr.hostile).toBe(true);
    expect(pr.bounces).toBeDefined();
  });

  it("updates sky_bullet arc and triggers ground impact splash upon landing", () => {
    launchSkyVolley(10, 10, 10, 10);
    expect(state.projectiles.length).toBe(3);

    // Step simulation while all projectiles are in mid-air
    const dt = 0.2;
    updateProjectiles(dt);
    expect(state.projectiles.length).toBe(3);

    // Further step beyond all flight times (1.2s)
    updateProjectiles(1.2);
    // Projectiles land, detonate, and despawn
    expect(state.projectiles.length).toBe(0);
  });

  it("handles death effects cleanly in killZombie", () => {
    const z = spawnKind("blaster_frank", 10, 10, 2.0, 3);
    expect(z).not.toBeNull();
    if (z) {
      expect(() => killZombie(z)).not.toThrow();
      expect(z.mode).toBe("dead");
    }
  });
});
