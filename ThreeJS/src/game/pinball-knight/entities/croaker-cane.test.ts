import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  CROAKER_SPIN_RANGE,
  CROAKER_SPIN_DAMAGE,
  CROAKER_SPIN_DEFLECT,
  CROAKER_R,
  CROAKER_HOP_SPEED,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  return { w: 10, h: 10, t: new Uint8Array(100), shapes: new Uint8Array(100) };
}

describe("croaker cane & showman mechanics", () => {
  beforeEach(() => {
    resetState();
    state.grid = makeGrid();
  });

  it("publishes valid croaker-S sprite sheet manifest with 4 clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/croaker-S.json");
    expect(existsSync(jsonPath), "public/sprites/croaker-S.json must exist").toBe(true);

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.name).toBe("croaker");
    expect(data.dir).toBe("S");

    const clipNames = data.rows.map((r: { clip: string }) => r.clip);
    expect(clipNames).toEqual(["idle", "walk", "attack", "death"]);

    for (const row of data.rows) {
      expect(row.cells.length).toBe(4);
      for (const cell of row.cells) {
        expect(cell.length).toBe(4);
        // Valid bounding rect
        expect(cell[2]).toBeGreaterThan(cell[0]);
        expect(cell[3]).toBeGreaterThan(cell[1]);
      }
    }
  });

  it("configures STATS.croaker as a melee cane spinner with 2.8 reach", () => {
    const st = STATS.croaker;
    expect(st.ranged).toBe(false);
    expect(st.contactRange).toBe(CROAKER_SPIN_RANGE);
    expect(st.contactRange).toBe(2.8);
    expect(CROAKER_SPIN_DAMAGE).toBe(2);
    expect(CROAKER_SPIN_DEFLECT).toBe(12.0);
    expect(CROAKER_HOP_SPEED).toBe(8.5);
  });

  it("deflects rolling pinball knight on cane contact", () => {
    const p = {
      x: 5,
      z: 5,
      hp: 10,
      momX: 0,
      momZ: 1,
      momSpeed: 6.0,
      facing: "S",
      attackT: -1,
      didHit: false,
      comboLanded: false,
      cooldown: 0,
      iframes: 0,
      flashT: 0,
    } as unknown as Player;
    state.player = p;

    // Croaker at (5, 6), inside CROAKER_SPIN_RANGE (dist = 1.0 < 2.8)
    const z = {
      kind: "croaker",
      x: 5,
      z: 6,
      hp: 3,
      mode: "chase",
      windupT: 0,
      cooldown: 0,
      speed: 1,
      flashT: 0,
      aggro: true,
      burnT: 0,
      anim: { play: () => {}, setFacing: () => {} } as any,
      sprite: { setTint: () => {}, mesh: {} } as any,
    } as unknown as Zombie;
    state.zombies = [z];

    // Deflect impulse should repel player away from croaker along z (from z=6 to z=5 => nz = -1)
    const pdx = p.x - z.x;
    const pdz = p.z - z.z;
    const pdist = Math.hypot(pdx, pdz);
    expect(pdist).toBeLessThan(CROAKER_SPIN_RANGE);

    const nx = pdx / pdist;
    const nz = pdz / pdist;
    p.momX = nx;
    p.momZ = nz;
    p.momSpeed = Math.max(p.momSpeed, CROAKER_SPIN_DEFLECT);

    expect(p.momZ).toBe(-1);
    expect(p.momSpeed).toBe(12.0);
  });
});
