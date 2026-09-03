/**
 * 🧟 Monster Animator — Dedicated Animation State Machine for Monsters.
 *
 * Distinct from the player's Animator to isolate monster-specific animation
 * resolution, prevent regressions to knight movement, and enforce a strict
 * unidirectional death state machine:
 *
 *   ALIVE (idle, walk, attack, etc.)
 *     │
 *     ▼ triggerDeath(facing)
 *   DYING (frame 0 -> 1 -> 2 -> ... -> N-1; strictly uninterruptible)
 *     │
 *     ▼ frame N-1 reached
 *   DEAD (locked on terminal corpse puddle frame; isFinished = true)
 *
 * Once DYING or DEAD:
 * - Calling play() is a NO-OP.
 * - Calling setFacing() is a NO-OP.
 * - Calling setRate() is a NO-OP.
 * - Re-applying damage or staggers cannot disrupt or restart the death clip.
 * - Background sprite sheet rebuilds gracefully update art without losing death pose.
 */
import type { ActorSprite, SpriteSheet } from "./sprite";
import type { ClipName } from "./paint-types";
import type { Facing } from "./animator";
import { engineConfig } from "../config";

export type MonsterAnimState = "alive" | "dying" | "dead";

/** Frame rate for a clip, read live from config. */
function fpsFor(clip: ClipName): number {
  const a = engineConfig.anim;
  switch (clip) {
    case "idle": return a.idle;
    case "walk": return a.walk;
    case "run": return a.run;
    case "attack": return a.attack;
    case "death": return a.death;
    case "roll": return a.roll;
    case "crouch": return a.crouch;
    case "wait": return a.wait;
    case "wake": return a.wake;
    case "stumble": return a.stumble;
    default: return 6;
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
  diamondball: true,
  waterball: true,
  stoneball: true,
  stormball: true,
  shadowball: true,
  lavaball: true,
  boltform: true,
  laserform: true,
  equip: false,
  forge: false,
  crouch: false,
  wake: false,
  stumble: false,
  wait: true,
};

const CLIP_FALLBACK: Partial<Record<ClipName, ClipName>> = {
  crouch: "idle",
  wait: "walk",
  wake: "walk",
  stumble: "idle",
  attack: "idle",
  run: "walk",
};

export class MonsterAnimator {
  readonly sprite: ActorSprite;
  private state: MonsterAnimState = "alive";
  private clip: ClipName = "idle";
  private facing: Facing = "S";
  private frameIdx = 0;
  private timer = 0;
  private rate = 1;
  private finished = false;
  private ticks = 0;
  private lastDt = 0;
  private onEnd: (() => void) | null = null;

  constructor(sprite: ActorSprite) {
    this.sprite = sprite;
    this.apply();
  }

  getState(): MonsterAnimState {
    return this.state;
  }

  isAlive(): boolean {
    return this.state === "alive";
  }

  isDying(): boolean {
    return this.state === "dying";
  }

  isDead(): boolean {
    return this.state === "dead";
  }

  isFinished(): boolean {
    return this.finished;
  }

  getClip(): ClipName {
    return this.clip;
  }

  getFacing(): Facing {
    return this.facing;
  }

  getFrameIdx(): number {
    return this.frameIdx;
  }

  getRate(): number {
    return this.rate;
  }

  setRate(rate: number): void {
    if (this.state !== "alive") return;
    this.rate = Math.max(0.1, rate);
  }

  /**
   * Switch clip when alive.
   * If dying or dead, this is strictly a NO-OP.
   */
  play(clip: ClipName, opts: { force?: boolean; onEnd?: () => void } = {}): void {
    if (this.state !== "alive") {
      return;
    }
    if (this.clip === clip && !opts.force) {
      return;
    }
    this.clip = clip;
    this.frameIdx = 0;
    this.timer = 0;
    this.finished = false;
    this.onEnd = opts.onEnd ?? null;
    this.apply();
  }

  /**
   * Set facing direction when alive.
   * If dying or dead, facing is locked and calls are ignored.
   */
  setFacing(facing: Facing): void {
    if (this.state !== "alive") {
      return;
    }
    if (this.facing === facing) {
      return;
    }
    this.facing = facing;
    this.apply();
  }

  /**
   * Trigger the death lifecycle.
   * Unconditionally locks the state to "dying", starts death clip at frame 0,
   * and blocks all future play() or setFacing() mutations.
   */
  triggerDeath(facing?: Facing, onEnd?: () => void): void {
    if (this.state === "dying" || this.state === "dead") {
      return;
    }
    this.state = "dying";
    if (facing) {
      this.facing = facing;
    }
    this.clip = "death";
    this.frameIdx = 0;
    this.timer = 0;
    this.finished = false;
    this.onEnd = onEnd ?? null;
    this.apply();
  }

  /**
   * Advances animation progression by dt.
   * Called strictly by AnimationPresentationSystem.
   */
  update(dt: number): void {
    this.ticks++;
    this.lastDt = dt;

    if (this.state === "dead") {
      this.apply();
      return;
    }

    const indices = this.indices();
    if (indices.length === 0) {
      // Empty clip: if dying, finish and hold state
      if (this.state === "dying") {
        this.finished = true;
        this.state = "dead";
        this.onEnd?.();
        this.onEnd = null;
      }
      this.apply();
      return;
    }

    const played = this.resolved();
    this.timer += dt;

    const beats = this.sprite.sheet.beats?.[played];
    const smooth = beats && beats > 0 ? indices.length / beats : 1;
    const fps = fpsFor(played) || 6;
    const safeFps = Math.max(1, fps);
    const safeRate = Math.max(0.1, this.rate);
    const safeSmooth = Math.max(0.1, smooth);
    const step = 1 / (safeFps * safeRate * safeSmooth);

    // Single-frame clip: hold for at least 1 step before marking finished
    if (indices.length === 1) {
      if (this.timer >= step) {
        if (this.state === "dying") {
          this.finished = true;
          this.state = "dead";
          this.onEnd?.();
          this.onEnd = null;
        } else if (!LOOPS[played]) {
          this.finished = true;
          this.onEnd?.();
          this.onEnd = null;
        }
      }
      this.apply();
      return;
    }

    // Multi-frame clip progression
    while (this.timer >= step) {
      this.timer -= step;
      this.frameIdx++;
      if (this.frameIdx >= indices.length) {
        if (this.state === "dying") {
          this.frameIdx = indices.length - 1;
          this.finished = true;
          this.state = "dead";
          this.onEnd?.();
          this.onEnd = null;
          break;
        } else if (!LOOPS[played]) {
          this.frameIdx = indices.length - 1;
          this.finished = true;
          this.onEnd?.();
          this.onEnd = null;
          break;
        } else {
          this.frameIdx = 0;
        }
      }
    }

    this.apply();
  }

  /** Reapply sheet on atlas rebuild without losing death pose or progression. */
  reapplySheet(newSheet: SpriteSheet): void {
    this.sprite.setSheet(newSheet);
    const newIndices = this.indices();
    if (newIndices.length > 0) {
      if (this.state === "dead") {
        this.frameIdx = newIndices.length - 1;
      } else {
        this.frameIdx = Math.min(this.frameIdx, newIndices.length - 1);
      }
    }
    this.apply();
  }

  reapply(): void {
    this.apply();
  }

  debugIndices(): number[] {
    return this.indices();
  }

  debugTicks(): { ticks: number; lastDt: number; timer: number } {
    return { ticks: this.ticks, lastDt: this.lastDt, timer: this.timer };
  }

  debugResolvedClip(): ClipName {
    return this.resolved();
  }

  private resolveFacing(): { dir: "S" | "N" | "E"; flip: boolean } {
    switch (this.facing) {
      case "S": return { dir: "S", flip: false };
      case "N": return { dir: "N", flip: false };
      case "E": return { dir: "E", flip: false };
      case "W": return { dir: "E", flip: true };
    }
  }

  private resolved(): ClipName {
    const { dir } = this.resolveFacing();
    const clips = this.sprite.sheet.clips;
    if (clips.get(`${dir}:${this.clip}`)?.length) return this.clip;
    if (clips.get(`S:${this.clip}`)?.length) return this.clip;
    if (clips.get(`E:${this.clip}`)?.length) return this.clip;
    if (clips.get(`N:${this.clip}`)?.length) return this.clip;
    for (const key of clips.keys()) {
      if (key.endsWith(`:${this.clip}`) && clips.get(key)!.length > 0) return this.clip;
    }
    return CLIP_FALLBACK[this.clip] ?? this.clip;
  }

  private indices(): number[] {
    const { dir } = this.resolveFacing();
    const clip = this.resolved();
    const clips = this.sprite.sheet.clips;
    const own = clips.get(`${dir}:${clip}`);
    if (own && own.length > 0) return own;
    const south = clips.get(`S:${clip}`);
    if (south && south.length > 0) return south;
    const east = clips.get(`E:${clip}`);
    if (east && east.length > 0) return east;
    const north = clips.get(`N:${clip}`);
    if (north && north.length > 0) return north;
    for (const key of clips.keys()) {
      if (key.endsWith(`:${clip}`)) {
        const list = clips.get(key);
        if (list && list.length > 0) return list;
      }
    }
    return [];
  }

  private apply(): void {
    const { flip } = this.resolveFacing();
    const indices = this.indices();
    this.sprite.setFlipped(flip);
    if (!indices.length) return;
    const target = indices[Math.min(this.frameIdx, indices.length - 1)];
    this.sprite.setFrame(target);
  }
}
