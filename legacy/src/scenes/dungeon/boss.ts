/**
 * ☠ THE REAPER KING — the end-of-run boss that gates the exit portal.
 *
 * Reuses the dungeon's own enemy pipeline (`makeZombie`) so it chases, takes
 * damage, and dies through the same combat path as everything else — but it is
 * a KILLABLE `brute` wearing the reaper's art (the real `reaper` kind is
 * combat-immune), scaled up, with two bespoke threats layered on top by this
 * module's own tick:
 *
 *   • ORBITING SKULLS — a ring of bone that wheels around the king, and every
 *     so often one detaches and flies at whoever it can see (ranged pressure).
 *   • TENTACLE SLAM — a telegraphed ground-pound: a growing ring marks where it
 *     will land, then it SLAMS, damaging + launching anyone still inside.
 *
 * While the king lives the floor's stairs won't descend (`state.exitLocked`).
 * On its death the lock lifts and a PORTAL blooms over the stairs — "kill the
 * boss to reach the portal". All meshes here are procedural (no art pipeline),
 * so the module is self-contained and safe to dispose on any level change.
 *
 * Co-op note: the king lives in `state.zombies`, so on a host it is part of the
 * authoritative world snapshot like any enemy; `coop.ts` streams it and the
 * skulls/slam telegraphs to replicas. This module runs its AI on the HOST only
 * (guarded by the caller), replicas render the streamed state.
 */
import * as THREE from "three";
import { state, type Zombie } from "./state";
import { hitPlayerRanged } from "./entities/combat";
import { showToast } from "./ui";
import { PINBALL_MAX_SPEED, REAPER_SCALE, REAPER_TINT } from "./constants";
import { tileCenter, type Grid, type TilePos } from "./maze/generator";
import { peers } from "../../net/presence";

// ── Tuning ────────────────────────────────────────────────────────────────────
const KING_HP = 220; // meaty — a real fight, not a speed-bump
const KING_SPEED = 2.0; // slow, inexorable
const KING_SCALE = REAPER_SCALE * 1.55; // looms over the horde
const SKULL_COUNT = 5;
const SKULL_ORBIT_R = 1.5;
const SKULL_ORBIT_SPEED = 1.1; // rad/s
const SKULL_Y = 1.5;
const SLAM_INTERVAL = 4.2; // seconds between slams
const SLAM_TELEGRAPH = 1.1; // windup the ring is visible before impact
const SLAM_RADIUS = 2.6;
const SLAM_DAMAGE = 2;
const SLAM_LAUNCH = 16; // u/s knockback on hit
const BARRAGE_INTERVAL = 2.6; // seconds between skull throws
const BONE_SPEED = 9; // u/s projectile
const BONE_DAMAGE = 1;
const BONE_MAX_DIST = 16;
const BONE_HIT_R = 0.55;

/**
 * Nearest knight to (x,z) among OUR player and every pool-mate on this floor —
 * the king fights the whole party, not just the authority's knight. Peer
 * positions come from presence (fresh at 15Hz).
 */
function nearestKnight(x: number, z: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  const p = state.player;
  if (p) {
    best = { x: p.x, z: p.z };
    bestD = Math.hypot(p.x - x, p.z - z);
  }
  const tag = `dungeon:${state.level}`;
  for (const peer of peers()) {
    if (peer.scene !== tag) continue;
    const d = Math.hypot(peer.x - x, peer.z - z);
    if (d < bestD) {
      bestD = d;
      best = { x: peer.x, z: peer.z };
    }
  }
  return best;
}

interface Skull {
  mesh: THREE.Mesh;
  phase: number; // orbit angle offset
}
interface Bone {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  vx: number;
  vz: number;
  dist: number;
}
interface BossState {
  z: Zombie;
  skulls: Skull[];
  bones: Bone[];
  slamT: number;
  slamPhase: "idle" | "telegraph";
  slamX: number;
  slamZ: number;
  telegraph: THREE.Mesh | null;
  barrageT: number;
  orbitT: number;
  portal: THREE.Mesh | null;
  opened: boolean;
}

let boss: BossState | null = null;

/** True while a boss is alive and holding the exit shut. */
export function bossActive(): boolean {
  return boss !== null && !boss.opened;
}

// ── Procedural meshes ─────────────────────────────────────────────────────────
function makeSkull(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.2, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xe8e2d0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 12;
  // Two hollow eyes so it reads as a skull, not a pearl.
  const eyeGeo = new THREE.SphereGeometry(0.055, 6, 5);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a0e12 });
  for (const dx of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(dx, 0.02, 0.17);
    mesh.add(eye);
  }
  return mesh;
}

function makeBone(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.14, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8c8a8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 12;
  return mesh;
}

function makeTelegraph(): THREE.Mesh {
  const geo = new THREE.RingGeometry(SLAM_RADIUS * 0.9, SLAM_RADIUS, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3050, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.04;
  mesh.renderOrder = 5;
  return mesh;
}

function makePortal(): THREE.Mesh {
  const geo = new THREE.TorusGeometry(0.95, 0.22, 12, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xa050e0 });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.y = 1.0;
  ring.renderOrder = 8;
  // A swirling inner disc so it reads as a gateway, not a hoop.
  const discGeo = new THREE.CircleGeometry(0.9, 32);
  const discMat = new THREE.MeshBasicMaterial({ color: 0x2a0d40, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.z = 0.001;
  ring.add(disc);
  return ring;
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
/**
 * Spawn the Reaper King at `spot`, wire the skull ring, and lock the exit.
 * `makeZombie` is injected (it lives in core.ts) to keep this module free of a
 * circular import. Safe no-op if a boss already exists or the scene is gone.
 */
export function spawnBoss(
  grid: Grid,
  spot: TilePos,
  makeZombie: (x: number, z: number, hp: number) => Zombie,
): void {
  if (boss || !state.scene || !state.player) return;
  const c = tileCenter(grid, spot.i, spot.j);
  const z = makeZombie(c.x, c.z, KING_HP);
  z.baseTint = REAPER_TINT;
  z.sprite.setTint(REAPER_TINT);
  z.sprite.mesh.scale.multiplyScalar(KING_SCALE);
  z.aggro = true;

  const skulls: Skull[] = [];
  for (let i = 0; i < SKULL_COUNT; i++) {
    const mesh = makeSkull();
    state.scene.add(mesh);
    skulls.push({ mesh, phase: (i / SKULL_COUNT) * Math.PI * 2 });
  }

  boss = {
    z,
    skulls,
    bones: [],
    slamT: SLAM_INTERVAL,
    slamPhase: "idle",
    slamX: 0,
    slamZ: 0,
    telegraph: null,
    barrageT: BARRAGE_INTERVAL,
    orbitT: 0,
    portal: null,
    opened: false,
  };
  state.exitLocked = true;
  showToast("☠ THE REAPER KING ☠", "slay it — only then does the portal open");
  state.shakeT = Math.max(state.shakeT, 0.4);
}

// ── Per-frame update (HOST authority — caller gates on !isReplica) ─────────────
export function updateBoss(dt: number): void {
  if (!boss) return;

  // Death: the king left `state.zombies` (killZombie removed it) or hp bottomed.
  if (!boss.opened && (boss.z.hp <= 0 || !state.zombies.includes(boss.z))) {
    openPortal();
    return;
  }

  if (boss.opened) {
    updatePortal(dt);
    updateBones(dt); // let any in-flight bones finish
    return;
  }

  const p = state.player;
  if (!p) return;
  const bx = boss.z.x;
  const bz = boss.z.z;
  // The king menaces whichever knight is CLOSEST — ours or a pool-mate's.
  const target = nearestKnight(bx, bz) ?? { x: p.x, z: p.z };

  // ── Skull ring wheels around the king ──
  boss.orbitT += dt * SKULL_ORBIT_SPEED;
  for (const s of boss.skulls) {
    const a = boss.orbitT + s.phase;
    s.mesh.position.set(bx + Math.cos(a) * SKULL_ORBIT_R, SKULL_Y + Math.sin(a * 2) * 0.12, bz + Math.sin(a) * SKULL_ORBIT_R);
  }

  // ── Skull barrage: fling a bone at the player on a cadence ──
  boss.barrageT -= dt;
  if (boss.barrageT <= 0 && boss.skulls.length > 0) {
    boss.barrageT = BARRAGE_INTERVAL;
    fireBone(bx, bz, target.x, target.z);
  }
  updateBones(dt);

  // ── Tentacle slam cycle ──
  boss.slamT -= dt;
  if (boss.slamPhase === "idle" && boss.slamT <= SLAM_TELEGRAPH) {
    // Commit the landing spot to the NEAREST knight's current position.
    boss.slamPhase = "telegraph";
    boss.slamX = target.x;
    boss.slamZ = target.z;
    boss.telegraph = makeTelegraph();
    boss.telegraph.position.set(p.x, 0.04, p.z);
    state.scene?.add(boss.telegraph);
  }
  if (boss.slamPhase === "telegraph") {
    // Pulse the ring as it winds up.
    if (boss.telegraph) {
      const m = boss.telegraph.material as THREE.MeshBasicMaterial;
      m.opacity = 0.35 + Math.abs(Math.sin(boss.slamT * 10)) * 0.4;
    }
    if (boss.slamT <= 0) doSlam();
  }
}

function fireBone(bx: number, bz: number, px: number, pz: number): void {
  const dx = px - bx;
  const dz = pz - bz;
  const len = Math.hypot(dx, dz) || 1;
  const mesh = makeBone();
  mesh.position.set(bx, SKULL_Y, bz);
  state.scene?.add(mesh);
  boss!.bones.push({ mesh, x: bx, z: bz, vx: (dx / len) * BONE_SPEED, vz: (dz / len) * BONE_SPEED, dist: 0 });
}

function updateBones(dt: number): void {
  if (!boss) return;
  const p = state.player;
  for (let i = boss.bones.length - 1; i >= 0; i--) {
    const b = boss.bones[i];
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.dist += Math.hypot(b.vx, b.vz) * dt;
    b.mesh.position.set(b.x, SKULL_Y, b.z);
    b.mesh.rotation.y += dt * 8;
    const hit = p && Math.hypot(p.x - b.x, p.z - b.z) < BONE_HIT_R;
    if (hit) {
      hitPlayerRanged(BONE_DAMAGE, b.x, b.z);
      state.vfx?.burst(b.x, SKULL_Y, b.z, 0xe8e2d0, 8, 4);
    }
    if (hit || b.dist > BONE_MAX_DIST) {
      disposeMesh(b.mesh);
      boss.bones.splice(i, 1);
    }
  }
}

function doSlam(): void {
  if (!boss) return;
  const { slamX, slamZ } = boss;
  if (boss.telegraph) {
    disposeMesh(boss.telegraph);
    boss.telegraph = null;
  }
  boss.slamPhase = "idle";
  boss.slamT = SLAM_INTERVAL;

  state.vfx?.burst(slamX, 0.2, slamZ, 0xff3050, 26, 7);
  state.shakeT = Math.max(state.shakeT, 0.35);
  state.hitstopT = Math.max(state.hitstopT, 0.06);

  const p = state.player;
  if (!p) return;
  const dx = p.x - slamX;
  const dz = p.z - slamZ;
  if (Math.hypot(dx, dz) <= SLAM_RADIUS) {
    hitPlayerRanged(SLAM_DAMAGE, slamX, slamZ);
    // Launch the knight out of the crater, reusing the pinball momentum channel.
    const len = Math.hypot(dx, dz) || 1;
    p.momX = dx / len;
    p.momZ = dz / len;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, SLAM_LAUNCH));
    p.iframes = Math.max(p.iframes, 0.2);
  }
}

// ── Death → portal ────────────────────────────────────────────────────────────
function openPortal(): void {
  if (!boss || boss.opened) return;
  boss.opened = true;
  state.exitLocked = false;

  // Skulls shatter.
  for (const s of boss.skulls) {
    state.vfx?.burst(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, 0xe8e2d0, 10, 5);
    disposeMesh(s.mesh);
  }
  boss.skulls = [];
  if (boss.telegraph) {
    disposeMesh(boss.telegraph);
    boss.telegraph = null;
  }

  // Bloom the portal over the stairs (the exit the king was guarding).
  if (state.scene && state.grid && state.stairs) {
    const c = tileCenter(state.grid, state.stairs.i, state.stairs.j);
    const portal = makePortal();
    portal.position.set(c.x, 1.0, c.z);
    portal.scale.setScalar(0.01); // grows in
    state.scene.add(portal);
    boss.portal = portal;
    state.vfx?.burst(c.x, 1.0, c.z, 0xa050e0, 30, 6);
  }
  showToast("THE REAPER KING FALLS", "the portal opens — step into it to descend");
  state.shakeT = Math.max(state.shakeT, 0.5);
}

function updatePortal(dt: number): void {
  if (!boss?.portal) return;
  boss.portal.rotation.z += dt * 1.5;
  const s = Math.min(1, boss.portal.scale.x + dt * 2);
  boss.portal.scale.setScalar(s);
  const disc = boss.portal.children[0] as THREE.Mesh | undefined;
  if (disc) (disc.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(state.elapsed * 4) * 0.15;
}

// ── Co-op: the king over the wire ─────────────────────────────────────────────
/** The boss aux state a floor authority streams to replicas each snapshot. */
export interface BossAux {
  /** Bone projectiles in flight. */
  bones: Array<{ x: number; z: number }>;
  /** A slam telegraph in progress: where, and seconds until impact. */
  slam: { x: number; z: number; t: number } | null;
  /** The opened portal's position, once the king is dead. */
  portal: { x: number; z: number } | null;
  /** King alive → replicas keep their skull ring + exit lock. */
  alive: boolean;
}

/** Authority side: serialize the aux threats for the snapshot. Null = no boss. */
export function bossNetState(): BossAux | null {
  if (!boss) return null;
  return {
    bones: boss.bones.map((b) => ({ x: Math.round(b.x * 50) / 50, z: Math.round(b.z * 50) / 50 })),
    slam: boss.slamPhase === "telegraph" ? { x: boss.slamX, z: boss.slamZ, t: boss.slamT } : null,
    portal: boss.portal ? { x: boss.portal.position.x, z: boss.portal.position.z } : null,
    alive: !boss.opened,
  };
}

// Replica-side mirrored meshes — deliberately separate from `boss` (the
// authority state) so an authority handover can adopt cleanly.
interface ReplicaAux {
  skulls: THREE.Mesh[];
  bones: THREE.Mesh[];
  telegraph: THREE.Mesh | null;
  slamPos: { x: number; z: number } | null;
  portal: THREE.Mesh | null;
  orbitT: number;
}
let replica: ReplicaAux | null = null;

function ensureReplica(): ReplicaAux {
  if (!replica) replica = { skulls: [], bones: [], telegraph: null, slamPos: null, portal: null, orbitT: 0 };
  return replica;
}

/**
 * Replica side: reconcile the mirrored boss threats against the authority's
 * aux snapshot (~10Hz). Slam IMPACT is detected here — the telegraph vanishing
 * from the aux means the authority fired it, so we burst and damage OUR knight
 * if they're inside (player HP is client-owned).
 */
export function applyRemoteBossAux(aux: BossAux | null): void {
  const r = ensureReplica();

  // Skull ring: cosmetic, orbits whatever boss-flagged zombie the snapshot gave us.
  const king = state.zombies.find((z) => z.boss && z.mode !== "dead");
  const wantSkulls = aux?.alive && king ? SKULL_COUNT : 0;
  while (r.skulls.length < wantSkulls) {
    const m = makeSkull();
    state.scene?.add(m);
    r.skulls.push(m);
  }
  while (r.skulls.length > wantSkulls) disposeMesh(r.skulls.pop()!);

  // Bones: match mesh count to the snapshot, park them on the reported spots.
  const bones = aux?.bones ?? [];
  while (r.bones.length < bones.length) {
    const m = makeBone();
    state.scene?.add(m);
    r.bones.push(m);
  }
  while (r.bones.length > bones.length) disposeMesh(r.bones.pop()!);
  for (let i = 0; i < bones.length; i++) r.bones[i].position.set(bones[i].x, SKULL_Y, bones[i].z);

  // Bone hits against OUR knight (the authority only guards its own).
  const p = state.player;
  if (p) {
    for (const b of bones) {
      if (Math.hypot(p.x - b.x, p.z - b.z) < BONE_HIT_R + 0.15 && p.iframes <= 0) {
        hitPlayerRanged(BONE_DAMAGE, b.x, b.z);
      }
    }
  }

  // Slam: ring while telegraphed; when it VANISHES, the authority fired it.
  const slam = aux?.slam ?? null;
  if (slam) {
    if (!r.telegraph) {
      r.telegraph = makeTelegraph();
      state.scene?.add(r.telegraph);
    }
    r.telegraph.position.set(slam.x, 0.04, slam.z);
    r.slamPos = { x: slam.x, z: slam.z };
  } else if (r.telegraph) {
    disposeMesh(r.telegraph);
    r.telegraph = null;
    const at = r.slamPos;
    r.slamPos = null;
    if (at) {
      state.vfx?.burst(at.x, 0.2, at.z, 0xff3050, 26, 7);
      state.shakeT = Math.max(state.shakeT, 0.35);
      if (p && Math.hypot(p.x - at.x, p.z - at.z) <= SLAM_RADIUS) {
        hitPlayerRanged(SLAM_DAMAGE, at.x, at.z);
        const len = Math.hypot(p.x - at.x, p.z - at.z) || 1;
        p.momX = (p.x - at.x) / len;
        p.momZ = (p.z - at.z) / len;
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, SLAM_LAUNCH));
        p.iframes = Math.max(p.iframes, 0.2);
      }
    }
  }

  // Portal: bloom it once; the coop layer clears state.exitLocked via the lock flag.
  if (aux?.portal && !r.portal) {
    r.portal = makePortal();
    r.portal.position.set(aux.portal.x, 1.0, aux.portal.z);
    state.scene?.add(r.portal);
    state.vfx?.burst(aux.portal.x, 1.0, aux.portal.z, 0xa050e0, 30, 6);
    showToast("THE REAPER KING FALLS", "the portal opens — step into it to descend");
  }
}

/** Replica per-frame smoothing: skulls orbit the king, the portal spins. */
export function updateBossReplica(dt: number): void {
  if (!replica) return;
  const king = state.zombies.find((z) => z.boss && z.mode !== "dead");
  replica.orbitT += dt * SKULL_ORBIT_SPEED;
  if (king) {
    for (let i = 0; i < replica.skulls.length; i++) {
      const a = replica.orbitT + (i / SKULL_COUNT) * Math.PI * 2;
      replica.skulls[i].position.set(king.x + Math.cos(a) * SKULL_ORBIT_R, SKULL_Y + Math.sin(a * 2) * 0.12, king.z + Math.sin(a) * SKULL_ORBIT_R);
    }
  }
  if (replica.telegraph) {
    const m = replica.telegraph.material as THREE.MeshBasicMaterial;
    m.opacity = 0.35 + Math.abs(Math.sin(state.elapsed * 10)) * 0.4;
  }
  replica.portal?.rotateZ(dt * 1.5);
}

/**
 * Authority HANDOVER: the previous simulator left mid-fight and we inherited a
 * living boss-flagged ghost. Wire the full boss module around it so slams and
 * barrages resume; replica-side mirrored meshes are dropped first.
 */
export function adoptBoss(z: Zombie): void {
  if (boss || !state.scene) return;
  disposeReplicaAux();
  const skulls: Skull[] = [];
  for (let i = 0; i < SKULL_COUNT; i++) {
    const mesh = makeSkull();
    state.scene.add(mesh);
    skulls.push({ mesh, phase: (i / SKULL_COUNT) * Math.PI * 2 });
  }
  boss = {
    z,
    skulls,
    bones: [],
    slamT: SLAM_INTERVAL,
    slamPhase: "idle",
    slamX: 0,
    slamZ: 0,
    telegraph: null,
    barrageT: BARRAGE_INTERVAL,
    orbitT: 0,
    portal: null,
    opened: false,
  };
  state.exitLocked = true;
}

function disposeReplicaAux(): void {
  if (!replica) return;
  for (const m of replica.skulls) disposeMesh(m);
  for (const m of replica.bones) disposeMesh(m);
  if (replica.telegraph) disposeMesh(replica.telegraph);
  if (replica.portal) disposeMesh(replica.portal);
  replica = null;
}

// ── Teardown ──────────────────────────────────────────────────────────────────
export function disposeBoss(): void {
  disposeReplicaAux();
  if (!boss) return;
  for (const s of boss.skulls) disposeMesh(s.mesh);
  for (const b of boss.bones) disposeMesh(b.mesh);
  if (boss.telegraph) disposeMesh(boss.telegraph);
  if (boss.portal) disposeMesh(boss.portal);
  boss = null;
}

function disposeMesh(m: THREE.Mesh): void {
  m.removeFromParent();
  m.geometry.dispose();
  const mat = m.material as THREE.Material | THREE.Material[];
  if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
  else mat.dispose();
  for (const child of m.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
}
