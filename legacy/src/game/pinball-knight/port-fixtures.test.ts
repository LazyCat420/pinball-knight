/**
 * PORT-PARITY FIXTURES — the TS side of the Rust port's oracle harness.
 *
 * This test computes golden traces with the REAL legacy engine code and pins
 * them against JSON fixtures committed under <repo>/assets/fixtures/. The
 * Rust port replays the same fixtures and must match BIT-EXACTLY (f64).
 *
 *   - Run normally: recomputes and asserts the committed fixture still
 *     matches — so drift on the TS side is caught too.
 *   - RUN_EXPORT=1: (re)writes the fixture files.
 *
 * Rust twin: crates/pk-core/tests/movement_trace.rs. If either side fails,
 * fix the PORT, never the pins — a pin change is only legitimate when the
 * legacy behavior itself intentionally changed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../../utils/rng";
import { type Grid, T_WALL, T_FLOOR, setTile, setShape, ensureArcs } from "./engine/grid";
import { SHAPE_ARC, SHAPE_ROUND_NE, SHAPE_SLANT_NE } from "./engine/tile-shape";
import { moveCircle } from "./engine/collision";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../assets/fixtures",
);

/** Mirror of pk_core::state::demo_floor — same RNG call order, exactly. */
function demoFloor(seed: number): { g: Grid; spawn: [number, number] } {
  const w = 25;
  const h = 25;
  const t = new Uint8Array(w * h).fill(T_WALL);
  const g: Grid = { w, h, t, shapes: new Uint8Array(w * h) };
  const rng = mulberry32(seed);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) t[j * w + i] = T_FLOOR;
  for (let j = 2; j < h - 2; j++) {
    for (let i = 2; i < w - 2; i++) {
      const centre = Math.abs(i - Math.trunc(w / 2)) <= 2 && Math.abs(j - Math.trunc(h / 2)) <= 2;
      if (centre) continue;
      if (rng() < 0.1) t[j * w + i] = T_WALL;
    }
  }
  // ── Shaped court — mirrors pk_core::state::demo_floor line for line.
  setTile(g, 6, 12, T_WALL);
  setShape(g, 6, 12, SHAPE_SLANT_NE);
  setTile(g, 5, 12, T_WALL); // west backing leg
  setTile(g, 6, 13, T_WALL); // south backing leg
  setTile(g, 17, 12, T_WALL);
  setShape(g, 17, 12, SHAPE_ROUND_NE);
  setTile(g, 16, 12, T_WALL);
  setTile(g, 17, 13, T_WALL);
  ensureArcs(g);
  g.arcs!.push({
    cx: 18,
    cz: 18,
    r: 3,
    a0: 0,
    span: Math.PI / 2,
    lanes: [{ a0: 0, span: Math.PI / 2, cw: true, cooldownT: 0, hitT: -1 }],
  });
  for (let j = 18; j <= 21; j++) {
    for (let i = 18; i <= 21; i++) {
      const d = Math.hypot(i + 0.5 - 18, j + 0.5 - 18);
      if (d > 2 && d < 4) {
        setTile(g, i, j, T_WALL);
        setShape(g, i, j, SHAPE_ARC);
        g.arcIdx![j * w + i] = 0;
      }
    }
  }
  const spawn: [number, number] = [
    Math.trunc(w / 2) + 0.5 - w / 2,
    Math.trunc(h / 2) + 0.5 - h / 2,
  ];
  return { g, spawn };
}

/** Mirror of pk_core::state::simulate's movement (sqrt-normalized intent). */
const PLAYER_SPEED = 4.2;
const PLAYER_R = 0.3;
const DT = 1 / 60;

/** 8 directions × 75 ticks = 600 ticks of walking into pillars and borders. */
function spiralDir(tick: number): [number, number] {
  const DIRS: Array<[number, number]> = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  return DIRS[Math.trunc(tick / 75)];
}

/** Routed through the shaped court: slant → round → arc guide. The Rust twin
 * (movement_trace.rs shaped_dir) must mirror these thresholds exactly. */
function shapedDir(tick: number): [number, number] {
  if (tick < 120) return [-1, 0]; // west into the slant court
  if (tick < 200) return [-1, 1]; // press into the diagonal
  if (tick < 350) return [1, 0]; // east across to the round corner
  if (tick < 450) return [1, 1]; // southeast into the arc guide
  return [0, 1]; // south along it
}

function trace(
  seed: number,
  dirAt: (tick: number) => [number, number],
): { seed: number; ticks: number; positions: Array<[number, number]> } {
  const { g, spawn } = demoFloor(seed);
  let [x, z] = spawn;
  const positions: Array<[number, number]> = [];
  for (let tick = 0; tick < 600; tick++) {
    const [ix, iz] = dirAt(tick);
    const len = Math.sqrt(ix * ix + iz * iz);
    const mx = ix / len;
    const mz = iz / len;
    const r = moveCircle(g, x, z, PLAYER_R, mx * PLAYER_SPEED * DT, mz * PLAYER_SPEED * DT);
    x = r.x;
    z = r.z;
    positions.push([x, z]);
  }
  return { seed, ticks: 600, positions };
}

function pinFixture(name: string, computed: unknown): void {
  const file = join(FIXTURE_DIR, name);
  if (process.env.RUN_EXPORT === "1" || !existsSync(file)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(computed));
  }
  expect(computed).toEqual(JSON.parse(readFileSync(file, "utf8")));
}

describe("port-parity fixtures", () => {
  it("movement trace (seed 7) matches the committed fixture", () => {
    pinFixture("movement-trace-seed7.json", trace(7, spiralDir));
  });

  it("shaped trace (slant + round + arc, seed 7) matches the committed fixture", () => {
    pinFixture("shaped-trace-seed7.json", trace(7, shapedDir));
  });
});
