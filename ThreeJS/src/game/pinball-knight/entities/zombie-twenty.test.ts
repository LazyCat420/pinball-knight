import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import {
  ZOMBIE_TYPES,
  ZOMBIE_TYPE_IDS,
  pickZombieType,
  typeHp,
  typeDropMult,
  variantIndicesFor,
} from "../zombie-types";
import { ZOMBIE_VARIANTS } from "../render/cel-painter";
import { state, type Zombie } from "../state";
import { debugSpawnAllZombies, makeDebugEnemy } from "../dev/debug-actions";
import type { SpriteSheet } from "../engine/render/sprite";
import * as THREE from "three";

const realDoc = (globalThis as { document?: unknown }).document;

function createDummySheet(): SpriteSheet {
  const tex = new THREE.Texture() as THREE.CanvasTexture;
  const clips = new Map<string, number[]>([
    ["S:idle", [0, 1, 2, 3]],
    ["S:walk", [4, 5, 6, 7]],
    ["S:attack", [8, 9, 10, 11]],
    ["S:death", [12, 13, 14, 15]],
    ["E:idle", [0, 1, 2, 3]],
    ["E:walk", [4, 5, 6, 7]],
    ["E:attack", [8, 9, 10, 11]],
    ["E:death", [12, 13, 14, 15]],
    ["N:idle", [0, 1, 2, 3]],
    ["N:walk", [4, 5, 6, 7]],
    ["N:attack", [8, 9, 10, 11]],
    ["N:death", [12, 13, 14, 15]],
  ]);
  return {
    texture: tex,
    cols: 4,
    rows: 4,
    frameCount: 16,
    clips,
  } as any;
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

describe("20 Zombie Variations - Comprehensive Suite", () => {
  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.zombies = [];
    state.level = 5;

    const sheet = createDummySheet();
    state.sheets.zombie = sheet;
    state.zombieVariantSheets = ZOMBIE_VARIANTS.map(() => sheet);

    const t = new Uint8Array(900);
    // Mark walkable (T_FLOOR = 1)
    for (let i = 0; i < 900; i++) t[i] = 1;
    state.grid = {
      w: 30,
      h: 30,
      t,
      shapes: new Uint8Array(900),
      rooms: [],
      start: { i: 5, j: 5 },
      exit: { i: 25, j: 25 },
    } as any;

    state.player = {
      x: 15,
      z: 15,
      bodyR: 0.4,
      hp: 10,
      maxHp: 10,
      speed: 1,
      bounceCombo: 0,
      sprite: { mesh: new THREE.Mesh() } as any,
    } as any;
  });

  afterEach(() => {
    state.zombies = [];
    state.scene = null;
    state.zombieVariantSheets = [];
  });

  it("contains exactly 20 distinct zombie types", () => {
    expect(ZOMBIE_TYPE_IDS.length).toBe(20);
    const unique = new Set(ZOMBIE_TYPE_IDS);
    expect(unique.size).toBe(20);
  });

  it("assigns valid names, positive multipliers, and compliant scales to all 20 types", () => {
    for (const id of ZOMBIE_TYPE_IDS) {
      const def = ZOMBIE_TYPES[id];
      expect(def.id).toBe(id);
      expect(typeof def.label).toBe("string");
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.speedMult).toBeGreaterThan(0);
      expect(def.hpMult).toBeGreaterThan(0);
      expect(def.scale).toBeGreaterThan(0);
      expect(def.bodyRMult).toBeGreaterThan(0);
      expect(def.reachMult).toBeGreaterThan(0);
      expect(def.windupMult).toBeGreaterThan(0);

      // Collider scale coupling invariant:
      if (def.scale !== 1) {
        expect(def.bodyRMult).not.toBe(1);
        expect(Math.sign(def.scale - 1)).toBe(Math.sign(def.bodyRMult - 1));
      } else {
        expect(def.bodyRMult).toBe(1);
      }
    }
  });

  it("ensures spawn weights sum to 100 with Shambler as the plurality", () => {
    const sum = ZOMBIE_TYPE_IDS.reduce((acc, id) => acc + ZOMBIE_TYPES[id].weight, 0);
    expect(sum).toBe(100);

    const shamblerWeight = ZOMBIE_TYPES.shambler.weight;
    for (const id of ZOMBIE_TYPE_IDS) {
      if (id === "shambler") continue;
      expect(shamblerWeight).toBeGreaterThan(ZOMBIE_TYPES[id].weight);
    }
  });

  it("provides valid artwork for all 20 sub-types through variantIndicesFor", () => {
    for (const id of ZOMBIE_TYPE_IDS) {
      const indices = variantIndicesFor(id, ZOMBIE_VARIANTS);
      expect(indices.length).toBeGreaterThan(0);
      for (const idx of indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(ZOMBIE_VARIANTS.length);
      }
    }
  });

  it("can spawn every one of the 20 zombie types via makeDebugEnemy", () => {
    for (const id of ZOMBIE_TYPE_IDS) {
      const z = makeDebugEnemy("zombie", 15, 15, id);
      expect(z).not.toBeNull();
      if (z) {
        expect(z.kind).toBe("zombie");
        expect(z.ztype === id || (id === "shambler" && !z.ztype)).toBe(true);
        expect(z.hp).toBeGreaterThan(0);
        expect(z.sprite.mesh).toBeDefined();
      }
    }
  });

  it("executes debugSpawnAllZombies placing 20 zombie actors into the scene", () => {
    debugSpawnAllZombies();
    expect(state.zombies.length).toBe(20);
    const spawnedTypes = state.zombies.map((z) => z.ztype ?? "shambler");
    for (const id of ZOMBIE_TYPE_IDS) {
      expect(spawnedTypes).toContain(id);
    }
  });

  it("depth-gates progressively so level 1 only spawns shambler and lurcher", () => {
    const level1Types = new Set<string>();
    for (let hash = 0; hash < 3000; hash++) {
      level1Types.add(pickZombieType(hash, 1));
    }
    expect([...level1Types].sort()).toEqual(["lurcher", "shambler"]);
  });

  it("unlocks all 20 types at higher dungeon levels", () => {
    const allSeen = new Set<string>();
    for (let level = 1; level <= 6; level++) {
      for (let hash = 0; hash < 2000; hash++) {
        allSeen.add(pickZombieType(hash, level));
      }
    }
    expect(allSeen.size).toBe(20);
  });
});
