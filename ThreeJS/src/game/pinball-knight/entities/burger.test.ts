import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../state";
import {
  BURGER_HP,
  BURGER_R,
  BURGER_SPEED_FACTOR,
  BURGER_DAMAGE,
  BURGER_ROT_RADIUS,
  BURGER_ROT_LIFE,
  BURGER_ROT_DAMAGE,
  BURGER_TOMATO_SPEED,
  BURGER_LETTUCE_SPEED,
  BURGER_SAUCE_SPEED,
} from "../constants";
import { IMPORTED_FACINGS, hasAuthoredFacing } from "../boot/manifest-inventory";
import { IMPORTED_ART, sheetKeyForKind } from "../boot/sheets";
import { KIND_SKIN } from "../spawn/kind-skin";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { KIND_INFO, buildBestiary } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { flingBurgerDeconstruction } from "./projectiles";
import { triggerBurgerRot } from "./combat";
import { installGameplayWiring } from "../boot/wiring";
import { makeBurgerPaints } from "../render/monsters/burger";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Burger Monster — Floating Deconstructing Hamburger with Lobster Eyes", () => {
  beforeEach(() => {
    state.scene = { add() {}, remove() {} } as any;
    state.dbgMaterialFloorFx = true;
    state.floorFx = [];
    state.zombies = [];
    state.projectiles = [];
    state.player = null;
    state.vfx = {
      burst: () => {},
      smoke: () => {},
      sparks: () => {},
      blood: () => {},
      ember: () => {},
      mote: () => {},
      dust: () => {},
      heal: () => {},
      steam: () => {},
      slash: () => {},
      slashCircle: () => {},
      sporeCloud: () => {},
      bolt: () => {},
      trail: () => {},
      damage: () => {},
    } as any;

    installGameplayWiring({
      spawnReaper: () => {},
      dropBossReward: () => {},
      startLevel: () => {},
      descend: () => {},
      onPlayerDeath: () => {},
      exitDungeonGame: () => {},
    });
  });

  it("registers burger as a first-class native sprite sheet", () => {
    expect(hasAuthoredFacing("burger", "S")).toBe(true);
    expect(IMPORTED_FACINGS.burger).toEqual(["S"]);
    expect(IMPORTED_ART.burger).toBe("burger");
    expect(sheetKeyForKind("burger")).toBe("burger");
    expect(KIND_SKIN.burger?.scale).toBe(1.0);

    // Has procedural fallback and portrait paints
    expect(SHEET_PAINTERS.burger).toBe(makeBurgerPaints);
    expect(KIND_PAINTS.burger).toBeDefined();
  });

  it("has published sprite-sheet json and png artifacts on disk", () => {
    const jsonPath = resolve(__dirname, "../../../../public/sprites/burger-S.json");
    const pngPath = resolve(__dirname, "../../../../public/sprites/burger-S.png");

    expect(existsSync(jsonPath), "burger-S.json must exist").toBe(true);
    expect(existsSync(pngPath), "burger-S.png must exist").toBe(true);

    const manifest = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(manifest.rows).toBeDefined();

    // Verify key animations are authored in the sheet
    const clipNames = manifest.rows.map((r: any) => r.clip);
    expect(clipNames).toContain("idle");
    expect(clipNames).toContain("walk");
    expect(clipNames).toContain("attack");
    expect(clipNames).toContain("death");
  });

  it("has complete bestiary, drops, and combat rules", () => {
    // Bestiary entry
    const info = KIND_INFO.burger;
    expect(info).toBeDefined();
    expect(info.label).toBe("Burger Beast");
    expect(info.blurb).toContain("floating hamburger");

    const bestiaryEntry = buildBestiary().find((e) => e.kind === "burger");
    expect(bestiaryEntry).toBeDefined();
    expect(bestiaryEntry!.mechanics.length).toBeGreaterThan(0);

    // Reagent drops
    expect(ENEMY_DROPS.burger).toBeDefined();
    expect(ENEMY_DROPS.burger.length).toBeGreaterThan(0);

    // Movement & Stagger rules
    expect(MOVEMENT_BY_KIND.burger).toBe("kite");
    expect(PAIN_BY_KIND.burger).toBe(0.6);

    // Balanced stats
    expect(BURGER_HP).toBe(4);
    expect(BURGER_R).toBe(0.35);
    expect(BURGER_DAMAGE).toBe(1);
    expect(BURGER_SPEED_FACTOR).toBe(0.95);
  });

  it("launches 3-part deconstruction fling attack with tomato, lettuce, and condiment sauce", () => {
    expect(state.projectiles.length).toBe(0);

    flingBurgerDeconstruction(10, 20, 1, 0);

    expect(state.projectiles.length).toBe(3);

    const kinds = state.projectiles.map((p) => p.kind);
    expect(kinds).toContain("burger_tomato");
    expect(kinds).toContain("burger_lettuce");
    expect(kinds).toContain("burger_sauce");

    const tomato = state.projectiles.find((p) => p.kind === "burger_tomato")!;
    const lettuce = state.projectiles.find((p) => p.kind === "burger_lettuce")!;
    const sauce = state.projectiles.find((p) => p.kind === "burger_sauce")!;

    expect(tomato.damage).toBe(BURGER_DAMAGE);
    expect(lettuce.damage).toBe(BURGER_DAMAGE);
    expect(sauce.damage).toBe(BURGER_DAMAGE);

    // Tomato is faster central disc
    expect(Math.hypot(tomato.vx, tomato.vz)).toBeCloseTo(BURGER_TOMATO_SPEED, 1);
    // Lettuce is aerodynamic fluttering blade
    expect(Math.hypot(lettuce.vx, lettuce.vz)).toBeCloseTo(BURGER_LETTUCE_SPEED, 1);
    // Sauce is condiment blob
    expect(Math.hypot(sauce.vx, sauce.vz)).toBeCloseTo(BURGER_SAUCE_SPEED, 1);
  });

  it("spawns rotting sludge puddle floor hazard when dying", () => {
    expect(state.floorFx.length).toBe(0);

    triggerBurgerRot(5, 8);

    expect(state.floorFx.length).toBe(1);
    const rot = state.floorFx[0];
    expect(rot.kind).toBe("rot");
    expect(rot.x).toBe(5);
    expect(rot.z).toBe(8);
    expect(rot.radius).toBe(BURGER_ROT_RADIUS);
    expect(rot.life).toBe(BURGER_ROT_LIFE);
    expect(rot.maxLife).toBe(BURGER_ROT_LIFE);
  });

  it("renders procedural fallback paints without crashing", () => {
    const paints = makeBurgerPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    const s = paints.S!;
    expect(s.idle.length).toBeGreaterThan(0);
    expect(s.walk.length).toBeGreaterThan(0);
    expect(s.attack.length).toBeGreaterThan(0);
    expect(s.death.length).toBeGreaterThan(0);

    // Check that canvas frame paint executes
    const mockCtx = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      ellipse: () => {},
      fill: () => {},
      stroke: () => {},
      fillRect: () => {},
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    } as any;

    expect(() => s.idle[0](mockCtx)).not.toThrow();
    expect(() => s.attack[0](mockCtx)).not.toThrow();
    expect(() => s.death[0](mockCtx)).not.toThrow();
  });
});
