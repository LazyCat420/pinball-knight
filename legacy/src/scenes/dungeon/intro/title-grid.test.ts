import { describe, it, expect } from "vitest";
import { buildTitleGrid, stepIntroBall, TITLE_FONT, GLYPH_H, INTRO_BALL_SPEED, INTRO_BALL_R, type IntroBall } from "./title-grid";
import { T_WALL, T_FLOOR, at, isWalkable, type Grid } from "../maze/generator";
import { circleCollides } from "../collision";

function ascii(g: Grid): string {
  let out = "";
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) out += at(g, i, j) === T_WALL ? "#" : ".";
    out += "\n";
  }
  return out;
}

describe("intro title grid", () => {
  const layout = buildTitleGrid();
  const g = layout.grid;

  it("seals the border completely", () => {
    for (let i = 0; i < g.w; i++) {
      expect(at(g, i, 0)).toBe(T_WALL);
      expect(at(g, i, g.h - 1)).toBe(T_WALL);
    }
    for (let j = 0; j < g.h; j++) {
      expect(at(g, 0, j)).toBe(T_WALL);
      expect(at(g, g.w - 1, j)).toBe(T_WALL);
    }
  });

  it("stamps the P of PINBALL exactly where the layout says", () => {
    const glyph = TITLE_FONT.P;
    const { i: i0, j: j0 } = layout.topWordOrigin;
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < glyph[r].length; c++) {
        const want = glyph[r][c] === "#" ? T_WALL : T_FLOOR;
        expect(at(g, i0 + c, j0 + r), `P glyph tile (${c},${r})\n${ascii(g)}`).toBe(want);
      }
    }
  });

  it("stamps the T of KNIGHT at the bottom word origin", () => {
    // T is the last letter — walk the origins forward across K,N,I,G,H.
    let i0 = layout.bottomWordOrigin.i;
    for (const ch of "KNIGH") i0 += TITLE_FONT[ch][0].length + 1;
    const glyph = TITLE_FONT.T;
    const j0 = layout.bottomWordOrigin.j;
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < glyph[r].length; c++) {
        const want = glyph[r][c] === "#" ? T_WALL : T_FLOOR;
        expect(at(g, i0 + c, j0 + r), `T glyph tile (${c},${r})`).toBe(want);
      }
    }
  });

  it("spawns the ball on clear floor with room to move", () => {
    expect(circleCollides(g, layout.spawn.x, layout.spawn.z, INTRO_BALL_R)).toBe(false);
    const ti = Math.floor(layout.spawn.x + g.w / 2);
    const tj = Math.floor(layout.spawn.z + g.h / 2);
    expect(isWalkable(g, ti, tj)).toBe(true);
  });

  it("keeps letter strokes one tile thick like real maze walls", () => {
    // Sanity on the font itself: every glyph is 5 rows, only #/. characters.
    for (const [ch, rows] of Object.entries(TITLE_FONT)) {
      expect(rows.length, ch).toBe(GLYPH_H);
      const w = rows[0].length;
      for (const row of rows) {
        expect(row.length, `${ch} row width`).toBe(w);
        expect(row).toMatch(/^[#.]+$/);
      }
    }
  });
});

describe("intro ricochet soak", () => {
  it("bounces for a full minute without escaping, sticking, or losing speed", () => {
    const layout = buildTitleGrid();
    const g = layout.grid;
    const b: IntroBall = { x: layout.spawn.x, z: layout.spawn.z, vx: 0.84, vz: 0.55 };
    const n = Math.hypot(b.vx, b.vz);
    b.vx = (b.vx / n) * INTRO_BALL_SPEED;
    b.vz = (b.vz / n) * INTRO_BALL_SPEED;

    let bounces = 0;
    let lastX = b.x;
    let lastZ = b.z;
    let stillFrames = 0;
    for (let step = 0; step < 120 * 60; step++) {
      if (stepIntroBall(g, b, 1 / 120)) bounces++;
      // Never inside a wall, never outside the arena.
      expect(circleCollides(g, b.x, b.z, INTRO_BALL_R * 0.95)).toBe(false);
      expect(Math.abs(b.x)).toBeLessThan(g.w / 2);
      expect(Math.abs(b.z)).toBeLessThan(g.h / 2);
      // Constant energy.
      expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(INTRO_BALL_SPEED, 5);
      // Not wedged in place.
      if (Math.hypot(b.x - lastX, b.z - lastZ) < 1e-4) stillFrames++;
      else stillFrames = 0;
      expect(stillFrames).toBeLessThan(10);
      lastX = b.x;
      lastZ = b.z;
    }
    expect(bounces).toBeGreaterThan(30);
  });
});
