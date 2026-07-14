/**
 * The hero — grid-free continuous movement, a 4-way facing, and a three-frame
 * sword swing whose hitbox agrees with its animation (the active window covers
 * exactly the middle "swing" frame).
 */
import { state } from "../state";
import {
  PLAYER_SPEED,
  PLAYER_R,
  ATTACK_COOLDOWN,
  ATTACK_ACTIVE_START,
  ATTACK_ACTIVE_END,
} from "../constants";
import { moveCircle } from "../collision";
import { facingFromVelocity } from "../render/animator";
import type { InputHandle } from "../input";
import { resolvePlayerAttack, syncActorMesh, updateFlash } from "./combat";
import { sfxSwing } from "../audio";

/** Attacking roots you a little — swinging at a full sprint feels weightless. */
const ATTACK_MOVE_FACTOR = 0.45;

export function updatePlayer(dt: number, input: InputHandle): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;

  p.cooldown = Math.max(0, p.cooldown - dt);
  p.iframes = Math.max(0, p.iframes - dt);
  updateFlash(p, dt);

  // ── Attack timeline ──
  const attacking = p.attackT >= 0;
  if (attacking) {
    p.attackT += dt;
    if (!p.didHit && p.attackT >= ATTACK_ACTIVE_START && p.attackT <= ATTACK_ACTIVE_END) {
      p.didHit = true;
      resolvePlayerAttack();
    }
    if (p.anim.isFinished()) p.attackT = -1;
  }

  // ── Movement (slowed mid-swing, facing locked to the swing) ──
  const a = input.axis();
  const speed = PLAYER_SPEED * (attacking ? ATTACK_MOVE_FACTOR : 1);
  if (a.x !== 0 || a.z !== 0) {
    const res = moveCircle(g, p.x, p.z, PLAYER_R, a.x * speed * dt, a.z * speed * dt);
    p.x = res.x;
    p.z = res.z;
  }

  if (!attacking) {
    if (a.x !== 0 || a.z !== 0) {
      p.facing = facingFromVelocity(a.x, a.z, p.facing);
      p.anim.setFacing(p.facing);
      p.anim.play("walk");
    } else {
      p.anim.play("idle");
    }

    if (input.consumeAttack() && p.cooldown <= 0) {
      p.attackT = 0;
      p.didHit = false;
      p.cooldown = ATTACK_COOLDOWN;
      p.anim.play("attack", { force: true });
      sfxSwing();
    }
  }

  syncActorMesh(p);
}
