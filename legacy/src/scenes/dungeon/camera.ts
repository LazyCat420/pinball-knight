/**
 * Isometric camera — orthographic, tilted ~38°, yawed 45° (true iso diamonds,
 * two visible faces per wall — the Diablo look).
 *
 * ORTHOGRAPHIC, not perspective, and that's not a stylistic coin-flip: with a
 * perspective camera a sprite at the top of the screen covers a different
 * number of screen pixels than the same sprite at the bottom, so the art
 * can't stay pixel-aligned. Ortho keeps the pixel scale constant everywhere.
 *
 * PIXEL SNAPPING under yaw: world-axis snapping only works when world axes
 * map to screen axes. With a 45° yaw they don't, so the camera position is
 * snapped along its own RIGHT/UP basis vectors instead — the projected image
 * shifts by whole texels regardless of orientation. Same cure, new anatomy.
 */
import * as THREE from "three";
import { VIEW_W, VIEW_H, CAMERA_TILT, CAMERA_YAW, CAMERA_DIST, PPU, CAM_DEADZONE, CAM_LERP } from "./constants";
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
  const horiz = Math.cos(CAMERA_TILT) * CAMERA_DIST;
  return new THREE.Vector3(
    Math.sin(CAMERA_YAW) * horiz,
    Math.sin(CAMERA_TILT) * CAMERA_DIST,
    Math.cos(CAMERA_YAW) * horiz,
  );
}

/**
 * Ground-plane direction of "screen up" (away from the camera) and
 * "screen right" — the input remap and facing logic key off these so WASD is
 * always screen-relative, the way Diablo controls feel.
 */
export const SCREEN_UP_XZ = { x: -Math.sin(CAMERA_YAW), z: -Math.cos(CAMERA_YAW) };
export const SCREEN_RIGHT_XZ = { x: Math.cos(CAMERA_YAW), z: -Math.sin(CAMERA_YAW) };

/** Screen-space axis → world ground direction. */
export function screenDirToWorld(sx: number, sz: number): { x: number; z: number } {
  // +sz is screen-down (toward the camera).
  return {
    x: sx * SCREEN_RIGHT_XZ.x - sz * SCREEN_UP_XZ.x,
    z: sx * SCREEN_RIGHT_XZ.z - sz * SCREEN_UP_XZ.z,
  };
}

/** World ground direction → screen-space axis (for facing picks). */
export function worldDirToScreen(wx: number, wz: number): { x: number; z: number } {
  return {
    x: wx * SCREEN_RIGHT_XZ.x + wz * SCREEN_RIGHT_XZ.z,
    z: -(wx * SCREEN_UP_XZ.x + wz * SCREEN_UP_XZ.z),
  };
}

/**
 * World aim direction from the mouse cursor for top-down ranged fire.
 *
 * Projects the player's world position to the canvas in pixels, measures the
 * screen-space vector from the player to the cursor, and converts THAT to a
 * world ground direction via screenDirToWorld — so the arrow flies toward
 * wherever the cursor sits on screen. Returns a unit {x,z}, or null if it can't
 * resolve (no camera / renderer, cursor on top of the player).
 *
 * `cursor` is in CLIENT pixels (viewport-relative, as from MouseEvent.clientX/Y).
 */
const _pWorld = new THREE.Vector3();
export function mouseAimDirection(
  px: number,
  pz: number,
  cursor: { x: number; y: number },
): { x: number; z: number } | null {
  const cam = state.camera;
  const renderer = state.renderer;
  if (!cam || !renderer) return null;

  // Player world → NDC → canvas pixels.
  _pWorld.set(px, 0.5, pz).project(cam);
  const rect = renderer.domElement.getBoundingClientRect();
  const playerPxX = rect.left + ((_pWorld.x + 1) / 2) * rect.width;
  const playerPxY = rect.top + ((1 - _pWorld.y) / 2) * rect.height;

  // Screen-space vector player → cursor (pixels). +x right, +y DOWN.
  const dxPx = cursor.x - playerPxX;
  const dyPx = cursor.y - playerPxY;
  if (dxPx * dxPx + dyPx * dyPx < 1) return null; // cursor on the player

  // screenDirToWorld takes (screen-right, screen-down). +y down = +sz.
  const w = screenDirToWorld(dxPx, dyPx);
  const len = Math.hypot(w.x, w.z);
  if (len < 1e-6) return null;
  return { x: w.x / len, z: w.z / len };
}

/**
 * Project a world position (at head height) to CLIENT pixel coordinates for DOM
 * overlays (floating combo numbers, etc). Returns null if the camera/renderer
 * aren't ready. Mirrors the player-projection math in mouseAimDirection.
 */
const _pScreen = new THREE.Vector3();
export function worldToScreenPx(x: number, z: number, y = 0.6): { x: number; y: number } | null {
  const cam = state.camera;
  const renderer = state.renderer;
  if (!cam || !renderer) return null;
  _pScreen.set(x, y, z).project(cam);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: rect.left + ((_pScreen.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - _pScreen.y) / 2) * rect.height,
  };
}

const _offset = cameraOffset();
const _target = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upVec = new THREE.Vector3();
const _fix = new THREE.Vector3();

/**
 * Point the camera at a world position, snapped to the render-target's pixel
 * grid in SCREEN space. Without this the camera slides by fractions of a
 * pixel and every static wall crawls and shimmers as you walk — the single
 * most common reason 8-bit 3D looks subtly wrong.
 */
export function aimCamera(cam: THREE.OrthographicCamera, x: number, y: number, z: number): void {
  _target.set(x, y, z);
  cam.position.copy(_target).add(_offset);
  cam.lookAt(_target);
  cam.updateMatrixWorld();

  // Snap along the camera's own right/up axes to whole texels (1/PPU units).
  _right.setFromMatrixColumn(cam.matrixWorld, 0);
  _upVec.setFromMatrixColumn(cam.matrixWorld, 1);
  const dr = cam.position.dot(_right);
  const du = cam.position.dot(_upVec);
  const snap = (v: number) => Math.round(v * PPU) / PPU;
  _fix
    .copy(_right)
    .multiplyScalar(snap(dr) - dr)
    .addScaledVector(_upVec, snap(du) - du);
  cam.position.add(_fix);
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
