/**
 * Frame timing + direction picking for one actor.
 *
 * Only S / N / E are authored — W is E with the sprite flipped. `resolve()` is
 * the only place that knows this, so the rest of the game just says "face west".
 */
import type { ActorSprite } from "./sprite";
import type { Dir, ClipName } from "./cel-painter";
import { FPS_IDLE, FPS_WALK, FPS_ATTACK, FPS_DEATH } from "../constants";

/** The four directions the game thinks in. */
export type Facing = "S" | "N" | "E" | "W";

const FPS: Record<ClipName, number> = {
  idle: FPS_IDLE,
  walk: FPS_WALK,
  attack: FPS_ATTACK,
  death: FPS_DEATH,
};

const LOOPS: Record<ClipName, boolean> = {
  idle: true,
  walk: true,
  attack: false,
  death: false,
};

/** Facing → (authored direction, whether to mirror). */
function resolve(facing: Facing): { dir: Dir; flip: boolean } {
  if (facing === "W") return { dir: "E", flip: true };
  return { dir: facing as Dir, flip: false };
}

export class Animator {
  private sprite: ActorSprite;
  private clip: ClipName = "idle";
  private facing: Facing = "S";
  private frameIdx = 0;
  private timer = 0;
  private finished = false;
  private onEnd: (() => void) | null = null;

  constructor(sprite: ActorSprite) {
    this.sprite = sprite;
    this.apply();
  }

  /** Switch clip. Re-playing the clip you're already in is a no-op (unless forced). */
  play(clip: ClipName, opts: { force?: boolean; onEnd?: () => void } = {}): void {
    if (this.clip === clip && !opts.force) return;
    this.clip = clip;
    this.frameIdx = 0;
    this.timer = 0;
    this.finished = false;
    this.onEnd = opts.onEnd ?? null;
    this.apply();
  }

  setFacing(facing: Facing): void {
    if (this.facing === facing) return;
    this.facing = facing;
    this.apply();
  }

  /** True once a non-looping clip (attack, death) has run out of frames. */
  isFinished(): boolean {
    return this.finished;
  }

  getClip(): ClipName {
    return this.clip;
  }

  update(dt: number): void {
    const indices = this.indices();
    if (indices.length <= 1) return;
    if (this.finished) return;

    this.timer += dt;
    const step = 1 / FPS[this.clip];
    while (this.timer >= step) {
      this.timer -= step;
      this.frameIdx++;
      if (this.frameIdx >= indices.length) {
        if (LOOPS[this.clip]) {
          this.frameIdx = 0;
        } else {
          // Hold the last frame — a death that snapped back to frame 0 would be
          // a resurrection.
          this.frameIdx = indices.length - 1;
          this.finished = true;
          this.onEnd?.();
          this.onEnd = null;
          break;
        }
      }
    }
    this.apply();
  }

  private indices(): number[] {
    const { dir } = resolve(this.facing);
    return this.sprite.sheet.clips.get(`${dir}:${this.clip}`) ?? [];
  }

  private apply(): void {
    const { flip } = resolve(this.facing);
    const indices = this.indices();
    if (!indices.length) return;
    this.sprite.setFlipped(flip);
    this.sprite.setFrame(indices[Math.min(this.frameIdx, indices.length - 1)]);
  }
}

/** Velocity → facing. Ties break toward the vertical axis, which reads better. */
export function facingFromVelocity(vx: number, vz: number, fallback: Facing): Facing {
  if (Math.abs(vx) < 1e-4 && Math.abs(vz) < 1e-4) return fallback;
  if (Math.abs(vz) >= Math.abs(vx)) return vz > 0 ? "S" : "N";
  return vx > 0 ? "E" : "W";
}
