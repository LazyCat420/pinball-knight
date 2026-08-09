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
import { type Grid, T_WALL, T_FLOOR, setTile, setShape, ensureArcs, isWalkable, surfaceAt } from "./engine/grid";
import { SHAPE_ARC, SHAPE_ROUND_NE, SHAPE_SLANT_NE } from "./engine/tile-shape";
import { moveCircle, computeArcCorners } from "./engine/collision";
import { wallSurface, floorSurface } from "./engine/surfaces";
import { freshRail, holdStrength, tryCatchRail, stepRail, decayOverspeed } from "./entities/rail";
import { buildTitleGrid, stepIntroBall, INTRO_BALL_SPEED, type IntroBall } from "./intro/title-grid";
import { comboWindow, comboZone, comboCornerRestitution, comboCornerAdd, comboSpeedCeil, comboFrictionMul, type ComboZone } from "./entities/combo-curve";
import {
  OVERCHARGE_TIME,
  BALL_SPEED_MULT,
  FRENZY_BALL_SPEED_MULT,
  PINBALL_STEER,
  PINBALL_MAX_SPEED,
  PINBALL_WALL_RESTITUTION,
  PINBALL_FRICTION,
  FRICTION_OPEN,
  FRICTION_CORRIDOR,
  FRICTION_TIGHT,
  LANE_CENTER_PULL,
  LANE_PROBE_MAX,
  PINBALL_EXIT_MULT,
  POCKET_RADIUS,
  POCKET_BOUNCES,
  POCKET_DAMP,
  POCKET_WINDOW,
  ARC_LANE_MULT,
  ARC_LANE_ADD,
  ARC_LANE_MIN_EXIT,
  ARC_LANE_MIN_SPEED,
  ARC_LANE_COOLDOWN,
  ARC_KICK_MULT,
  ARC_KICK_ADD,
  ARC_KICK_MIN_EXIT,
  ARC_KICK_MIN_SPEED,
  ARC_KICK_COOLDOWN,
  ARC_BANK_RADIUS,
  ARC_BOOST,
  ARC_COOLDOWN,
  ARC_MIN_SPEED,
} from "./constants";

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

/**
 * PINBALL TRACE — the momentum ride at pinball speeds, through the shaped
 * court: launch west into the slant, ricochet, steer across to the round
 * corner and down into the arc guide's booster lane.
 *
 * Mirrors pk_core::state::simulate + pinball::update_pinball's ORDER OF
 * OPERATIONS, calling the REAL legacy pieces for every formula: moveCircle,
 * the rail state machine, the combo curve, the surfaces tables and
 * computeArcCorners. The orchestration itself is the mirrored artifact (same
 * compromise as booster-corner-sim's loop, documented there); the Rust twin
 * is crates/pk-core/tests/pinball_trace.rs. No Math.random is reachable on
 * this floor (no parts, no kick bands), so the trace is deterministic.
 */
function pinballSteer(tick: number): [number, number] {
  if (tick < 120) return [0, 0]; // ballistic into the slant court
  if (tick < 240) return [1, 1]; // bend southeast off the ricochet
  if (tick < 400) return [1, 0]; // run east toward the guide
  return [0, 1]; // press south into the arc lane
}

function pinballTrace(seed: number): {
  seed: number;
  ticks: number;
  launch: { momX: number; momZ: number; momSpeed: number };
  positions: Array<[number, number, number]>;
} {
  const { g, spawn } = demoFloor(seed);
  const arcCorners = computeArcCorners(g);
  const p = {
    x: spawn[0],
    z: spawn[1],
    momX: -1,
    momZ: 0,
    momSpeed: 18,
    bounceCombo: 0,
    bounceComboT: 0,
    overcharge: 0,
    oilT: 0,
    turboT: 0,
    springT: 0,
    steerLockT: 0,
    grabT: 0,
    rail: freshRail(),
  };
  let comboZoneState: ComboZone = "launch";
  let pocketAX = 0;
  let pocketAZ = 0;
  let pocketN = 0;
  let pocketT = 0;
  const notePocketBounce = (): void => {
    if (pocketT > 0 && Math.hypot(p.x - pocketAX, p.z - pocketAZ) < POCKET_RADIUS) {
      pocketN++;
      if (pocketN > POCKET_BOUNCES) p.momSpeed *= POCKET_DAMP;
    } else {
      pocketAX = p.x;
      pocketAZ = p.z;
      pocketN = 1;
    }
    pocketT = POCKET_WINDOW;
  };
  const wallClearance = (dirX: number, dirZ: number): number => {
    for (let d = PLAYER_R; d <= LANE_PROBE_MAX; d += 0.12) {
      const i = Math.floor(p.x + dirX * d + g.w / 2);
      const j = Math.floor(p.z + dirZ * d + g.h / 2);
      if (!isWalkable(g, i, j)) return d;
    }
    return LANE_PROBE_MAX;
  };

  const positions: Array<[number, number, number]> = [];
  for (let tick = 0; tick < 600; tick++) {
    const [inX, inZ] = pinballSteer(tick);
    // tick_parts: arc band timers (no parts on this floor).
    for (const arc of g.arcs ?? []) {
      for (const k of arc.kicks ?? []) {
        if (k.cooldownT > 0) k.cooldownT = Math.max(0, k.cooldownT - DT);
        if (k.hitT >= 0) k.hitT += DT;
      }
      for (const l of arc.lanes ?? []) {
        if (l.cooldownT > 0) l.cooldownT = Math.max(0, l.cooldownT - DT);
        if (l.hitT >= 0) l.hitT += DT;
      }
    }

    if (p.momSpeed > 0) {
      // ── update_pinball mirror ──
      const zone = comboZone(p.bounceCombo);
      if (zone !== comboZoneState) {
        const order = { launch: 0, cruise: 1, frenzy: 2 } as const;
        if (order[zone] > order[comboZoneState] && zone === "cruise") p.overcharge = 1;
        comboZoneState = zone;
      }
      const isBall = p.overcharge >= 1;
      const speedMul = isBall ? (zone === "frenzy" ? FRENZY_BALL_SPEED_MULT : BALL_SPEED_MULT) : 1;
      p.overcharge = Math.min(1, p.overcharge + DT / OVERCHARGE_TIME);

      p.steerLockT = Math.max(0, p.steerLockT - DT);
      const sti = Math.floor(p.x + g.w / 2);
      const stj = Math.floor(p.z + g.h / 2);
      const steerSurfMult = floorSurface(surfaceAt(g, sti, stj) as never).steerMult;
      let steerX = 0;
      let steerZ = 0;
      if (inX !== 0 || inZ !== 0) {
        const wl = Math.hypot(inX, inZ) || 1;
        steerX = inX / wl;
        steerZ = inZ / wl;
      }
      if (p.steerLockT <= 0 && (steerX !== 0 || steerZ !== 0)) {
        p.momX += steerX * PINBALL_STEER * steerSurfMult * DT;
        p.momZ += steerZ * PINBALL_STEER * steerSurfMult * DT;
        const ml = Math.hypot(p.momX, p.momZ) || 1;
        p.momX /= ml;
        p.momZ /= ml;
      }

      const step = p.momSpeed * speedMul * DT;
      const wantX = p.x + p.momX * step;
      const wantZ = p.z + p.momZ * step;
      const res = moveCircle(g, p.x, p.z, PLAYER_R, p.momX * step, p.momZ * step);
      const blockedX = Math.abs(res.x - wantX) > 1e-3;
      const blockedZ = Math.abs(res.z - wantZ) > 1e-3;
      p.x = res.x;
      p.z = res.z;

      if (p.steerLockT <= 0 && p.momSpeed > PLAYER_SPEED) {
        const alongX = Math.abs(p.momX) >= Math.abs(p.momZ);
        const perpX = alongX ? 0 : 1;
        const perpZ = alongX ? 1 : 0;
        const cp = wallClearance(perpX, perpZ);
        const cn = wallClearance(-perpX, -perpZ);
        const nearWall = cp < LANE_PROBE_MAX || cn < LANE_PROBE_MAX;
        const imbalance = cp - cn;
        if (nearWall && Math.abs(imbalance) > 0.12) {
          const steering = steerX !== 0 || steerZ !== 0;
          const strength = steering ? 0.45 : 1;
          const dir = Math.sign(imbalance);
          const nudge = Math.min(Math.abs(imbalance) * 0.5, LANE_CENTER_PULL * DT) * strength;
          const r2 = moveCircle(g, p.x, p.z, PLAYER_R, perpX * dir * nudge, perpZ * dir * nudge);
          p.x = r2.x;
          p.z = r2.z;
        }
      }

      pocketT = Math.max(0, pocketT - DT);

      let railContact = false;
      let railStrength = 0;
      let railTangent: { tx: number; tz: number } | null = null;

      if (res.hitN) {
        const nx = res.hitN.nx;
        const nz = res.hitN.nz;
        const vn = p.momX * nx + p.momZ * nz;
        if (res.hitLane?.concave) {
          const strength = holdStrength(steerX, steerZ, nx, nz);
          if (p.rail.featureIdx !== res.hitLane.featureIdx) {
            p.rail.featureIdx = -1;
            tryCatchRail(p.rail, res.hitLane.featureIdx, strength, p.momSpeed);
          }
          railContact = true;
          railStrength = strength;
          railTangent = { tx: res.hitLane.tx, tz: res.hitLane.tz };
        }
        const lane = res.hitLane && p.momSpeed >= ARC_LANE_MIN_SPEED && p.rail.featureIdx < 0 ? res.hitLane : null;
        if (lane) {
          p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed * ARC_LANE_MULT + ARC_LANE_ADD, ARC_LANE_MIN_EXIT));
          p.momX = lane.tx * p.momSpeed;
          p.momZ = lane.tz * p.momSpeed;
          lane.band.cooldownT = ARC_LANE_COOLDOWN;
          lane.band.hitT = 0;
          p.bounceCombo += 1;
          p.bounceComboT = comboWindow(p.bounceCombo);
          notePocketBounce();
        } else if (vn < 0) {
          p.momX -= 2 * vn * nx;
          p.momZ -= 2 * vn * nz;
          const kick = res.hitKick && p.momSpeed >= ARC_KICK_MIN_SPEED ? res.hitKick : null;
          if (kick) {
            // No kick bands on this floor — kept for order parity (dead here).
            p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed * ARC_KICK_MULT + ARC_KICK_ADD, ARC_KICK_MIN_EXIT));
            kick.cooldownT = ARC_KICK_COOLDOWN;
            kick.hitT = 0;
            p.bounceCombo += 1;
            p.bounceComboT = comboWindow(p.bounceCombo);
            notePocketBounce();
          } else {
            const surf = wallSurface(res.hitSurface);
            const rest = PINBALL_WALL_RESTITUTION * surf.flatRestMult;
            p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * rest + surf.bounceAdd);
            if (surf.breaksCombo) {
              p.bounceCombo = 0;
              p.bounceComboT = 0;
            } else {
              p.bounceCombo += surf.comboTicks;
              p.bounceComboT = comboWindow(p.bounceCombo);
            }
            notePocketBounce();
          }
        }
      } else if (blockedX || blockedZ) {
        if (blockedX) p.momX = -p.momX;
        if (blockedZ) p.momZ = -p.momZ;
        const corner = blockedX && blockedZ;
        const surf = wallSurface(res.hitSurface);
        const flatRest = PINBALL_WALL_RESTITUTION * surf.flatRestMult;
        if (corner) {
          const gain = Math.min(p.momSpeed * comboCornerRestitution(p.bounceCombo) + comboCornerAdd(p.bounceCombo), comboSpeedCeil(p.bounceCombo));
          const next = surf.cornerMult >= 1 ? Math.max(p.momSpeed, gain * surf.cornerMult) : gain * surf.cornerMult;
          p.momSpeed = Math.min(PINBALL_MAX_SPEED, next);
        } else {
          p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * flatRest + surf.bounceAdd);
        }
        if (surf.breaksCombo) {
          p.bounceCombo = 0;
          p.bounceComboT = 0;
        } else {
          p.bounceCombo += surf.comboTicks;
          p.bounceComboT = comboWindow(p.bounceCombo);
        }
        notePocketBounce();
      }

      {
        const stepR = stepRail(p.rail, railContact, railStrength, p.momSpeed, DT);
        if (stepR.riding && railTangent) {
          p.momSpeed = stepR.speed;
          p.momX = railTangent.tx;
          p.momZ = railTangent.tz;
        }
      }
      if (p.rail.featureIdx < 0) p.momSpeed = decayOverspeed(p.momSpeed, DT);

      // touchPinballParts: no parts on this floor. bankArcCorners:
      for (const arc of arcCorners) {
        if (arc.cooldownT > 0) {
          arc.cooldownT = Math.max(0, arc.cooldownT - DT);
          continue;
        }
        if (p.momSpeed < ARC_MIN_SPEED) continue;
        const dx = p.x - arc.cx;
        const dz = p.z - arc.cz;
        if (dx * dx + dz * dz > ARC_BANK_RADIUS * ARC_BANK_RADIUS) continue;
        const inFrom1 = p.momX * -arc.d1x + p.momZ * -arc.d1z;
        const inFrom2 = p.momX * -arc.d2x + p.momZ * -arc.d2z;
        if (inFrom1 < 0.3 && inFrom2 < 0.3) continue;
        if (inFrom1 >= inFrom2) {
          p.momX = arc.d2x;
          p.momZ = arc.d2z;
        } else {
          p.momX = arc.d1x;
          p.momZ = arc.d1z;
        }
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * ARC_BOOST);
        arc.cooldownT = ARC_COOLDOWN;
        arc.hitT = 0;
        p.bounceCombo += 1;
        p.bounceComboT = comboWindow(p.bounceCombo);
        break;
      }

      const ti = Math.floor(p.x + g.w / 2);
      const tj = Math.floor(p.z + g.h / 2);
      let openN = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (isWalkable(g, ti + di, tj + dj)) openN++;
      }
      const floorSurf = floorSurface(surfaceAt(g, ti, tj) as never);
      const surfMul = (openN >= 3 ? FRICTION_OPEN : openN === 2 ? FRICTION_CORRIDOR : FRICTION_TIGHT) * floorSurf.frictionMult;
      const friction = p.oilT > 0 || p.turboT > 0 ? 0 : PINBALL_FRICTION * surfMul * comboFrictionMul(p.bounceCombo);
      p.momSpeed = Math.max(0, p.momSpeed - friction * DT);
      p.bounceComboT = Math.max(0, p.bounceComboT - DT);
      if (p.bounceComboT <= 0) p.bounceCombo = 0;

      if (p.momSpeed < PLAYER_SPEED * PINBALL_EXIT_MULT) {
        p.momSpeed = 0;
        p.grabT = 0;
        p.bounceCombo = 0;
        p.bounceComboT = 0;
        p.overcharge = Math.min(p.overcharge, 0.999);
      }
    } else {
      // ── walking mirror (same as trace()) ──
      const len = Math.sqrt(inX * inX + inZ * inZ);
      if (len > 1e-6) {
        const r = moveCircle(g, p.x, p.z, PLAYER_R, (inX / len) * PLAYER_SPEED * DT, (inZ / len) * PLAYER_SPEED * DT);
        p.x = r.x;
        p.z = r.z;
      }
    }
    positions.push([p.x, p.z, p.momSpeed]);
  }
  return { seed, ticks: 600, launch: { momX: -1, momZ: 0, momSpeed: 18 }, positions };
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

  it("pinball trace (momentum ride at speed, seed 7) matches the committed fixture", () => {
    const t = pinballTrace(7);
    // The trace must actually exercise the machine, not just coast: the ride
    // must survive a while, bounce (speed changes), and end back at a walk.
    const speeds = t.positions.map((q) => q[2]);
    expect(Math.max(...speeds)).toBeGreaterThan(10);
    pinFixture("pinball-trace-seed7.json", t);
  });

  it("intro ball trace (title-maze ricochet) matches the committed fixture", () => {
    // 600 ticks at the intro's 120 Hz sub-step through buildTitleGrid — the
    // launch runPinballIntro gives the ball, verbatim. Rust twin:
    // crates/pk-core/tests/intro_trace.rs.
    const layout = buildTitleGrid();
    const b: IntroBall = { x: layout.spawn.x, z: layout.spawn.z, vx: 0.84, vz: 0.55 };
    const n = Math.hypot(b.vx, b.vz);
    b.vx = (b.vx / n) * INTRO_BALL_SPEED;
    b.vz = (b.vz / n) * INTRO_BALL_SPEED;
    const positions: number[][] = [];
    const bounceTicks: number[] = [];
    for (let t = 0; t < 600; t++) {
      if (stepIntroBall(layout.grid, b, 1 / 120)) bounceTicks.push(t);
      positions.push([b.x, b.z, b.vx, b.vz]);
    }
    // The trace must actually ricochet, not glide: several wall strikes in 5s.
    expect(bounceTicks.length).toBeGreaterThan(3);
    pinFixture("intro-ball-trace.json", { ticks: 600, positions, bounceTicks });
  });
});
