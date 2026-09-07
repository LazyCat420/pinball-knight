import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { state, type Zombie, type Player } from "../state";
import { HP_BY_KIND } from "../spawn/factory";
import {
  TOUCAN_HP,
  TOUCAN_DAMAGE,
  TOUCAN_ROLL_SPEED,
  TOUCAN_ROLL_DEFLECT,
  TOUCAN_CONTACT_RANGE,
  TOUCAN_ATTACK_WINDUP,
  TOUCAN_ATTACK_COOLDOWN,
  TOUCAN_SPEED_FACTOR,
  TOUCAN_FROM_LEVEL,
} from "../constants/enemies";
import { STATS, updateZombies, toucanBarrelRollAttack } from "./zombie";
import { killZombie } from "./combat";
import { ENEMY_DROPS, rollReagentDrops } from "../reagents";
import { SHEET_KEYS, keysForFloor } from "../boot/sheets";
import { KIND_INFO } from "../bestiary";
import type { Grid } from "../maze/generator";

function makeFakeGrid(): Grid {
  return { w: 10, h: 10, t: new Uint8Array(100), shapes: new Uint8Array(100) };
}

function makeFakeToucan(x = 5, z = 5): Zombie {
  const currentClip = { name: "idle" };
  return {
    nid: "z_toucan_test",
    kind: "toucan",
    x,
    z,
    hp: TOUCAN_HP,
    maxHp: TOUCAN_HP,
    speed: 2 * TOUCAN_SPEED_FACTOR,
    bodyR: 0.35,
    mode: "chase",
    windupT: 0,
    cooldown: 0,
    flashT: 0,
    aggro: true,
    corpseT: 0,
    anim: {
      setFacing: () => {},
      play: (name: string) => {
        currentClip.name = name;
      },
      getFacing: () => "S",
      isFinished: () => false,
      update: () => {},
    },
    sprite: {
      setTint: () => {},
      setBlobVisible: () => {},
      mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()),
    },
  } as unknown as Zombie;
}

function makeFakePlayer(x = 5.2, z = 5.2): Player {
  return {
    x,
    z,
    hp: 10,
    maxHp: 10,
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

function makeFakeVfx(overrides: Record<string, any> = {}) {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => {};
    },
  }) as any;
}

describe("Toucan Monster Implementation", () => {
  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.grid = makeFakeGrid();
    state.player = makeFakePlayer();
    state.zombies = [];
    state.shakeT = 0;
    state.gear = {} as any;
    state.godMode = false;
    state.vfx = makeFakeVfx();
  });

  describe("Sprite-Forge Artifacts & Sheet Registration", () => {
    it("has published sprite atlas and manifest with idle, walk, attack, and death clips", () => {
      const jsonPath = path.resolve(process.cwd(), "public/sprites/toucan-S.json");
      const pngPath = path.resolve(process.cwd(), "public/sprites/toucan-S.png");

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(pngPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(manifest.name).toBe("toucan");
      expect(manifest.dir).toBe("S");

      const clipNames = manifest.rows.map((r: any) => r.clip);
      expect(clipNames).toContain("idle");
      expect(clipNames).toContain("walk");
      expect(clipNames).toContain("attack");
      expect(clipNames).toContain("death");
    });

    it("registers toucan in SHEET_KEYS and activates from floor 2 onwards", () => {
      expect(SHEET_KEYS.has("toucan")).toBe(true);
      expect(keysForFloor(1)).not.toContain("toucan");
      expect(keysForFloor(TOUCAN_FROM_LEVEL)).toContain("toucan");
    });
  });

  describe("Stats & Balancing Attributes", () => {
    it("has expected health, speed factor, and contact parameters", () => {
      expect(HP_BY_KIND.toucan).toBe(TOUCAN_HP);
      expect(TOUCAN_SPEED_FACTOR).toBe(1.35);
      expect(STATS.toucan.bodyR).toBe(0.35);
      expect(STATS.toucan.contactRange).toBe(TOUCAN_CONTACT_RANGE);
      expect(STATS.toucan.windup).toBe(TOUCAN_ATTACK_WINDUP);
      expect(STATS.toucan.cooldown).toBe(TOUCAN_ATTACK_COOLDOWN);
      expect(TOUCAN_DAMAGE).toBe(1.5);
      expect(TOUCAN_ROLL_SPEED).toBe(7.5);
      expect(TOUCAN_ROLL_DEFLECT).toBe(12.0);
    });

    it("registers reagent drops in ENEMY_DROPS and rolls correctly", () => {
      expect(ENEMY_DROPS.toucan).toBeDefined();
      const drops = ENEMY_DROPS.toucan.map((d) => d.id);
      expect(drops).toContain("hide");
      expect(drops).toContain("fang");

      const rolled = rollReagentDrops("toucan", { dropMult: 100 }, () => 0.01);
      expect(rolled.length).toBeGreaterThan(0);
    });

    it("registers in bestiary KIND_INFO with tropical aerial blurb", () => {
      expect(KIND_INFO.toucan).toBeDefined();
      expect(KIND_INFO.toucan.icon).toBe("🦜");
      expect(KIND_INFO.toucan.label).toBe("Toucan");
    });
  });

  describe("Barrel Roll Attack Behavior", () => {
    it("toucanBarrelRollAttack damages the player and applies deflection impulse", () => {
      const z = makeFakeToucan(5, 5);
      state.player = makeFakePlayer(5.2, 5.0); // Within TOUCAN_CONTACT_RANGE
      const initialHp = state.player.hp;

      let smokeFired = false;
      let burstFired = false;

      state.vfx = makeFakeVfx({
        smoke: () => {
          smokeFired = true;
        },
        burst: () => {
          burstFired = true;
        },
      });

      toucanBarrelRollAttack(z, 0.2, TOUCAN_CONTACT_RANGE);

      expect(state.player.hp).toBeLessThan(initialHp);
      expect(state.player.hp).toBeCloseTo(initialHp - TOUCAN_DAMAGE);
      // Verify deflection impulse knocked player
      const impulseMag = Math.hypot(state.player.momX, state.player.momZ);
      expect(impulseMag).toBeGreaterThan(0);
      expect(state.player.momSpeed).toBeGreaterThan(0);
      expect(smokeFired).toBe(true);
      expect(burstFired).toBe(true);
    });

    it("does not damage player if player is invulnerable (iframes > 0)", () => {
      const z = makeFakeToucan(5, 5);
      state.player = makeFakePlayer(5.1, 5.0);
      state.player.iframes = 0.5;
      const initialHp = state.player.hp;

      toucanBarrelRollAttack(z, 0.1, TOUCAN_CONTACT_RANGE);

      expect(state.player.hp).toBe(initialHp);
    });
  });

  describe("Defeat & Tropical Feather Burst Death", () => {
    it("killZombie sets mode to dead, plays death animation, and spawns tropical feather bursts", () => {
      const z = makeFakeToucan(5, 5);
      state.zombies = [z];

      let cyanFeathers = false;
      let orangeFeathers = false;

      state.vfx = makeFakeVfx({
        burst: (_x: number, _y: number, _z: number, color: number) => {
          if (color === 0x00ccff) cyanFeathers = true;
          if (color === 0xffaa00) orangeFeathers = true;
        },
      });

      killZombie(z);

      expect(z.mode).toBe("dead");
      expect(z.corpseT).toBe(0);
      expect(cyanFeathers).toBe(true);
      expect(orangeFeathers).toBe(true);
    });

    it("cleans up toucan zombie mesh and removes from list after corpse timer expires", () => {
      const z = makeFakeToucan(5, 5);
      z.mode = "dead";
      z.corpseT = 0.5;
      state.zombies = [z];

      let removedFromScene = false;
      state.scene.remove = (obj) => {
        if (obj === z.sprite.mesh) removedFromScene = true;
      };

      // Advance time by 0.1s so corpseT > 0.55
      updateZombies(0.1);

      expect(z.corpseT).toBeGreaterThan(0.55);
      expect(state.zombies.length).toBe(0);
      expect(removedFromScene).toBe(true);
    });
  });
});
