/**
 * 🐉 DRAGON SNAKE BOSS — A massive modular serpentine dragon boss that
 * undulates and slithers through the arena like the classic game Snake.
 *
 * ── ANATOMY & SEGMENT KINEMATICS ─────────────────────────────────────────────
 *
 * The dragon is composed of:
 *   1. HEAD: The lead actor in `state.zombies`, commanding navigation,
 *      targeting the player, roaring, and spewing torrents of inferno fire breath.
 *   2. BODY SEGMENTS (N parts): Modular serpentine body links trailing the
 *      leader via an invariant distance-constraint relaxation algorithm.
 *      Each segment maintains distance D from the preceding joint, creating an
 *      authentic continuous S-curve slither.
 *   3. TAIL: The terminal barbed fin segment that swishes behind the final body link.
 *
 * ── PINBALL PIN-BUMPER DYNAMICS ──────────────────────────────────────────────
 *
 * Every body segment is an armored pinball bumper! When the player marble rams
 * into the dragon's body coils:
 *   • The ball reflects outward with high-velocity pinball rebound impulse.
 *   • Clashing scale sparks erupt along the impact normal.
 *   • Outgoing damage is dealt to the dragon's shared boss health pool.
 *   • Head hits register 1.5× critical damage.
 */
import * as THREE from "three";
import { state, type Zombie, type Player } from "../state";
import { createActorSprite, type ActorSprite } from "../engine/render/sprite";
import { MonsterAnimator } from "../engine/render/monster-animator";
import { sheetFor } from "../boot/sheets";
import { syncActorMesh, damageZombie, hitPlayerRanged, playerDamage } from "./combat";
import { facingFromWorld } from "./zombie";
import { spawnFloorFx } from "./floor-fx";
import { PLAYER_R, PINBALL_MAX_SPEED } from "../constants";
import { animationPresentation } from "../presentation/animation-system";

export const DRAGON_DEFAULT_SEGMENTS = 12;
export const DRAGON_SEGMENT_DIST = 0.72;
export const DRAGON_SEGMENT_RADIUS = 0.58;
export const DRAGON_HEAD_RADIUS = 0.75;
export const DRAGON_BOUNCE_SPEED = 14;

export interface DragonBodySegment {
  index: number;
  mesh: THREE.Mesh;
  sprite: ActorSprite;
  anim: MonsterAnimator;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  flinchT: number;
}

export interface DragonSnakeBoss {
  head: Zombie;
  segments: DragonBodySegment[];
  tail: DragonBodySegment;
  segmentDist: number;
  scale: number;
  slitherT: number;
  breathCooldown: number;
  breathActiveT: number;
  breathDirX: number;
  breathDirZ: number;
  moltenCooldown: number;
  isEnraged: boolean;
  dead: boolean;
  deathT: number;
}

/**
 * Creates the modular body and tail segments for the Snake Dragon boss.
 */
export function createDragonSnake(
  head: Zombie,
  numSegments = DRAGON_DEFAULT_SEGMENTS,
  scale = 2.35,
): DragonSnakeBoss {
  const bodySheet = sheetFor("dragon_snake_body") ?? sheetFor("dragon");
  const tailSheet = sheetFor("dragon_snake_tail") ?? sheetFor("dragon");

  const segments: DragonBodySegment[] = [];

  // Initialize segments trailing backwards from the head
  for (let i = 0; i < numSegments; i++) {
    const sprite = createActorSprite(bodySheet!, false);
    sprite.mesh.scale.set(scale, scale, 1);
    const anim = new MonsterAnimator(sprite);
    anim.play("idle");

    const segX = head.x - (i + 1) * DRAGON_SEGMENT_DIST;
    const segZ = head.z;

    if (state.scene) {
      state.scene.add(sprite.mesh);
    }

    const segment: DragonBodySegment = {
      index: i,
      mesh: sprite.mesh,
      sprite,
      anim,
      x: segX,
      z: segZ,
      vx: 0,
      vz: 0,
      radius: DRAGON_SEGMENT_RADIUS * (scale / 2.0),
      flinchT: 0,
    };
    animationPresentation.register(segment);
    syncActorMesh({ sprite, x: segX, z: segZ });
    segments.push(segment);
  }

  // Terminal Tail Segment
  const tailSprite = createActorSprite(tailSheet!, false);
  tailSprite.mesh.scale.set(scale, scale, 1);
  const tailAnim = new MonsterAnimator(tailSprite);
  tailAnim.play("idle");

  const tailX = head.x - (numSegments + 1) * DRAGON_SEGMENT_DIST;
  const tailZ = head.z;

  if (state.scene) {
    state.scene.add(tailSprite.mesh);
  }

  const tail: DragonBodySegment = {
    index: numSegments,
    mesh: tailSprite.mesh,
    sprite: tailSprite,
    anim: tailAnim,
    x: tailX,
    z: tailZ,
    vx: 0,
    vz: 0,
    radius: DRAGON_SEGMENT_RADIUS * (scale / 2.0) * 0.9,
    flinchT: 0,
  };
  animationPresentation.register(tail);
  syncActorMesh({ sprite: tailSprite, x: tailX, z: tailZ });

  return {
    head,
    segments,
    tail,
    segmentDist: DRAGON_SEGMENT_DIST,
    scale,
    slitherT: 0,
    breathCooldown: 3.5,
    breathActiveT: 0,
    breathDirX: 0,
    breathDirZ: 1,
    moltenCooldown: 0.6,
    isEnraged: false,
    dead: false,
    deathT: 0,
  };
}

/**
 * Updates distance-constraint relaxation kinematics for the dragon's serpentine body.
 */
export function updateDragonSnakeKinematics(dragon: DragonSnakeBoss, dt: number): void {
  dragon.slitherT += dt;

  // Segment 0 follows Head
  let leaderX = dragon.head.x;
  let leaderZ = dragon.head.z;

  for (let i = 0; i < dragon.segments.length; i++) {
    const seg = dragon.segments[i];
    const dx = leaderX - seg.x;
    const dz = leaderZ - seg.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.0001) {
      // Relax position strictly to invariant spacing D
      seg.x = leaderX - (dx / dist) * dragon.segmentDist;
      seg.z = leaderZ - (dz / dist) * dragon.segmentDist;

      // Update facing towards the joint ahead
      const facing = facingFromWorld(dx, dz, "S");
      seg.anim.setFacing(facing);

      if (dragon.dead) {
        seg.anim.play("death");
      } else if (dragon.breathActiveT > 0 || dragon.isEnraged) {
        seg.anim.play("attack");
      } else {
        seg.anim.play("walk");
      }
    }

    if (seg.flinchT > 0) {
      seg.flinchT -= dt;
      seg.sprite.setTint?.(0xffffff);
    } else {
      seg.sprite.setTint?.(null);
    }

    syncActorMesh({ sprite: seg.sprite, x: seg.x, z: seg.z });

    leaderX = seg.x;
    leaderZ = seg.z;
  }

  // Tail follows the last body segment
  const lastBody = dragon.segments[dragon.segments.length - 1];
  if (lastBody) {
    const tdx = lastBody.x - dragon.tail.x;
    const tdz = lastBody.z - dragon.tail.z;
    const tDist = Math.hypot(tdx, tdz);

    if (tDist > 0.0001) {
      dragon.tail.x = lastBody.x - (tdx / tDist) * dragon.segmentDist;
      dragon.tail.z = lastBody.z - (tdz / tDist) * dragon.segmentDist;

      dragon.tail.anim.setFacing(facingFromWorld(tdx, tdz, "S"));
      if (dragon.dead) {
        dragon.tail.anim.play("death");
      } else if (dragon.isEnraged) {
        dragon.tail.anim.play("attack");
      } else {
        dragon.tail.anim.play("walk");
      }
    }

    if (dragon.tail.flinchT > 0) {
      dragon.tail.flinchT -= dt;
      dragon.tail.sprite.setTint?.(0xffffff);
    } else {
      dragon.tail.sprite.setTint?.(null);
    }

    syncActorMesh({ sprite: dragon.tail.sprite, x: dragon.tail.x, z: dragon.tail.z });
  }
}

/**
 * Checks pinball collisions against all body segments and the tail.
 * Pinball ball deflects off segments like energetic bumpers and deals damage.
 */
export function checkDragonSnakeCollisions(dragon: DragonSnakeBoss, player: Player, dt: number): void {
  if (dragon.dead || dragon.head.hp <= 0) return;

  const allParts = [...dragon.segments, dragon.tail];

  for (const part of allParts) {
    const dx = player.x - part.x;
    const dz = player.z - part.z;
    const dist = Math.hypot(dx, dz);
    const minDist = PLAYER_R + part.radius;

    if (dist < minDist && dist > 0.0001) {
      // Normal vector pointing outward from body segment to player
      const nx = dx / dist;
      const nz = dz / dist;

      // Push player outside segment circle
      player.x = part.x + nx * minDist;
      player.z = part.z + nz * minDist;

      // Pinball reflection velocity
      const curSpeed = player.momSpeed || 0;
      const bounceSpeed = Math.max(curSpeed * 1.15, DRAGON_BOUNCE_SPEED);
      player.momX = nx;
      player.momZ = nz;
      player.momSpeed = Math.min(PINBALL_MAX_SPEED, bounceSpeed);
      player.bounceCombo = (player.bounceCombo || 0) + 1;
      player.iframes = Math.max(player.iframes || 0, 0.25);

      // Visual juice: metallic scale sparks & screen shake
      state.vfx?.sparks(part.x, 0.7, part.z, nx, nz, 10);
      state.shakeT = Math.max(state.shakeT, 0.22);
      part.flinchT = 0.15;

      // Inflict damage to boss shared health pool
      const isFastRam = curSpeed > 8.0;
      const baseDmg = isFastRam ? 28 : 14;
      damageZombie(dragon.head, playerDamage(baseDmg), nx, nz, 0.4, false, isFastRam ? "bounce" : "steel");

      // If player collided at low speed without iframes, take contact damage
      if (player.iframes <= 0.05 && curSpeed < 6.0) {
        hitPlayerRanged(1, part.x, part.z);
      }
    }
  }
}

/**
 * Updates dragon snake attacks: inferno breath, phase 2 enrage, and magma trail.
 */
export function updateDragonSnakeAttacks(
  dragon: DragonSnakeBoss,
  dt: number,
  target: { x: number; z: number },
): void {
  if (dragon.dead || dragon.head.hp <= 0) return;

  // Phase 2 check: at <= 50% HP, enter enraged state
  const maxHp = dragon.head.maxHp ?? 100;
  if (!dragon.isEnraged && dragon.head.hp <= maxHp * 0.5) {
    dragon.isEnraged = true;
    dragon.head.speed *= 1.25;
    state.shakeT = Math.max(state.shakeT, 0.5);
  }

  // 1. Fire Breath Lifecycle
  if (dragon.breathActiveT > 0) {
    dragon.breathActiveT -= dt;
    dragon.head.anim.play("attack");

    // Spray fire embers and spawn molten fire decals along the flame cone
    const hx = dragon.head.x;
    const hz = dragon.head.z;
    const bdx = dragon.breathDirX;
    const bdz = dragon.breathDirZ;

    // Embers
    state.vfx?.sparks(hx + bdx * 1.2, 0.8, hz + bdz * 1.2, bdx, bdz, 6);

    // Drop burning floor fire hazard
    if (Math.random() < 0.25) {
      const spreadDist = 1.0 + Math.random() * 3.5;
      const spreadAngle = (Math.random() - 0.5) * 0.5;
      const cosA = Math.cos(spreadAngle);
      const sinA = Math.sin(spreadAngle);
      const fx = hx + (bdx * cosA - bdz * sinA) * spreadDist;
      const fz = hz + (bdx * sinA + bdz * cosA) * spreadDist;
      spawnFloorFx("fire", fx, fz, 0.8, 4.0, true);
    }

    // Check player damage inside flame cone
    const p = state.player;
    if (p && p.iframes <= 0) {
      const pdx = p.x - hx;
      const pdz = p.z - hz;
      const pDist = Math.hypot(pdx, pdz);
      if (pDist < 4.5 && pDist > 0.001) {
        const dot = (pdx / pDist) * bdx + (pdz / pDist) * bdz;
        if (dot > 0.7) {
          hitPlayerRanged(1, hx, hz);
        }
      }
    }
  } else {
    dragon.breathCooldown -= dt;
    if (dragon.breathCooldown <= 0) {
      // Wind up and unleash fire breath
      const dx = target.x - dragon.head.x;
      const dz = target.z - dragon.head.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.0001) {
        dragon.breathDirX = dx / dist;
        dragon.breathDirZ = dz / dist;
      }
      dragon.breathActiveT = 1.5;
      dragon.breathCooldown = dragon.isEnraged ? 3.0 : 5.0;
      dragon.head.anim.setFacing(facingFromWorld(dragon.breathDirX, dragon.breathDirZ, "S"));
      dragon.head.anim.play("attack");
    }
  }

  // 2. Phase 2 Molten Magma Trail: Tail leaves burning ground patches
  if (dragon.isEnraged) {
    dragon.moltenCooldown -= dt;
    if (dragon.moltenCooldown <= 0) {
      dragon.moltenCooldown = 0.7;
      spawnFloorFx("fire", dragon.tail.x, dragon.tail.z, 0.75, 5.0, true);
    }
  }
}

/**
 * Handles death sequence: cascading crumble down the segment chain.
 */
export function onDragonSnakeDeath(dragon: DragonSnakeBoss, dt: number): void {
  if (!dragon.dead) {
    dragon.dead = true;
    dragon.head.anim.play("death");
    for (const seg of dragon.segments) {
      seg.anim.play("death");
    }
    dragon.tail.anim.play("death");
    state.shakeT = Math.max(state.shakeT, 0.6);
  }

  dragon.deathT += dt;

  // Cascading stone/molten crumble sparks along the snake spine
  const idx = Math.floor(dragon.deathT * 8);
  if (idx < dragon.segments.length) {
    const seg = dragon.segments[idx];
    state.vfx?.sparks(seg.x, 0.6, seg.z, 0, 1, 14);
  } else if (idx === dragon.segments.length) {
    state.vfx?.sparks(dragon.tail.x, 0.6, dragon.tail.z, 0, 1, 14);
  }
}

/**
 * Disposes all meshes and sprites created for the multi-part dragon snake.
 */
export function disposeDragonSnake(dragon: DragonSnakeBoss): void {
  for (const seg of dragon.segments) {
    animationPresentation.unregister(seg);
    if (state.scene) {
      state.scene.remove(seg.mesh);
      seg.sprite.mesh.geometry?.dispose();
    }
  }
  animationPresentation.unregister(dragon.tail);
  if (state.scene) {
    state.scene.remove(dragon.tail.mesh);
    dragon.tail.sprite.mesh.geometry?.dispose();
  }
  dragon.segments.length = 0;
}
