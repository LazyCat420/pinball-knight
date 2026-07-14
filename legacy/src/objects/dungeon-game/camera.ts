/**
 * Top-down camera, tilted ~35° — Diablo's actual angle, near enough.
 *
 * ORTHOGRAPHIC, not perspective, and that's not a stylistic coin-flip: with a
 * perspective camera a sprite at the top of the screen covers a different number
 * of screen pixels than the same sprite at the bottom, so the art can't stay
 * pixel-aligned. Ortho keeps the pixel scale constant everywhere.
 *
 * A true 90° overhead would show only the tops of everyone's heads and throw
 * away all the sprite art; full isometric would fight the square grid. 35° is
 * the angle that lets you read a character's face AND the maze layout.
 */
import * as THREE from "three";
import { VIEW_W, VIEW_H, CAMERA_TILT, CAMERA_DIST, PPU, CAM_DEADZONE, CAM_LERP } from "./constants";
import { state } from "./state";

export function createDungeonCamera(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(
    -VIEW_W / 2,
    VIEW_W / 2,
    VIEW_H / 2,
    -VIEW_H / 2,
    0.1,
    200,
  );
  cam.up.set(0, 1, 0);
  return cam;
}

/** The camera's offset from whatever it's looking at. Fixed for the whole game. */
export function cameraOffset(): THREE.Vector3 {
  return new THREE.Vector3(
    0,
    Math.sin(CAMERA_TILT) * CAMERA_DIST,
    Math.cos(CAMERA_TILT) * CAMERA_DIST,
  );
}

const _offset = cameraOffset();
const _target = new THREE.Vector3();

/**
 * Point the camera at a world position.
 *
 * The target is SNAPPED to the render-target's pixel grid first. Without this,
 * the camera slides by fractions of a pixel and every static wall in the scene
 * crawls and shimmers as you walk. It is the single most common reason 8-bit 3D
 * looks subtly wrong, and it is very hard to diagnose after the fact.
 */
export function aimCamera(cam: THREE.OrthographicCamera, x: number, y: number, z: number): void {
  _target.set(Math.round(x * PPU) / PPU, y, Math.round(z * PPU) / PPU);
  cam.position.copy(_target).add(_offset);
  cam.lookAt(_target);
  cam.updateMatrixWorld();
}

/** Hard-cut the follow target (level start, retry). No lerp across a level change. */
export function snapCameraTo(x: number, z: number): void {
  state.camX = x;
  state.camZ = z;
}

/**
 * Follow the player with a dead-zone: the player roams a small box around the
 * camera target freely, and only pushes the camera once they leave it. Without
 * the dead-zone every one-pixel micro-step drags the whole world with it.
 *
 * Screen shake rides on top as a decaying offset — the AIM point shakes, so
 * the pixel-grid snap in aimCamera still applies and the shake itself stays
 * on whole pixels.
 */
export function updateFollowCamera(cam: THREE.OrthographicCamera, px: number, pz: number, dt: number): void {
  const t = Math.min(1, CAM_LERP * dt);

  const dx = px - state.camX;
  if (Math.abs(dx) > CAM_DEADZONE) {
    state.camX += (dx - Math.sign(dx) * CAM_DEADZONE) * t;
  }
  const dz = pz - state.camZ;
  if (Math.abs(dz) > CAM_DEADZONE * 0.7) {
    state.camZ += (dz - Math.sign(dz) * CAM_DEADZONE * 0.7) * t;
  }

  let ox = 0;
  let oz = 0;
  if (state.shakeT > 0) {
    state.shakeT = Math.max(0, state.shakeT - dt);
    const amp = 0.14 * state.shakeT * 4; // decays with the timer
    ox = (Math.random() - 0.5) * 2 * amp;
    oz = (Math.random() - 0.5) * 2 * amp;
  }

  aimCamera(cam, state.camX + ox, 0.5, state.camZ + oz);
}
