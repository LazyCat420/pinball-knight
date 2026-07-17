/**
 * Projectiles — bullets, arrows and flame puffs.
 *
 * Simulated on the fixed timestep like everything else: fly along a ground
 * direction at PROJECTILE_Y, die against walls, connect against zombies via
 * the same damage funnel melee uses (combat.damageZombie).
 *
 * Flame puffs are the odd ones out: they're a particle cone, they pass
 * THROUGH zombies (the cone keeps burning whoever stands in it), and each
 * zombie has a short burn-immunity window so ten overlapping puffs read as a
 * steady burn rather than an instant kill.
 */
import * as THREE from "three";
import { state, type Projectile } from "../state";
import {
  PROJECTILE_Y,
  MUZZLE_OFFSET,
  FLAME_BURN_IMMUNITY,
  ZOMBIE_R,
  PLAYER_R,
  SPITTER_GLOB_SPEED,
  SPITTER_FIRE_RANGE,
  SPITTER_DAMAGE,
  WEB_GLOB_SPEED,
  GOLEM_SHARDS,
  GOLEM_SHARD_SPEED,
  GOLEM_SHARD_DAMAGE,
  GOLEM_SHARD_LIFE,
  CURVE_ACCEL,
} from "../constants";
import { PALETTE_HEX } from "../render/palette";
import { worldToTile, isWalkable } from "../maze/generator";
import { damageZombie, playerDamage, hitPlayerRanged, webPlayer } from "./combat";
import type { WeaponDef } from "../items";

const HIT_R = 0.16; // projectile body radius for zombie contact

// ── Shared GPU assets, created lazily, torn down with the game ──
let _bulletGeo: THREE.BoxGeometry | null = null;
let _bulletMat: THREE.MeshBasicMaterial | null = null;
let _arrowGeo: THREE.BoxGeometry | null = null;
let _arrowMat: THREE.MeshBasicMaterial | null = null;
let _flameGeo: THREE.SphereGeometry | null = null;

function bulletAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _bulletGeo ??= new THREE.BoxGeometry(0.07, 0.07, 0.16);
  _bulletMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[22] });
  return { geo: _bulletGeo, mat: _bulletMat };
}

function arrowAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _arrowGeo ??= new THREE.BoxGeometry(0.05, 0.05, 0.42);
  _arrowMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[28] });
  return { geo: _arrowGeo, mat: _arrowMat };
}

function flameGeo(): THREE.SphereGeometry {
  _flameGeo ??= new THREE.SphereGeometry(0.11, 8, 6);
  return _flameGeo;
}

let _globGeo: THREE.SphereGeometry | null = null;
let _globMat: THREE.MeshBasicMaterial | null = null;
function globAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _globGeo ??= new THREE.SphereGeometry(0.14, 8, 6);
  _globMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[9] }); // rot-light acid green
  return { geo: _globGeo, mat: _globMat };
}

let _webMat: THREE.MeshBasicMaterial | null = null;
let _shardGeo: THREE.BoxGeometry | null = null;
let _shardMat: THREE.MeshBasicMaterial | null = null;
function webAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _globGeo ??= new THREE.SphereGeometry(0.14, 8, 6);
  _webMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[22] }); // pale silk
  return { geo: _globGeo, mat: _webMat };
}
function shardAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _shardGeo ??= new THREE.BoxGeometry(0.12, 0.12, 0.12);
  _shardMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[20] }); // stone chip
  return { geo: _shardGeo, mat: _shardMat };
}

export function disposeProjectileAssets(): void {
  _bulletGeo?.dispose();
  _bulletMat?.dispose();
  _arrowGeo?.dispose();
  _arrowMat?.dispose();
  _flameGeo?.dispose();
  _globGeo?.dispose();
  _globMat?.dispose();
  _webMat?.dispose();
  _shardGeo?.dispose();
  _shardMat?.dispose();
  _bulletGeo = _bulletMat = _arrowGeo = _arrowMat = _flameGeo = _globGeo = _globMat = null;
  _webMat = _shardGeo = _shardMat = null;
}

/**
 * A spitter's hostile acid glob, launched from (x,z) along the unit ground
 * direction (dx,dz). Flies like a bullet but hits the PLAYER, not zombies.
 */
export function spitGlob(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = globAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "glob",
    x: sx,
    z: sz,
    vx: dx * SPITTER_GLOB_SPEED,
    vz: dz * SPITTER_GLOB_SPEED,
    life: SPITTER_FIRE_RANGE / SPITTER_GLOB_SPEED,
    maxLife: SPITTER_FIRE_RANGE / SPITTER_GLOB_SPEED,
    damage: SPITTER_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {}, // shared geo/mat, torn down in disposeProjectileAssets
  });
}

/**
 * The webspinner's silk shot: flies like a glob, but landing WEBS the player
 * (a slow, no damage — see combat.webPlayer) instead of hurting them.
 */
export function spitWeb(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = webAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "web",
    x: sx,
    z: sz,
    vx: dx * WEB_GLOB_SPEED,
    vz: dz * WEB_GLOB_SPEED,
    life: SPITTER_FIRE_RANGE / WEB_GLOB_SPEED,
    maxLife: SPITTER_FIRE_RANGE / WEB_GLOB_SPEED,
    damage: 0,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/**
 * A shattered BRICK GOLEM's shard spray: stone chips that RICOCHET off walls
 * until their fuse runs out, hurting any zombie they clip — the golem's death
 * is a room-clearing event if you detonate it in a crowd.
 */
export function golemShards(x: number, z: number): void {
  if (!state.scene) return;
  const { geo, mat } = shardAssets();
  for (let n = 0; n < GOLEM_SHARDS; n++) {
    const a = (n / GOLEM_SHARDS) * Math.PI * 2 + Math.random() * 0.5;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, PROJECTILE_Y, z);
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "shard",
      x,
      z,
      vx: Math.cos(a) * GOLEM_SHARD_SPEED,
      vz: Math.sin(a) * GOLEM_SHARD_SPEED,
      life: GOLEM_SHARD_LIFE,
      maxLife: GOLEM_SHARD_LIFE,
      damage: GOLEM_SHARD_DAMAGE,
      mesh,
      dispose: () => {},
    });
  }
}

/** Remove a projectile from the world (mesh + list entry by index). */
function despawn(index: number): void {
  const pr = state.projectiles[index];
  state.scene?.remove(pr.mesh);
  pr.dispose();
  state.projectiles.splice(index, 1);
}

export function clearProjectiles(): void {
  for (let i = state.projectiles.length - 1; i >= 0; i--) despawn(i);
}

/**
 * Fire the ranged weapon in hand from (px,pz) along the unit ground direction
 * (fx,fz). Spread and pellet count come from the weapon table — the
 * flamethrower's cone IS its spread applied to a pair of puffs.
 */
export function fireWeapon(w: WeaponDef, px: number, pz: number, fx: number, fz: number): void {
  if (!state.scene || !w.projectile || !w.projectileSpeed) return;
  const pellets = w.pellets ?? 1;

  for (let n = 0; n < pellets; n++) {
    const jitter = (Math.random() - 0.5) * 2 * (w.spread ?? 0);
    const cos = Math.cos(jitter);
    const sin = Math.sin(jitter);
    const dx = fx * cos - fz * sin;
    const dz = fx * sin + fz * cos;
    // flame puffs also vary speed so the cone has depth, not a moving wall
    const speed = w.projectile === "flame" ? w.projectileSpeed * (0.75 + Math.random() * 0.5) : w.projectileSpeed;

    let mesh: THREE.Mesh;
    let dispose: () => void;
    if (w.projectile === "bullet") {
      const a = bulletAssets();
      mesh = new THREE.Mesh(a.geo, a.mat);
      dispose = () => {}; // shared assets
    } else if (w.projectile === "arrow") {
      const a = arrowAssets();
      mesh = new THREE.Mesh(a.geo, a.mat);
      dispose = () => {};
    } else {
      // each puff owns its material — its colour cools as it dies
      const mat = new THREE.MeshBasicMaterial({ color: PALETTE_HEX[18] });
      mesh = new THREE.Mesh(flameGeo(), mat);
      dispose = () => mat.dispose();
    }

    const x = px + fx * MUZZLE_OFFSET;
    const z = pz + fz * MUZZLE_OFFSET;
    mesh.position.set(x, PROJECTILE_Y, z);
    mesh.rotation.y = Math.atan2(dx, dz); // long axis along the flight line
    state.scene.add(mesh);

    const life = w.range / w.projectileSpeed;
    // CURVE SHOT: bend the flight toward the side the player is sweeping. The
    // curve accel is perpendicular to the shot heading, signed by the player's
    // lateral velocity (a still player curves toward its facing-right).
    let curveX = 0;
    let curveZ = 0;
    const pl = state.player;
    if (pl && pl.curveT > 0) {
      const perpX = -dz; // left-hand perpendicular to the heading
      const perpZ = dx;
      const vx2 = pl.momSpeed > 0 ? pl.momX : 0;
      const vz2 = pl.momSpeed > 0 ? pl.momZ : 0;
      const side = perpX * vx2 + perpZ * vz2 >= 0 ? 1 : -1;
      curveX = perpX * CURVE_ACCEL * side;
      curveZ = perpZ * CURVE_ACCEL * side;
    }
    state.projectiles.push({
      kind: w.projectile,
      x,
      z,
      vx: dx * speed,
      vz: dz * speed,
      life,
      maxLife: life,
      damage: playerDamage(w.damage), // rage buff doubles it, baked in at fire time
      curveX,
      curveZ,
      mesh,
      dispose,
    });
  }
}

/** The three colour stops a flame puff cools through. */
const FLAME_RAMP = [PALETTE_HEX[18], PALETTE_HEX[17], PALETTE_HEX[16], PALETTE_HEX[15]];

export function updateProjectiles(dt: number): void {
  const g = state.grid;
  if (!g) return;

  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const pr = state.projectiles[i];
    pr.life -= dt;
    if (pr.life <= 0) {
      despawn(i);
      continue;
    }


    // ── Shards RICOCHET: resolve each axis against the grid and reflect the
    // blocked component (they die by fuse, not by wall). Everything else
    // integrates straight and dies where it lands. ──
    if (pr.kind === "shard") {
      const nx = pr.x + pr.vx * dt;
      const nz = pr.z + pr.vz * dt;
      const tx = worldToTile(g, nx, pr.z);
      if (!isWalkable(g, tx.i, tx.j)) pr.vx = -pr.vx;
      else pr.x = nx;
      const tz = worldToTile(g, pr.x, nz);
      if (!isWalkable(g, tz.i, tz.j)) pr.vz = -pr.vz;
      else pr.z = nz;
      pr.mesh.rotation.y += dt * 12; // tumbling chip
    } else {
      // CURVE SHOT: apply the lateral bend, then re-point the mesh down the new
      // heading so the art follows the arc.
      if (pr.curveX || pr.curveZ) {
        pr.vx += (pr.curveX ?? 0) * dt;
        pr.vz += (pr.curveZ ?? 0) * dt;
        pr.mesh.rotation.y = Math.atan2(pr.vx, pr.vz);
      }
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;

      // ── Walls ──
      const t = worldToTile(g, pr.x, pr.z);
      if (!isWalkable(g, t.i, t.j)) {
        // Arrows/bullets spit a spark off the masonry they bury into.
        if (pr.kind === "arrow" || pr.kind === "bullet") {
          state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx, -pr.vz, 6);
        }
        despawn(i);
        continue;
      }

      // ARROW TRAIL: a faint glowing streak shed behind the shaft each frame,
      // drifting backward so it reads as motion (Wolfenstein arrow juice).
      if (pr.kind === "arrow") {
        state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx * 0.015, -pr.vz * 0.015, 1);
      }
    }

    // ── Hostile shots hit the PLAYER, not zombies (acid hurts, silk webs) ──
    if (pr.hostile) {
      const p = state.player;
      if (p && p.hp > 0) {
        const dx = p.x - pr.x;
        const dz = p.z - pr.z;
        if (dx * dx + dz * dz <= (PLAYER_R + HIT_R) * (PLAYER_R + HIT_R)) {
          if (pr.kind === "web") {
            if (p.iframes <= 0) webPlayer();
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, 0, 0, 5);
          } else {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.blood(pr.x, PROJECTILE_Y, pr.z, "green", 6);
          }
          despawn(i);
          continue;
        }
      }
      pr.mesh.position.set(pr.x, PROJECTILE_Y, pr.z);
      continue; // hostile shots skip the zombie loop below
    }

    // ── Zombies ──
    let consumed = false;
    for (const z of state.zombies) {
      if (z.mode === "dead") continue;
      const dx = z.x - pr.x;
      const dz = z.z - pr.z;
      if (dx * dx + dz * dz > (ZOMBIE_R + HIT_R) * (ZOMBIE_R + HIT_R)) continue;

      if (pr.kind === "flame") {
        // the cone burns in ticks; the puff itself flies on
        if (z.burnT <= 0) {
          z.burnT = FLAME_BURN_IMMUNITY;
          damageZombie(z, pr.damage, pr.vx, pr.vz, 0.06);
        }
      } else {
        damageZombie(z, pr.damage, pr.vx, pr.vz, pr.kind === "arrow" ? 0.5 : 0.3);
        consumed = true;
        break;
      }
    }
    if (consumed) {
      despawn(i);
      continue;
    }

    // ── Presentation ──
    pr.mesh.position.set(pr.x, PROJECTILE_Y, pr.z);
    if (pr.kind === "flame") {
      const age = 1 - pr.life / pr.maxLife;
      pr.mesh.scale.setScalar(0.6 + age * 2.6);
      pr.mesh.position.y = PROJECTILE_Y + age * 0.25; // fire drifts up
      const mat = pr.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(FLAME_RAMP[Math.min(FLAME_RAMP.length - 1, Math.floor(age * FLAME_RAMP.length))]);
    }
  }
}
