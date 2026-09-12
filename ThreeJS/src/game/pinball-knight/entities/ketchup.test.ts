import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../state";
import {
  KETCHUP_HP,
  KETCHUP_R,
  KETCHUP_SPEED_FACTOR,
  KETCHUP_DAMAGE,
  KETCHUP_FIRE_RANGE,
  KETCHUP_KITE_RANGE,
  KETCHUP_SPEED,
  KETCHUP_SLOW_TIME,
  KETCHUP_PUDDLE_RADIUS,
  KETCHUP_PUDDLE_LIFE,
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
import { launchKetchupSquirts } from "./projectiles";
import { triggerKetchupDeath } from "./combat";
import { installGameplayWiring } from "../boot/wiring";
import { makeKetchupPaints } from "../render/monsters/ketchup";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Ketchup Monster — Baron von Ketchup Squeeze Bottle Brawler", () => {
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

  it("registers ketchup as a first-class native sprite sheet", () => {
    expect(hasAuthoredFacing("ketchup", "S")).toBe(true);
    expect(IMPORTED_FACINGS.ketchup).toEqual(["S"]);
    expect(IMPORTED_ART.ketchup).toBe("ketchup");
    expect(sheetKeyForKind("ketchup")).toBe("ketchup");
    expect(KIND_SKIN.ketchup?.scale).toBe(1.0);

    // Has procedural fallback and portrait paints
    expect(SHEET_PAINTERS.ketchup).toBe(makeKetchupPaints);
    expect(KIND_PAINTS.ketchup).toBeDefined();
  });

  it("has published sprite-sheet json and png artifacts on disk", () => {
    const jsonPath = resolve(__dirname, "../../../../public/sprites/ketchup-S.json");
    const pngPath = resolve(__dirname, "../../../../public/sprites/ketchup-S.png");

    expect(existsSync(jsonPath), "ketchup-S.json must exist").toBe(true);
    expect(existsSync(pngPath), "ketchup-S.png must exist").toBe(true);

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
    const info = KIND_INFO.ketchup;
    expect(info).toBeDefined();
    expect(info.label).toBe("Baron von Ketchup");
    expect(info.blurb).toContain("squeeze bottle");

    const bestiaryEntry = buildBestiary().find((e) => e.kind === "ketchup");
    expect(bestiaryEntry).toBeDefined();
    expect(bestiaryEntry!.drops.length).toBeGreaterThan(0);

    // Reagent drops
    expect(ENEMY_DROPS.ketchup).toBeDefined();
    expect(ENEMY_DROPS.ketchup.length).toBeGreaterThan(0);

    // Movement & Stagger rules
    expect(MOVEMENT_BY_KIND.ketchup).toBe("kite");
    expect(PAIN_BY_KIND.ketchup).toBe(0.50);

    // Balanced stats
    expect(KETCHUP_HP).toBe(5);
    expect(KETCHUP_R).toBe(0.36);
    expect(KETCHUP_DAMAGE).toBe(1);
    expect(KETCHUP_SPEED_FACTOR).toBe(0.92);
    expect(KETCHUP_FIRE_RANGE).toBe(5.8);
    expect(KETCHUP_KITE_RANGE).toBe(3.2);
    expect(KETCHUP_SLOW_TIME).toBe(2.0);
  });

  it("launches high-velocity ketchup glob projectiles with velocity and damage", () => {
    expect(state.projectiles.length).toBe(0);

    launchKetchupSquirts(5, 10, 1, 0);

    expect(state.projectiles.length).toBe(3);

    for (const p of state.projectiles) {
      expect(p.kind).toBe("ketchup_glob");
      expect(p.damage).toBe(KETCHUP_DAMAGE);
      const speed = Math.hypot(p.vx, p.vz);
      expect(speed).toBeGreaterThan(0);
    }
  });

  it("spawns sticky ketchup puddle floor hazard when dying", () => {
    expect(state.floorFx.length).toBe(0);

    triggerKetchupDeath(4, 7);

    expect(state.floorFx.length).toBe(1);
    const puddle = state.floorFx[0];
    expect(puddle.kind).toBe("ketchup");
    expect(puddle.x).toBe(4);
    expect(puddle.z).toBe(7);
    expect(puddle.radius).toBe(KETCHUP_PUDDLE_RADIUS);
    expect(puddle.life).toBe(KETCHUP_PUDDLE_LIFE);
    expect(puddle.maxLife).toBe(KETCHUP_PUDDLE_LIFE);
  });

  it("renders procedural fallback paints without crashing", () => {
    const paints = makeKetchupPaints();
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
