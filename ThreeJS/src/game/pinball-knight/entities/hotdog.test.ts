import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../state";
import {
  HOTDOG_HP,
  HOTDOG_R,
  HOTDOG_SPEED_FACTOR,
  HOTDOG_DAMAGE,
  HOTDOG_FIRE_RANGE,
  HOTDOG_KITE_RANGE,
  HOTDOG_MUSTARD_SPEED,
  HOTDOG_MUSTARD_SLICK_TIME,
  HOTDOG_MUSTARD_RADIUS,
  HOTDOG_MUSTARD_LIFE,
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
import { launchMustardStream } from "./projectiles";
import { triggerHotdogMustardSplatter } from "./combat";
import { installGameplayWiring } from "../boot/wiring";
import { makeHotdogPaints } from "../render/monsters/hotdog";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Hotdog Monster — Franken-Frank Ballpark Wiener Brawler", () => {
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

  it("registers hotdog as a first-class native sprite sheet", () => {
    expect(hasAuthoredFacing("hotdog", "S")).toBe(true);
    expect(IMPORTED_FACINGS.hotdog).toEqual(["S"]);
    expect(IMPORTED_ART.hotdog).toBe("hotdog");
    expect(sheetKeyForKind("hotdog")).toBe("hotdog");
    expect(KIND_SKIN.hotdog?.scale).toBe(1.05);

    // Has procedural fallback and portrait paints
    expect(SHEET_PAINTERS.hotdog).toBe(makeHotdogPaints);
    expect(KIND_PAINTS.hotdog).toBeDefined();
  });

  it("has published sprite-sheet json and png artifacts on disk", () => {
    const jsonPath = resolve(__dirname, "../../../../public/sprites/hotdog-S.json");
    const pngPath = resolve(__dirname, "../../../../public/sprites/hotdog-S.png");

    expect(existsSync(jsonPath), "hotdog-S.json must exist").toBe(true);
    expect(existsSync(pngPath), "hotdog-S.png must exist").toBe(true);

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
    const info = KIND_INFO.hotdog;
    expect(info).toBeDefined();
    expect(info.label).toBe("Franken-Frank");
    expect(info.blurb).toContain("ballpark frankfurter");

    const bestiaryEntry = buildBestiary().find((e) => e.kind === "hotdog");
    expect(bestiaryEntry).toBeDefined();
    expect(bestiaryEntry!.drops.length).toBeGreaterThan(0);

    // Reagent drops
    expect(ENEMY_DROPS.hotdog).toBeDefined();
    expect(ENEMY_DROPS.hotdog.length).toBeGreaterThan(0);

    // Movement & Stagger rules
    expect(MOVEMENT_BY_KIND.hotdog).toBe("kite");
    expect(PAIN_BY_KIND.hotdog).toBe(0.45);

    // Balanced stats
    expect(HOTDOG_HP).toBe(5);
    expect(HOTDOG_R).toBe(0.38);
    expect(HOTDOG_DAMAGE).toBe(1);
    expect(HOTDOG_SPEED_FACTOR).toBe(0.90);
    expect(HOTDOG_FIRE_RANGE).toBe(6.2);
    expect(HOTDOG_KITE_RANGE).toBe(3.5);
  });

  it("launches high-pressure mustard glob projectiles with velocity and damage", () => {
    expect(state.projectiles.length).toBe(0);

    launchMustardStream(5, 10, 1, 0);

    expect(state.projectiles.length).toBeGreaterThanOrEqual(2);

    for (const p of state.projectiles) {
      expect(p.kind).toBe("mustard_glob");
      expect(p.damage).toBe(HOTDOG_DAMAGE);
      const speed = Math.hypot(p.vx, p.vz);
      expect(speed).toBeGreaterThan(0);
    }
  });

  it("spawns mustard slick puddle floor hazard when dying", () => {
    expect(state.floorFx.length).toBe(0);

    triggerHotdogMustardSplatter(4, 7);

    expect(state.floorFx.length).toBe(1);
    const puddle = state.floorFx[0];
    expect(puddle.kind).toBe("mustard");
    expect(puddle.x).toBe(4);
    expect(puddle.z).toBe(7);
    expect(puddle.radius).toBe(HOTDOG_MUSTARD_RADIUS);
    expect(puddle.life).toBe(HOTDOG_MUSTARD_LIFE);
    expect(puddle.maxLife).toBe(HOTDOG_MUSTARD_LIFE);
  });

  it("renders procedural fallback paints without crashing", () => {
    const paints = makeHotdogPaints();
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
