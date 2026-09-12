import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { state, resetState, type Player } from "../state";
import { STATS } from "./zombie";
import { HP_BY_KIND, spawnKind } from "../spawn/factory";
import { KIND_SKIN } from "../spawn/kind-skin";
import { DMG_BY_KIND } from "./combat";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { ENEMY_DROPS } from "../reagents";
import { KIND_INFO } from "../bestiary";
import { KIND_STYLE } from "../render/card-styles";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeJunkbotPaints } from "../render/monsters/junkbot";
import { installSpriteTestDom } from "../testkit/atlas-census";

describe("Junkbot (5-Variant Scavenger Robot) - Registration, Mechanics & Sprites", () => {
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
      sprite: { setTint: () => {}, mesh: new THREE.Mesh(), setSheet: () => {} },
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

  it("is registered in STATS with accurate combat tuning", () => {
    const s = STATS.junkbot;
    expect(s).toBeDefined();
    expect(s.bodyR).toBe(0.52);
    expect(s.contactRange).toBe(1.1);
    expect(s.windup).toBe(0.45);
    expect(s.cooldown).toBe(1.8);
    expect(s.ranged).toBe(false);
  });

  it("has HP, damage, and skin scale registered", () => {
    expect(HP_BY_KIND.junkbot).toBe(32);
    expect(DMG_BY_KIND.junkbot).toBe(2);
    expect(KIND_SKIN.junkbot?.scale).toBe(1.15);
  });

  it("has chase movement policy and stagger pain rating", () => {
    expect(MOVEMENT_BY_KIND.junkbot).toBe("chase");
    expect(PAIN_BY_KIND.junkbot).toBe(0.35);
  });

  it("drops ironshard, lodestone, and glass reagents", () => {
    const drops = ENEMY_DROPS.junkbot;
    expect(drops).toBeDefined();
    expect(drops.length).toBe(3);
    expect(drops.some((d) => d.id === "ironshard")).toBe(true);
    expect(drops.some((d) => d.id === "lodestone")).toBe(true);
    expect(drops.some((d) => d.id === "glass")).toBe(true);
  });

  it("has complete bestiary KIND_INFO entry", () => {
    const info = KIND_INFO.junkbot;
    expect(info).toBeDefined();
    expect(info.label).toBe("Junkbot");
    expect(info.icon).toBe("🤖");
    expect(info.blurb).toContain("scrap parts");
  });

  it("has card style set to iron", () => {
    expect(KIND_STYLE.junkbot).toBe("iron");
  });

  it("has working procedural cel-painter producing all animation frames", () => {
    const painter = KIND_PAINTS.junkbot;
    expect(painter).toBeDefined();
    const paints = makeJunkbotPaints();
    for (const dir of ["S", "N", "E"] as const) {
      expect(paints[dir]).toBeDefined();
      expect(paints[dir]!.idle?.length).toBe(4);
      expect(paints[dir]!.walk?.length).toBe(4);
      expect(paints[dir]!.attack?.length).toBe(4);
      expect(paints[dir]!.death?.length).toBe(4);
    }
  });

  it("spawns a junkbot with random variant assignment", () => {
    const z = spawnKind("junkbot", 12, 14, 2.5, 3);
    expect(z).not.toBeNull();
    if (z) {
      expect(z.kind).toBe("junkbot");
      expect(z.junkbotVariant).toBeDefined();
      expect(["tractor", "cyber", "motor", "crane", "appliance"]).toContain(z.junkbotVariant);
      expect(z.hp).toBe(32);
    }
  });

  it("verifies all 5 variant sprite sheets and manifests exist in public/sprites", () => {
    const publicSprites = join(__dirname, "../../../../public/sprites");
    const variants = ["junkbot", "junkbot_tractor", "junkbot_cyber", "junkbot_motor", "junkbot_crane", "junkbot_appliance"];

    for (const v of variants) {
      const pngPath = join(publicSprites, `${v}-S.png`);
      const jsonPath = join(publicSprites, `${v}-S.json`);

      expect(existsSync(pngPath), `Missing ${v}-S.png`).toBe(true);
      expect(existsSync(jsonPath), `Missing ${v}-S.json`).toBe(true);

      const manifest = JSON.parse(readFileSync(jsonPath, "utf8"));
      expect(manifest.name).toBe(v);
      expect(manifest.dir).toBe("S");
      expect(manifest.rows.length).toBe(4);

      const clipNames = manifest.rows.map((r: { clip: string }) => r.clip);
      expect(clipNames).toEqual(["idle", "walk", "attack", "death"]);
      for (const row of manifest.rows) {
        expect(row.cells.length).toBe(4);
      }
    }
  });
});
