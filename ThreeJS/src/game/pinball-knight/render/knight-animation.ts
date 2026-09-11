/** Continuous presentation clock, independent of the old sprite frame rate. */
import type { WeaponId } from '../items';
import { attackPhase, blendKnightPoses, clamp01, ease, gaitParameters, restKnightPose, sampleKnightPose, type KnightClip, type KnightPose } from './knight-motion';

export interface KnightAnimationFrame {
  dt: number;
  clip: KnightClip;
  heading: number;
  /** Achieved world-space travel. Blocked movement must supply zero. */
  distance: number;
  speed: number;
  worldScale: number;
  weapon: WeaponId;
  attackTime?: number;
  timing?: { windup: number; active: number; recovery: number } | null;
  variant?: number;
  charge?: number;
  hurt?: boolean;
}
const wrappedAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export class KnightAnimation {
  private phase = 0;
  private clock = 0;
  private speed = 0;
  private active = '';
  private previousAttack = -1;
  private transitionAge = 1;
  private transitionDuration = .16;
  private transitionFrom = restKnightPose();
  private current = restKnightPose();
  private deathTime = 0;
  private hurtTime = Infinity;
  private initialized = false;
  heading = 0;

  update(frame: KnightAnimationFrame): KnightPose {
    const dt = Math.min(.1, Math.max(0, frame.dt));
    if (!this.initialized) { this.heading = frame.heading; this.initialized = true; }
    this.clock += dt;
    const speedTarget = Number.isFinite(frame.speed) ? Math.max(0, frame.speed) : 0;
    this.speed += (speedTarget - this.speed) * (1 - Math.exp(-dt * 16));
    const wantsLocomotion = frame.clip === 'walk' || frame.clip === 'run';
    const locomotion = wantsLocomotion && (this.speed > .06 || frame.distance > .00001);
    // One phase survives speed changes and walk/run transitions. It advances
    // from actual travel, so pressing into a wall cannot run the legs in place.
    if (locomotion && dt > 0) {
      const travel = gaitParameters(this.speed).travel * frame.worldScale;
      this.phase += Math.max(0, frame.distance) / Math.max(.01, travel);
    }
    const active = locomotion ? 'locomotion' : wantsLocomotion ? 'idle' : frame.clip;
    const attackTime = frame.attackTime ?? 0;
    const restarted = active === 'attack' && this.active === 'attack' && attackTime < this.previousAttack - .0001;
    if (active !== this.active || restarted) {
      this.transitionFrom = this.current;
      this.transitionAge = 0;
      this.transitionDuration = active === 'attack' ? .055 : active === 'death' ? .09 : .17;
      this.active = active;
      if (active === 'death') this.deathTime = 0;
    }
    this.previousAttack = active === 'attack' ? attackTime : -1;
    if (active === 'death') this.deathTime += dt;
    this.transitionAge += dt;
    const clip = wantsLocomotion && !locomotion ? 'idle' : frame.clip;
    const time = locomotion ? this.phase : clip === 'attack' ? attackPhase(attackTime, frame.timing)
      : clip === 'death' ? clamp01(this.deathTime / .95) : this.clock;
    let pose = sampleKnightPose(clip, time, { speed: this.speed, weapon: frame.weapon, variant: frame.variant, charge: frame.charge });
    if (this.transitionAge < this.transitionDuration) {
      pose = blendKnightPoses(this.transitionFrom, pose, ease(this.transitionAge / this.transitionDuration));
    }
    const turn = wrappedAngle(frame.heading - this.heading);
    this.heading += turn * (1 - Math.exp(-dt * (active === 'attack' ? 25 : 14)));
    // Head leads a turn; torso follows, with a small inward lean while moving.
    pose.neck[1] += Math.max(-.24, Math.min(.24, turn * .32));
    if (locomotion) pose.chest[2] -= Math.max(-.065, Math.min(.065, turn * .055));
    if (frame.hurt) this.hurtTime = 0;
    this.hurtTime += dt;
    if (this.hurtTime < .28 && active !== 'death') {
      const recoil = Math.sin(Math.PI * this.hurtTime / .28) * Math.exp(-this.hurtTime * 5);
      pose.chest[0] -= .20 * recoil; pose.spine[2] += .08 * recoil; pose.neck[0] += .12 * recoil;
    }
    this.current = pose;
    return pose;
  }
  /** Read-only diagnostics for the animation viewer and regression checks. */
  inspect() { return { phase: this.phase, speed: this.speed, heading: this.heading, active: this.active, pose: this.current }; }
}
