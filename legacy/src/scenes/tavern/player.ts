/**
 * The knight, in the tavern. Walk, face, stop at furniture. That's the whole job.
 *
 * This deliberately does NOT reuse `scenes/dungeon/entities/player.ts`. That
 * controller is ~1500 lines interleaved with pinball momentum, wall-launches,
 * rides, dodge-rolls, melee combo state and grid smashing, and it requires a
 * maze `Grid` to move at all. None of that exists here and none of it should.
 *
 * What IS reused is the art: the same cached `SpriteSheet` the dungeon builds
 * for the currently-held weapon, so the knight in the tavern is visibly the
 * same knight who just came up the stairs, holding the same thing.
 */
import * as THREE from "three";
import { state as dungeonState, activeWeapon } from "../dungeon/state";
import { buildSpriteSheet, createActorSprite } from "../dungeon/render/sprite";
import { makeKnightPaints } from "../dungeon/render/cel-painter";
import { Animator, facingFromVelocity, type Facing } from "../dungeon/render/animator";
import { PPU } from "../dungeon/constants";
import type { InputHandle } from "../dungeon/input";
import { moveInRoom, SPAWN } from "./layout";
import { tavern, type TavernPlayer } from "./state";

/** Stroll speed, world units/sec. Slower than the dungeon — nothing is chasing you. */
const WALK_SPEED = 3.4;
/** Hold shift to cross the room quickly without it feeling like a sprint mechanic. */
const HURRY_MULT = 1.55;
/** Acceleration/deceleration, units/sec². High enough to feel responsive, low
 * enough that stopping isn't a hard snap. */
const ACCEL = 26;

/** Above this speed the walk clip plays; below it the knight idles. */
const WALK_CLIP_THRESHOLD = 0.35;

const ISO = Math.SQRT1_2;

/** Current velocity, module-local (one player, one tavern). */
let vx = 0;
let vz = 0;
let animator: Animator | null = null;

/**
 * Snap the mesh so its texels land on whole render-target pixels. Unsnapped
 * sprites shimmer as they move — same trick, and same reason, as the dungeon's
 * `syncActorMesh`.
 */
function syncMesh(p: TavernPlayer): void {
  const u = (p.x - p.z) * ISO;
  const v = (p.x + p.z) * ISO;
  const su = Math.round(u * PPU) / PPU;
  const sv = Math.round(v * PPU) / PPU;
  p.sprite.mesh.position.set((sv + su) * ISO, 0, (sv - su) * ISO);
}

/** Build the knight and drop them at the foot of the stair. */
export function createTavernPlayer(scene: THREE.Scene): TavernPlayer {
  const weaponId = activeWeapon().id;
  // Reuse the dungeon's cached atlas when it exists, so entering the tavern
  // doesn't re-run the (not cheap) paint + pixel-crush for art we already have.
  let sheet = dungeonState.playerSheets.get(weaponId);
  if (!sheet) {
    sheet = buildSpriteSheet(makeKnightPaints(weaponId));
    dungeonState.playerSheets.set(weaponId, sheet);
  }

  const sprite = createActorSprite(sheet, false);
  scene.add(sprite.mesh);
  animator = new Animator(sprite);

  const p: TavernPlayer = {
    x: SPAWN.x,
    z: SPAWN.z,
    facing: "N" as Facing, // arriving from the stair, looking into the room
    speed: 0,
    animT: 0,
    sprite,
  };
  vx = 0;
  vz = 0;
  animator.setFacing(p.facing);
  syncMesh(p);
  return p;
}

/**
 * One movement step.
 *
 * `frozen` is true while a station panel is open — the knight holds position and
 * drops to idle rather than sliding around behind the UI.
 */
export function updateTavernPlayer(dt: number, input: InputHandle, frozen: boolean): void {
  const p = tavern.player;
  if (!p || !animator) return;

  let tx = 0;
  let tz = 0;
  if (!frozen) {
    const a = input.axis();
    if (a.x !== 0 || a.z !== 0) {
      // The input axis is SCREEN-relative; under the isometric yaw, screen-up is
      // a world diagonal. Rotating here is what makes "W" walk away from the
      // camera instead of off to one side.
      const wx = (a.x - a.z) * ISO;
      const wz = (a.x + a.z) * ISO;
      const len = Math.hypot(wx, wz) || 1;
      const speed = WALK_SPEED * (input.sprintHeld() ? HURRY_MULT : 1);
      tx = (wx / len) * speed;
      tz = (wz / len) * speed;
    }
  }

  // Ramp toward the target rather than snapping, so starts and stops have weight.
  const dvx = tx - vx;
  const dvz = tz - vz;
  const dvLen = Math.hypot(dvx, dvz);
  if (dvLen > 0) {
    const step = Math.min(dvLen, ACCEL * dt);
    vx += (dvx / dvLen) * step;
    vz += (dvz / dvLen) * step;
  }

  if (vx !== 0 || vz !== 0) {
    const moved = moveInRoom(p.x, p.z, p.x + vx * dt, p.z + vz * dt);
    // Kill the velocity component we just got blocked on, or we keep pressing
    // into the counter and the walk cycle plays on the spot.
    if (moved.x === p.x) vx = 0;
    if (moved.z === p.z) vz = 0;
    p.x = moved.x;
    p.z = moved.z;
  }

  p.speed = Math.hypot(vx, vz);
  p.animT += dt;

  if (p.speed > WALK_CLIP_THRESHOLD) {
    p.facing = facingFromVelocity(vx, vz, p.facing);
    animator.setFacing(p.facing);
    animator.play("walk");
    // Gait quickens with speed so hurrying reads without a separate run clip.
    animator.setRate(0.7 + (p.speed / WALK_SPEED) * 0.6);
  } else {
    animator.play("idle");
    animator.setRate(1);
  }
  animator.update(dt);
  syncMesh(p);
}

/** Drop the module-local animator/velocity when the scene closes. */
export function disposeTavernPlayer(): void {
  animator = null;
  vx = 0;
  vz = 0;
}
