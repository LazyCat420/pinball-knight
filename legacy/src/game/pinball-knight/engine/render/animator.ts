/**
 * Frame timing + direction picking for one actor.
 *
 * Only S / N / E are authored — W is E with the sprite flipped. `resolve()` is
 * the only place that knows this, so the rest of the game just says "face west".
 */
import type { ActorSprite } from "./sprite";
import type { Dir, ClipName } from "./paint-types";
import { engineConfig } from "../config";

/** The four directions the game thinks in. */
export type Facing = "S" | "N" | "E" | "W";

/**
 * Frame rate for a clip, read live from the injected config.
 *
 * A function rather than a captured table: the table used to be built at
 * module load from `constants`, which would freeze whatever the config held
 * at import time and silently ignore anything the game injected afterwards.
 */
function fpsFor(clip: ClipName): number {
  const a = engineConfig.anim;
  switch (clip) {
    case "idle":
      return a.idle;
    case "walk":
      return a.walk;
    case "run":
      return a.run;
    case "attack":
      return a.attack;
    case "death":
      return a.death;
    case "roll":
      return a.roll;
    // steelball shares the ball cadence — it's the same ride, different skin.
    case "ball":
    case "steelball":
      return a.ball;
    case "equip":
      return a.equip;
    case "forge":
      return a.forge;
    case "crouch":
      return a.crouch;
    case "wait":
      return a.wait;
    case "wake":
      return a.wake;
    case "stumble":
      return a.stumble;
  }
}

const LOOPS: Record<ClipName, boolean> = {
  idle: true,
  walk: true,
  run: true,
  attack: false,
  death: false,
  roll: false,
  ball: true,
  steelball: true,
  equip: false,
  forge: false,
  // A telegraph HOLDS its end pose. A crouch that looped back to "just starting
  // to crouch" would restate the wind-up the player is already reading, and a
  // stagger that looped would read as a second hit landing.
  crouch: false,
  wake: false,
  stumble: false,
  // The stalk is a gait, not a beat — it loops like the walk it replaces.
  wait: true,
};

/**
 * What to play when an actor does not author the clip that was asked for.
 *
 * The four telegraph clips are authored on the sheets that actually run those
 * policies (the zombie rig, the spider, the magnet) rather than on all
 * twenty-two families. Without a fallback the rest would resolve to an EMPTY
 * index list, and `apply()` bails on empty — so the actor would freeze on
 * whatever frame it happened to be on. That is strictly worse than the tint-only
 * telegraph this wave is replacing, and it would only show up on the families
 * nobody thought to check.
 *
 * So an unauthored clip degrades to the clip the game played BEFORE it existed:
 * a stagger with no stumble art plays `idle` pale, exactly as it used to. The
 * RATE and the LOOP FLAG follow the resolved clip too — falling back to `walk`
 * but keeping `wake`'s one-shot flag would freeze a bursting ambusher's legs
 * halfway through a stride, which is not "unchanged", it is a new bug.
 */
const CLIP_FALLBACK: Partial<Record<ClipName, ClipName>> = {
  crouch: "idle",
  wait: "walk",
  wake: "walk",
  stumble: "idle",
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
  private rate = 1;

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

  /**
   * Playback-rate multiplier over the clip's base FPS. The sprint gait ramps
   * this with the sprint charge so the run visibly quickens as it spools.
   * Sticky across play() calls — callers that care set it every frame.
   */
  setRate(rate: number): void {
    this.rate = Math.max(0.1, rate);
  }

  update(dt: number): void {
    const indices = this.indices();
    if (indices.length <= 1) return;
    if (this.finished) return;

    const played = this.resolved();
    this.timer += dt;
    const step = 1 / (fpsFor(played) * this.rate);
    while (this.timer >= step) {
      this.timer -= step;
      this.frameIdx++;
      if (this.frameIdx >= indices.length) {
        if (LOOPS[played]) {
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

  /**
   * The clip whose frames will actually play: the requested one if this sheet
   * authors it, else the fallback (once — the chain is one hop deep by design,
   * since every fallback target is a clip every actor has).
   */
  private resolved(): ClipName {
    const { dir } = resolve(this.facing);
    if (this.sprite.sheet.clips.get(`${dir}:${this.clip}`)?.length) return this.clip;
    return CLIP_FALLBACK[this.clip] ?? this.clip;
  }

  private indices(): number[] {
    const { dir } = resolve(this.facing);
    return this.sprite.sheet.clips.get(`${dir}:${this.resolved()}`) ?? [];
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
