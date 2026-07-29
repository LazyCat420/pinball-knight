/**
 * GameEngine — the seam between Pinball Knight and its engine.
 *
 * Two jobs, and deliberately nothing else:
 *
 *  1. **Wiring.** `installEngine()` hands the engine everything it needs from
 *     the game: the tuning numbers out of `constants.ts`, the "Cold Crypt"
 *     palette, and the reading of how deep the current bounce chain is. After
 *     the extraction, `engine/` imports no game module at all — every value it
 *     used to reach in and take is now pushed to it from here. This function IS
 *     that inversion; if it stops being called, the engine silently falls back
 *     to greyscale and default tuning rather than failing loudly, so treat the
 *     call in `launchDungeonGame` as load-bearing.
 *
 *  2. **The fixed-step clock.** `FixedStepLoop` owns the accumulator that
 *     drives the 60Hz simulation. It was inline in `core.ts`'s RAF callback and
 *     is lifted here because the rules it encodes — clamp a long frame, never
 *     bank time during a hit-freeze, run juice clocks in REAL time — are engine
 *     policy that any game on this loop wants, and because inline in a 2100-line
 *     RAF callback they were untestable.
 *
 * WHAT THIS IS NOT: a god object that owns the game. `core.ts` still owns the
 * scene, the level lifecycle and the render order. This is the boundary layer,
 * and it should stay small enough to read in one sitting.
 */
import {
  CAM_DEADZONE,
  CAM_LERP,
  CAMERA_DIST,
  CAMERA_TILT,
  CAMERA_YAW,
  PPU,
  VIEW_H,
  VIEW_W,
  HITSTOP_CHAIN_FALLOFF,
  HITSTOP_CHAIN_FLOOR,
  HITSTOP_MAX_PENDING,
  HITSTOP_MIN_GAP,
  SHAKE_CHAIN_FALLOFF,
  SHAKE_CHAIN_FLOOR,
  SHAKE_CHAIN_WINDOW,
  SPRITE_PX,
  ART_PX,
  SPRITE_PIXEL_GRID,
  SPRITE_UNITS,
  MAX_ATLAS_WIDTH,
  RENDER_W,
  RENDER_H,
  MAX_RENDER_W,
  MAX_RENDER_H,
  BLOOM_THRESHOLD,
  BLOOM_STRENGTH,
  BLOOM_RADIUS,
  AO_RADIUS,
  AO_STRENGTH,
  VIGNETTE,
  OUTLINE_EDGE_THRESHOLD,
  FRENZY_VIGNETTE,
  FRENZY_ABERRATION,
  FPS_IDLE,
  FPS_WALK,
  FPS_RUN,
  FPS_ATTACK,
  FPS_DEATH,
  FPS_ROLL,
  FPS_BALL,
  FPS_EQUIP,
  FPS_FORGE,
  FPS_CROUCH,
  FPS_WAIT,
  FPS_WAKE,
  FPS_STUMBLE,
} from "./constants";
import { configureEngine } from "./engine/config";
import { setEnginePalette } from "./engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./render/palette";

/**
 * Palette index used to tint the player's silhouette when a wall is between
 * them and the camera. 30 is the arcane mid — it reads as "you, behind the
 * wall" rather than as another actor.
 */
const OCCLUSION_PALETTE_INDEX = 30;

/**
 * Push the game's configuration into the engine.
 *
 * Call ONCE, before anything builds a camera, a sprite or the pixel pass —
 * several engine modules resolve config at construction, so injecting late
 * means the first objects are built against the defaults.
 */
export function installEngine(): void {
  configureEngine({
    camera: {
      viewW: VIEW_W,
      viewH: VIEW_H,
      tilt: CAMERA_TILT,
      yaw: CAMERA_YAW,
      dist: CAMERA_DIST,
      ppu: PPU,
      deadzone: CAM_DEADZONE,
      lerp: CAM_LERP,
    },
    juice: {
      shakeChainWindow: SHAKE_CHAIN_WINDOW,
      shakeChainFloor: SHAKE_CHAIN_FLOOR,
      shakeChainFalloff: SHAKE_CHAIN_FALLOFF,
      hitstopMinGap: HITSTOP_MIN_GAP,
      hitstopChainFalloff: HITSTOP_CHAIN_FALLOFF,
      hitstopChainFloor: HITSTOP_CHAIN_FLOOR,
      hitstopMaxPending: HITSTOP_MAX_PENDING,
    },
    sprite: {
      px: SPRITE_PX,
      artPx: ART_PX,
      pixelGrid: SPRITE_PIXEL_GRID,
      units: SPRITE_UNITS,
      maxAtlasWidth: MAX_ATLAS_WIDTH,
    },
    post: {
      renderW: RENDER_W,
      renderH: RENDER_H,
      maxRenderW: MAX_RENDER_W,
      maxRenderH: MAX_RENDER_H,
      bloomThreshold: BLOOM_THRESHOLD,
      bloomStrength: BLOOM_STRENGTH,
      bloomRadius: BLOOM_RADIUS,
      aoRadius: AO_RADIUS,
      aoStrength: AO_STRENGTH,
      vignette: VIGNETTE,
      outlineEdgeThreshold: OUTLINE_EDGE_THRESHOLD,
      frenzyVignette: FRENZY_VIGNETTE,
      frenzyAberration: FRENZY_ABERRATION,
    },
    anim: {
      idle: FPS_IDLE,
      walk: FPS_WALK,
      run: FPS_RUN,
      attack: FPS_ATTACK,
      death: FPS_DEATH,
      roll: FPS_ROLL,
      ball: FPS_BALL,
      equip: FPS_EQUIP,
      forge: FPS_FORGE,
      crouch: FPS_CROUCH,
      wait: FPS_WAIT,
      wake: FPS_WAKE,
      stumble: FPS_STUMBLE,
    },
  });

  setEnginePalette({
    size: PALETTE_SIZE,
    toFloatArray: paletteToFloatArray,
    hex: () => PALETTE_HEX,
    css: paletteCss,
    occlusionIndex: OCCLUSION_PALETTE_INDEX,
  });
}

/** What one tick of the loop did — returned so callers can profile it. */
export interface StepResult {
  /** Real seconds elapsed this frame, after clamping. */
  frame: number;
  /** How many fixed steps ran. 0 during a hit-freeze. */
  simSteps: number;
  /** True if the sim was frozen this frame. */
  frozen: boolean;
}

export interface FixedStepOptions {
  /** Seconds per simulation step. */
  fixedStep: number;
  /** Ceiling on a single frame's delta — tab-out protection. */
  maxFrame: number;
}

/**
 * The accumulator that drives the fixed-timestep simulation.
 *
 * Extracted from core's RAF callback. The three rules it encodes each exist
 * because of a specific bug:
 *
 *  - **Clamp the delta at both ends.** `maxFrame` is tab-out protection. The
 *    ZERO FLOOR guards a first RAF timestamp that lags `performance.now()` (a
 *    headless / pre-render quirk): one negative delta poisons the accumulator
 *    and freezes the simulation for that long.
 *  - **Never bank time during a hit-freeze.** While frozen the accumulator is
 *    clamped to a single step, so the world does not fast-forward to catch up
 *    the instant the freeze ends — which would undo the crunch the freeze was
 *    there to sell.
 *  - **Juice clocks tick in REAL time**, outside the fixed-step block. They
 *    measure the gap between crunches as the PLAYER feels it, and sim time does
 *    not advance during a freeze — clocking them inside would stop the limiter
 *    exactly when it is needed.
 */
export class FixedStepLoop {
  private acc = 0;
  private readonly fixedStep: number;
  private readonly maxFrame: number;

  constructor(opts: FixedStepOptions) {
    this.fixedStep = opts.fixedStep;
    this.maxFrame = opts.maxFrame;
  }

  /** Banked, not-yet-simulated time. Exposed for tests and the profiler. */
  get accumulator(): number {
    return this.acc;
  }

  /** Drop banked time — call on level change so a new floor starts clean. */
  reset(): void {
    this.acc = 0;
  }

  /**
   * Advance by one real frame.
   *
   * @param rawDelta  Seconds since the previous frame, unclamped.
   * @param hitstopT  Seconds of hit-freeze remaining, before this frame.
   * @param simulate  Runs one fixed step.
   * @returns         What happened, plus the new hitstop remainder.
   */
  step(
    rawDelta: number,
    hitstopT: number,
    simulate: (dt: number) => void,
  ): StepResult & { hitstopT: number } {
    const frame = Math.min(Math.max(0, rawDelta), this.maxFrame);
    this.acc += frame;

    if (hitstopT > 0) {
      // Frozen: bleed the freeze down in real time and refuse to bank.
      this.acc = Math.min(this.acc, this.fixedStep);
      return { frame, simSteps: 0, frozen: true, hitstopT: Math.max(0, hitstopT - frame) };
    }

    let simSteps = 0;
    while (this.acc >= this.fixedStep) {
      this.acc -= this.fixedStep;
      simulate(this.fixedStep);
      simSteps++;
    }
    return { frame, simSteps, frozen: false, hitstopT: 0 };
  }
}
