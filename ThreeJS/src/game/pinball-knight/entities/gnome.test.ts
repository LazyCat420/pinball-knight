import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { state, type Zombie, type Player } from "../state";
import { HP_BY_KIND } from "../spawn/factory";
import {
  GNOME_HP,
  GNOME_DAMAGE,
  GNOME_MOWER_DEFLECT,
  GNOME_SPEED_FACTOR,
  GNOME_CONTACT_RANGE,
  GNOME_FROM_LEVEL,
} from "../constants/enemies";
import { STATS, updateZombies, gnomeLawnmowerCharge } from "./zombie";
import { killZombie } from "./combat";
import { ENEMY_DROPS, rollReagentDrops } from "../reagents";
import { SHEET_KEYS, keysForFloor } from "../boot/sheets";
import type { Grid } from "../maze/generator";

function makeFakeGrid(): Grid {
  return { w: 10, h: 10, t: new Uint8Array(100), shapes: new Uint8Array(100) };
}

function makeFakeGnome(x = 5, z = 5): Zombie {
  const currentClip = { name: "idle" };
  return {
    nid: "z_gnome_test",
    kind: "gnome",
    x,
    z,
    hp: GNOME_HP,
    maxHp: GNOME_HP,
    speed: 2 * GNOME_SPEED_FACTOR,
    bodyR: 0.38,
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

describe("Gnome Monster Implementation", () => {
  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.grid = makeFakeGrid();
    state.player = makeFakePlayer();
    state.zombies = [];
    state.shakeT = 0;
    state.vfx = makeFakeVfx();
  });

  describe("Sprite-Forge Artifacts & Sheet Registration", () => {
    it("has published sprite atlas and manifest with idle, walk, attack, and death clips", () => {
      const jsonPath = path.resolve(process.cwd(), "public/sprites/gnome-S.json");
      const pngPath = path.resolve(process.cwd(), "public/sprites/gnome-S.png");

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(pngPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(manifest.name).toBe("gnome");
      expect(manifest.dir).toBe("S");

      const clipNames = manifest.rows.map((r: any) => r.clip);
      expect(clipNames).toContain("idle");
      expect(clipNames).toContain("walk");
      expect(clipNames).toContain("attack");
      expect(clipNames).toContain("death");
    });

    it("registers gnome in SHEET_KEYS and activates from floor 2 onwards", () => {
      expect(SHEET_KEYS.has("gnome")).toBe(true);
      expect(keysForFloor(1)).not.toContain("gnome");
      expect(keysForFloor(GNOME_FROM_LEVEL)).toContain("gnome");
    });
  });

  describe("Enemy Stats, Rules & Reagents", () => {
    it("defines correct HP, speed factor, and damage in factory and stats", () => {
      expect(HP_BY_KIND.gnome).toBe(GNOME_HP);
      expect(GNOME_HP).toBe(5);
      expect(GNOME_DAMAGE).toBe(1.5);
      expect(GNOME_MOWER_DEFLECT).toBeGreaterThanOrEqual(12);

      const stats = STATS.gnome;
      expect(stats).toBeDefined();
      expect(stats.contactRange).toBeCloseTo(GNOME_CONTACT_RANGE);
      expect(stats.ranged).toBe(false);
    });

    it("drops mechanical materials (ironshard, steelpin) on defeat", () => {
      const drops = ENEMY_DROPS.gnome;
      expect(drops).toBeDefined();
      const ids = drops.map((d) => d.id);
      expect(ids).toContain("ironshard");
      expect(ids).toContain("steelpin");

      const rolled = rollReagentDrops("gnome", {}, () => 0.01);
      expect(rolled).toContain("ironshard");
    });
  });

  describe("Lawnmower Attack Behavior", () => {
    it("charges player with lawnmower, triggers attack clip, deals damage, and applies deflect momentum", () => {
      const gnome = makeFakeGnome(5.0, 5.0);
      const player = makeFakePlayer(5.2, 5.2);
      state.zombies = [gnome];
      state.player = player;

      let sparksFired = false;
      let grassBurstFired = false;
      let smokeFired = false;
      state.vfx = makeFakeVfx({
        sparks: () => {
          sparksFired = true;
        },
        burst: (_x: number, _y: number, _z: number, color: number) => {
          if (color === 0x44bb33) grassBurstFired = true; // green grass clippings
        },
        smoke: () => {
          smokeFired = true;
        },
      });

      gnomeLawnmowerCharge(gnome, 0.28, GNOME_CONTACT_RANGE);

      expect(player.hp).toBeLessThan(10); // damaged by GNOME_DAMAGE
      expect(player.momSpeed).toBeGreaterThanOrEqual(GNOME_MOWER_DEFLECT); // deflected by rotary mower
      expect(sparksFired).toBe(true);
      expect(grassBurstFired).toBe(true);
      expect(smokeFired).toBe(true);
    });
  });

  describe("Death Poof Behavior", () => {
    it("emits smoke burst on death and cleanly vanishes into nothing without leaving a corpse", () => {
      const gnome = makeFakeGnome(5.0, 5.0);
      state.scene!.add(gnome.sprite.mesh);
      state.zombies = [gnome];

      let deathSmokePuff = false;
      state.vfx = {
        smoke: (_x: number, _y: number, _z: number, scale: number) => {
          if (scale >= 1.0) deathSmokePuff = true;
        },
        sparks: () => {},
      } as any;

      // Kill the gnome
      gnome.hp = 0;
      killZombie(gnome);

      expect(gnome.mode).toBe("dead");
      expect(deathSmokePuff).toBe(true);

      // Advance time past the death poof duration (0.55s)
      updateZombies(0.6);

      // Verify gnome has poofed into nothing: spliced from zombies array and removed from scene
      expect(state.zombies).not.toContain(gnome);
      expect(state.zombies.length).toBe(0);
      expect(state.scene!.children).not.toContain(gnome.sprite.mesh);
    });
  });
});
