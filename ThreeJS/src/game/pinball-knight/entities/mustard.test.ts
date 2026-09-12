import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../state";
import {
  MUSTARD_HP,
  MUSTARD_R,
  MUSTARD_SPEED_FACTOR,
  MUSTARD_DAMAGE,
  MUSTARD_FIRE_RANGE,
  MUSTARD_KITE_RANGE,
  MUSTARD_JET_SPEED,
  MUSTARD_PUDDLE_RADIUS,
  MUSTARD_PUDDLE_LIFE,
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
import { launchMustardJets } from "./projectiles";
import { triggerMustardDeath } from "./combat";
import { installGameplayWiring } from "../boot/wiring";
import { makeMustardPaints } from "../render/monsters/mustard";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Mustard Monster — Colonel Dijon High-Pressure Squeeze Bottle", () => {
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

  it("registers mustard as a first-class native sprite sheet", () => {
    expect(hasAuthoredFacing("mustard", "S")).toBe(true);
    expect(IMPORTED_FACINGS.mustard).toEqual(["S"]);
    expect(IMPORTED_ART.mustard).toBe("mustard");
    expect(sheetKeyForKind("mustard")).toBe("mustard");
    expect(KIND_SKIN.mustard?.scale).toBe(1.0);

    // Has procedural fallback and portrait paints
    expect(SHEET_PAINTERS.mustard).toBe(makeMustardPaints);
    expect(KIND_PAINTS.mustard).toBeDefined();
  });

  it("has published sprite-sheet json and png artifacts on disk", () => {
    const jsonPath = resolve(__dirname, "../../../../public/sprites/mustard-S.json");
    const pngPath = resolve(__dirname, "../../../../public/sprites/mustard-S.png");

    expect(existsSync(jsonPath), "mustard-S.json must exist").toBe(true);
    expect(existsSync(pngPath), "mustard-S.png must exist").toBe(true);

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
    const info = KIND_INFO.mustard;
    expect(info).toBeDefined();
    expect(info.label).toBe("Colonel Dijon");
    expect(info.blurb).toContain("squeeze bottle");

    const bestiaryEntry = buildBestiary().find((e) => e.kind === "mustard");
    expect(bestiaryEntry).toBeDefined();
    expect(bestiaryEntry!.drops.length).toBeGreaterThan(0);

    // Reagent drops
    expect(ENEMY_DROPS.mustard).toBeDefined();
    expect(ENEMY_DROPS.mustard.length).toBeGreaterThan(0);

    // Movement & Stagger rules
    expect(MOVEMENT_BY_KIND.mustard).toBe("kite");
    expect(PAIN_BY_KIND.mustard).toBe(0.45);

    // Balanced stats
    expect(MUSTARD_HP).toBe(4);
    expect(MUSTARD_R).toBe(0.36);
    expect(MUSTARD_DAMAGE).toBe(1);
    expect(MUSTARD_SPEED_FACTOR).toBe(1.05);
    expect(MUSTARD_FIRE_RANGE).toBe(6.4);
    expect(MUSTARD_KITE_RANGE).toBe(3.6);
    expect(MUSTARD_JET_SPEED).toBe(8.5);
  });

  it("launches high-pressure twin mustard jet projectiles with velocity and damage", () => {
    expect(state.projectiles.length).toBe(0);

    launchMustardJets(5, 10, 1, 0);

    expect(state.projectiles.length).toBe(2);

    for (const p of state.projectiles) {
      expect(p.kind).toBe("mustard_glob");
      expect(p.damage).toBe(MUSTARD_DAMAGE);
      const speed = Math.hypot(p.vx, p.vz);
      expect(speed).toBeGreaterThan(0);
    }
  });

  it("spawns slippery mustard puddle floor hazard when dying", () => {
    expect(state.floorFx.length).toBe(0);

    triggerMustardDeath(4, 7);

    expect(state.floorFx.length).toBe(1);
    const puddle = state.floorFx[0];
    expect(puddle.kind).toBe("mustard");
    expect(puddle.x).toBe(4);
    expect(puddle.z).toBe(7);
    expect(puddle.radius).toBe(MUSTARD_PUDDLE_RADIUS);
    expect(puddle.life).toBe(MUSTARD_PUDDLE_LIFE);
    expect(puddle.maxLife).toBe(MUSTARD_PUDDLE_LIFE);
  });

  it("renders procedural fallback paints without crashing", () => {
    const paints = makeMustardPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    const s = paints.S;
    expect(s).toBeDefined();
    if (!s) return;
    expect(s.idle?.length).toBeGreaterThan(0);
    expect(s.walk?.length).toBeGreaterThan(0);
    expect(s.attack?.length).toBeGreaterThan(0);
    expect(s.death?.length).toBeGreaterThan(0);

    // Check that canvas frame paint executes
    const mockCtx = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
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

    expect(() => s.idle?.[0](mockCtx)).not.toThrow();
    expect(() => s.attack?.[0](mockCtx)).not.toThrow();
    expect(() => s.death?.[0](mockCtx)).not.toThrow();
  });
});
