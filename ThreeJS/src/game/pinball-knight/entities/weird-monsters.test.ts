import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { state, resetState, type Player } from "../state";
import { STATS } from "./zombie";
import { HP_BY_KIND, spawnKind } from "../spawn/factory";
import { DMG_BY_KIND } from "./combat";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { ENEMY_DROPS } from "../reagents";
import { KIND_INFO } from "../bestiary";
import { KIND_STYLE } from "../render/card-styles";
import { KIND_PAINTS } from "../render/monster-portrait";
import { installSpriteTestDom } from "../testkit/atlas-census";

describe("5 Weird American Monsters - Comprehensive Registration & Mechanics", () => {
  let restoreDom: () => void;
  const WEIRD_KINDS = [
    "pit_peeper",
    "dumpster_dan",
    "toaster_gremlin",
    "lip_flapper",
    "hydrant_hound",
  ] as const;

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
    state.scene = null;
    state.zombies = [];
    state.player = null;
    state.grid = null;
    restoreDom?.();
  });

  it("all 5 monsters are registered in STATS with appropriate combat flags", () => {
    for (const kind of WEIRD_KINDS) {
      const s = STATS[kind];
      expect(s).toBeDefined();
      expect(s.bodyR).toBeGreaterThan(0.3);
      expect(s.contactRange).toBeGreaterThan(0);
      expect(s.windup).toBeGreaterThan(0);
      expect(s.cooldown).toBeGreaterThan(0);
    }
    expect(STATS.pit_peeper.ranged).toBe(false);
    expect(STATS.dumpster_dan.ranged).toBe(false);
    expect(STATS.toaster_gremlin.ranged).toBe(true);
    expect(STATS.lip_flapper.ranged).toBe(true);
    expect(STATS.hydrant_hound.ranged).toBe(false);
  });

  it("all 5 monsters have defined HP and damage values", () => {
    expect(HP_BY_KIND.pit_peeper).toBe(22);
    expect(HP_BY_KIND.dumpster_dan).toBe(28);
    expect(HP_BY_KIND.toaster_gremlin).toBe(18);
    expect(HP_BY_KIND.lip_flapper).toBe(16);
    expect(HP_BY_KIND.hydrant_hound).toBe(32);

    expect(DMG_BY_KIND.pit_peeper).toBe(1);
    expect(DMG_BY_KIND.dumpster_dan).toBe(2);
    expect(DMG_BY_KIND.toaster_gremlin).toBe(1);
    expect(DMG_BY_KIND.lip_flapper).toBe(1);
    expect(DMG_BY_KIND.hydrant_hound).toBe(2);
  });

  it("all 5 monsters have configured movement policies", () => {
    expect(MOVEMENT_BY_KIND.pit_peeper).toBe("chase");
    expect(MOVEMENT_BY_KIND.dumpster_dan).toBe("chase");
    expect(MOVEMENT_BY_KIND.toaster_gremlin).toBe("kite");
    expect(MOVEMENT_BY_KIND.lip_flapper).toBe("kite");
    expect(MOVEMENT_BY_KIND.hydrant_hound).toBe("chase");
  });

  it("all 5 monsters have stagger pain ratings", () => {
    for (const kind of WEIRD_KINDS) {
      expect(PAIN_BY_KIND[kind]).toBeGreaterThan(0);
      expect(PAIN_BY_KIND[kind]).toBeLessThanOrEqual(1.0);
    }
  });

  it("all 5 monsters have reagent drops in ENEMY_DROPS", () => {
    for (const kind of WEIRD_KINDS) {
      const drops = ENEMY_DROPS[kind];
      expect(drops).toBeDefined();
      expect(drops.length).toBeGreaterThan(0);
      for (const d of drops) {
        expect(d.id).toBeTruthy();
        expect(d.chance).toBeGreaterThan(0);
      }
    }
  });

  it("all 5 monsters have complete bestiary KIND_INFO entries", () => {
    for (const kind of WEIRD_KINDS) {
      const info = KIND_INFO[kind];
      expect(info).toBeDefined();
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.icon.length).toBeGreaterThan(0);
      expect(info.blurb.length).toBeGreaterThan(15);
    }
  });

  it("all 5 monsters have card styles in KIND_STYLE", () => {
    expect(KIND_STYLE.pit_peeper).toBe("chitin");
    expect(KIND_STYLE.dumpster_dan).toBe("bone");
    expect(KIND_STYLE.toaster_gremlin).toBe("iron");
    expect(KIND_STYLE.lip_flapper).toBe("bone");
    expect(KIND_STYLE.hydrant_hound).toBe("iron");
  });

  it("all 5 monsters have working procedural cel-painters producing complete sprite frames", () => {
    for (const kind of WEIRD_KINDS) {
      const painter = KIND_PAINTS[kind];
      expect(painter).toBeDefined();
      const paints = painter();
      expect(paints.S).toBeDefined();
      expect(paints.N).toBeDefined();
      expect(paints.E).toBeDefined();
      expect(paints.S.idle.length).toBeGreaterThan(0);
      expect(paints.S.walk.length).toBeGreaterThan(0);
      expect(paints.S.attack.length).toBeGreaterThan(0);
      expect(paints.S.death.length).toBeGreaterThan(0);
    }
  });

  it("can successfully spawn all 5 monsters via spawnKind", () => {
    for (const kind of WEIRD_KINDS) {
      const z = spawnKind(kind, 12, 14, 2.5, 5);
      expect(z).not.toBeNull();
      if (z) {
        expect(z.kind).toBe(kind);
        expect(z.hp).toBe(HP_BY_KIND[kind]);
        expect(z.x).toBe(12);
        expect(z.z).toBe(14);
      }
    }
  });
});
