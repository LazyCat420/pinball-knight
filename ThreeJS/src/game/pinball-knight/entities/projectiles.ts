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
  CROAKER_BEAM_SPEED,
  CROAKER_BEAM_DAMAGE,
  CROAKER_FIRE_RANGE,
  CROAKER_BEAM_SPREAD,
  ROTORTAIL_TIMBER_SPEED,
  ROTORTAIL_TIMBER_DAMAGE,
  ROTORTAIL_FIRE_RANGE,
  STILTNECK_BOMB_SPEED,
  STILTNECK_BOMB_FUSE,
  STILTNECK_BLAST_RADIUS,
  STILTNECK_BLAST_DAMAGE,
  STILTNECK_BLAST_ENEMY_DAMAGE,
  STILTNECK_BLAST_PUSH,
  CURVE_ACCEL,
  WARDEN_BULLET_SPEED,
  WARDEN_BULLET_DAMAGE,
  WARDEN_BULLET_BOUNCES,
  BURGER_FIRE_RANGE,
  BURGER_DAMAGE,
  BURGER_TOMATO_SPEED,
  BURGER_LETTUCE_SPEED,
  BURGER_SAUCE_SPEED,
} from "../constants";
import { PALETTE_HEX } from "../render/palette";
import { worldToTile, isWalkable } from "../maze/generator";
import { damageZombie, playerDamage, hitPlayerRanged, webPlayer, applyCardOnHit } from "./combat";
import { aggregateCards } from "../cards";
import { sfxGun } from "../sfx/weapons";
import { sfxTarget } from "../sfx/pinball";
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
let _bombGeo: THREE.SphereGeometry | null = null;
let _bombMat: THREE.MeshBasicMaterial | null = null;
/**
 * The stiltneck's bomb. A SPHERE, and a black one.
 *
 * Every other hostile shot in the game is either a light colour (acid green,
 * pale silk, blood-red plate/beam) or a long brown bar. This one is the palette
 * void — the darkest thing available — because the read the player needs is not
 * "something is flying at me" but "THAT is the thing with the fuse", and it has
 * to survive being one of six objects in the air during a fight. It is also a
 * touch bigger than a glob: the bomb's danger is its RADIUS, and a projectile
 * that hurts a wider area than it occupies should at least look heavy.
 */
function bombAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _bombGeo ??= new THREE.SphereGeometry(0.18, 10, 8);
  _bombMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[1] }); // ink — iron casing
  return { geo: _bombGeo, mat: _bombMat };
}
let _beamGeo: THREE.BoxGeometry | null = null;
let _beamMat: THREE.MeshBasicMaterial | null = null;
/**
 * A croaker eye-beam. A LONG thin box, not a ball.
 *
 * Every other hostile shot in the game is a sphere or a plate, and the shape is
 * how a player tells at a glance what is coming at them. Length along the
 * flight line also does the job a tracer does: at CROAKER_BEAM_SPEED a round
 * projectile moves most of its own diameter per frame and reads as a
 * stroboscopic dotted line, where a 0.5-long shaft reads as a continuous bolt.
 */
function beamAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _beamGeo ??= new THREE.BoxGeometry(0.05, 0.05, 0.5);
  _beamMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[13] }); // blood light
  return { geo: _beamGeo, mat: _beamMat };
}
let _crystalMat: THREE.MeshBasicMaterial | null = null;
function crystalAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _shardGeo ??= new THREE.BoxGeometry(0.12, 0.12, 0.12);
  _crystalMat ??= new THREE.MeshBasicMaterial({ color: PALETTE_HEX[31] }); // prismatic cool
  return { geo: _shardGeo, mat: _crystalMat };
}

let _copBulletGeo: THREE.BoxGeometry | null = null;
let _copBulletMat: THREE.MeshBasicMaterial | null = null;
function copBulletAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _copBulletGeo ??= new THREE.BoxGeometry(0.09, 0.09, 0.22);
  _copBulletMat ??= new THREE.MeshBasicMaterial({ color: 0xffdd44 }); // bright brass with tracer glow
  return { geo: _copBulletGeo, mat: _copBulletMat };
}

let _tomatoGeo: THREE.CylinderGeometry | null = null;
let _tomatoMat: THREE.MeshBasicMaterial | null = null;
function tomatoAssets(): { geo: THREE.CylinderGeometry; mat: THREE.MeshBasicMaterial } {
  _tomatoGeo ??= new THREE.CylinderGeometry(0.18, 0.18, 0.04, 10);
  _tomatoMat ??= new THREE.MeshBasicMaterial({ color: 0xdc2626 }); // ripe red tomato
  return { geo: _tomatoGeo, mat: _tomatoMat };
}

let _lettuceGeo: THREE.BoxGeometry | null = null;
let _lettuceMat: THREE.MeshBasicMaterial | null = null;
function lettuceAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _lettuceGeo ??= new THREE.BoxGeometry(0.18, 0.03, 0.24);
  _lettuceMat ??= new THREE.MeshBasicMaterial({ color: 0x22c55e }); // fresh green lettuce leaf
  return { geo: _lettuceGeo, mat: _lettuceMat };
}

let _sauceGeo: THREE.SphereGeometry | null = null;
let _sauceMat: THREE.MeshBasicMaterial | null = null;
function sauceAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _sauceGeo ??= new THREE.SphereGeometry(0.13, 8, 6);
  _sauceMat ??= new THREE.MeshBasicMaterial({ color: 0xeab308 }); // tangy mustard/mayo sauce
  return { geo: _sauceGeo, mat: _sauceMat };
}

export function disposeProjectileAssets(): void {
  _bulletGeo?.dispose();
  _bulletMat?.dispose();
  _copBulletGeo?.dispose();
  _copBulletMat?.dispose();
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
  _beamGeo?.dispose();
  _beamMat?.dispose();
  _timberGeo?.dispose();
  _timberMat?.dispose();
  _bombGeo?.dispose();
  _bombMat?.dispose();
  _tomatoGeo?.dispose();
  _tomatoMat?.dispose();
  _lettuceGeo?.dispose();
  _lettuceMat?.dispose();
  _sauceGeo?.dispose();
  _sauceMat?.dispose();
  _bulletGeo = _bulletMat = _copBulletGeo = _copBulletMat = _arrowGeo = _arrowMat = _flameGeo = _globGeo = _globMat = null;
  _webMat = _shardGeo = _shardMat = _crystalMat = null;
  _discGeo = _discMat = null;
  _beamGeo = _beamMat = null;
  _timberGeo = _timberMat = null;
  _bombGeo = _bombMat = null;
  _tomatoGeo = _tomatoMat = _lettuceGeo = _lettuceMat = _sauceGeo = _sauceMat = null;
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
 * The STILTNECK's bomb: the roster's only shot with a FUSE instead of a flight.
 *
 * Every other hostile projectile is answered by the same verb — do not be on the
 * line. This one is not, because its `life` is not "range ÷ speed" the way every
 * other entry in this file computes it; it is STILTNECK_BOMB_FUSE, a wall-clock
 * countdown that started the moment the neck let go. Reaching the end of it is
 * not the shot expiring, it is the shot GOING OFF (see `updateProjectiles`,
 * where `kind === "bomb"` is the one case that detonates instead of despawning
 * quietly). A wall is the same story. So the bomb always ends in a blast, and
 * the only question is where you are standing when it does.
 */
export function slingBomb(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = bombAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "bomb",
    x: sx,
    z: sz,
    vx: dx * STILTNECK_BOMB_SPEED,
    vz: dz * STILTNECK_BOMB_SPEED,
    life: STILTNECK_BOMB_FUSE,
    maxLife: STILTNECK_BOMB_FUSE,
    damage: STILTNECK_BLAST_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {}, // shared geo/mat, torn down in disposeProjectileAssets
  });
}

/**
 * A bomb goes off at (x,z): one blast, everything inside STILTNECK_BLAST_RADIUS.
 *
 * ── THE BLAST IS INDISCRIMINATE, AND THAT IS THE MECHANIC ──────────────────
 *
 * This is the only hostile damage in the game that also hurts the HORDE. Every
 * other enemy shot takes the `pr.hostile` early-out above and never looks at
 * `state.zombies` at all, which is the right default — a room where monsters
 * casually kill each other has no threat in it. The exception is bought here on
 * purpose and paid for by the stiltneck's whole cost sheet (deepest gate,
 * slowest walk, longest tell): it turns the pack between you and the thrower
 * from an obstacle into COVER YOU CAN DETONATE, and it is the only play in the
 * game that rewards deliberately not clearing a crowd.
 *
 * Two details that are not decoration:
 *   · The reaper is skipped explicitly. `damageZombie(force = true)` is used
 *     here so the blast ignores momentum gates — an explosion does not care how
 *     fast the KNIGHT happens to be moving, and without `force` a bomb landing
 *     in a pack of goblins while the player stood still would clink off every
 *     one of them. But `force` also bypasses the Death Dealer's immunity, which
 *     is not a rule this monster gets to break.
 *   · Damage falls off with distance for the player only. The knight is asked to
 *     read a radius and commit to leaving it, so the edge of the blast has to be
 *     survivable or the read is worthless; the horde has no such contract and
 *     eats the full number, which keeps the bait play worth setting up.
 */
export function detonate(x: number, z: number): void {
  const r = STILTNECK_BLAST_RADIUS;
  const r2 = r * r;

  // ── The show ── a hot ring on the floor plus a fireball, so the radius that
  // was just applied is a radius the player SAW. A blast with no footprint is
  // damage arriving from nowhere, which is the one thing a telegraphed monster
  // must never produce.
  state.vfx?.ring(x, z, PALETTE_HEX[16], r, 0.35);
  state.vfx?.burst(x, PROJECTILE_Y, z, PALETTE_HEX[17], 22, 7);
  state.vfx?.sparks(x, PROJECTILE_Y, z, 0, 0, 10);
  state.shakeT = Math.max(state.shakeT, 0.22);

  const p = state.player;
  if (p && p.hp > 0) {
    const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d2 <= r2) {
      // Linear falloff to half at the rim, ROUNDED, with a floor of 1 so a graze
      // still costs something — a blast that can land for 0 reads as the radius
      // being a lie.
      //
      // `ceil` was the obvious choice here and it silently deleted the whole
      // falloff. STILTNECK_BLAST_DAMAGE is 2, so the scaled value only drops
      // below 1.0 in the last one-hundredth of the radius and `ceil` rounded
      // every other graze straight back up to 2. The comment said "the rim is
      // survivable"; the code charged full price everywhere inside it. With
      // `round` the inner half of the blast does 2 and the outer half does 1,
      // which is a difference the player can actually feel and act on.
      const t = 1 - Math.sqrt(d2) / r;
      hitPlayerRanged(Math.max(1, Math.round(STILTNECK_BLAST_DAMAGE * (0.5 + 0.5 * t))), x, z);
    }
  }

  const g = state.grid;
  for (const zb of state.zombies) {
    if (zb.mode === "dead") continue;
    if (zb.kind === "reaper") continue; // it cannot be harmed — `force` must not change that
    const dx = zb.x - x;
    const dz = zb.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    // Shove outward from the seat of the blast. Degenerate only if a monster is
    // exactly on it, in which case any direction will do.
    const d = Math.sqrt(d2) || 1;
    damageZombie(zb, STILTNECK_BLAST_ENEMY_DAMAGE, dx / d, dz / d, STILTNECK_BLAST_PUSH, true, "ranged");
    state.vfx?.blood(zb.x, PROJECTILE_Y, zb.z, "red", 5);
  }
}

/**
 * The CROAKER's twin eye-beams, fired as a PAIR straddling the aim line.
 *
 * The spread is the mechanic. One beam down the middle would be a spitter with
 * a different colour; two beams at ±CROAKER_BEAM_SPREAD leave a gap on the
 * exact line between the frog and the player, so a straight sprint at it
 * threads them and any lateral drift eats one. That inverts the usual advice —
 * against this one you close head-on rather than strafe — which is what makes
 * it worth having next to the spitter's volley (harder to sidestep) and the
 * jester's single ricochet (impossible to hide from).
 *
 * Beams die on masonry. The FROG is what bounces off walls, not its shot; both
 * ricocheting would be a room nobody can read.
 */
export function fireEyeBeams(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = beamAssets();
  const life = CROAKER_FIRE_RANGE / CROAKER_BEAM_SPEED;
  for (const ang of [-CROAKER_BEAM_SPREAD, CROAKER_BEAM_SPREAD]) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const bx = dx * c - dz * s;
    const bz = dx * s + dz * c;
    const mesh = new THREE.Mesh(geo, mat);
    const sx = x + bx * MUZZLE_OFFSET;
    const sz = z + bz * MUZZLE_OFFSET;
    mesh.position.set(sx, PROJECTILE_Y, sz);
    mesh.rotation.y = Math.atan2(bx, bz); // long axis down the flight line
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "beam",
      x: sx,
      z: sz,
      vx: bx * CROAKER_BEAM_SPEED,
      vz: bz * CROAKER_BEAM_SPEED,
      life,
      maxLife: life,
      damage: CROAKER_BEAM_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }
}

/**
 * The WARDEN cop's service pistol shot.
 *
 * Fires a high-velocity brass bullet with an intentional aim offset so the direct
 * trajectory bypasses the player and slams into dungeon walls. Upon hitting a wall,
 * it RICOCHETS (up to WARDEN_BULLET_BOUNCES times), throwing sparks, playing a metallic
 * ping, and becoming lethal to the player (and dealing collateral damage to other monsters).
 */
export function fireCopBullet(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = copBulletAssets();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, PROJECTILE_Y, z);
  mesh.rotation.y = Math.atan2(dx, dz);
  state.scene.add(mesh);

  // Muzzle flash + sparks + smoke puff at gunpoint
  state.vfx?.burst(x + dx * 0.4, PROJECTILE_Y, z + dz * 0.4, PALETTE_HEX[18], 5, 2.5);
  state.vfx?.sparks(x + dx * 0.4, PROJECTILE_Y, z + dz * 0.4, dx, dz, 4);
  state.vfx?.smoke(x + dx * 0.4, PROJECTILE_Y, z + dz * 0.4, 1, 0.2);
  sfxGun();

  const life = 3.5;
  state.projectiles.push({
    kind: "bullet",
    x,
    z,
    vx: dx * WARDEN_BULLET_SPEED,
    vz: dz * WARDEN_BULLET_SPEED,
    life,
    maxLife: life,
    damage: WARDEN_BULLET_DAMAGE,
    hostile: true,
    bounces: WARDEN_BULLET_BOUNCES,
    bounced: false,
    mesh,
    dispose: () => {},
  });
}

/**
 * The BURGER BEAST's deconstruct attack:
 * The hamburger separates in mid-air and flings a 3-part ingredient fan burst:
 * 1. Tomato slice (center, spinning red disc)
 * 2. Lettuce cutter (left, fluttering green leaf)
 * 3. Mustard/Mayo glob (right, sticky condiment blob that slows the player)
 */
export function flingBurgerDeconstruction(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const baseAngle = Math.atan2(dx, dz);

  // Deconstruct burst VFX
  state.vfx?.burst(x + dx * 0.3, PROJECTILE_Y, z + dz * 0.3, 0xf59e0b, 8, 1.8);

  // 1. Tomato slice (center)
  {
    const { geo, mat } = tomatoAssets();
    const mesh = new THREE.Mesh(geo, mat);
    const sx = x + dx * MUZZLE_OFFSET;
    const sz = z + dz * MUZZLE_OFFSET;
    mesh.position.set(sx, PROJECTILE_Y, sz);
    mesh.rotation.x = Math.PI / 2;
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "burger_tomato",
      x: sx,
      z: sz,
      vx: dx * BURGER_TOMATO_SPEED,
      vz: dz * BURGER_TOMATO_SPEED,
      life: BURGER_FIRE_RANGE / BURGER_TOMATO_SPEED,
      maxLife: BURGER_FIRE_RANGE / BURGER_TOMATO_SPEED,
      damage: BURGER_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }

  // 2. Lettuce blade (left fan: -0.28 rad)
  {
    const angle = baseAngle - 0.28;
    const ldx = Math.sin(angle);
    const ldz = Math.cos(angle);
    const { geo, mat } = lettuceAssets();
    const mesh = new THREE.Mesh(geo, mat);
    const sx = x + ldx * MUZZLE_OFFSET;
    const sz = z + ldz * MUZZLE_OFFSET;
    mesh.position.set(sx, PROJECTILE_Y, sz);
    mesh.rotation.y = angle;
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "burger_lettuce",
      x: sx,
      z: sz,
      vx: ldx * BURGER_LETTUCE_SPEED,
      vz: ldz * BURGER_LETTUCE_SPEED,
      life: BURGER_FIRE_RANGE / BURGER_LETTUCE_SPEED,
      maxLife: BURGER_FIRE_RANGE / BURGER_LETTUCE_SPEED,
      damage: BURGER_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }

  // 3. Mustard/Mayo glob (right fan: +0.28 rad)
  {
    const angle = baseAngle + 0.28;
    const rdx = Math.sin(angle);
    const rdz = Math.cos(angle);
    const { geo, mat } = sauceAssets();
    const mesh = new THREE.Mesh(geo, mat);
    const sx = x + rdx * MUZZLE_OFFSET;
    const sz = z + rdz * MUZZLE_OFFSET;
    mesh.position.set(sx, PROJECTILE_Y, sz);
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "burger_sauce",
      x: sx,
      z: sz,
      vx: rdx * BURGER_SAUCE_SPEED,
      vz: rdz * BURGER_SAUCE_SPEED,
      life: BURGER_FIRE_RANGE / BURGER_SAUCE_SPEED,
      maxLife: BURGER_FIRE_RANGE / BURGER_SAUCE_SPEED,
      damage: BURGER_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }
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

  // Muzzle flash — one per trigger pull, not per pellet, or a spread weapon
  // strobes. Without it the shot has no visible origin: projectiles appear a
  // MUZZLE_OFFSET ahead of the knight out of nothing. The bow gets sparks only
  // (a string has no fire), the flamer an ember-coloured tongue.
  const mx = px + fx * MUZZLE_OFFSET;
  const mz = pz + fz * MUZZLE_OFFSET;
  if (w.projectile === "flame") {
    state.vfx?.burst(mx, PROJECTILE_Y, mz, PALETTE_HEX[17], 6, 3.2);
  } else {
    state.vfx?.sparks(mx, PROJECTILE_Y, mz, fx, fz, w.projectile === "bullet" ? 6 : 3);
    if (w.projectile === "bullet") state.vfx?.burst(mx, PROJECTILE_Y, mz, PALETTE_HEX[18], 4, 2.4);
  }

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
      // For every other projectile `life` is range ÷ speed and running out means
      // the shot fell short. For a BOMB it is the fuse, and running out is the
      // whole point — a bomb nobody dodged still goes off where it got to.
      if (pr.kind === "bomb") detonate(pr.x, pr.z);
      despawn(i);
      continue;
    }


    // ── Shards & Bouncing Bullets RICOCHET: resolve each axis against the grid and reflect the
    // blocked component (they die by fuse/bounces, not by wall). Everything else
    // integrates straight and dies where it lands. ──
    if (pr.kind === "shard" || pr.kind === "disc" || (pr.bounces !== undefined && pr.bounces > 0)) {
      const nx = pr.x + pr.vx * dt;
      const nz = pr.z + pr.vz * dt;
      const tx = worldToTile(g, nx, pr.z);
      const hitX = !isWalkable(g, tx.i, tx.j);
      if (hitX) {
        pr.vx = -pr.vx;
        if (pr.bounces !== undefined) {
          pr.bounces--;
          pr.bounced = true;
          state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, pr.vx, pr.vz, 6);
          sfxTarget();
        }
      } else {
        pr.x = nx;
      }
      const tz = worldToTile(g, pr.x, nz);
      const hitZ = !isWalkable(g, tz.i, tz.j);
      if (hitZ) {
        pr.vz = -pr.vz;
        if (pr.bounces !== undefined) {
          pr.bounces--;
          pr.bounced = true;
          state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, pr.vx, pr.vz, 6);
          sfxTarget();
        }
      } else {
        pr.z = nz;
      }
      if (pr.bounces !== undefined && pr.bounces <= 0) {
        despawn(i);
        continue;
      }
      pr.mesh.rotation.y = Math.atan2(pr.vx, pr.vz);
      if (pr.kind === "disc") {
        pr.mesh.rotation.y += dt * 26;
        if (hitX || hitZ) {
          state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, pr.vx, pr.vz, 4);
        }
      } else if (pr.kind === "shard") {
        pr.mesh.rotation.y += dt * 12;
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
        } else if (pr.kind === "burger_tomato") {
          state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xdc2626, 8, 1.2);
        } else if (pr.kind === "burger_lettuce") {
          state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0x16a34a, 6, 1.0);
        } else if (pr.kind === "burger_sauce") {
          state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xeab308, 8, 1.0);
        }
        // A bomb against masonry is a bomb going off against masonry. This is
        // what stops "break line of sight" from being the free answer it is
        // against the spitter and the rotortail: duck behind a corner at close
        // range and the blast comes round it anyway.
        if (pr.kind === "bomb") detonate(pr.x, pr.z);
        despawn(i);
        continue;
      }

      // TIMBER TUMBLE: it turns end over end as it flies. Rotation is the only
      // motion cue on a projectile this slow — without it the log reads as a
      // static prop sliding across the floor.
      if (pr.kind === "timber") pr.mesh.rotation.y += dt * 7;
      if (pr.kind === "burger_tomato") pr.mesh.rotation.y += dt * 20;
      if (pr.kind === "burger_lettuce") {
        pr.mesh.rotation.y += dt * 8;
        pr.mesh.rotation.z += dt * 6;
      }

      // FUSE BURN: the bomb sheds sparks the whole way in, faster as the fuse
      // shortens. The trail is the countdown made visible — the player has to be
      // able to tell a bomb that is about to go off from one that just left, and
      // a black sphere has no other way of saying it. It also pulses bigger on
      // the last third, which is the beat that says "leave now".
      if (pr.kind === "bomb") {
        const burn = 1 - pr.life / pr.maxLife;
        state.vfx?.sparks(pr.x, PROJECTILE_Y + 0.15, pr.z, -pr.vx * 0.02, -pr.vz * 0.02, burn > 0.66 ? 2 : 1);
        pr.mesh.scale.setScalar(1 + Math.max(0, burn - 0.6) * 0.9);
      }

      // ARROW TRAIL: a faint glowing streak shed behind the shaft each frame,
      // drifting backward so it reads as motion (Wolfenstein arrow juice).
      if (pr.kind === "arrow") {
        state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx * 0.015, -pr.vz * 0.015, 1);
      }
    }

    // ── Hostile shots hit the PLAYER, not zombies (acid hurts, silk webs) ──
    if (pr.hostile) {
      // Bouncing bullets (Warden cop shot): initial direct shot always misses
      // and only damages the player AFTER bouncing off a wall.
      const canHitPlayer = pr.bounces === undefined || pr.bounced;
      const p = state.player;
      if (canHitPlayer && p && p.hp > 0) {
        const dx = p.x - pr.x;
        const dz = p.z - pr.z;
        if (dx * dx + dz * dz <= (PLAYER_R + HIT_R) * (PLAYER_R + HIT_R)) {
          if (pr.kind === "web") {
            if (p.iframes <= 0) webPlayer();
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, 0, 0, 5);
          } else if (pr.kind === "bomb") {
            detonate(pr.x, pr.z);
          } else if (pr.kind === "burger_sauce") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            if (p.iframes <= 0) webPlayer();
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xeab308, 12, 1.5);
          } else if (pr.kind === "burger_tomato") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xdc2626, 12, 1.8);
          } else if (pr.kind === "burger_lettuce") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0x16a34a, 10, 1.5);
          } else {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            if (pr.bounced) {
              state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx, -pr.vz, 8);
              state.vfx?.blood(pr.x, PROJECTILE_Y, pr.z, "red", 5);
            } else if (pr.kind === "disc" || pr.kind === "timber" || pr.kind === "beam") {
              state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx, -pr.vz, 8);
            } else state.vfx?.blood(pr.x, PROJECTILE_Y, pr.z, "green", 6);
          }
          despawn(i);
          continue;
        }
      }

      // Friendly fire: a bounced ricochet bullet can also clip other monsters
      if (pr.bounced) {
        let hitMob = false;
        for (const z of state.zombies) {
          if (z.mode === "dead") continue;
          const dx = z.x - pr.x;
          const dz = z.z - pr.z;
          if (dx * dx + dz * dz <= (ZOMBIE_R + HIT_R) * (ZOMBIE_R + HIT_R)) {
            damageZombie(z, pr.damage, pr.vx, pr.vz, 0.3, false, "ranged");
            state.vfx?.sparks(z.x, PROJECTILE_Y, z.z, pr.vx, pr.vz, 6);
            despawn(i);
            hitMob = true;
            break;
          }
        }
        if (hitMob) continue;
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
          state.vfx?.ember(z.x, 0.4, z.z);
          if (Math.random() < 0.4) state.vfx?.smoke(z.x, 0.5, z.z, 1, 0.2);
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
          state.vfx?.sparks(z.x, PROJECTILE_Y, z.z, pr.vx, pr.vz, 6);
          if (pr.kind === "arrow") state.vfx?.dust(z.x, 0.1, z.z);
        } else {
          consumed = true;
          if (pr.kind === "bullet") {
            state.vfx?.sparks(z.x, PROJECTILE_Y, z.z, pr.vx, pr.vz, 8);
            state.vfx?.burst(z.x, PROJECTILE_Y, z.z, PALETTE_HEX[18], 4, 2.8);
          } else if (pr.kind === "arrow") {
            state.vfx?.sparks(z.x, PROJECTILE_Y, z.z, pr.vx, pr.vz, 5);
            state.vfx?.dust(z.x, 0.1, z.z);
          } else if (pr.kind === "shard") {
            state.vfx?.sparks(z.x, PROJECTILE_Y, z.z, -pr.vx, -pr.vz, 4);
          }
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
