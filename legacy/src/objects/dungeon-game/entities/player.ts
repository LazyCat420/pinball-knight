/**
 * The hero — grid-free continuous movement, a 4-way facing, and an attack
 * that depends on what's in the active hand:
 *
 *  - MELEE: a three-frame swing whose hitbox agrees with its animation (the
 *    active window covers exactly the middle "strike" frame).
 *  - RANGED: the shot leaves the muzzle the instant the trigger pulls (a gun
 *    with a windup feels broken), ammo is spent per shot, and fast weapons
 *    (the flamethrower) can re-fire while the fire animation is still playing.
 *
 * Attack numbers come from whatever weapon is currently in the active slot;
 * boots come from the gear slots.
 */
import { state, activeWeapon } from "../state";
import {
  PLAYER_SPEED,
  PLAYER_R,
  ATTACK_ACTIVE_START,
  ATTACK_ACTIVE_END,
  BOOTS_SPEED_FACTOR,
} from "../constants";
import { moveCircle } from "../collision";
import { facingFromVelocity } from "../render/animator";
import { screenDirToWorld } from "../camera";
import type { InputHandle } from "../input";
import { WEAPONS } from "../items";
import { resolvePlayerAttack, wearActiveWeapon, syncActorMesh, updateFlash, FACING_VEC } from "./combat";
import { fireWeapon } from "./projectiles";
import { sfxSwing, sfxGun, sfxBow, sfxFlame } from "../audio";

/** Attacking roots you a little — swinging at a full sprint feels weightless. */
const ATTACK_MOVE_FACTOR = 0.45;

/** Footstep-dust cadence — a puff kicks up this often while walking. */
const STEP_DUST_INTERVAL = 0.26;
let stepDustT = 0;

function rangedSfx(id: string): void {
  if (id === "gun") sfxGun();
  else if (id === "bow") sfxBow();
  else sfxFlame();
}

export function updatePlayer(dt: number, input: InputHandle): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;

  p.cooldown = Math.max(0, p.cooldown - dt);
  p.iframes = Math.max(0, p.iframes - dt);
  updateFlash(p, dt);

  const w = WEAPONS[activeWeapon().id];
  const ranged = w.kind === "ranged";

  // ── Attack timeline ──
  let attacking = p.attackT >= 0;
  if (attacking) {
    p.attackT += dt;
    if (!ranged && !p.didHit && p.attackT >= ATTACK_ACTIVE_START && p.attackT <= ATTACK_ACTIVE_END) {
      p.didHit = true;
      resolvePlayerAttack();
    }
    if (p.anim.isFinished()) {
      p.attackT = -1;
      attacking = false;
    }
  }

  // ── Movement (slowed mid-swing, facing locked to a melee swing) ──
  // Input is SCREEN-relative (W = up the screen), converted to world ground
  // directions here — under the isometric yaw those are diagonals. This is
  // how Diablo controls feel: the stick/keys always mean what your eyes see.
  const a = input.axis();
  const moving = a.x !== 0 || a.z !== 0;
  let speed = PLAYER_SPEED * (attacking ? ATTACK_MOVE_FACTOR : 1);
  if (state.gear.boots !== undefined) speed *= BOOTS_SPEED_FACTOR;
  if (moving) {
    const wd = screenDirToWorld(a.x, a.z);
    const res = moveCircle(g, p.x, p.z, PLAYER_R, wd.x * speed * dt, wd.z * speed * dt);
    p.x = res.x;
    p.z = res.z;
    // Kick up a little floor dust at a walking cadence (not while rooted mid-swing).
    stepDustT -= dt;
    if (stepDustT <= 0 && !attacking) {
      stepDustT = STEP_DUST_INTERVAL;
      state.vfx?.dust(p.x, 0.05, p.z);
    }
  }

  // Facing picks from the SCREEN axis, so pressing D always shows the
  // side-facing art regardless of camera yaw. A melee swing locks the facing;
  // ranged fire doesn't — you can hose the flamethrower while turning.
  if (moving && (!attacking || ranged)) {
    p.facing = facingFromVelocity(a.x, a.z, p.facing);
    p.anim.setFacing(p.facing);
  }
  if (!attacking) {
    p.anim.play(moving ? "walk" : "idle");
  }

  // ── Trigger ──
  // Melee waits for the previous swing to finish; ranged only waits for the
  // cooldown (the flamethrower re-fires many times per fire animation).
  if (input.consumeAttack() && p.cooldown <= 0 && (!attacking || ranged)) {
    p.attackT = 0;
    p.didHit = false;
    p.cooldown = w.cooldown;
    p.anim.play("attack", { force: true });
    if (ranged) {
      const [fx, fz] = FACING_VEC[p.facing];
      fireWeapon(w, p.x, p.z, fx, fz);
      wearActiveWeapon(); // ammo is spent on the shot, hit or miss
      rangedSfx(w.id);
    } else {
      // Slash crescent swept in the facing direction, tinted to the weapon.
      const [fx, fz] = FACING_VEC[p.facing];
      state.vfx?.slash(p.x + fx * 0.5, 0.6, p.z + fz * 0.5, p.facing, w.slashColor ?? 0xdfe7f2);
      sfxSwing();
    }
  }

  syncActorMesh(p);
}
