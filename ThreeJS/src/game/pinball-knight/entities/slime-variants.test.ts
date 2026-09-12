import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import * as THREE from "three";
import { state, type EnemyKind } from "../state";
import { KIND_INFO } from "../bestiary";
import { STATS } from "./zombie";
import { HP_BY_KIND, queueMini, drainPendingMinis } from "../spawn/factory";
import { DMG_BY_KIND } from "./combat";
import { MOVEMENT_BY_KIND, MOMENTUM_GATES } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PORTRAIT } from "../render/monster-portrait";
import { installPalette } from "../render/palette";
import { makeMagmaSlimePaints } from "../render/monsters/magma_slime";
import { makeToxicSlimePaints } from "../render/monsters/toxic_slime";
import { makeFrostSlimePaints } from "../render/monsters/frost_slime";
import { makeVoidSlimePaints } from "../render/monsters/void_slime";
import { burstIceShards } from "./projectiles";
import {
  MAGMA_SLIME_HP,
  TOXIC_SLIME_HP,
  FROST_SLIME_HP,
  VOID_SLIME_HP,
  FROST_SLIME_SHARDS,
} from "../constants";

const SLIME_KINDS: EnemyKind[] = [
  "magma_slime",
  "toxic_slime",
  "frost_slime",
  "void_slime",
];

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  installPalette();
  state.scene = new THREE.Scene();
  state.zombies = [];
  state.projectiles = [];
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

describe("Elemental & Hazard Slime Variants - Roster Integration", () => {
  it("all 4 slime variants are registered in core systems", () => {
    for (const kind of SLIME_KINDS) {
      expect(KIND_INFO[kind]).toBeDefined();
      expect(KIND_INFO[kind].label).toBeTruthy();
      expect(KIND_INFO[kind].icon).toBeTruthy();

      expect(STATS[kind]).toBeDefined();
      expect(STATS[kind].bodyR).toBeGreaterThan(0);
      expect(STATS[kind].contactRange).toBeGreaterThan(0);

      expect(HP_BY_KIND[kind]).toBeDefined();
      expect(HP_BY_KIND[kind]).toBeGreaterThan(0);

      expect(DMG_BY_KIND[kind]).toBeDefined();
      expect(DMG_BY_KIND[kind]).toBeGreaterThan(0);

      expect(MOVEMENT_BY_KIND[kind]).toBeDefined();
      expect(PAIN_BY_KIND[kind]).toBeGreaterThan(0);

      expect(ENEMY_DROPS[kind]).toBeDefined();
      expect(ENEMY_DROPS[kind].length).toBeGreaterThan(0);

      expect(KIND_SKIN[kind]).toBeDefined();
      expect(KIND_SKIN[kind]!.scale).toBeGreaterThan(0);

      expect(SHEET_PAINTERS[kind as keyof typeof SHEET_PAINTERS]).toBeDefined();
      expect(KIND_PORTRAIT[kind]).toBeDefined();
    }
  });

  it("assigns expected base HP for all 4 slimes", () => {
    expect(HP_BY_KIND.magma_slime).toBe(MAGMA_SLIME_HP);
    expect(HP_BY_KIND.toxic_slime).toBe(TOXIC_SLIME_HP);
    expect(HP_BY_KIND.frost_slime).toBe(FROST_SLIME_HP);
    expect(HP_BY_KIND.void_slime).toBe(VOID_SLIME_HP);
  });

  it("frost_slime is registered in MOMENTUM_GATES with damage gating", () => {
    const gate = MOMENTUM_GATES.frost_slime;
    expect(gate).toBeDefined();
    expect(gate?.gatesDamage).toBe(true);
    expect(gate?.soft).toBeLessThan(1.0);
    expect(gate?.text).toContain("Glacial Shell");
  });
});

describe("Elemental & Hazard Slime Variants - Procedural Cel-Painters", () => {
  const PAINTERS = [
    { kind: "magma_slime", fn: makeMagmaSlimePaints },
    { kind: "toxic_slime", fn: makeToxicSlimePaints },
    { kind: "frost_slime", fn: makeFrostSlimePaints },
    { kind: "void_slime", fn: makeVoidSlimePaints },
  ];

  for (const { kind, fn } of PAINTERS) {
    it(`${kind} painter renders non-empty pixels across S, N, E facings`, () => {
      const paints = fn();
      for (const dir of ["S", "N", "E"] as const) {
        const clips = paints[dir];
        expect(clips).toBeDefined();
        for (const clipKey of ["idle", "walk", "attack", "death"] as const) {
          const frames = clips[clipKey];
          expect(frames).toBeDefined();
          expect(frames!.length).toBeGreaterThan(0);

          for (const frame of frames!) {
            const cv = createCanvas(128, 128);
            const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;
            frame(ctx);
            const imgData = (ctx as any).getImageData(0, 0, 128, 128);
            let colored = 0;
            for (let i = 3; i < imgData.data.length; i += 4) {
              if (imgData.data[i] > 0) colored++;
            }
            expect(colored).toBeGreaterThan(100);
          }
        }
      }
    });
  }
});

describe("Elemental & Hazard Slime Variants - Combat & Mechanics", () => {
  it("burstIceShards creates 8 radial ricocheting ice shards", () => {
    state.projectiles = [];
    burstIceShards(10, 15);
    expect(state.projectiles.length).toBe(FROST_SLIME_SHARDS);
    for (const pr of state.projectiles) {
      expect(pr.kind).toBe("ice_shard");
      expect(pr.hostile).toBe(true);
      expect(pr.bounces).toBe(2);
      expect(pr.x).toBe(10);
      expect(pr.z).toBe(15);
    }
  });

  it("queueMini and drainPendingMinis spawns mini magma slimes with magma_slime kind", () => {
    state.zombies = [];
    queueMini(5, 5, 2.0, "magma_slime");
    drainPendingMinis();
    expect(state.zombies.length).toBe(2);
    for (const z of state.zombies) {
      expect(z.kind).toBe("magma_slime");
      expect(z.mini).toBe(true);
      expect(z.aggro).toBe(true);
    }
  });
});
