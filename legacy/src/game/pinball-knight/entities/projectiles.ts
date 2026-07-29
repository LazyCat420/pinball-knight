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
  JESTER_DISC_SPEED,
  JESTER_DISC_DAMAGE,
  JESTER_DISC_LIFE,
  ROTORTAIL_TIMBER_SPEED,
  ROTORTAIL_TIMBER_DAMAGE,
  ROTORTAIL_FIRE_RANGE,
  CURVE_ACCEL,
} from "../constants";
import { PALETTE_HEX } from "../render/palette";
import { worldToTile, isWalkable } from "../maze/generator";
import { damageZombie, playerDamage, hitPlayerRanged, webPlayer, applyCardOnHit } from "./combat";
import { aggregateCards } from "../cards";
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
let _discGeo: THREE.CylinderGeometry | null = null;
let _discMat: THREE.MeshBasicMaterial | null = null;
/**
 * The jester's plate. A flat CYLINDER, not a sphere — every other projectile in
 * the game is a ball or a chip, and the one thing a player has to recognise
 * about this one at speed is that it is the thing that was on the monster's
 * head. Cylinder's default axis is +Y, so it spawns lying flat and spinning
 * about its own axis reads as a thrown discus with no extra transform.
 */
function discAssets(): { geo: THREE.CylinderGeometry; mat: THREE.MeshBasicMaterial } {
  _discGeo ??= new THREE.CylinderGeometry(0.19, 0.19, 0.05, 12);
  _discMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[12] }); // blood mid
  return { geo: _discGeo, mat: _discMat };
}
let _timberGeo: THREE.CylinderGeometry | null = null;
let _timberMat: THREE.MeshBasicMaterial | null = null;
/**
 * The rotortail's baulk of timber. A cylinder laid on its SIDE — rotated onto
 * the ground plane at spawn — because the one thing the player has to read at a
 * glance is that this is a long object, not another ball. Every other hostile
 * shot in the game is round; a bar tumbling toward you is a different warning.
 */
function timberAssets(): { geo: THREE.CylinderGeometry; mat: THREE.MeshBasicMaterial } {
  _timberGeo ??= new THREE.CylinderGeometry(0.11, 0.11, 0.46, 8);
  _timberMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[27] }); // leather dark — wood
  return { geo: _timberGeo, mat: _timberMat };
}
let _crystalMat: THREE.MeshBasicMaterial | null = null;
function crystalAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _shardGeo ??= new THREE.BoxGeometry(0.12, 0.12, 0.12);
  _crystalMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[31] }); // prismatic cool
  return { geo: _shardGeo, mat: _crystalMat };
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
  _crystalMat?.dispose();
  _discGeo?.dispose();
  _discMat?.dispose();
  _timberGeo?.dispose();
  _timberMat?.dispose();
  _bulletGeo = _bulletMat = _arrowGeo = _arrowMat = _flameGeo = _globGeo = _globMat = null;
  _webMat = _shardGeo = _shardMat = _crystalMat = null;
  _discGeo = _discMat = null;
  _timberGeo = _timberMat = null;
}

/**
 * A marble-material shard burst — the same ricocheting "shard" projectiles a
 * shattered golem throws, but with tunable count/speed/damage/fuse and an
 * optional aimed FAN (baseAngle ± fan) instead of a full radial ring. Diamond
 * uses the prismatic crystal look; anything else the stone chip.
 */
export function spawnShardBurst(
  x: number,
  z: number,
  opts: { count: number; speed: number; damage: number; life: number; baseAngle?: number; fan?: number; crystal?: boolean },
): void {
  if (!state.scene) return;
  const { geo, mat } = opts.crystal ? crystalAssets() : shardAssets();
  const { count, speed, damage, life, baseAngle, fan } = opts;
  for (let n = 0; n < count; n++) {
    // Aimed fan around baseAngle, or an even radial ring when no fan is given.
    const a = fan !== undefined && baseAngle !== undefined
      ? baseAngle + (count > 1 ? (n / (count - 1) - 0.5) * 2 * fan : 0)
      : (n / count) * Math.PI * 2 + Math.random() * 0.4;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, PROJECTILE_Y, z);
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "shard",
      x,
      z,
      vx: Math.cos(a) * speed,
      vz: Math.sin(a) * speed,
      life,
      maxLife: life,
      damage,
      mesh,
      dispose: () => {},
    });
  }
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
 * The JESTER's plate: fired off its own head, and the only HOSTILE projectile
 * that ricochets.
 *
 * It rides the `shard` integration path (reflect the blocked axis, die by fuse)
 * with `hostile` set, which is the whole feature — a spitter's glob is beaten by
 * stepping behind a corner, and this is not. Damage is carried on the projectile
 * rather than looked up per hit so a plate already in the air keeps the stats it
 * was fired with, exactly like every other shot here.
 */
export function flingPlate(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = discAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "disc",
    x: sx,
    z: sz,
    vx: dx * JESTER_DISC_SPEED,
    vz: dz * JESTER_DISC_SPEED,
    life: JESTER_DISC_LIFE,
    maxLife: JESTER_DISC_LIFE,
    damage: JESTER_DISC_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/**
 * The ROTORTAIL's timber: a slow, heavy baulk thrown from altitude.
 *
 * Deliberately the SLOWEST hostile shot in the game (ROTORTAIL_TIMBER_SPEED is
 * below every player marble speed), and deliberately the hardest-hitting. The
 * whole family is built on that trade: a long visible hoist, then a shot you
 * can walk out of if you started walking — and cannot if you did not. It takes
 * the plain integration path, so it dies on the masonry like a glob; breaking
 * line of sight beats it, which is what stops a circling bombardier from being
 * unanswerable in an open room.
 *
 * The mesh is rolled onto its side at spawn and pointed down the flight line so
 * the cylinder reads as a log flying end-on rather than as a floating pillar.
 */
export function hurlTimber(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = timberAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  // Cylinder's axis is +Y: tip it flat, then yaw it ACROSS the flight line so
  // the long side faces the way it is travelling — a thrown log tumbles broadside.
  mesh.rotation.set(Math.PI / 2, 0, Math.atan2(dx, dz));
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "timber",
    x: sx,
    z: sz,
    vx: dx * ROTORTAIL_TIMBER_SPEED,
    vz: dz * ROTORTAIL_TIMBER_SPEED,
    life: ROTORTAIL_FIRE_RANGE / ROTORTAIL_TIMBER_SPEED,
    maxLife: ROTORTAIL_FIRE_RANGE / ROTORTAIL_TIMBER_SPEED,
    damage: ROTORTAIL_TIMBER_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {}, // shared geo/mat, torn down in disposeProjectileAssets
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
  // PIERCE card: how many extra foes each shot passes through (Piercer/Railgun).
  const wState = state.weaponSlots[state.activeSlot];
  // Weapon BASELINE pierce (the bow threads a lane) plus whatever the socketed
  // Piercer/Railgun cards add on top — they stack rather than override.
  const pierce =
    (w.pierce ?? 0) + (wState?.cards?.length ? aggregateCards(wState.cards).pierce : 0);

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
      pierced: w.projectile === "flame" ? 0 : pierce, // flame already passes through
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
    if (pr.kind === "shard" || pr.kind === "disc") {
      const nx = pr.x + pr.vx * dt;
      const nz = pr.z + pr.vz * dt;
      const tx = worldToTile(g, nx, pr.z);
      const hitX = !isWalkable(g, tx.i, tx.j);
      if (hitX) pr.vx = -pr.vx;
      else pr.x = nx;
      const tz = worldToTile(g, pr.x, nz);
      const hitZ = !isWalkable(g, tz.i, tz.j);
      if (hitZ) pr.vz = -pr.vz;
      else pr.z = nz;
      // The plate spins fast and SPARKS off the masonry. The spark is not
      // decoration: a hostile ricochet that bounces silently is a hit the
      // player never saw coming, so every reflection announces itself.
      pr.mesh.rotation.y += dt * (pr.kind === "disc" ? 26 : 12);
      if (pr.kind === "disc" && (hitX || hitZ)) {
        state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, pr.vx, pr.vz, 4);
      }
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

      // TIMBER TUMBLE: it turns end over end as it flies. Rotation is the only
      // motion cue on a projectile this slow — without it the log reads as a
      // static prop sliding across the floor.
      if (pr.kind === "timber") pr.mesh.rotation.y += dt * 7;

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
            // Acid splashes green; a steel plate strikes sparks; a log throws
            // splinters, which are sparks in everything but name.
            if (pr.kind === "disc" || pr.kind === "timber") {
              state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx, -pr.vz, 8);
            } else state.vfx?.blood(pr.x, PROJECTILE_Y, pr.z, "green", 6);
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
          applyCardOnHit(z);
        }
      } else {
        // `"ranged"` is what the "dodges-ranged" sub-type exception reads: a
        // Runner sidesteps an arrow it would eat from a swing. The FLAME cone
        // above stays `steel` on purpose — a wall of fire is not something you
        // step off the line of.
        damageZombie(z, pr.damage, pr.vx, pr.vz, pr.kind === "arrow" ? 0.5 : 0.3, false, "ranged");
        applyCardOnHit(z);
        // PIERCE: keep flying through this foe (one per frame, so a fast shot
        // threads a line of enemies) until the pierce budget is spent.
        if ((pr.pierced ?? 0) > 0) {
          pr.pierced = (pr.pierced ?? 0) - 1;
          state.vfx?.sparks(z.x, PROJECTILE_Y, z.z, pr.vx, pr.vz, 4);
        } else {
          consumed = true;
        }
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
