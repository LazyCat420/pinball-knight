import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { state, type Zombie, type Player } from "../state";
import { HP_BY_KIND } from "../spawn/factory";
import {
  CIGARETTE_HP,
  CIGARETTE_DAMAGE,
  CIGARETTE_BURN_DURATION,
  CIGARETTE_CONTACT_RANGE,
  CIGARETTE_ATTACK_WINDUP,
  CIGARETTE_ATTACK_COOLDOWN,
  CIGARETTE_SPEED_FACTOR,
  CIGARETTE_FROM_LEVEL,
} from "../constants/enemies";
import { STATS, updateZombies, cigaretteBurnAttack } from "./zombie";
import { killZombie } from "./combat";
import { ENEMY_DROPS, rollReagentDrops } from "../reagents";
import { SHEET_KEYS, keysForFloor } from "../boot/sheets";
import { KIND_INFO } from "../bestiary";
import type { Grid } from "../maze/generator";

function makeFakeGrid(): Grid {
  return { w: 10, h: 10, t: new Uint8Array(100), shapes: new Uint8Array(100) };
}

function makeFakeCigarette(x = 5, z = 5): Zombie {
  const currentClip = { name: "idle" };
  return {
    nid: "z_cigarette_test",
    kind: "cigarette",
    x,
    z,
    hp: CIGARETTE_HP,
    maxHp: CIGARETTE_HP,
    speed: 2 * CIGARETTE_SPEED_FACTOR,
    bodyR: 0.32,
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

describe("Walking Cigarette Monster Implementation", () => {
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
      const jsonPath = path.resolve(process.cwd(), "public/sprites/cigarette-S.json");
      const pngPath = path.resolve(process.cwd(), "public/sprites/cigarette-S.png");

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(pngPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(manifest.name).toBe("cigarette");
      expect(manifest.dir).toBe("S");

      const clipNames = manifest.rows.map((r: any) => r.clip);
      expect(clipNames).toContain("idle");
      expect(clipNames).toContain("walk");
      expect(clipNames).toContain("attack");
      expect(clipNames).toContain("death");
    });

    it("registers cigarette in SHEET_KEYS and activates from floor 2 onwards", () => {
      expect(SHEET_KEYS.has("cigarette")).toBe(true);
      expect(keysForFloor(1)).not.toContain("cigarette");
      expect(keysForFloor(CIGARETTE_FROM_LEVEL)).toContain("cigarette");
    });
  });

  describe("Stats & Balancing Attributes", () => {
    it("has expected health, speed factor, and contact parameters", () => {
      expect(HP_BY_KIND.cigarette).toBe(CIGARETTE_HP);
      expect(CIGARETTE_SPEED_FACTOR).toBe(1.3);
      expect(STATS.cigarette.bodyR).toBe(0.32);
      expect(STATS.cigarette.contactRange).toBe(CIGARETTE_CONTACT_RANGE);
      expect(STATS.cigarette.windup).toBe(CIGARETTE_ATTACK_WINDUP);
      expect(STATS.cigarette.cooldown).toBe(CIGARETTE_ATTACK_COOLDOWN);
      expect(CIGARETTE_DAMAGE).toBe(1.25);
      expect(CIGARETTE_BURN_DURATION).toBe(2.0);
    });

    it("registers reagent drops in ENEMY_DROPS and rolls correctly", () => {
      expect(ENEMY_DROPS.cigarette).toBeDefined();
      const drops = ENEMY_DROPS.cigarette.map((d) => d.id);
      expect(drops).toContain("glass");
      expect(drops).toContain("rotflesh");

      // With dropMult=100%, drops should be awarded
      const rolled = rollReagentDrops("cigarette", { dropMult: 100 }, () => 0.01);
      expect(rolled.length).toBeGreaterThan(0);
    });

    it("registers in bestiary KIND_INFO with 1950s rubberhose blurb", () => {
      expect(KIND_INFO.cigarette).toBeDefined();
      expect(KIND_INFO.cigarette.icon).toBe("🚬");
      expect(KIND_INFO.cigarette.label).toBe("Walking Cigarette");
    });
  });

  describe("Burn Attack Behavior", () => {
    it("cigaretteBurnAttack damages the player and triggers ember sparks / smoke VFX", () => {
      const z = makeFakeCigarette(5, 5);
      state.player = makeFakePlayer(5.2, 5.0); // Within CIGARETTE_CONTACT_RANGE
      const initialHp = state.player.hp;

      let sparksFired = false;
      let smokeFired = false;
      let burstFired = false;

      state.vfx = makeFakeVfx({
        sparks: () => {
          sparksFired = true;
        },
        smoke: () => {
          smokeFired = true;
        },
        burst: () => {
          burstFired = true;
        },
      });

      cigaretteBurnAttack(z, 0.2, CIGARETTE_CONTACT_RANGE);

      expect(state.player.hp).toBeLessThan(initialHp);
      expect(state.player.hp).toBeCloseTo(initialHp - CIGARETTE_DAMAGE);
      expect(sparksFired).toBe(true);
      expect(smokeFired).toBe(true);
      expect(burstFired).toBe(true);
    });

    it("does not damage player if player is invulnerable (iframes > 0)", () => {
      const z = makeFakeCigarette(5, 5);
      state.player = makeFakePlayer(5.1, 5.0);
      state.player.iframes = 0.5;
      const initialHp = state.player.hp;

      cigaretteBurnAttack(z, 0.1, CIGARETTE_CONTACT_RANGE);

      expect(state.player.hp).toBe(initialHp);
    });
  });

  describe("Defeat & Stubbed-out Ash Death", () => {
    it("killZombie sets mode to dead, plays death animation, and spawns ash/smoke", () => {
      const z = makeFakeCigarette(5, 5);
      state.zombies = [z];

      let smokeFired = false;
      let ashBurstFired = false;
      let sparksFired = false;

      state.vfx = makeFakeVfx({
        smoke: () => {
          smokeFired = true;
        },
        burst: (_x: number, _y: number, _z: number, color: number) => {
          if (color === 0x555555) ashBurstFired = true;
        },
        sparks: () => {
          sparksFired = true;
        },
      });

      killZombie(z);

      expect(z.mode).toBe("dead");
      expect(z.corpseT).toBe(0);
      expect(smokeFired).toBe(true);
      expect(ashBurstFired).toBe(true);
      expect(sparksFired).toBe(true);
    });

    it("cleans up cigarette zombie mesh and removes from list after corpse timer expires", () => {
      const z = makeFakeCigarette(5, 5);
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
