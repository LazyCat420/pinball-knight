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
import { screenDirToWorld } from "../dungeon/camera";
import type { InputHandle } from "../dungeon/input";
import { moveInRoom, SPAWN } from "./layout";
import { tavern, type TavernPlayer } from "./state";

/**
 * Walk speed, world units/sec.
 *
 * Was 3.4 — "slower than the dungeon, nothing is chasing you". That reasoning is
 * sound for the FICTION and wrong for the FEEL: the player arrives here straight
 * off the dungeon's PLAYER_SPEED 4.2, so a 19% drop reads as the controls having
 * gone soft, not as the room being calm. Worse, the tavern camera leans only
 * CAM_LEAN (0.5) toward the player (core.ts), which means the player's APPARENT
 * on-screen motion is exactly half their world motion — walk 1 unit, the frame
 * follows 0.5, so you slide 0.5 across the screen. The dungeon's dead-zone
 * camera holds still for small moves and gives you close to 1:1.
 *
 * So matching 4.2 exactly still reads slower than the dungeon. 4.6 is the
 * dungeon's speed plus a margin paid to the camera lean; crossing the 18-unit
 * room now takes ~3.9s instead of ~5.3s. Deliberately NOT taken further — this
 * is a hub with staged props, and past ~5 the knight starts skating.
 */
const WALK_SPEED = 4.6;
/** Hold shift to cross the room quickly without it feeling like a sprint mechanic. */
const HURRY_MULT = 1.5;
/**
 * Acceleration/deceleration, units/sec².
 *
 * Was 26 against the dungeon's MOVE_ACCEL 22. Raised with the speed so the RAMP
 * TIME doesn't grow: 4.6/34 = 0.135s to full speed, against the old 3.4/26 =
 * 0.131s, so the extra speed costs nothing in start latency. Left well short of
 * an instant snap on purpose — the stop still has a short slide, which is what
 * stops the knight looking like a cursor.
 */
const ACCEL = 34;

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
 * `syncActorMesh`. But it has to be done against THIS scene's camera, and the
 * straight copy of the dungeon's version was not:
 *
 *  1. ZOOM. `Math.round(u * PPU) / PPU` quantises to 1/64 of a world unit, which
 *     is one render pixel only when `camera.zoom === 1`. The dungeon never sets
 *     zoom, so that holds there. The tavern runs at CAM_ZOOM_WIDE 0.78 and eases
 *     to CAM_ZOOM_FOCUS 0.92 whenever a station takes focus (core.ts), so a
 *     1/PPU step was 0.78 of a pixel — SUB-pixel, so it never aligned a texel to
 *     anything, and the rounding error it added was pure noise. The snap was
 *     doing none of the job it was there for and all of the damage.
 *  2. FRAME OF REFERENCE. The dungeon's camera has a dead-zone, so it is usually
 *     STILL and a world-space snap is also a screen-space snap. The tavern's
 *     camera eases toward its target every single frame with no dead-zone, so
 *     the world slid smoothly underneath a sprite that was hopping on a fixed
 *     world lattice — the sprite visibly juddered against the background even
 *     when the player was walking in a straight line. That is the "not smooth"
 *     in the report, and it is why raising WALK_SPEED alone would not have
 *     fixed it: a faster hop is a bigger hop.
 *
 * So: snap to a real render pixel (1/(PPU * zoom)), and snap RELATIVE TO THE
 * CAMERA rather than to the world origin. The sprite's offset from the camera
 * lands on whole pixels — which is the whole point, it is what keeps the texels
 * from shimmering — while the camera's own smooth pan carries the sprite along
 * with the scenery instead of fighting it.
 *
 * TRADEOFF, stated plainly: the sprite is no longer pinned to a fixed world
 * lattice, so relative to the *floor* it can shift by up to half a pixel as the
 * camera eases. That is invisible (the floor is a flat quantised texture and the
 * camera moves anyway); the judder it replaces was not. Falls back to the old
 * behaviour when there is no camera yet, which is the case during
 * `createTavernPlayer`.
 */
function syncMesh(p: TavernPlayer): void {
  const u = (p.x - p.z) * ISO;
  const v = (p.x + p.z) * ISO;
  const zoom = tavern.camera?.zoom ?? 1;
  // One render-target pixel, expressed in world units.
  const texel = 1 / (PPU * zoom);
  // The camera's aim point in the same (u, v) camera-aligned basis.
  const cu = (tavern.camX - tavern.camZ) * ISO;
  const cv = (tavern.camX + tavern.camZ) * ISO;
  const su = cu + Math.round((u - cu) / texel) * texel;
  const sv = cv + Math.round((v - cv) / texel) * texel;
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
      //
      // This MUST go through the same `screenDirToWorld` the dungeon uses. It
      // used to hand-roll the rotation as `(a.x - a.z, a.x + a.z) * ISO`, which
      // is the correct basis turned exactly 90°: W walked screen-RIGHT, A
      // walked screen-UP, S screen-LEFT, D screen-DOWN. The dungeon was fine
      // because it always called the shared helper — the tavern was the only
      // place with a second copy of the maths, and a second copy is the whole
      // reason the two could disagree. `movement.test.ts` now pins them equal.
      const w = screenDirToWorld(a.x, a.z);
      const wx = w.x;
      const wz = w.z;
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
    const wantDx = vx * dt;
    const wantDz = vz * dt;
    const moved = moveInRoom(p.x, p.z, p.x + wantDx, p.z + wantDz);
    // Kill the velocity component we just got blocked on, or we keep pressing
    // into the counter and the walk cycle plays on the spot.
    //
    // This used to be `moved.x === p.x` — an exact float compare, which is only
    // ever true on the SECOND frame of contact (the first frame still travels
    // the last sliver of gap to the ejection boundary, so the positions differ).
    // It happened to work because moveInRoom's ejection is deterministic, but it
    // meant one frame of full velocity buried in the counter, and it would go
    // silently dead the moment any float drift crept into the eject position.
    //
    // Comparing ACHIEVED against INTENDED is the honest question, and it is
    // tolerant: keep less than a tenth of what we asked for on an axis and that
    // axis is blocked. Note this only ever zeroes the BLOCKED axis — the free
    // one keeps its velocity, which is what makes brushing along a counter a
    // slide at full speed rather than a stutter where you re-accelerate from
    // zero every frame.
    if (Math.abs(moved.x - p.x) < Math.abs(wantDx) * 0.1) vx = 0;
    if (Math.abs(moved.z - p.z) < Math.abs(wantDz) * 0.1) vz = 0;
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
