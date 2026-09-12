/**
 * THE DESCENT LABYRINTH — the two things about it that can silently be wrong.
 *
 * 1. THE ROUTE MUST RUN DOWN CORRIDORS. The thread is stroked between cell
 *    centres, so a route that steps between two cells with a wall between them
 *    draws a gold line straight THROUGH a wall. Nothing throws, the screen
 *    still looks busy, and it is the kind of thing you only notice in a
 *    screenshot somebody else takes. Asserted directly: every consecutive pair
 *    on the path is adjacent, and the wall between them is carved.
 *
 * 2. EVERY PAINTED COLOUR MUST BE A PALETTE ENTRY. This is the bug the screen
 *    shipped with for months. The old labyrinth drew translucent navy over
 *    black; the pass snaps the UI to 32 colours, that composite landed nearest
 *    VOID, and the most expensive thing on the screen was invisible. A
 *    translucent fill is not "a dimmer version of the colour" here — it is a
 *    different palette entry, or none. So the layers are scanned pixel by pixel
 *    and every colour in them must be an exact entry, which is the property
 *    that makes the art's dimming survive to the display.
 *
 * DOM-free vitest environment, so `document` is shimmed with node-canvas — the
 * same trick `load-warmup.test.ts` and `render/monster-portrait.test.ts` use.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { weaveMaze, paintMazeArt, N, E, S, W } from "./loading-maze";
import { PALETTE_HEX } from "../../render/palette";

const realDoc = (globalThis as { document?: unknown }).document;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(8, 8) : {}),
    head: { appendChild: () => {} },
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

/** A deterministic stand-in for Math.random, so a failure can be re-run. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const BIT: Record<number, { dx: number; dy: number }> = { [N]: { dx: 0, dy: -1 }, [E]: { dx: 1, dy: 0 }, [S]: { dx: 0, dy: 1 }, [W]: { dx: -1, dy: 0 } };

describe("weaveMaze", () => {
  it("connects every cell (nothing is walled off)", () => {
    const { cols, rows, walls } = weaveMaze(21, 13, seeded(7));
    const seen = new Uint8Array(cols * rows);
    const queue = [0];
    seen[0] = 1;
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      const cx = c % cols;
      const cy = (c / cols) | 0;
      for (const bit of [N, E, S, W]) {
        if (walls[c] & bit) continue;
        const nx = cx + BIT[bit].dx;
        const ny = cy + BIT[bit].dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (seen[n]) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    expect(queue.length).toBe(cols * rows);
  });

  it("agrees with itself about every shared wall", () => {
    // A carve that knocks down one side only leaves a corridor you can walk
    // into and not out of — invisible in the art, and it would let the solver
    // return a route the drawn maze contradicts.
    const { cols, rows, walls } = weaveMaze(17, 11, seeded(11));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const a = y * cols + x;
        expect(!!(walls[a] & E)).toBe(!!(walls[a + 1] & W));
      }
    }
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols; x++) {
        const a = y * cols + x;
        expect(!!(walls[a] & S)).toBe(!!(walls[a + cols] & N));
      }
    }
  });

  it("solves left edge to right edge, and never steps through a wall", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { cols, rows, walls, path } = weaveMaze(23, 15, seeded(seed));
      expect(path.length).toBeGreaterThan(cols); // it has to cross the field
      expect(path[0] % cols).toBe(0);
      expect(path[path.length - 1] % cols).toBe(cols - 1);
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const dx = (b % cols) - (a % cols);
        const dy = ((b / cols) | 0) - ((a / cols) | 0);
        expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
        const bit = dx === 1 ? E : dx === -1 ? W : dy === 1 ? S : N;
        expect(walls[a] & bit).toBe(0);
      }
      expect(rows).toBe(15);
    }
  });

  it("punches chambers — open cells the corridors do not have", () => {
    // A chamber is the only way a cell loses three or four of its walls, so
    // counting those is a direct test that the rooms were cut. Without them the
    // field is a uniform one-cell weave, which is the "puzzle-book page" look
    // the chambers exist to break up.
    const { walls } = weaveMaze(40, 24, seeded(3));
    let open = 0;
    for (const bits of walls) {
      let n = 0;
      for (const bit of [N, E, S, W]) if (!(bits & bit)) n++;
      if (n >= 3) open++;
    }
    expect(open).toBeGreaterThan(8);
  });

  it("degrades rather than throws on a field too small to weave", () => {
    const tiny = weaveMaze(1, 1, seeded(1));
    expect(tiny.path.length).toBe(0);
    expect(() => weaveMaze(0, 0, seeded(1))).not.toThrow();
  });
});

describe("paintMazeArt", () => {
  it("paints ONLY exact palette entries, so the dimming survives the snap", () => {
    const art = paintMazeArt(320, 200, 24, seeded(9));
    const allowed = new Set(PALETTE_HEX);
    for (const layer of [art.cold, art.lit]) {
      const g = layer.getContext("2d");
      expect(g).toBeTruthy();
      const { data } = g!.getImageData(0, 0, layer.width, layer.height);
      const strays = new Map<number, number>();
      for (let i = 0; i < data.length; i += 4) {
        const hex = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        if (data[i + 3] !== 255) strays.set(-1, (strays.get(-1) ?? 0) + 1);
        else if (!allowed.has(hex)) strays.set(hex, (strays.get(hex) ?? 0) + 1);
      }
      expect([...strays.keys()].map((k) => k.toString(16))).toEqual([]);
    }
  });

  it("keeps the cell even and the route on cell centres", () => {
    // Odd cells put the centres on a half pixel, where a 2px gold line
    // antialiases into two brown ones under the palette snap.
    const art = paintMazeArt(400, 300, 25, seeded(4));
    expect(art.cell % 2).toBe(0);
    const half = art.cell >> 1;
    for (let i = 0; i < art.path.length; i += 2) {
      expect((art.path[i] - half) % art.cell).toBe(0);
      expect((art.path[i + 1] - half) % art.cell).toBe(0);
    }
  });

  it("runs the cumulative length monotonically to the end of the route", () => {
    const art = paintMazeArt(400, 300, 24, seeded(5));
    const count = art.path.length / 2;
    expect(art.run.length).toBe(count);
    expect(art.run[0]).toBe(0);
    for (let i = 1; i < count; i++) expect(art.run[i]).toBeGreaterThan(art.run[i - 1]);
  });

  it("covers the whole surface (no transparent slack for the scene to show through)", () => {
    // The backdrop is what makes this screen opaque over a half-built floor.
    const art = paintMazeArt(200, 120, 20, seeded(6));
    for (const layer of [art.cold, art.lit]) {
      const g = layer.getContext("2d")!;
      for (const [x, y] of [
        [0, 0],
        [layer.width - 1, 0],
        [0, layer.height - 1],
        [layer.width - 1, layer.height - 1],
      ]) {
        expect(g.getImageData(x, y, 1, 1).data[3]).toBe(255);
      }
    }
  });
});
