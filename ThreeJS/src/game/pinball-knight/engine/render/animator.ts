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
    // steelball and the six MARBLE BODIES share the ball cadence — it's the
    // same ride, different substance. The spin is a quarter turn per frame in
    // every case, so a material that rolled at its own rate would read as the
    // ball changing SPEED when you picked it up.
    case "ball":
    case "steelball":
    case "diamondball":
    case "waterball":
    case "stoneball":
    case "stormball":
    case "shadowball":
    case "lavaball":
    // The ricochet forms ride the ball cadence too — they are the same
    // four-beat spin, drawn as a bolt / a beam instead of a sphere.
    case "boltform":
    case "laserform":
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
  // A rolling sphere never stops rolling — every marble body loops.
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
  /**
   * ATTACK, added when the windup stopped hard-coding `idle` for melee kinds
   * (entities/zombie.ts). Before that change only ranged families ever asked
   * for this clip, and every ranged family paints one — so the gap was real but
   * unreachable.
   *
   * It is reachable now, and MOST of the roster falls through it: twelve
   * painted families author no `attack` at all (zombie, spider, brute, boss,
   * ghost, reaper, bat, slime, goblin, pin, golem, magnet). Without this entry
   * every one of them would resolve to an empty index list the moment it wound
   * up, and `apply()` bails on empty — a horde frozen mid-stride whenever it
   * decided to swing. That is a far louder bug than the missing animation this
   * wave set out to fix.
   *
   * `idle` is the honest target: it is exactly what those families played
   * during a windup before, so a family with no attack art is unchanged, and
   * the colour telegraph that has always carried the read is untouched.
   */
  attack: "idle",
  /**
   * RUN, which the PAINTED roster does not have and the IMPORTED roster gets
   * for free — the asymmetry this closes.
   *
   * `alias()` in render/imported-paints.ts already hands `run` the `walk`
   * frames by reference for any imported sheet, on the reasoning that one
   * animation serves both gaits at different frame rates (most source sheets
   * literally caption the row "Walk / Run"). Nothing did the same for a
   * painter, so `run` resolved to an empty list on 21 of 22 painted families —
   * measured with scripts/clip-probe.mjs against the live atlas.
   *
   * Latent today: the only monster that plays `run` is the croaker's airborne
   * hop (entities/zombie.ts), and the croaker is imported, so `alias()` covers
   * it. That is precisely why it is worth fixing now rather than when it bites
   * — the next leap or charge policy pointed at a painted family would freeze
   * it mid-air, and the symptom (a monster stuck in the air) would look like a
   * physics bug, not an art one.
   *
   * `walk` and not `idle`, matching `alias()`: a sprinting creature playing its
   * walk cycle at the run frame rate is how a run is drawn by hand anyway. The
   * rate follows the resolved clip, so this plays walk's frames at walk's FPS —
   * a touch slower than a real run would read, and still enormously better than
   * a frozen frame.
   */
  run: "walk",
};

/**
 * Is this clip a RIDE pose — the knight tucked into a ball, tumbling, or shot
 * as a ricochet form — rather than a pose on his feet?
 *
 * Derived from the clip NAME rather than a hand-kept list, and from the same
 * convention `materialClip()` builds its clip out of (`${material}ball`), so a
 * seventh marble body is covered on the day it is painted instead of on the day
 * somebody remembers this function exists.
 *
 * Anything that renders a COPY of the knight needs it: a body derived from its
 * own velocity renders a hurtling marble as a walk cycle, which is the bug this
 * exists to prevent (see MIRRORED_CLIPS in render/remote-party.ts, which learnt
 * the same lesson for co-op peers).
 */
export function isRideClip(clip: ClipName): boolean {
  return clip === "roll" || clip.endsWith("ball") || clip.endsWith("form");
}

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
    // Guard against interrupting or resetting a death animation already in progress or completed
    if (this.clip === "death" && clip === "death" && (this.finished || this.frameIdx > 0)) {
      return;
    }
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

  getFrameIdx(): number {
    return this.frameIdx;
  }


  /**
   * Playback-rate multiplier over the clip's base FPS. The sprint gait ramps
   * this with the sprint charge so the run visibly quickens as it spools.
   * Sticky across play() calls — callers that care set it every frame.
   */
  setRate(rate: number): void {
    this.rate = Math.max(0.1, rate);
  }

  /**
   * The live rate. Exists so an actor that MIRRORS another (the multi-ball
   * echoes) copies the spin it is actually running rather than re-deriving it
   * from momentum a second time — two copies of that formula is how one of them
   * ends up spinning at the wrong speed.
   */
  getRate(): number {
    return this.rate;
  }

  update(dt: number): void {
    const indices = this.indices();
    if (indices.length <= 1) return;
    if (this.finished) return;

    const played = this.resolved();
    this.timer += dt;
    // Frames per authored beat. A clip that declares `beats` keeps its CYCLE
    // DURATION no matter how many in-betweens it gains, so a 4-frame walk taken
    // to 8 gets smoother rather than half-speed — which would be foot-sliding,
    // since monsters never call setRate and their world speed is unchanged.
    const beats = this.sprite.sheet.beats?.[played];
    const smooth = beats && beats > 0 ? indices.length / beats : 1;
    const step = 1 / (fpsFor(played) * this.rate * smooth);
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
      } else if (!LOOPS[played] && this.frameIdx === indices.length - 1) {
        this.finished = true;
        this.onEnd?.();
        this.onEnd = null;
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
    if (this.sprite.sheet.clips.get(`S:${this.clip}`)?.length) return this.clip;
    return CLIP_FALLBACK[this.clip] ?? this.clip;
  }

  private indices(): number[] {
    const { dir } = resolve(this.facing);
    const clip = this.resolved();
    const own = this.sprite.sheet.clips.get(`${dir}:${clip}`);
    if (own && own.length > 0) return own;
    return this.sprite.sheet.clips.get(`S:${clip}`) ?? [];
  }

  private apply(): void {
    const { flip } = resolve(this.facing);
    const indices = this.indices();
    // The flip updates even when the clip has no frames to show. Bailing
    // before it left the sprite on the OLD frame with the OLD mirror, so the
    // next successful apply() combined a new frame with a stale flip — one
    // beat of the actor facing the wrong way on every W↔E turn through an
    // unauthored clip.
    this.sprite.setFlipped(flip);
    if (!indices.length) return;
    this.sprite.setFrame(indices[Math.min(this.frameIdx, indices.length - 1)]);
  }
}

/**
 * Velocity → facing, with HYSTERESIS on the axis.
 *
 * A diagonal exactly on the 45° line otherwise flips between two facings on
 * frame-to-frame noise — measured on the knight as the body re-rendering
 * S/E/S/E while the stride carried on, which players read as "the legs turn
 * but the body doesn't". The current axis keeps the facing until the other
 * axis clearly dominates (25%); sign reversals WITHIN the axis (S↔N, E↔W)
 * stay instant, because a turn-around must not lag the stick.
 */
export function facingFromVelocity(vx: number, vz: number, fallback: Facing): Facing {
  const ax = Math.abs(vx);
  const az = Math.abs(vz);
  if (ax < 1e-4 && az < 1e-4) return fallback;
  const vertical = fallback === "S" || fallback === "N";
  const MARGIN = 1.25;
  if (vertical && az * MARGIN >= ax && az >= 1e-4) return vz > 0 ? "S" : "N";
  if (!vertical && ax * MARGIN >= az && ax >= 1e-4) return vx > 0 ? "E" : "W";
  // The other axis clearly won (or the current one went dead): switch. Ties
  // break toward the vertical axis, which reads better.
  if (az >= ax) return vz > 0 ? "S" : "N";
  return vx > 0 ? "E" : "W";
}
