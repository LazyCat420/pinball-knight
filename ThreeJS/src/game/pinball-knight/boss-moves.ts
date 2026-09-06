/**
 * THE BOSS ATTACK PRIMITIVES — six of them, shared by every boss.
 *
 * `boss-kinds.ts` says WHICH two a boss uses and with what numbers; this module
 * is HOW each one behaves. A fifth boss is a row in that table, not another
 * copy of a wind-up timer.
 *
 * ── EVERY ATTACK HAS A TELL ────────────────────────────────────────────────
 *
 * Not decoration — the design constraint. `ARPG_FEATURE_PLAN` ruled out dense
 * projectile patterns for this game because *"occluding isometric walls make
 * dense projectile patterns unreadable"*, and asked for TELEGRAPH QUALITY
 * instead. So each primitive below is a two-phase state machine: an `idle`
 * countdown, then a visible `windup`/`telegraph` during which the attack is
 * COMMITTED and readable, then the hit. Nothing here fires on a bare timer.
 *
 * The Reaper King's skull barrage did fire on a bare timer, for its whole
 * existence — `fireBone` straight off a 2.6 s countdown, no wind-up, no tint,
 * no clip. It was simultaneously his most frequent attack and his only
 * undodgeable one. `updateBarrage` is where that is fixed.
 *
 * ── SHAPE ──────────────────────────────────────────────────────────────────
 *
 * Each primitive owns a small mutable runtime record (`*Rt`), takes its spec
 * and a context, and mutates the world through the context's callbacks. No
 * primitive reads `state.player` directly: the boss picks the target (co-op
 * picks the NEAREST knight) and hands it down, so a primitive cannot disagree
 * with the boss about who it is aiming at.
 */
import * as THREE from "three";
import type { BarrageSpec, ChargeSpec, FanBoomerangSpec, NovaSpec, OrbitSpec, SlamSpec, SummonSpec, TeleportFireSpec } from "./boss-kinds";
import { state } from "./state";
import type { Grid } from "./maze/generator";
import { moveCircle } from "./engine/collision";
import { isWalkable, worldToTile } from "./maze/generator";
import { facingFromWorld } from "./entities/zombie";

/** What a primitive is allowed to know and do. */
export interface MoveCtx {
  dt: number;
  /** The boss's current world position. */
  x: number;
  z: number;
  /** The knight this boss is aiming at — nearest, in co-op. */
  target: { x: number; z: number };
  grid: Grid | null;
  bodyR: number;
  /** Damage the knight if they are within `r` of (x, z). Returns true on a hit. */
  hitAt(x: number, z: number, r: number, damage: number, launch: number): boolean;
  /** Move the boss. Used only by the charge and teleport. */
  moveTo(x: number, z: number): void;
  playAnim?(clip: string, opts?: { force?: boolean }): void;
  setFacing?(dir: "N" | "S" | "E" | "W"): void;
}

function add(mesh: THREE.Mesh): THREE.Mesh {
  state.scene?.add(mesh);
  return mesh;
}

export function disposeMesh(m: THREE.Mesh | null): void {
  if (!m) return;
  m.parent?.remove(m);
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}

/** A flat ring on the ground — the shared vocabulary for "this area is about to hurt". */
function groundRing(r: number, color: number, thickness = 0.1): THREE.Mesh {
  const geo = new THREE.RingGeometry(Math.max(0.01, r - r * thickness), r, 40);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.04;
  mesh.renderOrder = 5;
  return mesh;
}

/** Pulse a telegraph's opacity so a held tell still reads as urgent. */
function pulse(mesh: THREE.Mesh | null, t: number): void {
  if (!mesh) return;
  const m = mesh.material as THREE.MeshBasicMaterial;
  m.opacity = 0.35 + Math.abs(Math.sin(t * 10)) * 0.4;
}

// ── ORBIT ───────────────────────────────────────────────────────────────────
// Cosmetic, and the reason the barrage has ammo to throw. Purely visual state.

export interface Orbiter {
  mesh: THREE.Mesh;
  phase: number;
}

export function makeOrbiter(color: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.2, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 12;
  // Two hollow sockets so it reads as a skull, not a pearl.
  const eyeGeo = new THREE.SphereGeometry(0.055, 6, 5);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a0e12 });
  for (const dx of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(dx, 0.02, 0.17);
    mesh.add(eye);
  }
  return mesh;
}

export function syncOrbit(orbiters: Orbiter[], spec: OrbitSpec, x: number, z: number, t: number, y = 1.5): void {
  for (const o of orbiters) {
    const a = t + o.phase;
    o.mesh.position.set(x + Math.cos(a) * spec.radius, y + Math.sin(a * 2) * 0.12, z + Math.sin(a) * spec.radius);
  }
}

// ── PROJECTILES ─────────────────────────────────────────────────────────────

export interface BossShot {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  vx: number;
  vz: number;
  dist: number;
  damage: number;
  maxDist: number;
  slowFor: number;
}

const SHOT_Y = 1.5;
const SHOT_HIT_R = 0.55;

export function updateShots(shots: BossShot[], ctx: MoveCtx): void {
  for (let i = shots.length - 1; i >= 0; i--) {
    const b = shots[i];
    b.x += b.vx * ctx.dt;
    b.z += b.vz * ctx.dt;
    b.dist += Math.hypot(b.vx, b.vz) * ctx.dt;
    b.mesh.position.set(b.x, SHOT_Y, b.z);
    b.mesh.rotation.y += ctx.dt * 8;
    if (Math.random() < ctx.dt * 20) {
      state.vfx?.mote(b.x, SHOT_Y, b.z, 0xb06fe8);
    }
    const hit = ctx.hitAt(b.x, b.z, SHOT_HIT_R, b.damage, 0);
    if (hit) {
      state.vfx?.burst(b.x, SHOT_Y, b.z, 0xe8e2d0, 8, 4);
      // A web gob takes your MOMENTUM, which in this game is the real damage.
      // Deliberately the SAME `webbedT` the webspinner sets, not a new status:
      // its counter-play — any pinball part touch clears it
      // (entities/pinball-collide.ts) — is already taught by the mob, so the
      // boss version needs no new lesson, only a longer duration.
      if (b.slowFor > 0 && state.player) {
        state.player.webbedT = Math.max(state.player.webbedT, b.slowFor);
      }
    }
    if (hit || b.dist > b.maxDist) {
      disposeMesh(b.mesh);
      shots.splice(i, 1);
    }
  }
}

// ── BARRAGE ─────────────────────────────────────────────────────────────────

export interface BarrageRt {
  t: number;
  phase: "idle" | "windup";
  aimX: number;
  aimZ: number;
  tell: THREE.Mesh | null;
}

export function freshBarrage(spec: BarrageSpec): BarrageRt {
  return { t: spec.interval, phase: "idle", aimX: 0, aimZ: 0, tell: null };
}

/**
 * Aim, show the tell, then throw.
 *
 * The aim is committed AT THE START of the wind-up, not at release — that is
 * what makes stepping out of the line a real answer rather than a coin flip.
 */
export function updateBarrage(rt: BarrageRt, spec: BarrageSpec, ctx: MoveCtx, shots: BossShot[]): void {
  rt.t -= ctx.dt;
  if (rt.phase === "idle" && rt.t <= spec.windup) {
    rt.phase = "windup";
    rt.aimX = ctx.target.x;
    rt.aimZ = ctx.target.z;
    // The tell is a mote gathering at the boss, coloured like the shot it will
    // become, so the wind-up and the projectile read as one action.
    const geo = new THREE.SphereGeometry(0.3, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.6 });
    const tell = new THREE.Mesh(geo, mat);
    tell.renderOrder = 12;
    rt.tell = add(tell);
  }
  if (rt.phase === "windup") {
    if (rt.tell) {
      rt.tell.position.set(ctx.x, SHOT_Y, ctx.z);
      const k = 1 - Math.max(0, rt.t) / Math.max(0.001, spec.windup);
      rt.tell.scale.setScalar(0.4 + k * 0.9);
      (rt.tell.material as THREE.MeshBasicMaterial).opacity = 0.35 + k * 0.5;
    }
    if (rt.t <= 0) {
      disposeMesh(rt.tell);
      rt.tell = null;
      rt.phase = "idle";
      rt.t = spec.interval;
      fireShot(ctx.x, ctx.z, rt.aimX, rt.aimZ, spec, shots);
    }
  }
}

function fireShot(bx: number, bz: number, px: number, pz: number, spec: BarrageSpec, shots: BossShot[]): void {
  const dx = px - bx;
  const dz = pz - bz;
  const len = Math.hypot(dx, dz) || 1;
  const geo = new THREE.SphereGeometry(0.14, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color: spec.color });
  const mesh = add(new THREE.Mesh(geo, mat));
  mesh.renderOrder = 12;
  mesh.position.set(bx, SHOT_Y, bz);
  shots.push({
    mesh,
    x: bx,
    z: bz,
    vx: (dx / len) * spec.speed,
    vz: (dz / len) * spec.speed,
    dist: 0,
    damage: spec.damage,
    maxDist: spec.maxDist,
    slowFor: spec.slowFor ?? 0,
  });
}

// ── SLAM ────────────────────────────────────────────────────────────────────

export interface SlamRt {
  t: number;
  phase: "idle" | "telegraph" | "echo";
  x: number;
  z: number;
  ring: THREE.Mesh | null;
  echoT: number;
}

export function freshSlam(spec: SlamSpec): SlamRt {
  return { t: spec.interval, phase: "idle", x: 0, z: 0, ring: null, echoT: 0 };
}

export function updateSlam(rt: SlamRt, spec: SlamSpec, ctx: MoveCtx): void {
  if (rt.phase === "echo") {
    rt.echoT -= ctx.dt;
    if (rt.echoT <= 0) {
      const e = spec.echo!;
      state.vfx?.burst(rt.x, 0.2, rt.z, spec.color, 20, 6);
      ctx.hitAt(rt.x, rt.z, e.radius, e.damage, spec.launch * 0.6);
      disposeMesh(rt.ring);
      rt.ring = null;
      rt.phase = "idle";
      rt.t = spec.interval;
    } else {
      pulse(rt.ring, rt.echoT);
    }
    return;
  }

  rt.t -= ctx.dt;
  if (rt.phase === "idle" && rt.t <= spec.telegraph) {
    rt.phase = "telegraph";
    rt.x = ctx.target.x;
    rt.z = ctx.target.z;
    const ring = groundRing(spec.radius, spec.color);
    ring.position.set(rt.x, 0.04, rt.z);
    rt.ring = add(ring);
    ctx.playAnim?.("attack", { force: true });
  }
  if (rt.phase === "telegraph") {
    pulse(rt.ring, rt.t);
    if (rt.t <= 0) {
      state.vfx?.burst(rt.x, 0.2, rt.z, spec.color, 26, 7);
      state.vfx?.ring(rt.x, rt.z, spec.color, spec.radius * 1.25, 0.45, { thin: true });
      state.vfx?.dust(rt.x, 0.1, rt.z);
      state.vfx?.sparks(rt.x, 0.3, rt.z, 0, 0, 14);
      state.shakeT = Math.max(state.shakeT, 0.35);
      state.hitstopT = Math.max(state.hitstopT, 0.06);
      ctx.hitAt(rt.x, rt.z, spec.radius, spec.damage, spec.launch);
      ctx.playAnim?.("attack", { force: true });
      if (spec.echo) {
        // The second ring is WIDER, so the roll that saved you from the first
        // is what puts you inside the second. Swap the ring rather than adding
        // one — two telegraphs at once is the unreadable case.
        disposeMesh(rt.ring);
        const ring = groundRing(spec.echo.radius, spec.color);
        ring.position.set(rt.x, 0.04, rt.z);
        rt.ring = add(ring);
        rt.phase = "echo";
        rt.echoT = spec.echo.delay;
      } else {
        disposeMesh(rt.ring);
        rt.ring = null;
        rt.phase = "idle";
        rt.t = spec.interval;
      }
    }
  }
}

// ── CHARGE ──────────────────────────────────────────────────────────────────

export interface ChargeRt {
  t: number;
  phase: "idle" | "telegraph" | "running";
  dx: number;
  dz: number;
  left: number;
  lane: THREE.Mesh | null;
}

export function freshCharge(spec: ChargeSpec): ChargeRt {
  return { t: spec.interval, phase: "idle", dx: 0, dz: 0, left: 0, lane: null };
}

/** True while the charge owns the boss's movement — the caller must not steer. */
export function chargeHoldsMovement(rt: ChargeRt): boolean {
  return rt.phase === "running";
}

export function updateCharge(rt: ChargeRt, spec: ChargeSpec, ctx: MoveCtx): void {
  if (rt.phase === "running") {
    const step = spec.speed * ctx.dt;
    const nx = ctx.x + rt.dx * step;
    const nz = ctx.z + rt.dz * step;
    if (ctx.grid) {
      const res = moveCircle(ctx.grid, ctx.x, ctx.z, ctx.bodyR, rt.dx * step, rt.dz * step);
      // A wall ends the charge — that is the counter-play, and the reason the
      // lane is drawn: you are meant to put a wall between you and the line.
      const moved = Math.hypot(res.x - ctx.x, res.z - ctx.z);
      ctx.moveTo(res.x, res.z);
      if (moved < step * 0.4) rt.left = 0;
    } else {
      ctx.moveTo(nx, nz);
    }
    ctx.hitAt(ctx.x, ctx.z, ctx.bodyR + 0.35, spec.damage, spec.launch);
    if (Math.random() < ctx.dt * 18) {
      state.vfx?.dust(ctx.x, 0.05, ctx.z);
    }
    rt.left -= step;
    if (rt.left <= 0) {
      state.shakeT = Math.max(state.shakeT, 0.25);
      rt.phase = "idle";
      rt.t = spec.interval;
    }
    return;
  }

  rt.t -= ctx.dt;
  if (rt.phase === "idle" && rt.t <= spec.telegraph) {
    rt.phase = "telegraph";
    const dx = ctx.target.x - ctx.x;
    const dz = ctx.target.z - ctx.z;
    const len = Math.hypot(dx, dz) || 1;
    rt.dx = dx / len;
    rt.dz = dz / len;
    // A LANE, not a ring: the shape of the tell has to match the shape of the
    // attack, or the telegraph teaches the wrong dodge.
    const geo = new THREE.PlaneGeometry(1.4, spec.distance);
    const mat = new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const lane = new THREE.Mesh(geo, mat);
    lane.rotation.x = -Math.PI / 2;
    lane.rotation.z = -Math.atan2(rt.dz, rt.dx) + Math.PI / 2;
    lane.position.set(ctx.x + rt.dx * spec.distance * 0.5, 0.045, ctx.z + rt.dz * spec.distance * 0.5);
    lane.renderOrder = 5;
    rt.lane = add(lane);
  }
  if (rt.phase === "telegraph") {
    pulse(rt.lane, rt.t);
    if (rt.t <= 0) {
      disposeMesh(rt.lane);
      rt.lane = null;
      rt.phase = "running";
      rt.left = spec.distance;
      state.shakeT = Math.max(state.shakeT, 0.18);
    }
  }
}

// ── SUMMON ──────────────────────────────────────────────────────────────────

export interface SummonRt {
  t: number;
  phase: "idle" | "telegraph";
  ring: THREE.Mesh | null;
  /** Adds this boss has produced that are still alive. */
  alive: number;
}

export function freshSummon(spec: SummonSpec): SummonRt {
  return { t: spec.interval, phase: "idle", ring: null, alive: 0 };
}

export function updateSummon(rt: SummonRt, spec: SummonSpec, ctx: MoveCtx, spawn: (x: number, z: number) => boolean): void {
  rt.t -= ctx.dt;
  if (rt.phase === "idle" && rt.t <= spec.telegraph) {
    // The cap is checked at the TELL, not at the spawn: a boss that visibly
    // winds up and then produces nothing reads as broken.
    if (rt.alive >= spec.maxAlive) {
      rt.t = spec.interval;
      return;
    }
    rt.phase = "telegraph";
    const ring = groundRing(1.8, spec.color, 0.25);
    ring.position.set(ctx.x, 0.04, ctx.z);
    rt.ring = add(ring);
  }
  if (rt.phase === "telegraph") {
    pulse(rt.ring, rt.t);
    if (rt.t <= 0) {
      disposeMesh(rt.ring);
      rt.ring = null;
      rt.phase = "idle";
      rt.t = spec.interval;
      for (let i = 0; i < spec.count; i++) {
        const a = (i / spec.count) * Math.PI * 2 + Math.random() * 0.4;
        if (spawn(ctx.x + Math.cos(a) * 1.4, ctx.z + Math.sin(a) * 1.4)) rt.alive++;
      }
      state.vfx?.burst(ctx.x, 0.4, ctx.z, spec.color, 18, 5);
    }
  }
}

// ── NOVA ────────────────────────────────────────────────────────────────────

export interface NovaRt {
  t: number;
  phase: "idle" | "telegraph" | "sweeping";
  x: number;
  z: number;
  ring: THREE.Mesh | null;
  age: number;
  hit: boolean;
}

export function freshNova(spec: NovaSpec): NovaRt {
  return { t: spec.interval, phase: "idle", x: 0, z: 0, ring: null, age: 0, hit: false };
}

/**
 * A ring that sweeps OUTWARD from where the boss stood.
 *
 * The telegraph is the full-size ring drawn faintly, so you can see how far you
 * have to get; the sweep is a second ring growing into it. Distance is the
 * answer, which is why the Archivist pairs it with a barrage — the punish for
 * taking the distance.
 */
export function updateNova(rt: NovaRt, spec: NovaSpec, ctx: MoveCtx): void {
  if (rt.phase === "sweeping") {
    rt.age += ctx.dt;
    const k = Math.min(1, rt.age / Math.max(0.001, spec.sweep));
    const r = spec.radius * k;
    if (rt.ring) {
      rt.ring.scale.setScalar(Math.max(0.001, k));
      (rt.ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k * 0.6);
    }
    // One hit per nova: the ring passes THROUGH you once, it does not grind.
    if (!rt.hit && ctx.hitAt(rt.x, rt.z, r, spec.damage, 0)) rt.hit = true;
    if (k >= 1) {
      disposeMesh(rt.ring);
      rt.ring = null;
      rt.phase = "idle";
      rt.t = spec.interval;
    }
    return;
  }

  rt.t -= ctx.dt;
  if (rt.phase === "idle" && rt.t <= spec.telegraph) {
    rt.phase = "telegraph";
    rt.x = ctx.x;
    rt.z = ctx.z;
    const ring = groundRing(spec.radius, spec.color, 0.06);
    ring.position.set(rt.x, 0.04, rt.z);
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.25;
    rt.ring = add(ring);
  }
  if (rt.phase === "telegraph") {
    pulse(rt.ring, rt.t);
    if (rt.t <= 0) {
      // Swap the faint outline for the solid front, anchored where he stood.
      disposeMesh(rt.ring);
      const ring = groundRing(spec.radius, spec.color, 0.14);
      ring.position.set(rt.x, 0.05, rt.z);
      rt.ring = add(ring);
      state.vfx?.burst(rt.x, 0.25, rt.z, spec.color, 16, 4.5);
      state.vfx?.ring(rt.x, rt.z, spec.color, spec.radius, spec.sweep, { thin: true });
      rt.phase = "sweeping";
      rt.age = 0;
      rt.hit = false;
      state.shakeT = Math.max(state.shakeT, 0.2);
    }
  }
}

// ── TELEPORT & FIRE SPRAY ──────────────────────────────────────────────────

export interface TeleportFireRt {
  t: number;
  phase: "idle" | "telegraph" | "spray";
  destX: number;
  destZ: number;
  ring: THREE.Mesh | null;
  sprayT: number;
  sprayInterval: number;
  sprayTimer: number;
  shotsFired: number;
}

export function freshTeleportFire(spec: TeleportFireSpec): TeleportFireRt {
  return {
    t: spec.interval,
    phase: "idle",
    destX: 0,
    destZ: 0,
    ring: null,
    sprayT: 0,
    sprayInterval: spec.fireDuration / Math.max(1, spec.shotCount),
    sprayTimer: 0,
    shotsFired: 0,
  };
}

export function teleportFireHoldsMovement(rt: TeleportFireRt): boolean {
  return rt.phase === "telegraph" || rt.phase === "spray";
}

export function findTeleportDestination(
  tx: number,
  tz: number,
  dist: number,
  grid: Grid | null,
  bodyR: number
): { x: number; z: number } {
  if (!grid) return { x: tx + dist, z: tz };
  const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -(3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const testX = tx + Math.cos(a) * dist;
    const testZ = tz + Math.sin(a) * dist;
    const t = worldToTile(grid, testX, testZ);
    if (t.i >= 1 && t.i < grid.w - 1 && t.j >= 1 && t.j < grid.h - 1) {
      if (isWalkable(grid, t.i, t.j)) {
        const res = moveCircle(grid, tx, tz, bodyR, testX - tx, testZ - tz);
        if (Math.hypot(res.x - testX, res.z - testZ) < 0.5) {
          return { x: testX, z: testZ };
        }
      }
    }
  }
  return { x: tx + dist * 0.7, z: tz + dist * 0.7 };
}

export function fireMouthFlame(
  bx: number,
  bz: number,
  tx: number,
  tz: number,
  spec: TeleportFireSpec,
  shots: BossShot[]
): void {
  const spread = (Math.random() - 0.5) * 0.4;
  const dx = tx - bx;
  const dz = tz - bz;
  const baseAngle = Math.atan2(dz, dx) + spread;
  const vx = Math.cos(baseAngle) * spec.fireSpeed;
  const vz = Math.sin(baseAngle) * spec.fireSpeed;

  const geo = new THREE.SphereGeometry(0.24, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color: spec.color });
  const mesh = add(new THREE.Mesh(geo, mat));
  mesh.renderOrder = 13;
  mesh.position.set(bx, 1.45, bz);

  // Spark burst at the mouth
  state.vfx?.burst(bx, 1.45, bz, 0xffbb00, 6, 3);

  shots.push({
    mesh,
    x: bx,
    z: bz,
    vx,
    vz,
    dist: 0,
    damage: spec.damage,
    maxDist: 16,
    slowFor: 0,
  });
}

export function updateTeleportFire(
  rt: TeleportFireRt,
  spec: TeleportFireSpec,
  ctx: MoveCtx,
  shots: BossShot[]
): void {
  if (rt.phase === "spray") {
    rt.sprayT -= ctx.dt;
    rt.sprayTimer -= ctx.dt;
    if (rt.sprayTimer <= 0 && rt.shotsFired < spec.shotCount) {
      rt.sprayTimer = rt.sprayInterval;
      rt.shotsFired++;
      ctx.setFacing?.(facingFromWorld(ctx.target.x - ctx.x, ctx.target.z - ctx.z, "S"));
      ctx.playAnim?.("attack", { force: true });
      fireMouthFlame(ctx.x, ctx.z, ctx.target.x, ctx.target.z, spec, shots);
    }
    if (rt.sprayT <= 0 || rt.shotsFired >= spec.shotCount) {
      rt.phase = "idle";
      rt.t = spec.interval;
    }
    return;
  }

  rt.t -= ctx.dt;
  if (rt.phase === "idle" && rt.t <= spec.telegraph) {
    rt.phase = "telegraph";
    const dest = findTeleportDestination(ctx.target.x, ctx.target.z, spec.distance, ctx.grid, ctx.bodyR);
    rt.destX = dest.x;
    rt.destZ = dest.z;
    const ring = groundRing(1.8, 0x8822bb, 0.15); // dark purple necrotic tell
    ring.position.set(ctx.x, 0.04, ctx.z);
    rt.ring = add(ring);
    state.vfx?.burst(ctx.x, 0.5, ctx.z, 0xff5500, 8, 3);
  }

  if (rt.phase === "telegraph") {
    pulse(rt.ring, rt.t);
    state.vfx?.burst(ctx.x, 1.2, ctx.z, 0xff6600, 2, 1);
    if (rt.t <= 0) {
      disposeMesh(rt.ring);
      rt.ring = null;

      // Burst of shadowy smoke and sparks at departure
      state.vfx?.burst(ctx.x, 1.2, ctx.z, 0x220033, 24, 5);
      state.vfx?.burst(ctx.x, 1.2, ctx.z, 0xff4500, 16, 4);

      // Relocate boss
      ctx.moveTo(rt.destX, rt.destZ);

      // Burst of shadowy smoke and fiery arrival
      state.vfx?.burst(rt.destX, 1.2, rt.destZ, 0x220033, 28, 6);
      state.vfx?.burst(rt.destX, 1.2, rt.destZ, 0xff4500, 24, 5);
      state.shakeT = Math.max(state.shakeT, 0.28);

      ctx.setFacing?.(facingFromWorld(ctx.target.x - rt.destX, ctx.target.z - rt.destZ, "S"));
      ctx.playAnim?.("attack", { force: true });

      rt.phase = "spray";
      rt.sprayT = spec.fireDuration;
      rt.sprayInterval = spec.fireDuration / Math.max(1, spec.shotCount);
      rt.sprayTimer = 0;
      rt.shotsFired = 0;
    }
  }
}

// ── FAN BOOMERANG ───────────────────────────────────────────────────────────
//
// The Jade Buddha's signature weapon: an ornate Chinese war fan thrown in an
// arcing boomerang trajectory. Travels outward with a lateral curve, hovers
// at apex while spinning furiously with razor wind particles, then accelerates
// back to the LIVE coordinates of the Buddha. Can damage on both legs!

export interface BoomerangFan {
  mesh: THREE.Mesh;
  state: "outward" | "apex" | "returning" | "done";
  x: number;
  z: number;
  startX: number;
  startZ: number;
  headingX: number;
  headingZ: number;
  perpX: number;
  perpZ: number;
  dist: number;
  maxDist: number;
  speed: number;
  curve: number;
  apexT: number;
  damage: number;
  launch: number;
  hasHitOutward: boolean;
  hasHitReturn: boolean;
  rotSpeed: number;
}

export interface FanBoomerangRt {
  t: number;
  phase: "idle" | "windup" | "active";
  aimX: number;
  aimZ: number;
  tell: THREE.Mesh | null;
  fans: BoomerangFan[];
}

export function freshFanBoomerang(spec: FanBoomerangSpec): FanBoomerangRt {
  return { t: spec.interval, phase: "idle", aimX: 0, aimZ: 0, tell: null, fans: [] };
}

let _fanTex: THREE.CanvasTexture | null = null;
function getFanTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (_fanTex) return _fanTex;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const cx = 64;
    const cy = 70;
    const r = 54;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.closePath();
    ctx.fillStyle = "#2ee89a"; // radiant emerald jade
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffd700"; // gold rim
    ctx.stroke();

    for (let a = -Math.PI * 0.85; a <= -Math.PI * 0.15; a += Math.PI * 0.14) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.strokeStyle = "#e6b800";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Pivot and red tassel
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#b22222";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy + 4);
    ctx.lineTo(cx - 5, cy + 30);
    ctx.lineTo(cx + 5, cy + 30);
    ctx.closePath();
    ctx.fillStyle = "#ff2040";
    ctx.fill();

    _fanTex = new THREE.CanvasTexture(canvas);
    _fanTex.magFilter = THREE.NearestFilter;
    _fanTex.minFilter = THREE.NearestFilter;
    return _fanTex;
  } catch {
    return null;
  }
}

function makeFanMesh(color: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1.5, 1.5);
  const tex = getFanTexture();
  const mat = tex
    ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 13;
  return add(mesh);
}

function spawnFan(
  bx: number,
  bz: number,
  aimX: number,
  aimZ: number,
  spec: FanBoomerangSpec,
  curveSign: number,
): BoomerangFan {
  const dx = aimX - bx;
  const dz = aimZ - bz;
  const len = Math.hypot(dx, dz) || 1;
  const hx = dx / len;
  const hz = dz / len;
  // Perpendicular vector for lateral boomerang curve
  const px = -hz * curveSign;
  const pz = hx * curveSign;

  const mesh = makeFanMesh(spec.color);
  mesh.position.set(bx, SHOT_Y, bz);

  return {
    mesh,
    state: "outward",
    x: bx,
    z: bz,
    startX: bx,
    startZ: bz,
    headingX: hx,
    headingZ: hz,
    perpX: px,
    perpZ: pz,
    dist: 0,
    maxDist: spec.reachDist,
    speed: spec.speed,
    curve: spec.curve,
    apexT: spec.apexPause,
    damage: spec.damage,
    launch: spec.launch,
    hasHitOutward: false,
    hasHitReturn: false,
    rotSpeed: 24 * curveSign,
  };
}

export function updateFanBoomerang(rt: FanBoomerangRt, spec: FanBoomerangSpec, ctx: MoveCtx): void {
  // ── IDLE PHASE ──
  if (rt.phase === "idle") {
    rt.t -= ctx.dt;
    if (rt.t <= spec.telegraph + 1e-4) {
      rt.phase = "windup";
      rt.aimX = ctx.target.x;
      rt.aimZ = ctx.target.z;

      // Tell: glowing emerald energy gathering at Buddha
      const ring = groundRing(1.6, spec.color, 0.12);
      ring.position.set(ctx.x, 0.04, ctx.z);
      rt.tell = add(ring);
      ctx.playAnim?.("attack", { force: true });
    }
    return;
  }

  // ── WINDUP PHASE ──
  if (rt.phase === "windup") {
    rt.t -= ctx.dt;
    if (rt.tell) {
      rt.tell.position.set(ctx.x, 0.04, ctx.z);
      pulse(rt.tell, rt.t);
      if (Math.random() < ctx.dt * 15) {
        state.vfx?.mote(ctx.x, SHOT_Y, ctx.z, spec.color);
      }
    }
    if (rt.t <= 0) {
      disposeMesh(rt.tell);
      rt.tell = null;
      rt.phase = "active";
      rt.t = spec.interval;

      // Launch fans! Dual mode throws two fans along mirrored crossing arcs
      if (spec.dual) {
        rt.fans.push(spawnFan(ctx.x, ctx.z, rt.aimX, rt.aimZ, spec, 1));
        rt.fans.push(spawnFan(ctx.x, ctx.z, rt.aimX, rt.aimZ, spec, -1));
      } else {
        rt.fans.push(spawnFan(ctx.x, ctx.z, rt.aimX, rt.aimZ, spec, 1));
      }
      state.vfx?.burst(ctx.x, SHOT_Y, ctx.z, spec.color, 16, 4);
    }
    return;
  }

  // ── ACTIVE FLIGHT PHASE ──
  if (rt.phase === "active") {
    const FAN_HIT_R = 1.35;

    for (const fan of rt.fans) {
      if (fan.state === "done") continue;

      // Spin fan around Y-axis in ground plane (mesh.rotation.z because rotation.x = -PI/2)
      fan.mesh.rotation.z += ctx.dt * fan.rotSpeed;

      // ── OUTWARD FLIGHT ──
      if (fan.state === "outward") {
        fan.dist += fan.speed * ctx.dt;
        const frac = Math.min(1, fan.dist / fan.maxDist);
        const lateral = Math.sin(frac * Math.PI) * fan.curve;

        fan.x = fan.startX + fan.headingX * fan.dist + fan.perpX * lateral;
        fan.z = fan.startZ + fan.headingZ * fan.dist + fan.perpZ * lateral;

        // Particle trail
        if (Math.random() < ctx.dt * 20) {
          state.vfx?.mote(fan.x, SHOT_Y, fan.z, spec.color);
        }

        // Damage check on outward trip
        if (!fan.hasHitOutward) {
          const hit = ctx.hitAt(fan.x, fan.z, FAN_HIT_R, fan.damage, fan.launch);
          if (hit) {
            fan.hasHitOutward = true;
            state.vfx?.burst(fan.x, SHOT_Y, fan.z, 0xffffff, 10, 5);
          }
        }

        if (fan.dist >= fan.maxDist) {
          fan.state = "apex";
          fan.apexT = spec.apexPause;
          state.vfx?.burst(fan.x, SHOT_Y, fan.z, spec.color, 12, 4);
        }
      }

      // ── APEX HOVER ──
      else if (fan.state === "apex") {
        fan.apexT -= ctx.dt;
        // High-speed hover spin + razor wind sparks
        fan.mesh.rotation.z += ctx.dt * fan.rotSpeed * 1.5;
        if (Math.random() < ctx.dt * 25) {
          state.vfx?.mote(fan.x, SHOT_Y, fan.z, 0xffffff);
        }
        if (fan.apexT <= 0) {
          fan.state = "returning";
        }
      }

      // ── HOMING RETURN FLIGHT ──
      else if (fan.state === "returning") {
        const toBossX = ctx.x - fan.x;
        const toBossZ = ctx.z - fan.z;
        const distToBoss = Math.hypot(toBossX, toBossZ);

        if (distToBoss > 0.1) {
          fan.x += (toBossX / distToBoss) * fan.speed * ctx.dt;
          fan.z += (toBossZ / distToBoss) * fan.speed * ctx.dt;
        }

        // Particle trail
        if (Math.random() < ctx.dt * 20) {
          state.vfx?.mote(fan.x, SHOT_Y, fan.z, spec.color);
        }

        // Damage check on return trip (enables double-hit!)
        if (!fan.hasHitReturn) {
          const hit = ctx.hitAt(fan.x, fan.z, FAN_HIT_R, fan.damage, fan.launch);
          if (hit) {
            fan.hasHitReturn = true;
            state.vfx?.burst(fan.x, SHOT_Y, fan.z, 0xffffff, 10, 5);
          }
        }

        // Caught by boss!
        if (distToBoss < 0.85) {
          disposeMesh(fan.mesh);
          fan.state = "done";
          state.vfx?.burst(ctx.x, SHOT_Y, ctx.z, spec.color, 8, 3);
        }
      }

      fan.mesh.position.set(fan.x, SHOT_Y, fan.z);
    }

    // Clean up finished fans
    rt.fans = rt.fans.filter((f) => f.state !== "done");
    if (rt.fans.length === 0) {
      rt.phase = "idle";
      ctx.playAnim?.("idle");
    }
  }
}

export function disposeFanBoomerang(rt: FanBoomerangRt | null): void {
  if (!rt) return;
  if (rt.tell) {
    disposeMesh(rt.tell);
    rt.tell = null;
  }
  for (const fan of rt.fans) {
    disposeMesh(fan.mesh);
  }
  rt.fans = [];
}
