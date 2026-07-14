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
import { PROJECTILE_Y, MUZZLE_OFFSET, FLAME_BURN_IMMUNITY, ZOMBIE_R } from "../constants";
import { PALETTE_HEX } from "../render/palette";
import { worldToTile, isWalkable } from "../maze/generator";
import { damageZombie } from "./combat";
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

export function disposeProjectileAssets(): void {
  _bulletGeo?.dispose();
  _bulletMat?.dispose();
  _arrowGeo?.dispose();
  _arrowMat?.dispose();
  _flameGeo?.dispose();
  _bulletGeo = _bulletMat = _arrowGeo = _arrowMat = _flameGeo = null;
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
    state.projectiles.push({
      kind: w.projectile,
      x,
      z,
      vx: dx * speed,
      vz: dz * speed,
      life,
      maxLife: life,
      damage: w.damage,
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

    pr.x += pr.vx * dt;
    pr.z += pr.vz * dt;

    // ── Walls ──
    const t = worldToTile(g, pr.x, pr.z);
    if (!isWalkable(g, t.i, t.j)) {
      despawn(i);
      continue;
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
