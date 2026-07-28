/**
 * Engine tuning, injected by the game at boot.
 *
 * ── Why injection rather than importing `constants.ts` ────────────────────
 *
 * The engine files used to import `../constants` — a 2279-line table of
 * pinball tuning covering wall break speeds, mana costs and flipper
 * restitution. The camera needed eight numbers out of it. Importing the whole
 * table to get eight numbers is what made the camera un-reusable: you could
 * not take it to another game without taking the pinball balance with it.
 *
 * So the engine declares the shape it needs and the game supplies it. The
 * game's `constants.ts` remains the single source of truth for the VALUES —
 * this is not a second place to tune the camera, it is the seam through which
 * the existing values arrive.
 *
 * Defaults are present so the engine is usable standalone (and so tests can
 * import an engine module without booting the game). The game overwrites them
 * in `configureEngine`, called from core's boot path before the first frame.
 */

export interface CameraConfig {
  /** Orthographic frustum width/height in world units. */
  viewW: number;
  viewH: number;
  /** Camera tilt from horizontal, radians. */
  tilt: number;
  /** Camera yaw, radians. 45° gives true iso diamonds. */
  yaw: number;
  /** Distance along the view axis. Irrelevant to scale under ortho. */
  dist: number;
  /** Pixels per world unit — the pixel-snap lattice. */
  ppu: number;
  /** How far the player may wander before the camera follows. */
  deadzone: number;
  /** Follow catch-up rate, 1/sec. */
  lerp: number;
}

export interface JuiceConfig {
  /** Two shakes closer together than this are treated as one chain. */
  shakeChainWindow: number;
  /** Lower bound on chain damping — a fully damped hit still reads. */
  shakeChainFloor: number;
  /** Per-chain-step multiplier for shake. */
  shakeChainFalloff: number;
  /** Two hit-freezes closer than this are one stutter; the second is dropped. */
  hitstopMinGap: number;
  /** Per-chain-step multiplier for hit-freeze. */
  hitstopChainFalloff: number;
  /** Lower bound on hit-freeze chain damping. */
  hitstopChainFloor: number;
  /** Hard ceiling on pending freeze — the structural anti-stutter backstop. */
  hitstopMaxPending: number;
}

export interface SpriteConfig {
  /** Painted art size per frame, px. */
  px: number;
  /** The pixel grid a sprite occupies on screen. */
  pixelGrid: number;
  /** World height of a sprite = pixelGrid / ppu. */
  units: number;
  /**
   * Hard cap on atlas width. Exceeding the GPU limit silently yields a BLANK
   * texture rather than an error, so this is a real ceiling, not a hint.
   */
  maxAtlasWidth: number;
}

export interface PostConfig {
  /** Internal render-target size before upscale. */
  renderW: number;
  renderH: number;
  /** Ceiling on the render target on high-DPI displays. */
  maxRenderW: number;
  maxRenderH: number;
  bloomThreshold: number;
  bloomStrength: number;
  /** Blur spread in half-res texels. */
  bloomRadius: number;
  aoRadius: number;
  /** How hard concave corners darken. */
  aoStrength: number;
  vignette: number;
  /** Luma step a colour edge must exceed to be inked (the second outline term). */
  outlineEdgeThreshold: number;
  /** Vignette target at full frenzy. */
  frenzyVignette: number;
  /** Peak chromatic-aberration split, UV units. */
  frenzyAberration: number;
}

/** Frames per second for each named clip. */
export interface AnimConfig {
  idle: number;
  walk: number;
  run: number;
  attack: number;
  death: number;
  roll: number;
  ball: number;
  equip: number;
  forge: number;
  crouch: number;
  wait: number;
  wake: number;
  stumble: number;
}

export interface EngineConfig {
  camera: CameraConfig;
  juice: JuiceConfig;
  sprite: SpriteConfig;
  post: PostConfig;
  anim: AnimConfig;
}

/**
 * Live config. Mutated in place by `configureEngine` rather than reassigned,
 * so modules that captured a reference at import time see the update.
 */
export const engineConfig: EngineConfig = {
  camera: {
    viewW: 20,
    viewH: 11.25,
    tilt: (38 * Math.PI) / 180,
    yaw: (45 * Math.PI) / 180,
    dist: 24,
    ppu: 64,
    deadzone: 0.7,
    lerp: 6,
  },
  juice: {
    shakeChainWindow: 0.09,
    shakeChainFloor: 0.35,
    shakeChainFalloff: 0.72,
    hitstopMinGap: 0.11,
    hitstopChainFalloff: 0.55,
    hitstopChainFloor: 0.25,
    hitstopMaxPending: 0.09,
  },
  sprite: {
    px: 128,
    pixelGrid: 72,
    units: 72 / 64,
    maxAtlasWidth: 8192,
  },
  post: {
    renderW: 1280,
    renderH: 720,
    maxRenderW: 1920,
    maxRenderH: 1080,
    bloomThreshold: 0.7,
    bloomStrength: 0.9,
    bloomRadius: 2.2,
    aoRadius: 14,
    aoStrength: 0.85,
    vignette: 0.32,
    outlineEdgeThreshold: 0.26,
    frenzyVignette: 0.48,
    frenzyAberration: 0.006,
  },
  anim: {
    idle: 3,
    walk: 8,
    run: 10,
    attack: 12,
    death: 6,
    roll: 10,
    ball: 14,
    equip: 8,
    forge: 7,
    crouch: 7,
    wait: 5,
    wake: 10,
    stumble: 9,
  },
};

/**
 * Install the game's tuning into the engine. Partial — a caller that only
 * cares about the camera need not restate the juice policy.
 *
 * Camera geometry is cached by `camera.ts` at module load (the offset vector
 * and the screen-axis basis are derived from yaw/tilt/dist), so callers that
 * change those must re-derive; `camera.ts` exposes `refreshCameraBasis` for
 * exactly that and this function calls it.
 */
/**
 * Modules that cache values derived from the config register here so they can
 * re-derive when it changes.
 *
 * A callback rather than a direct call into `camera.ts`, because camera.ts
 * imports this module and the reverse import would be a cycle. It is
 * deliberately SYNCHRONOUS: an async refresh (via `await import`) would let
 * the first frame render against a stale basis, showing up as one frame of
 * mis-rotated controls at boot.
 */
type DerivedRefresh = () => void;
const derived: DerivedRefresh[] = [];

/** Register a re-derive hook. Called at module load by dependents. */
export function onConfigChange(fn: DerivedRefresh): void {
  derived.push(fn);
}

export function configureEngine(cfg: {
  camera?: Partial<CameraConfig>;
  juice?: Partial<JuiceConfig>;
  sprite?: Partial<SpriteConfig>;
  post?: Partial<PostConfig>;
  anim?: Partial<AnimConfig>;
}): void {
  if (cfg.camera) Object.assign(engineConfig.camera, cfg.camera);
  if (cfg.juice) Object.assign(engineConfig.juice, cfg.juice);
  if (cfg.sprite) Object.assign(engineConfig.sprite, cfg.sprite);
  if (cfg.post) Object.assign(engineConfig.post, cfg.post);
  if (cfg.anim) Object.assign(engineConfig.anim, cfg.anim);
  for (const fn of derived) fn();
}
