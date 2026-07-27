/**
 * 🔫 RAMPAGE — the first-person "ultimate".
 *
 * The dungeon is already REAL three.js 3D (instanced box walls, a real floor,
 * billboarded enemy sprites). That's the whole trick behind this mode: we don't
 * rebuild anything — we swap the fixed orthographic ISO camera for a
 * perspective camera at the player's eye, drive it with mouse-look + WASD, and
 * shoot hitscan bolts down the corridors. The pixel + palette-quantize pass
 * stays on, so it reads as a chunky DOS-era shooter (Wolfenstein/Doom), not a
 * modern FPS. Enemies are billboards that already face the camera, so they read
 * correctly from first person for free.
 *
 * It's a timed power fantasy: the meter charges from kills (see combat.ts), a
 * key drops you in for ULT_DURATION seconds of god-mode blasting, then it hands
 * control back to the iso view exactly where you stood.
 */
import * as THREE from "three";
import { state } from "./state";
import {
  FPS_EYE_HEIGHT,
  FPS_FOV,
  FPS_MOVE_SPEED,
  FPS_TURN_SPEED,
  FPS_MOUSE_SENS,
  FPS_PITCH_LIMIT,
  FPS_SHOT_COOLDOWN,
  FPS_SHOT_DAMAGE,
  FPS_SHOT_RANGE,
  ULT_DURATION,
  PLAYER_R,
  RENDER_W,
  RENDER_H,
  ZOMBIE_R,
} from "./constants";
import { moveCircle } from "./collision";
import { faceCameraYaw, faceCameraIso } from "./render/sprite";
import { damageZombie } from "./entities/combat";
import type { InputHandle } from "./input";
import { setFpsOverlay, flashFpsMuzzle, updateFpsStreak } from "./ui";
import { setHUDMode } from "./hud";
import { sfxGun } from "./audio";
import { clamp } from "../../utils/math";

/** How long a streak survives without a fresh kill before it resets, seconds. */
const STREAK_WINDOW = 2.5;

/** Lazily build (once) the perspective camera used only during rampage. */
function fpsCamera(): THREE.PerspectiveCamera {
  if (state.fpsCamera) return state.fpsCamera;
  const cam = new THREE.PerspectiveCamera(FPS_FOV, RENDER_W / RENDER_H, 0.05, 200);
  cam.up.set(0, 1, 0);
  state.fpsCamera = cam;
  return cam;
}

/** True when the ultimate meter is full and a rampage may be triggered. */
export function canRampage(): boolean {
  return state.ultCharge >= 1 && !state.fpsActive && !state.gameOver;
}

/** Drop into first person. Spends the meter, hides the hero sprite (we ARE him). */
export function enterRampage(): void {
  const p = state.player;
  if (!p || !canRampage()) return;
  state.fpsActive = true;
  state.fpsTimer = ULT_DURATION;
  state.ultCharge = 0;
  state.fpsShotCd = 0;
  state.fpsPitch = 0;
  state.fpsKick = 0;
  state.fpsStreak = 0;
  state.fpsStreakT = 0;
  // Start looking the way the hero currently faces, mapped to a world yaw.
  state.fpsYaw = facingToYaw();
  // Hide the third-person knight billboard + its occlusion silhouette.
  p.sprite.mesh.visible = false;
  if (p.silhouette) p.silhouette.mesh.visible = false;
  // Enemy planes were baked to face the ISO camera; in first-person they'd show
  // edge-on/skewed. Switch them to upright yaw-billboards and drop the flat
  // contact blobs (whose orientation is baked against the iso tilt).
  for (const z of state.zombies) z.sprite.setBlobVisible(false);
  billboardEnemiesToFps();
  setFpsOverlay(state.fpsOverlayEl, true);
  // Swap the Diablo strategy panel down and the Wolfenstein combat bar up; the
  // shared face rides across into the wolf bar's socket.
  setHUDMode("wolf");
  state.hudDirty = true;
}

/**
 * Point every enemy sprite upright at the FPS camera. Called each rendered
 * frame during rampage so they always face the player as they/you move.
 */
export function billboardEnemiesToFps(): void {
  const p = state.player;
  if (!p) return;
  for (const z of state.zombies) faceCameraYaw(z.sprite.mesh, p.x, p.z);
}

/** Hand control back to the iso camera at the same spot. */
export function exitRampage(): void {
  const p = state.player;
  state.fpsActive = false;
  state.fpsTimer = 0;
  if (p) {
    p.sprite.mesh.visible = true;
    if (p.silhouette) p.silhouette.mesh.visible = true;
  }
  // Restore the enemy planes to their baked iso orientation + contact blobs.
  for (const z of state.zombies) {
    faceCameraIso(z.sprite.mesh);
    z.sprite.setBlobVisible(true);
  }
  updateFpsStreak(state.fpsOverlayEl, 0); // clear the combo readout
  state.fpsStreak = 0;
  setFpsOverlay(state.fpsOverlayEl, false);
  // Slide the Wolfenstein bar back down and the Diablo panel back up.
  setHUDMode("diablo");
  state.hudDirty = true;
}

/** The hero's screen-facing → a world-plane yaw to seed the look direction. */
function facingToYaw(): number {
  // The iso camera looks from the south-east; map the four facings to sensible
  // world headings so entering rampage doesn't spin you around.
  switch (state.player?.facing) {
    case "N": return Math.PI * 0.25;
    case "S": return Math.PI * 1.25;
    case "E": return Math.PI * 0.75;
    default: return Math.PI * 1.75; // W
  }
}

/** Mouse-look: accumulate yaw/pitch from a relative pointer delta. */
export function onFpsMouseMove(dx: number, dy: number): void {
  if (!state.fpsActive) return;
  // SIGN CONVENTION (worked out from the camera, not by feel): the camera
  // lookAt()s along forwardXZ = (sin yaw, -cos yaw), so growing yaw veers the
  // view toward +x when facing -z — the RIGHT of the screen. Mouse-right
  // (dx > 0) must therefore INCREASE yaw. This was `-=` (turn left on
  // mouse-right) and play-testing called it out as inverted.
  state.fpsYaw += dx * FPS_MOUSE_SENS;
  state.fpsPitch = clamp(state.fpsPitch - dy * FPS_MOUSE_SENS, -FPS_PITCH_LIMIT, FPS_PITCH_LIMIT);
}

/** Forward ground vector for the current yaw. */
function forwardXZ(): { x: number; z: number } {
  return { x: Math.sin(state.fpsYaw), z: -Math.cos(state.fpsYaw) };
}

/**
 * One rampage frame: turn (keyboard), strafe/advance (WASD relative to look),
 * fire, tick the timer, and re-aim the perspective camera. Movement is
 * collision-checked with the same swept circle the iso game uses, so you can't
 * clip walls.
 */
export function updateFps(dt: number, input: InputHandle): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return;

  const beforeTimer = state.fpsTimer;
  state.fpsTimer -= dt;
  if (Math.ceil(state.fpsTimer) !== Math.ceil(beforeTimer)) state.hudDirty = true;
  if (state.fpsTimer <= 0) {
    exitRampage();
    return;
  }
  state.fpsShotCd = Math.max(0, state.fpsShotCd - dt);
  if (state.fpsFlashT > 0) state.fpsFlashT = Math.max(0, state.fpsFlashT - dt);
  // Recoil kick decays back to zero fast (springy).
  if (state.fpsKick > 0) state.fpsKick = Math.max(0, state.fpsKick - dt * 0.9);
  // Kill-streak window: a lull with no kills resets the combo.
  if (state.fpsStreak > 0) {
    state.fpsStreakT += dt;
    if (state.fpsStreakT > STREAK_WINDOW) {
      state.fpsStreak = 0;
      updateFpsStreak(state.fpsOverlayEl, 0); // hide the combo readout
      state.hudDirty = true;
    }
  }

  // ── Look: mouse delta (free-aim) + keyboard turn (Q/E, arrows) ──
  const md = input.consumeMouseDelta();
  if (md.dx !== 0 || md.dy !== 0) onFpsMouseMove(md.dx, md.dy);
  const turn = input.turnAxis();
  // turnAxis is +1 for "turn right" — same convention as the mouse above.
  state.fpsYaw += turn * FPS_TURN_SPEED * dt;

  // ── Move: W/S along look, A/D strafe. Screen-relative axis reused: a.z is
  // forward/back (W = -1), a.x is strafe. ──
  const a = input.axis();
  const fwd = forwardXZ();
  // Right-of-look = fwd × up = (-fwd.z, fwd.x). A previous pass flipped this to
  // (fwd.z, -fwd.x) "because strafe felt wrong" — but the real bug was the yaw
  // SIGN (above): with turning inverted, the doubly-inverted strafe felt right.
  // Both signs are now canonical: yaw+ = turn right, and this is true
  // screen-right, so D strafes right with no compensating errors.
  const right = { x: -fwd.z, z: fwd.x };
  // a.z is +down (toward camera) in iso; here -a.z means "W = forward".
  let mx = (fwd.x * -a.z + right.x * a.x);
  let mz = (fwd.z * -a.z + right.z * a.x);
  const len = Math.hypot(mx, mz);
  if (len > 1e-4) {
    mx = (mx / len) * FPS_MOVE_SPEED * dt;
    mz = (mz / len) * FPS_MOVE_SPEED * dt;
    const res = moveCircle(g, p.x, p.z, PLAYER_R, mx, mz);
    p.x = res.x;
    p.z = res.z;
  }

  // ── Fire (held or tapped) ──
  if (input.consumeAttack() && state.fpsShotCd <= 0) {
    fpsShoot();
  }

  aimFpsCamera();
}

/** Position + orient the perspective camera at the player's eye. */
export function aimFpsCamera(): void {
  const p = state.player;
  if (!p) return;
  const cam = fpsCamera();
  cam.position.set(p.x, FPS_EYE_HEIGHT, p.z);
  const fwd = forwardXZ();
  // Recoil punches the aim UP by fpsKick; it springs back each frame.
  const pitch = clamp(state.fpsPitch + state.fpsKick, -FPS_PITCH_LIMIT, FPS_PITCH_LIMIT);
  const cp = Math.cos(pitch);
  cam.lookAt(
    p.x + fwd.x * cp,
    FPS_EYE_HEIGHT + Math.sin(pitch),
    p.z + fwd.z * cp,
  );
  cam.updateMatrixWorld();
}

/**
 * A hitscan shot: march along the look ray and hit the first living enemy whose
 * body cylinder the ray passes through within range. No projectile mesh — this
 * is instant, Doom-style. Damage funnels through the same combat.damageZombie.
 */
export function fpsShoot(): void {
  const p = state.player;
  if (!p) return;
  state.fpsShotCd = FPS_SHOT_COOLDOWN;
  state.fpsFlashT = 0.06;
  state.fpsKick = Math.min(0.1, state.fpsKick + 0.045); // per-shot recoil punch
  flashFpsMuzzle(state.fpsOverlayEl);
  sfxGun();

  const fwd = forwardXZ();
  // Closest enemy along the ray, within its body radius of the line.
  let best: { z: (typeof state.zombies)[number]; t: number } | null = null;
  for (const z of state.zombies) {
    if (z.mode === "dead") continue;
    const rx = z.x - p.x;
    const rz = z.z - p.z;
    const t = rx * fwd.x + rz * fwd.z; // projection along the ray
    if (t < 0 || t > FPS_SHOT_RANGE) continue;
    // perpendicular distance from the enemy to the ray
    const perpX = rx - fwd.x * t;
    const perpZ = rz - fwd.z * t;
    const perp = Math.hypot(perpX, perpZ);
    if (perp > ZOMBIE_R + 0.15) continue; // a little aim-assist forgiveness
    if (!best || t < best.t) best = { z, t };
  }

  if (best) {
    damageZombie(best.z, FPS_SHOT_DAMAGE, fwd.x, fwd.z, 0.5);
    state.vfx?.sparks(best.z.x, 0.6, best.z.z, 0, 0, 5);
  }
  // Muzzle spark at the barrel regardless of a hit.
  state.vfx?.sparks(p.x + fwd.x * 0.5, FPS_EYE_HEIGHT, p.z + fwd.z * 0.5, fwd.x, fwd.z, 3);
  state.shakeT = Math.max(state.shakeT, 0.06);
}
