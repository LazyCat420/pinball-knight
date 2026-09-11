import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import {
  CHRISTMAS_TREE_HP,
  CHRISTMAS_TREE_R,
  CHRISTMAS_TREE_SPEED_FACTOR,
  CHRISTMAS_TREE_FROM_LEVEL,
  CHRISTMAS_TREE_DAMAGE,
  CHRISTMAS_TREE_FIRE_RANGE,
  CHRISTMAS_TREE_WINDUP,
  CHRISTMAS_TREE_COOLDOWN,
  ORNAMENT_SPEED,
  ORNAMENT_DAMAGE,
  ORNAMENT_BOUNCES,
} from "../constants/enemies";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { DMG_BY_KIND, killZombie, setChristmasTreeDeathHandler } from "./combat";
import { PAIN_BY_KIND } from "./stagger";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { STATS } from "./zombie";
import { SPAWNABLE } from "../debug-panel";
import { makeChristmasTreePaints } from "../render/monsters/christmas-tree";
import { launchOrnament, updateProjectiles } from "./projectiles";
import type { Zombie, Player } from "../state";
import { state } from "../state";

describe("Christmas Tree Monster — Tables & Registrations", () => {
  it("has correct stats and constants defined", () => {
    expect(CHRISTMAS_TREE_HP).toBe(18);
    expect(CHRISTMAS_TREE_R).toBe(0.45);
    expect(CHRISTMAS_TREE_SPEED_FACTOR).toBe(0.75);
    expect(CHRISTMAS_TREE_FROM_LEVEL).toBe(3);
    expect(CHRISTMAS_TREE_DAMAGE).toBe(1);
    expect(CHRISTMAS_TREE_FIRE_RANGE).toBe(6.5);
    expect(CHRISTMAS_TREE_WINDUP).toBe(0.45);
    expect(CHRISTMAS_TREE_COOLDOWN).toBe(2.8);
    expect(ORNAMENT_SPEED).toBe(4.5);
    expect(ORNAMENT_DAMAGE).toBe(1);
    expect(ORNAMENT_BOUNCES).toBe(1);
  });

  it("is registered in bestiary with icon and label", () => {
    const info = KIND_INFO.christmas_tree;
    expect(info).toBeDefined();
    expect(info.label).toBe("Holiday Tree");
    expect(info.icon).toBe("🎄");
    expect(info.blurb).toContain("hops");
  });

  it("is registered in reagent drops with glass and lodestone", () => {
    const drops = ENEMY_DROPS.christmas_tree;
    expect(drops).toBeDefined();
    expect(drops.some((d) => d.id === "glass")).toBe(true);
    expect(drops.some((d) => d.id === "lodestone")).toBe(true);
  });

  it("is configured in KIND_SKIN with appropriate scale", () => {
    const skin = KIND_SKIN.christmas_tree;
    expect(skin).toBeDefined();
    expect(skin?.scale).toBe(1.15);
  });

  it("has combat damage, stagger, movement, and zombie stats configured", () => {
    expect(DMG_BY_KIND.christmas_tree).toBe(CHRISTMAS_TREE_DAMAGE);
    expect(PAIN_BY_KIND.christmas_tree).toBe(0.45);
    expect(MOVEMENT_BY_KIND.christmas_tree).toBe("kite");
    expect(STATS.christmas_tree.ranged).toBe(true);
    expect(STATS.christmas_tree.contactRange).toBe(CHRISTMAS_TREE_FIRE_RANGE);
    expect(STATS.christmas_tree.windup).toBe(CHRISTMAS_TREE_WINDUP);
    expect(STATS.christmas_tree.cooldown).toBe(CHRISTMAS_TREE_COOLDOWN);
  });

  it("is present in the debug panel spawnable roster", () => {
    const entry = SPAWNABLE.find((e) => e.kind === "christmas_tree");
    expect(entry).toBeDefined();
    expect(entry?.label).toContain("XmasTree");
  });

  it("generates procedural cel-paints for all facings and clips", () => {
    const paints = makeChristmasTreePaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    for (const facing of [paints.S, paints.N, paints.E]) {
      expect(facing.idle?.length).toBeGreaterThan(0);
      expect(facing.walk?.length).toBeGreaterThan(0);
      expect(facing.attack?.length).toBeGreaterThan(0);
      expect(facing.death?.length).toBeGreaterThan(0);
    }
  });
});

describe("Christmas Tree Monster — Mechanics & Death Effects", () => {
  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.projectiles = [];
    state.zombies = [];
    state.player = {
      x: 5,
      z: 5,
      hp: 10,
      maxHp: 10,
      facing: "S",
      invulnT: 0,
      momSpeed: 0,
      dead: false,
    } as unknown as Player;
  });

  it("launches ornament projectile with correct velocity and trajectory", () => {
    launchOrnament(2, 2, 1, 0); // Aiming +X
    expect(state.projectiles.length).toBe(1);
    const proj = state.projectiles[0];
    expect(proj.kind).toBe("ornament");
    expect(proj.bounces).toBe(1);
    expect(proj.vx).toBeCloseTo(ORNAMENT_SPEED);
    expect(proj.vz).toBeCloseTo(0);
  });

  it("triggers death handler upon killZombie", () => {
    let deathTriggered = false;
    let deathX = 0;
    let deathZ = 0;

    setChristmasTreeDeathHandler((x, z) => {
      deathTriggered = true;
      deathX = x;
      deathZ = z;
    });

    const dummyTree = {
      nid: 999,
      kind: "christmas_tree",
      x: 4.5,
      z: 3.5,
      hp: 0,
      mode: "chase",
      sprite: {
        mesh: { position: { x: 4.5, y: 0, z: 3.5 } },
        setTint: () => {},
        setBlobVisible: () => {},
      },
      anim: {
        play: () => {},
        getFacing: () => "S",
        currentClip: "idle",
      },
    } as unknown as Zombie;

    killZombie(dummyTree);
    expect(dummyTree.mode).toBe("dead");
    expect(deathTriggered).toBe(true);
    expect(deathX).toBe(4.5);
    expect(deathZ).toBe(3.5);
  });
});
