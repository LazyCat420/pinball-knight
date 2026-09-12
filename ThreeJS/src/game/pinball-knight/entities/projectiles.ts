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
  FRIES_FIRE_RANGE,
  FRIES_DAMAGE,
  FRIES_DART_SPEED,
  MILKSHAKE_FIRE_RANGE,
  MILKSHAKE_DAMAGE,
  MILKSHAKE_SPRAY_SPEED,
  SUMO_NINJA_FIRE_RANGE,
  SUMO_NINJA_DAMAGE,
  SUMO_NINJA_SHURIKEN_SPEED,
  ZIPPO_FIRE_RANGE,
  ZIPPO_DAMAGE,
  ZIPPO_FLAME_SPEED,
  CLAM_FIRE_RANGE,
  CLAM_PEARL_DAMAGE,
  CLAM_PEARL_SPEED,
  CLAM_PEARL_BOUNCE_SPEED,
  CLAM_PEARL_BOUNCES,
  PINBALL_MAX_SPEED,
  SHARK_TRAPPER_HOOK_RANGE,
  SHARK_TRAPPER_HOOK_SPEED,
  SHARK_TRAPPER_HOOK_DAMAGE,
  OCTOPUS_GUNNER_FIRE_RANGE,
  OCTOPUS_GUNNER_BULLET_SPEED,
  OCTOPUS_GUNNER_DAMAGE,
  CLOWNFISH_MOB_FIRE_RANGE,
  CLOWNFISH_MOB_BULLET_SPEED,
  CLOWNFISH_MOB_DAMAGE,
  LIONFISH_MOB_FIRE_RANGE,
  LIONFISH_MOB_SPINE_SPEED,
  LIONFISH_MOB_DAMAGE,
  ANGLERFISH_MOB_FIRE_RANGE,
  ANGLERFISH_MOB_SNIPER_SPEED,
  ANGLERFISH_MOB_DAMAGE,
  PUFFERFISH_MOB_FIRE_RANGE,
  PUFFERFISH_MOB_SLUG_SPEED,
  PUFFERFISH_MOB_DAMAGE,
  PUFFERFISH_MOB_SPIKE_SPEED,
  PUFFERFISH_MOB_SPIKE_DAMAGE,
  SWORDFISH_MOB_HARPOON_RANGE,
  SWORDFISH_MOB_HARPOON_SPEED,
  SWORDFISH_MOB_HARPOON_DAMAGE,
  MORAY_MOB_FIRE_RANGE,
  MORAY_MOB_ORB_SPEED,
  MORAY_MOB_DAMAGE,
  SEAHORSE_MOB_FIRE_RANGE,
  SEAHORSE_MOB_MORTAR_SPEED,
  SEAHORSE_MOB_DAMAGE,
  CHRISTMAS_TREE_FIRE_RANGE,
  ORNAMENT_SPEED,
  ORNAMENT_DAMAGE,
  ORNAMENT_BOUNCES,
  CORVID_BOMB_FUSE,
  CORVID_BLAST_RADIUS,
  CORVID_BLAST_DAMAGE,
  CORVID_BLAST_ENEMY_DAMAGE,
  CORVID_BLAST_PUSH,
  VULTURE_SLUDGE_RADIUS,
  VULTURE_ROT_LIFE,
  VULTURE_BLAST_DAMAGE,
  VULTURE_BLAST_ENEMY_DAMAGE,
  GULL_EGG_SPEED,
  GULL_MINI_RADIUS,
  GULL_BLAST_DAMAGE,
  GULL_BLAST_ENEMY_DAMAGE,
  FALCON_BLAST_RADIUS,
  FALCON_FIRE_LIFE,
  FALCON_BLAST_DAMAGE,
  FALCON_BLAST_ENEMY_DAMAGE,
} from "../constants";
import { spawnFloorFx } from "./floor-fx";
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

let _fryDartGeo: THREE.BoxGeometry | null = null;
let _fryDartMat: THREE.MeshBasicMaterial | null = null;
export function fryDartAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _fryDartGeo ??= new THREE.BoxGeometry(0.08, 0.08, 0.36);
  _fryDartMat ??= new THREE.MeshBasicMaterial({ color: 0xfacc15 }); // crispy golden crinkle fry
  return { geo: _fryDartGeo, mat: _fryDartMat };
}

let _shakeSprayGeo: THREE.SphereGeometry | null = null;
let _shakeSprayMat: THREE.MeshBasicMaterial | null = null;
export function shakeSprayAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _shakeSprayGeo ??= new THREE.SphereGeometry(0.12, 8, 6);
  _shakeSprayMat ??= new THREE.MeshBasicMaterial({ color: 0x84cc16 }); // toxic lime green milkshake glob
  return { geo: _shakeSprayGeo, mat: _shakeSprayMat };
}

let _shurikenGeo: THREE.CylinderGeometry | null = null;
let _shurikenMat: THREE.MeshBasicMaterial | null = null;
export function shurikenAssets(): { geo: THREE.CylinderGeometry; mat: THREE.MeshBasicMaterial } {
  _shurikenGeo ??= new THREE.CylinderGeometry(0.14, 0.14, 0.02, 4); // 4-pointed metallic diamond star
  _shurikenMat ??= new THREE.MeshBasicMaterial({ color: 0xe2e8f0 }); // gleaming metallic steel
  return { geo: _shurikenGeo, mat: _shurikenMat };
}

let _zippoFlameGeo: THREE.SphereGeometry | null = null;
let _zippoFlameMat: THREE.MeshBasicMaterial | null = null;
export function zippoFlameAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _zippoFlameGeo ??= new THREE.SphereGeometry(0.16, 8, 6);
  _zippoFlameMat ??= new THREE.MeshBasicMaterial({ color: 0xff6600 }); // fiery blazing orange
  return { geo: _zippoFlameGeo, mat: _zippoFlameMat };
}

let _pearlGeo: THREE.SphereGeometry | null = null;
let _pearlMat: THREE.MeshBasicMaterial | null = null;
export function pearlAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _pearlGeo ??= new THREE.SphereGeometry(0.18, 12, 10);
  _pearlMat ??= new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  return { geo: _pearlGeo, mat: _pearlMat };
}

let _hookGeo: THREE.CylinderGeometry | null = null;
let _hookMat: THREE.MeshBasicMaterial | null = null;
export function hookAssets(): { geo: THREE.CylinderGeometry; mat: THREE.MeshBasicMaterial } {
  _hookGeo ??= new THREE.CylinderGeometry(0.08, 0.08, 0.28, 6);
  _hookMat ??= new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
  return { geo: _hookGeo, mat: _hookMat };
}

let _octoBulletGeo: THREE.SphereGeometry | null = null;
let _octoBulletMat: THREE.MeshBasicMaterial | null = null;
export function octoBulletAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _octoBulletGeo ??= new THREE.SphereGeometry(0.12, 8, 6);
  _octoBulletMat ??= new THREE.MeshBasicMaterial({ color: 0x334155 });
  return { geo: _octoBulletGeo, mat: _octoBulletMat };
}

let _fishBulletGeo: THREE.BoxGeometry | null = null;
let _fishBulletMat: THREE.MeshBasicMaterial | null = null;
export function fishBulletAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _fishBulletGeo ??= new THREE.BoxGeometry(0.06, 0.06, 0.20);
  _fishBulletMat ??= new THREE.MeshBasicMaterial({ color: 0xd97706 });
  return { geo: _fishBulletGeo, mat: _fishBulletMat };
}

let _lionSpineGeo: THREE.CylinderGeometry | null = null;
let _lionSpineMat: THREE.MeshBasicMaterial | null = null;
export function lionSpineAssets(): { geo: THREE.CylinderGeometry; mat: THREE.MeshBasicMaterial } {
  _lionSpineGeo ??= new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6);
  _lionSpineMat ??= new THREE.MeshBasicMaterial({ color: 0xa855f7 });
  return { geo: _lionSpineGeo, mat: _lionSpineMat };
}

let _magnumBulletGeo: THREE.BoxGeometry | null = null;
let _magnumBulletMat: THREE.MeshBasicMaterial | null = null;
export function magnumBulletAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _magnumBulletGeo ??= new THREE.BoxGeometry(0.08, 0.08, 0.38);
  _magnumBulletMat ??= new THREE.MeshBasicMaterial({ color: 0xfef08a });
  return { geo: _magnumBulletGeo, mat: _magnumBulletMat };
}

let _pufferSlugGeo: THREE.SphereGeometry | null = null;
let _pufferSlugMat: THREE.MeshBasicMaterial | null = null;
export function pufferSlugAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _pufferSlugGeo ??= new THREE.SphereGeometry(0.20, 10, 8);
  _pufferSlugMat ??= new THREE.MeshBasicMaterial({ color: 0x1e293b });
  return { geo: _pufferSlugGeo, mat: _pufferSlugMat };
}

let _pufferSpikeGeo: THREE.BoxGeometry | null = null;
let _pufferSpikeMat: THREE.MeshBasicMaterial | null = null;
export function pufferSpikeAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _pufferSpikeGeo ??= new THREE.BoxGeometry(0.06, 0.06, 0.22);
  _pufferSpikeMat ??= new THREE.MeshBasicMaterial({ color: 0xf1f5f9 });
  return { geo: _pufferSpikeGeo, mat: _pufferSpikeMat };
}

let _spearBoltGeo: THREE.BoxGeometry | null = null;
let _spearBoltMat: THREE.MeshBasicMaterial | null = null;
export function spearBoltAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshBasicMaterial } {
  _spearBoltGeo ??= new THREE.BoxGeometry(0.07, 0.07, 0.48);
  _spearBoltMat ??= new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  return { geo: _spearBoltGeo, mat: _spearBoltMat };
}

let _electricBulletGeo: THREE.SphereGeometry | null = null;
let _electricBulletMat: THREE.MeshBasicMaterial | null = null;
export function electricBulletAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _electricBulletGeo ??= new THREE.SphereGeometry(0.16, 8, 6);
  _electricBulletMat ??= new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
  return { geo: _electricBulletGeo, mat: _electricBulletMat };
}

let _waterMortarGeo: THREE.SphereGeometry | null = null;
let _waterMortarMat: THREE.MeshBasicMaterial | null = null;
export function waterMortarAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _waterMortarGeo ??= new THREE.SphereGeometry(0.22, 10, 8);
  _waterMortarMat ??= new THREE.MeshBasicMaterial({ color: 0x0284c7 });
  return { geo: _waterMortarGeo, mat: _waterMortarMat };
}

let _ornamentGeo: THREE.SphereGeometry | null = null;
let _ornamentMat: THREE.MeshBasicMaterial | null = null;
export function ornamentAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _ornamentGeo ??= new THREE.SphereGeometry(0.20, 10, 8);
  _ornamentMat ??= new THREE.MeshBasicMaterial({ color: 0xef4444 });
  return { geo: _ornamentGeo, mat: _ornamentMat };
}

let _corvidBombGeo: THREE.SphereGeometry | null = null;
let _corvidBombMat: THREE.MeshBasicMaterial | null = null;
export function corvidBombAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _corvidBombGeo ??= new THREE.SphereGeometry(0.20, 10, 8);
  _corvidBombMat ??= new THREE.MeshBasicMaterial({ color: 0x18181b }); // cast iron dark charcoal
  return { geo: _corvidBombGeo, mat: _corvidBombMat };
}

let _vultureSludgeGeo: THREE.SphereGeometry | null = null;
let _vultureSludgeMat: THREE.MeshBasicMaterial | null = null;
export function vultureSludgeAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _vultureSludgeGeo ??= new THREE.SphereGeometry(0.22, 8, 6);
  _vultureSludgeMat ??= new THREE.MeshBasicMaterial({ color: 0x4d7c0f }); // toxic bile green
  return { geo: _vultureSludgeGeo, mat: _vultureSludgeMat };
}

let _gullEggGeo: THREE.SphereGeometry | null = null;
let _gullEggMat: THREE.MeshBasicMaterial | null = null;
export function gullEggAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _gullEggGeo ??= new THREE.SphereGeometry(0.18, 9, 7);
  _gullEggMat ??= new THREE.MeshBasicMaterial({ color: 0xfef08a }); // speckled egg cream
  return { geo: _gullEggGeo, mat: _gullEggMat };
}

let _gullMiniGeo: THREE.SphereGeometry | null = null;
let _gullMiniMat: THREE.MeshBasicMaterial | null = null;
export function gullMiniAssets(): { geo: THREE.SphereGeometry; mat: THREE.MeshBasicMaterial } {
  _gullMiniGeo ??= new THREE.SphereGeometry(0.11, 7, 5);
  _gullMiniMat ??= new THREE.MeshBasicMaterial({ color: 0xfbbf24 }); // amber yolk mini
  return { geo: _gullMiniGeo, mat: _gullMiniMat };
}

let _falconFireGeo: THREE.CylinderGeometry | null = null;
let _falconFireMat: THREE.MeshBasicMaterial | null = null;
export function falconFireBombAssets(): { geo: THREE.CylinderGeometry; mat: THREE.MeshBasicMaterial } {
  _falconFireGeo ??= new THREE.CylinderGeometry(0.08, 0.12, 0.32, 8);
  _falconFireMat ??= new THREE.MeshBasicMaterial({ color: 0xe11d48 }); // incendiary scarlet
  return { geo: _falconFireGeo, mat: _falconFireMat };
}

export function disposeProjectileAssets(): void {
  _ornamentGeo?.dispose(); _ornamentGeo = null; _ornamentMat?.dispose(); _ornamentMat = null;
  _corvidBombGeo?.dispose(); _corvidBombGeo = null; _corvidBombMat?.dispose(); _corvidBombMat = null;
  _vultureSludgeGeo?.dispose(); _vultureSludgeGeo = null; _vultureSludgeMat?.dispose(); _vultureSludgeMat = null;
  _gullEggGeo?.dispose(); _gullEggGeo = null; _gullEggMat?.dispose(); _gullEggMat = null;
  _gullMiniGeo?.dispose(); _gullMiniGeo = null; _gullMiniMat?.dispose(); _gullMiniMat = null;
  _falconFireGeo?.dispose(); _falconFireGeo = null; _falconFireMat?.dispose(); _falconFireMat = null;
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
  _fryDartGeo?.dispose();
  _fryDartMat?.dispose();
  _fryDartGeo = null;
  _fryDartMat = null;
  _shakeSprayGeo?.dispose();
  _shakeSprayMat?.dispose();
  _shakeSprayGeo = null;
  _shakeSprayMat = null;
  _shurikenGeo?.dispose();
  _shurikenMat?.dispose();
  _shurikenGeo = null;
  _shurikenMat = null;
  _zippoFlameGeo?.dispose();
  _zippoFlameGeo = null;
  _zippoFlameMat?.dispose();
  _zippoFlameMat = null;
  _pearlGeo?.dispose();
  _pearlGeo = null;
  _pearlMat?.dispose();
  _pearlMat = null;
  _hookGeo?.dispose(); _hookGeo = null; _hookMat?.dispose(); _hookMat = null;
  _octoBulletGeo?.dispose(); _octoBulletGeo = null; _octoBulletMat?.dispose(); _octoBulletMat = null;
  _fishBulletGeo?.dispose(); _fishBulletGeo = null; _fishBulletMat?.dispose(); _fishBulletMat = null;
  _lionSpineGeo?.dispose(); _lionSpineGeo = null; _lionSpineMat?.dispose(); _lionSpineMat = null;
  _magnumBulletGeo?.dispose(); _magnumBulletGeo = null; _magnumBulletMat?.dispose(); _magnumBulletMat = null;
  _pufferSlugGeo?.dispose(); _pufferSlugGeo = null; _pufferSlugMat?.dispose(); _pufferSlugMat = null;
  _pufferSpikeGeo?.dispose(); _pufferSpikeGeo = null; _pufferSpikeMat?.dispose(); _pufferSpikeMat = null;
  _spearBoltGeo?.dispose(); _spearBoltGeo = null; _spearBoltMat?.dispose(); _spearBoltMat = null;
  _electricBulletGeo?.dispose(); _electricBulletGeo = null; _electricBulletMat?.dispose(); _electricBulletMat = null;
  _waterMortarGeo?.dispose(); _waterMortarGeo = null; _waterMortarMat?.dispose(); _waterMortarMat = null;
  _bulletGeo = _bulletMat = _copBulletGeo = _copBulletMat = _arrowGeo = _arrowMat = _flameGeo = _globGeo = _globMat = null;
  _webMat = _shardGeo = _shardMat = _crystalMat = null;
  _discGeo = _discMat = null;
  _beamGeo = _beamMat = null;
  _timberGeo = _timberMat = null;
  _bombGeo = _bombMat = null;
  _tomatoGeo = _tomatoMat = _lettuceGeo = _lettuceMat = _sauceGeo = _sauceMat = _fryDartGeo = _fryDartMat = null;
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
 * RAVEN BOMBARDIER: drops a heavy cast-iron timed delay bomb onto the corridor floor.
 */
export function dropCorvidBomb(x: number, z: number, dx = 0, dz = 0): void {
  if (!state.scene) return;
  const { geo, mat } = corvidBombAssets();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, PROJECTILE_Y, z);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "corvid_bomb",
    x,
    z,
    vx: dx * 1.5,
    vz: dz * 1.5,
    life: CORVID_BOMB_FUSE,
    maxLife: CORVID_BOMB_FUSE,
    damage: CORVID_BLAST_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

export function detonateCorvidBomb(x: number, z: number): void {
  const r = CORVID_BLAST_RADIUS;
  const r2 = r * r;

  state.vfx?.ring(x, z, PALETTE_HEX[16], r, 0.4);
  state.vfx?.burst(x, PROJECTILE_Y, z, PALETTE_HEX[17], 24, 8);
  state.vfx?.sparks(x, PROJECTILE_Y, z, 0, 0, 12);
  state.shakeT = Math.max(state.shakeT, 0.28);

  const p = state.player;
  if (p && p.hp > 0) {
    const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d2 <= r2) {
      const t = 1 - Math.sqrt(d2) / r;
      hitPlayerRanged(Math.max(1, Math.round(CORVID_BLAST_DAMAGE * (0.5 + 0.5 * t))), x, z);
    }
  }

  for (const zb of state.zombies) {
    if (zb.mode === "dead") continue;
    if (zb.kind === "reaper") continue;
    const dx = zb.x - x;
    const dz = zb.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2) || 1;
    damageZombie(zb, CORVID_BLAST_ENEMY_DAMAGE, dx / d, dz / d, CORVID_BLAST_PUSH, true, "ranged");
    state.vfx?.blood(zb.x, PROJECTILE_Y, zb.z, "red", 6);
  }
}

/**
 * BONE VULTURE: drops a heavy toxic sludge bomb vertically from altitude.
 */
export function dropVultureBomb(x: number, z: number): void {
  if (!state.scene) return;
  const { geo, mat } = vultureSludgeAssets();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, PROJECTILE_Y, z);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "vulture_sludge_bomb",
    x,
    z,
    vx: 0,
    vz: 0,
    life: 1.2,
    maxLife: 1.2,
    damage: VULTURE_BLAST_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

export function detonateVultureSludge(x: number, z: number): void {
  const r = VULTURE_SLUDGE_RADIUS;
  const r2 = r * r;

  state.vfx?.ring(x, z, 0x84cc16, r, 0.4);
  state.vfx?.burst(x, PROJECTILE_Y, z, 0x4d7c0f, 20, 6);
  state.vfx?.smoke(x, PROJECTILE_Y, z, 1.2, 10);
  state.shakeT = Math.max(state.shakeT, 0.18);

  // Spawns lingering toxic rot / tar floor hazard puddles
  spawnFloorFx("rot", x, z, VULTURE_SLUDGE_RADIUS, VULTURE_ROT_LIFE, true);
  spawnFloorFx("tar", x, z, VULTURE_SLUDGE_RADIUS * 0.85, VULTURE_ROT_LIFE, true);

  const p = state.player;
  if (p && p.hp > 0) {
    const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d2 <= r2) {
      const t = 1 - Math.sqrt(d2) / r;
      hitPlayerRanged(Math.max(1, Math.round(VULTURE_BLAST_DAMAGE * (0.5 + 0.5 * t))), x, z);
    }
  }

  for (const zb of state.zombies) {
    if (zb.mode === "dead") continue;
    if (zb.kind === "reaper") continue;
    const dx = zb.x - x;
    const dz = zb.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2) || 1;
    damageZombie(zb, VULTURE_BLAST_ENEMY_DAMAGE, dx / d, dz / d, 1.2, true, "ranged");
    state.vfx?.blood(zb.x, PROJECTILE_Y, zb.z, "green", 5);
  }
}

/**
 * PLUNDER GULL: drops a bouncing cluster egg bomb that ricochets and fragments into 3 mini bomblets.
 */
export function dropGullClusterBomb(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = gullEggAssets();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, PROJECTILE_Y, z);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "gull_egg_bomb",
    x,
    z,
    vx: dx * GULL_EGG_SPEED,
    vz: dz * GULL_EGG_SPEED,
    life: 1.5,
    maxLife: 1.5,
    damage: GULL_BLAST_DAMAGE,
    hostile: true,
    bounces: 1,
    mesh,
    dispose: () => {},
  });
}

export function dropGullMiniBomb(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = gullMiniAssets();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, PROJECTILE_Y, z);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "gull_mini_bomb",
    x,
    z,
    vx: dx * 3.2,
    vz: dz * 3.2,
    life: 0.65,
    maxLife: 0.65,
    damage: GULL_BLAST_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

export function detonateGullEgg(x: number, z: number): void {
  state.vfx?.burst(x, PROJECTILE_Y, z, 0xfef08a, 12, 1.8);
  state.vfx?.sparks(x, PROJECTILE_Y, z, 0, 0, 6);
  // Spawn 3 mini-bomblets in a triangular spread
  const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  for (const baseA of angles) {
    const a = baseA + (Math.random() - 0.5) * 0.3;
    dropGullMiniBomb(x, z, Math.cos(a), Math.sin(a));
  }
}

export function detonateGullMini(x: number, z: number): void {
  const r = GULL_MINI_RADIUS;
  const r2 = r * r;
  state.vfx?.burst(x, PROJECTILE_Y, z, 0xfacc15, 10, 1.5);
  state.vfx?.sparks(x, PROJECTILE_Y, z, 0, 0, 5);
  state.shakeT = Math.max(state.shakeT, 0.12);

  const p = state.player;
  if (p && p.hp > 0) {
    const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d2 <= r2) {
      hitPlayerRanged(GULL_BLAST_DAMAGE, x, z);
    }
  }

  for (const zb of state.zombies) {
    if (zb.mode === "dead") continue;
    if (zb.kind === "reaper") continue;
    const dx = zb.x - x;
    const dz = zb.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2) || 1;
    damageZombie(zb, GULL_BLAST_ENEMY_DAMAGE, dx / d, dz / d, 0.8, true, "ranged");
    state.vfx?.blood(zb.x, PROJECTILE_Y, zb.z, "red", 3);
  }
}

/**
 * PEREGRINE SCREAMER: drops a supersonic incendiary napalm bomb leaving burning corridors.
 */
export function dropFalconFireBomb(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = falconFireBombAssets();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, PROJECTILE_Y, z);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "falcon_fire_bomb",
    x,
    z,
    vx: dx * 7.5,
    vz: dz * 7.5,
    life: 1.2,
    maxLife: 1.2,
    damage: FALCON_BLAST_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

export function detonateFalconFire(x: number, z: number): void {
  const r = FALCON_BLAST_RADIUS;
  const r2 = r * r;

  state.vfx?.ring(x, z, 0xf97316, r, 0.45);
  state.vfx?.burst(x, PROJECTILE_Y, z, 0xef4444, 22, 7);
  state.vfx?.smoke(x, PROJECTILE_Y, z, 1.0, 12);
  state.shakeT = Math.max(state.shakeT, 0.22);

  // Spawn fire hazard in the corridor
  spawnFloorFx("fire", x, z, FALCON_BLAST_RADIUS, FALCON_FIRE_LIFE, true);

  const p = state.player;
  if (p && p.hp > 0) {
    const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d2 <= r2) {
      const t = 1 - Math.sqrt(d2) / r;
      hitPlayerRanged(Math.max(1, Math.round(FALCON_BLAST_DAMAGE * (0.5 + 0.5 * t))), x, z);
    }
  }

  for (const zb of state.zombies) {
    if (zb.mode === "dead") continue;
    if (zb.kind === "reaper") continue;
    const dx = zb.x - x;
    const dz = zb.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2) || 1;
    damageZombie(zb, FALCON_BLAST_ENEMY_DAMAGE, dx / d, dz / d, 1.5, true, "ranged");
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
 * The FRY SENTINEL's head-rocket attack:
 * Fires a 3-shot burst of sizzling crinkle-cut fries launched right out of its head carton!
 */
export function launchFryBarrage(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const baseAngle = Math.atan2(dx, dz);

  // Sizzling steam & spark VFX at head carton muzzle
  state.vfx?.sparks(x + dx * 0.2, PROJECTILE_Y + 0.2, z + dz * 0.2, dx * 1.5, dz * 1.5, 6);

  // 3 crinkle-cut fries in a spread (-0.18, 0, +0.18 rad)
  for (const offset of [-0.18, 0, 0.18]) {
    const angle = baseAngle + offset;
    const fdx = Math.sin(angle);
    const fdz = Math.cos(angle);
    const { geo, mat } = fryDartAssets();
    const mesh = new THREE.Mesh(geo, mat);
    const sx = x + fdx * MUZZLE_OFFSET;
    const sz = z + fdz * MUZZLE_OFFSET;
    mesh.position.set(sx, PROJECTILE_Y, sz);
    mesh.rotation.y = angle;
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "fry_dart",
      x: sx,
      z: sz,
      vx: fdx * FRIES_DART_SPEED,
      vz: fdz * FRIES_DART_SPEED,
      life: FRIES_FIRE_RANGE / FRIES_DART_SPEED,
      maxLife: FRIES_FIRE_RANGE / FRIES_DART_SPEED,
      damage: FRIES_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }
}

export function launchMilkshakeSpray(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const baseAngle = Math.atan2(dx, dz);

  // Sizzling green toxic vapor puff at straw nozzle
  state.vfx?.sparks(x + dx * 0.2, PROJECTILE_Y + 0.15, z + dz * 0.2, dx * 1.2, dz * 1.2, 5);

  // 4 sizzling toxic globules in a spray fan (-0.20, -0.06, +0.06, +0.20 rad)
  for (const offset of [-0.20, -0.06, 0.06, 0.20]) {
    const angle = baseAngle + offset;
    const fdx = Math.sin(angle);
    const fdz = Math.cos(angle);
    const { geo, mat } = shakeSprayAssets();
    const mesh = new THREE.Mesh(geo, mat);
    const sx = x + fdx * MUZZLE_OFFSET;
    const sz = z + fdz * MUZZLE_OFFSET;
    mesh.position.set(sx, PROJECTILE_Y, sz);
    mesh.rotation.y = angle;
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "shake_spray",
      x: sx,
      z: sz,
      vx: fdx * MILKSHAKE_SPRAY_SPEED,
      vz: fdz * MILKSHAKE_SPRAY_SPEED,
      life: MILKSHAKE_FIRE_RANGE / MILKSHAKE_SPRAY_SPEED,
      maxLife: MILKSHAKE_FIRE_RANGE / MILKSHAKE_SPRAY_SPEED,
      damage: MILKSHAKE_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }
}

export function launchShuriken(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const baseAngle = Math.atan2(dx, dz);

  // Metallic glint sparks at throw release
  state.vfx?.sparks(x + dx * 0.25, PROJECTILE_Y + 0.1, z + dz * 0.25, dx * 1.5, dz * 1.5, 6);

  // Stumbling sumo flings 2 spinning stars with slight drunken spread (-0.12, +0.12 rad)
  for (const offset of [-0.12, 0.12]) {
    const angle = baseAngle + offset;
    const fdx = Math.sin(angle);
    const fdz = Math.cos(angle);
    const { geo, mat } = shurikenAssets();
    const mesh = new THREE.Mesh(geo, mat);
    const sx = x + fdx * MUZZLE_OFFSET;
    const sz = z + fdz * MUZZLE_OFFSET;
    mesh.position.set(sx, PROJECTILE_Y, sz);
    mesh.rotation.y = angle;
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "shuriken",
      x: sx,
      z: sz,
      vx: fdx * SUMO_NINJA_SHURIKEN_SPEED,
      vz: fdz * SUMO_NINJA_SHURIKEN_SPEED,
      life: SUMO_NINJA_FIRE_RANGE / SUMO_NINJA_SHURIKEN_SPEED,
      maxLife: SUMO_NINJA_FIRE_RANGE / SUMO_NINJA_SHURIKEN_SPEED,
      damage: SUMO_NINJA_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }
}

export function launchZippoFlameBreath(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const baseAngle = Math.atan2(dx, dz);

  // Fiery sparks & smoke puff at lighter mouth
  state.vfx?.sparks(x + dx * 0.25, PROJECTILE_Y + 0.1, z + dz * 0.25, dx * 1.5, dz * 1.5, 6);
  state.vfx?.smoke(x + dx * 0.2, PROJECTILE_Y + 0.05, z + dz * 0.2, 0.5);

  // Expanding 5-shot fire breath fan (-0.22, -0.10, 0, 0.10, 0.22 rad)
  for (const offset of [-0.22, -0.10, 0, 0.10, 0.22]) {
    const angle = baseAngle + offset;
    const fdx = Math.sin(angle);
    const fdz = Math.cos(angle);
    const { geo, mat } = zippoFlameAssets();
    const mesh = new THREE.Mesh(geo, mat);
    const sx = x + fdx * MUZZLE_OFFSET;
    const sz = z + fdz * MUZZLE_OFFSET;
    mesh.position.set(sx, PROJECTILE_Y, sz);
    mesh.rotation.y = angle;
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "zippo_flame",
      x: sx,
      z: sz,
      vx: fdx * ZIPPO_FLAME_SPEED,
      vz: fdz * ZIPPO_FLAME_SPEED,
      life: ZIPPO_FIRE_RANGE / ZIPPO_FLAME_SPEED,
      maxLife: ZIPPO_FIRE_RANGE / ZIPPO_FLAME_SPEED,
      damage: ZIPPO_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }
}

/**
 * An Old Clam's hostile bouncy pearl projectile: launched from (x, z) along (dx, dz).
 * Bounces off walls up to CLAM_PEARL_BOUNCES times, and on contact with the player,
 * inflicts slight damage and imparts a high-velocity pinball bounce impulse that
 * completely disrupts player trajectory.
 */
export function spitPearl(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = pearlAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "pearl",
    x: sx,
    z: sz,
    vx: dx * CLAM_PEARL_SPEED,
    vz: dz * CLAM_PEARL_SPEED,
    life: (CLAM_FIRE_RANGE / CLAM_PEARL_SPEED) * 2.5,
    maxLife: (CLAM_FIRE_RANGE / CLAM_PEARL_SPEED) * 2.5,
    damage: CLAM_PEARL_DAMAGE,
    hostile: true,
    bounces: CLAM_PEARL_BOUNCES,
    mesh,
    dispose: () => {},
  });
}

/** Shark Trapper's fishing hook */
export function launchFishingHook(x: number, z: number, dx: number, dz: number, ownerNid?: string): void {
  if (!state.scene) return;
  const { geo, mat } = hookAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  mesh.rotation.x = Math.PI / 2;
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "fishing_hook",
    x: sx,
    z: sz,
    vx: dx * SHARK_TRAPPER_HOOK_SPEED,
    vz: dz * SHARK_TRAPPER_HOOK_SPEED,
    life: SHARK_TRAPPER_HOOK_RANGE / SHARK_TRAPPER_HOOK_SPEED,
    maxLife: SHARK_TRAPPER_HOOK_RANGE / SHARK_TRAPPER_HOOK_SPEED,
    damage: SHARK_TRAPPER_HOOK_DAMAGE,
    hostile: true,
    ownerNid,
    mesh,
    dispose: () => {},
  });
}

/** Octopus Mob Boss 8-way bullet */
export function shootOctoBullet(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = octoBulletAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "octo_bullet",
    x: sx,
    z: sz,
    vx: dx * OCTOPUS_GUNNER_BULLET_SPEED,
    vz: dz * OCTOPUS_GUNNER_BULLET_SPEED,
    life: OCTOPUS_GUNNER_FIRE_RANGE / OCTOPUS_GUNNER_BULLET_SPEED,
    maxLife: OCTOPUS_GUNNER_FIRE_RANGE / OCTOPUS_GUNNER_BULLET_SPEED,
    damage: OCTOPUS_GUNNER_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/** Clownfish Mobster tommy gun bullet */
export function shootFishBullet(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = fishBulletAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  mesh.rotation.y = Math.atan2(dx, dz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "fish_bullet",
    x: sx,
    z: sz,
    vx: dx * CLOWNFISH_MOB_BULLET_SPEED,
    vz: dz * CLOWNFISH_MOB_BULLET_SPEED,
    life: CLOWNFISH_MOB_FIRE_RANGE / CLOWNFISH_MOB_BULLET_SPEED,
    maxLife: CLOWNFISH_MOB_FIRE_RANGE / CLOWNFISH_MOB_BULLET_SPEED,
    damage: CLOWNFISH_MOB_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/** Lionfish Mob Enforcer venom spine */
export function shootLionSpine(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = lionSpineAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  mesh.rotation.x = Math.PI / 2;
  mesh.rotation.z = -Math.atan2(dx, dz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "lion_spine",
    x: sx,
    z: sz,
    vx: dx * LIONFISH_MOB_SPINE_SPEED,
    vz: dz * LIONFISH_MOB_SPINE_SPEED,
    life: LIONFISH_MOB_FIRE_RANGE / LIONFISH_MOB_SPINE_SPEED,
    maxLife: LIONFISH_MOB_FIRE_RANGE / LIONFISH_MOB_SPINE_SPEED,
    damage: LIONFISH_MOB_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/** Anglerfish Hitman sniper slug */
export function shootMagnumBullet(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = magnumBulletAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  mesh.rotation.y = Math.atan2(dx, dz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "magnum_bullet",
    x: sx,
    z: sz,
    vx: dx * ANGLERFISH_MOB_SNIPER_SPEED,
    vz: dz * ANGLERFISH_MOB_SNIPER_SPEED,
    life: ANGLERFISH_MOB_FIRE_RANGE / ANGLERFISH_MOB_SNIPER_SPEED,
    maxLife: ANGLERFISH_MOB_FIRE_RANGE / ANGLERFISH_MOB_SNIPER_SPEED,
    damage: ANGLERFISH_MOB_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/** Pufferfish Capo blunderbuss slug */
export function shootPufferSlug(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = pufferSlugAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "puffer_slug",
    x: sx,
    z: sz,
    vx: dx * PUFFERFISH_MOB_SLUG_SPEED,
    vz: dz * PUFFERFISH_MOB_SLUG_SPEED,
    life: PUFFERFISH_MOB_FIRE_RANGE / PUFFERFISH_MOB_SLUG_SPEED,
    maxLife: PUFFERFISH_MOB_FIRE_RANGE / PUFFERFISH_MOB_SLUG_SPEED,
    damage: PUFFERFISH_MOB_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/** Pufferfish Capo 8-way death spike explosion */
export function burstPufferSpikes(x: number, z: number): void {
  if (!state.scene) return;
  const { geo, mat } = pufferSpikeAssets();
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, PROJECTILE_Y, z);
    mesh.rotation.y = angle;
    state.scene.add(mesh);
    state.projectiles.push({
      kind: "puffer_spike",
      x,
      z,
      vx: dx * PUFFERFISH_MOB_SPIKE_SPEED,
      vz: dz * PUFFERFISH_MOB_SPIKE_SPEED,
      life: 0.9,
      maxLife: 0.9,
      damage: PUFFERFISH_MOB_SPIKE_DAMAGE,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }
}

/** Swordfish Mobster harpoon speargun bolt */
export function shootSpearBolt(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = spearBoltAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  mesh.rotation.y = Math.atan2(dx, dz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "spear_bolt",
    x: sx,
    z: sz,
    vx: dx * SWORDFISH_MOB_HARPOON_SPEED,
    vz: dz * SWORDFISH_MOB_HARPOON_SPEED,
    life: SWORDFISH_MOB_HARPOON_RANGE / SWORDFISH_MOB_HARPOON_SPEED,
    maxLife: SWORDFISH_MOB_HARPOON_RANGE / SWORDFISH_MOB_HARPOON_SPEED,
    damage: SWORDFISH_MOB_HARPOON_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/** Moray Eel Mobster electric shock orb */
export function shootElectricBullet(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = electricBulletAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "electric_bullet",
    x: sx,
    z: sz,
    vx: dx * MORAY_MOB_ORB_SPEED,
    vz: dz * MORAY_MOB_ORB_SPEED,
    life: MORAY_MOB_FIRE_RANGE / MORAY_MOB_ORB_SPEED,
    maxLife: MORAY_MOB_FIRE_RANGE / MORAY_MOB_ORB_SPEED,
    damage: MORAY_MOB_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/** Seahorse Mobster arcing water mortar */
export function launchWaterMortar(x: number, z: number, targetX: number, targetZ: number): void {
  if (!state.scene) return;
  const { geo, mat } = waterMortarAssets();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, PROJECTILE_Y, z);
  state.scene.add(mesh);
  const dx = targetX - x;
  const dz = targetZ - z;
  const dist = Math.hypot(dx, dz) || 1;
  const flightTime = Math.max(0.6, dist / SEAHORSE_MOB_MORTAR_SPEED);
  state.projectiles.push({
    kind: "water_mortar",
    x,
    z,
    startX: x,
    startZ: z,
    targetX,
    targetZ,
    vx: dx / flightTime,
    vz: dz / flightTime,
    life: flightTime,
    maxLife: flightTime,
    damage: SEAHORSE_MOB_DAMAGE,
    hostile: true,
    mesh,
    dispose: () => {},
  });
}

/** Christmas Tree thrown festive ornament projectile */
export function launchOrnament(x: number, z: number, dx: number, dz: number): void {
  if (!state.scene) return;
  const { geo, mat } = ornamentAssets();
  const mesh = new THREE.Mesh(geo, mat);
  const sx = x + dx * MUZZLE_OFFSET;
  const sz = z + dz * MUZZLE_OFFSET;
  mesh.position.set(sx, PROJECTILE_Y + 0.1, sz);
  state.scene.add(mesh);
  state.projectiles.push({
    kind: "ornament",
    x: sx,
    z: sz,
    vx: dx * ORNAMENT_SPEED,
    vz: dz * ORNAMENT_SPEED,
    life: (CHRISTMAS_TREE_FIRE_RANGE / ORNAMENT_SPEED) * 2.0,
    maxLife: (CHRISTMAS_TREE_FIRE_RANGE / ORNAMENT_SPEED) * 2.0,
    damage: ORNAMENT_DAMAGE,
    hostile: true,
    bounces: ORNAMENT_BOUNCES,
    mesh,
    dispose: () => {},
  });
  state.vfx?.sparks(sx, PROJECTILE_Y + 0.1, sz, dx, dz, 4);
}

/**
 * BLASTER FRANK — Shoots revolver straight up into the ceiling/sky!
 * Launches an arc of falling bullets that crash down around target coordinates,
 * kicking up warning dust, dealing splash damage to players, and collateral damage to foes.
 */
export function launchSkyVolley(x: number, z: number, targetX: number, targetZ: number): void {
  if (!state.scene) return;

  // Overhead muzzle flash and loud gunshot
  sfxGun();
  state.vfx?.burst(x, PROJECTILE_Y + 0.8, z, 0xf59e0b, 12, 2.5);
  state.vfx?.sparks(x, PROJECTILE_Y + 0.8, z, 0, 1.5, 6);
  state.vfx?.smoke(x, PROJECTILE_Y + 0.8, z, 1.0, 0.4);

  const bulletCount = 3;
  for (let b = 0; b < bulletCount; b++) {
    const spreadAngle = (b / bulletCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const spreadDist = 0.3 + Math.random() * 1.2;
    const tx = targetX + Math.cos(spreadAngle) * spreadDist;
    const tz = targetZ + Math.sin(spreadAngle) * spreadDist;

    const { geo, mat } = copBulletAssets();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, PROJECTILE_Y + 0.5, z);
    state.scene.add(mesh);

    const flightTime = 0.75 + b * 0.15;
    const dx = tx - x;
    const dz = tz - z;

    state.projectiles.push({
      kind: "sky_bullet",
      x,
      z,
      startX: x,
      startZ: z,
      targetX: tx,
      targetZ: tz,
      vx: dx / flightTime,
      vz: dz / flightTime,
      life: flightTime,
      maxLife: flightTime,
      damage: 2,
      hostile: true,
      mesh,
      dispose: () => {},
    });
  }
}

/**
 * BLASTER FRANK — Random trigger misfire that fires a wild stray ricocheting bullet!
 */
export function fireWildBullet(x: number, z: number, angle: number): void {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  fireCopBullet(x, z, dx, dz);
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
      if (pr.kind === "corvid_bomb") detonateCorvidBomb(pr.x, pr.z);
      if (pr.kind === "vulture_sludge_bomb") detonateVultureSludge(pr.x, pr.z);
      if (pr.kind === "gull_egg_bomb") detonateGullEgg(pr.x, pr.z);
      if (pr.kind === "gull_mini_bomb") detonateGullMini(pr.x, pr.z);
      if (pr.kind === "falcon_fire_bomb") detonateFalconFire(pr.x, pr.z);
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
      if (pr.kind === "water_mortar" || pr.kind === "sky_bullet") {
        const u = 1 - pr.life / pr.maxLife;
        const peakH = pr.kind === "sky_bullet" ? 4.5 : 2.2;
        const h = 4 * peakH * u * (1 - u);
        pr.mesh.position.y = PROJECTILE_Y + h;
        pr.mesh.position.x = pr.x;
        pr.mesh.position.z = pr.z;

        if (pr.kind === "sky_bullet" && pr.targetX !== undefined && pr.targetZ !== undefined && u > 0.35) {
          state.vfx?.dust(pr.targetX, 0.05, pr.targetZ);
        }

        if (pr.life <= dt) {
          if (pr.kind === "sky_bullet") {
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xf59e0b, 14, 2.0);
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, 0, 1.5, 8);
            state.vfx?.smoke(pr.x, PROJECTILE_Y, pr.z, 0.6, 0.2);
            state.shakeT = Math.max(state.shakeT, 0.12);
            const p = state.player;
            if (p && Math.hypot(p.x - pr.x, p.z - pr.z) < 1.2) {
              hitPlayerRanged(pr.damage, pr.x, pr.z);
            }
            for (const foe of state.zombies) {
              if (foe.mode === "dead") continue;
              if (Math.hypot(foe.x - pr.x, foe.z - pr.z) < 1.1) {
                damageZombie(foe, 3, 0, 0, 0.3, false, "ranged");
              }
            }
          } else {
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0x0284c7, 16, 2.0);
            spawnFloorFx("slick", pr.x, pr.z, 1.2, 4.0, true);
            const p = state.player;
            if (p && Math.hypot(p.x - pr.x, p.z - pr.z) < 1.4) {
              hitPlayerRanged(pr.damage, pr.x, pr.z);
            }
          }
          despawn(i);
          continue;
        }
        continue;
      } else {
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
          } else if (pr.kind === "fry_dart") {
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xfacc15, 8, 1.2);
          } else if (pr.kind === "shake_spray") {
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0x84cc16, 8, 1.3);
          } else if (pr.kind === "shuriken") {
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xe2e8f0, 8, 1.4);
          } else if (pr.kind === "zippo_flame") {
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xff6600, 10, 1.4);
          } else if (pr.kind === "puffer_slug") {
            burstPufferSpikes(pr.x, pr.z);
          } else if (pr.kind === "electric_bullet") {
            spawnFloorFx("shock", pr.x, pr.z, 1.2, 3.0, true);
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, 0, 0, 8);
          }
          if (pr.kind === "bomb") detonate(pr.x, pr.z);
          if (pr.kind === "corvid_bomb") detonateCorvidBomb(pr.x, pr.z);
          if (pr.kind === "vulture_sludge_bomb") detonateVultureSludge(pr.x, pr.z);
          if (pr.kind === "gull_egg_bomb") detonateGullEgg(pr.x, pr.z);
          if (pr.kind === "gull_mini_bomb") detonateGullMini(pr.x, pr.z);
          if (pr.kind === "falcon_fire_bomb") detonateFalconFire(pr.x, pr.z);
          despawn(i);
          continue;
        }
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
      if (pr.kind === "fry_dart") {
        pr.mesh.rotation.z += dt * 15;
      }
      if (pr.kind === "shake_spray") {
        pr.mesh.rotation.y += dt * 10;
        state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx * 0.01, -pr.vz * 0.01, 1);
      }
      if (pr.kind === "shuriken") {
        pr.mesh.rotation.y += dt * 35;
        state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx * 0.01, -pr.vz * 0.01, 1);
      }
      if (pr.kind === "zippo_flame") {
        pr.mesh.rotation.y += dt * 15;
        state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx * 0.02, -pr.vz * 0.02, 1);
      }

      // FUSE BURN: the bomb sheds sparks the whole way in, faster as the fuse
      // shortens. The trail is the countdown made visible — the player has to be
      // able to tell a bomb that is about to go off from one that just left, and
      // a black sphere has no other way of saying it. It also pulses bigger on
      // the last third, which is the beat that says "leave now".
      if (pr.kind === "bomb" || pr.kind === "corvid_bomb") {
        const burn = 1 - pr.life / pr.maxLife;
        state.vfx?.sparks(pr.x, PROJECTILE_Y + 0.15, pr.z, -pr.vx * 0.02, -pr.vz * 0.02, burn > 0.66 ? 2 : 1);
        pr.mesh.scale.setScalar(1 + Math.max(0, burn - 0.6) * 0.9);
      }
      if (pr.kind === "falcon_fire_bomb") {
        state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx * 0.025, -pr.vz * 0.025, 2);
      }
      if (pr.kind === "vulture_sludge_bomb") {
        state.vfx?.dust(pr.x, PROJECTILE_Y, pr.z);
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
      // Pearls and ornaments can hit directly or after ricocheting off walls.
      const canHitPlayer = pr.kind === "pearl" || pr.kind === "ornament" || pr.bounces === undefined || pr.bounced;
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
          } else if (pr.kind === "corvid_bomb") {
            detonateCorvidBomb(pr.x, pr.z);
          } else if (pr.kind === "vulture_sludge_bomb") {
            detonateVultureSludge(pr.x, pr.z);
          } else if (pr.kind === "gull_egg_bomb") {
            detonateGullEgg(pr.x, pr.z);
          } else if (pr.kind === "gull_mini_bomb") {
            detonateGullMini(pr.x, pr.z);
          } else if (pr.kind === "falcon_fire_bomb") {
            detonateFalconFire(pr.x, pr.z);
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
          } else if (pr.kind === "fry_dart") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xfacc15, 10, 1.4);
          } else if (pr.kind === "shake_spray") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            if (p.iframes <= 0) webPlayer();
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0x84cc16, 12, 1.5);
          } else if (pr.kind === "shuriken") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xe2e8f0, 10, 1.5);
            state.vfx?.blood(pr.x, PROJECTILE_Y, pr.z, "red", 6);
          } else if (pr.kind === "zippo_flame") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xff6600, 14, 1.6);
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, 0, 0, 8);
          } else if (pr.kind === "ornament") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xef4444, 16, 2.0);
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, 0, 0, 10);
            sfxTarget();
          } else if (pr.kind === "pearl") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            // Deflect player momentum: bounce off pearl normal
            const dist = Math.hypot(dx, dz) || 1;
            const nx = dx / dist;
            const nz = dz / dist;
            const curSpeed = p.momSpeed || 0;
            p.momX = nx;
            p.momZ = nz;
            p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(curSpeed * 1.15, CLAM_PEARL_BOUNCE_SPEED));
            p.bounceCombo = (p.bounceCombo || 0) + 1;
            p.iframes = Math.max(p.iframes || 0, 0.2);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xf1f5f9, 14, 1.8);
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, nx * 2, nz * 2, 8);
            sfxTarget();
          } else if (pr.kind === "fishing_hook") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, 0, 0, 8);
            if (pr.ownerNid) {
              const shark = state.zombies.find(zb => zb.nid === pr.ownerNid && zb.mode !== "dead");
              if (shark) shark.hookTetherT = 1.2;
            }
          } else if (pr.kind === "lion_spine") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            webPlayer();
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xa855f7, 10, 1.4);
          } else if (pr.kind === "puffer_slug") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            burstPufferSpikes(pr.x, pr.z);
          } else if (pr.kind === "puffer_spike") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0xf1f5f9, 6, 1.2);
          } else if (pr.kind === "electric_bullet") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            spawnFloorFx("shock", pr.x, pr.z, 1.2, 3.0, true);
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, 0, 0, 10);
          } else if (pr.kind === "spear_bolt") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.burst(pr.x, PROJECTILE_Y, pr.z, 0x38bdf8, 12, 1.6);
          } else if (pr.kind === "octo_bullet" || pr.kind === "fish_bullet" || pr.kind === "magnum_bullet") {
            hitPlayerRanged(pr.damage, pr.x, pr.z);
            state.vfx?.sparks(pr.x, PROJECTILE_Y, pr.z, -pr.vx, -pr.vz, 8);
            state.vfx?.blood(pr.x, PROJECTILE_Y, pr.z, "red", 5);
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
