import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS, platypusTailSlam } from "./zombie";
import {
  PLATYPUS_CONTACT_RANGE,
  PLATYPUS_DAMAGE,
  PLATYPUS_SLAM_RADIUS,
  PLATYPUS_SLAM_DEFLECT,
  PLATYPUS_HP,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  return { w: 10, h: 10, t: new Uint8Array(100), shapes: new Uint8Array(100) };
}

describe("iron platypus tail slam & ground cracks mechanics", () => {
  beforeEach(() => {
    resetState();
    state.grid = makeGrid();
    state.scene = { add() {}, remove() {} } as unknown as typeof state.scene;
    state.dbgMaterialFloorFx = true;
    state.floorFx = [];
  });

  it("publishes valid platypus-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/platypus-S.json");
    expect(existsSync(jsonPath), "public/sprites/platypus-S.json must exist").toBe(true);

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.name).toBe("platypus");
    expect(data.dir).toBe("S");

    const clipNames = data.rows.map((r: { clip: string }) => r.clip);
    expect(clipNames).toEqual(["idle", "walk", "attack", "death"]);
    expect(data.rows.length).toBe(4);

    for (const row of data.rows) {
      expect(row.cells.length).toBe(4);
      for (const cell of row.cells) {
        expect(cell.length).toBe(4);
        // Valid bounding rect: x2 > x1 and y2 > y1
        expect(cell[2]).toBeGreaterThan(cell[0]);
        expect(cell[3]).toBeGreaterThan(cell[1]);
      }
    }
  });

  it("configures STATS.platypus with 8 HP, 2.6 contact range and melee quadruped stance", () => {
    const st = STATS.platypus;
    expect(st.ranged).toBe(false);
    expect(st.contactRange).toBe(PLATYPUS_CONTACT_RANGE);
    expect(st.contactRange).toBe(2.6);
    expect(PLATYPUS_HP).toBe(8);
    expect(PLATYPUS_DAMAGE).toBe(2);
    expect(PLATYPUS_SLAM_RADIUS).toBe(2.4);
    expect(PLATYPUS_SLAM_DEFLECT).toBe(10.0);
  });

  it("executes platypusTailSlam creating screen shake, 6 radiating groove cracks, and player deflection", () => {
    const p = {
      x: 5,
      z: 6,
      hp: 10,
      momX: 0,
      momZ: 1,
      momSpeed: 4.0,
      facing: "S",
      attackT: -1,
      didHit: false,
      comboLanded: false,
      cooldown: 0,
      iframes: 0,
      flashT: 0,
      sprite: { setTint: () => {}, mesh: { position: { set: () => {} } } },
    } as unknown as Player;
    state.player = p;

    let playedAnim = "";
    const platypus = {
      kind: "platypus",
      x: 5,
      z: 5,
      hp: 8,
      mode: "chase",
      windupT: 0,
      cooldown: 0,
      speed: 1,
      flashT: 0,
      aggro: true,
      burnT: 0,
      anim: {
        play: (anim: string) => {
          playedAnim = anim;
        },
        setFacing: () => {},
      } as any,
      sprite: { setTint: () => {}, mesh: {} } as any,
    } as unknown as Zombie;
    state.zombies = [platypus];

    // Execute the tail slam!
    platypusTailSlam(platypus, 1.0, PLATYPUS_CONTACT_RANGE);

    // 1. Attack animation played
    expect(playedAnim).toBe("attack");

    // 2. Heavy screen shake triggered
    expect(state.shakeT).toBeGreaterThanOrEqual(0.35);

    // 3. Radiating floor cracks spawned in state.floorFx
    expect(state.floorFx.length).toBe(6);
    for (const fx of state.floorFx) {
      expect(fx.kind).toBe("groove");
      expect(fx.life).toBeGreaterThan(0);
    }

    // 4. Player hit and deflected along +z (from z=5 to z=6 => nz = 1)
    expect(p.hp).toBe(10 - PLATYPUS_DAMAGE);
    expect(p.momZ).toBe(1);
    expect(p.momSpeed).toBe(PLATYPUS_SLAM_DEFLECT);
  });
});
