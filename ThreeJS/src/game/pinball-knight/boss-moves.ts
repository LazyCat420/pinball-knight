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
import type { BarrageSpec, ChargeSpec, NovaSpec, OrbitSpec, SlamSpec, SummonSpec } from "./boss-kinds";
import { state } from "./state";
import type { Grid } from "./maze/generator";
import { moveCircle } from "./engine/collision";

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
  /** Move the boss. Used only by the charge. */
  moveTo(x: number, z: number): void;
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
  }
  if (rt.phase === "telegraph") {
    pulse(rt.ring, rt.t);
    if (rt.t <= 0) {
      state.vfx?.burst(rt.x, 0.2, rt.z, spec.color, 26, 7);
      state.shakeT = Math.max(state.shakeT, 0.35);
      state.hitstopT = Math.max(state.hitstopT, 0.06);
      ctx.hitAt(rt.x, rt.z, spec.radius, spec.damage, spec.launch);
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
      rt.phase = "sweeping";
      rt.age = 0;
      rt.hit = false;
      state.shakeT = Math.max(state.shakeT, 0.2);
    }
  }
}
