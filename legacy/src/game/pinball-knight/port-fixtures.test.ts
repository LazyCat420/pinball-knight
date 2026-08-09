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
import { type Grid, T_WALL, T_FLOOR } from "./engine/grid";
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
const DIRS: Array<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

function trace(seed: number): { seed: number; ticks: number; positions: Array<[number, number]> } {
  const { g, spawn } = demoFloor(seed);
  let [x, z] = spawn;
  const positions: Array<[number, number]> = [];
  for (let tick = 0; tick < 600; tick++) {
    const [ix, iz] = DIRS[Math.trunc(tick / 75)];
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

describe("port-parity fixtures", () => {
  it("movement trace (seed 7) matches the committed fixture", () => {
    const computed = trace(7);
    const file = join(FIXTURE_DIR, "movement-trace-seed7.json");
    if (process.env.RUN_EXPORT === "1" || !existsSync(file)) {
      mkdirSync(FIXTURE_DIR, { recursive: true });
      writeFileSync(file, JSON.stringify(computed));
    }
    const committed = JSON.parse(readFileSync(file, "utf8"));
    expect(computed).toEqual(committed);
  });
});
