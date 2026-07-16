/**
 * Module state singleton — same pattern as mouse-game/state.ts.
 */
import type * as THREE from "three";
import type { PixelPass } from "./render/pixel-pass";
import type { VfxSystem } from "./render/vfx";
import type { ActorSprite, SpriteSheet } from "./render/sprite";
import type { Animator, Facing } from "./render/animator";
import type { Grid, TilePos } from "./maze/generator";
import type { MazeHandle } from "./maze/build";
import type { InputHandle } from "./input";
import type { WeaponState, WeaponId, GearState, ProjectileKind } from "./items";
import { QUANTIZE_DEFAULT, DITHER_DEFAULT, SCANLINE_DEFAULT, OUTLINE_DEFAULT, PLAYER_MAX_HP, STAMINA_MAX } from "./constants";
import { freshWeapon } from "./items";

export interface Actor {
  sprite: ActorSprite;
  anim: Animator;
  x: number;
  z: number;
}

export interface Player extends Actor {
  hp: number;
  facing: Facing;
  /** -1 when not attacking, else seconds since the swing started. */
  attackT: number;
  /** True once this swing's active window has connected — one swing, one hit roll. */
  didHit: boolean;
  cooldown: number;
  iframes: number;
  flashT: number;
  /** Seconds left on the rage buff (2× damage). 0 = inactive. */
  rageT: number;
  /** Seconds left on the haste buff (faster move + swing). 0 = inactive. */
  hasteT: number;
  /** Seconds left on the shield buff (invulnerable). 0 = inactive. */
  shieldT: number;

  // ── Stamina (shared by sprint + dodge) ──
  /** Current stamina, 0..STAMINA_MAX. Sprinting drains it; dodge/heavy spend it. */
  stamina: number;
  /** Seconds until stamina regen resumes — set on every spend (Souls-style pause). */
  staminaRegenDelay: number;

  // ── Dodge-roll ──
  /** -1 when not rolling, else seconds into the current roll (incl. recovery). */
  rollT: number;
  /** WORLD direction locked in at the start of the roll (input is ignored mid-roll). */
  rollDirX: number;
  rollDirZ: number;

  // ── Sprint charge (the 3-second spool-up; gates the wall-ride) ──
  /**
   * 0..1 sprint charge. Fills over SPRINT_RAMP_TIME while holding Shift + moving,
   * bleeds back over SPRINT_DECAY_TIME when you stop. Lerps top speed from walk
   * (1×) toward SPRINT_SPEED_MULT; past SPRINT_RIDE_THRESHOLD the wall-ride unlocks.
   */
  sprintCharge: number;

  // ── Wall moves (Mortal-Kombat-style specials off a wall) ──
  /**
   * -1 when no launch move is airborne, else seconds into the current
   * wall-kick / pounce arc (a scripted committed-direction launch, like the roll
   * body but its own move so it can carry a strike and different i-frames).
   */
  wallMoveT: number;
  /** Total duration of the active launch (WALLKICK_DURATION or POUNCE_DURATION). */
  wallMoveDur: number;
  /** i-frame window (front of the launch) for the active wall move. */
  wallMoveIfr: number;
  /** Distance the active launch covers, eased fast→slow. */
  wallMoveDist: number;
  /** WORLD launch direction, locked at kick-off. */
  wallMoveDirX: number;
  wallMoveDirZ: number;
  /** "pounce" fires a radial AoE on landing; "kick" chains a lunging strike; null = none. */
  wallMoveKind: "kick" | "pounce" | null;

  // ── Melee combo/heavy state ──
  /** Which move the current/next swing is: 0 = light-1, 1 = light-2, 2 = finisher. */
  comboStep: number;
  /** Seconds left in the window to chain the next combo step; 0 = closed. */
  comboWindowT: number;
  /** Seconds a heavy has been charging (trigger held); -1 = not charging. */
  chargeT: number;
  /** Buffered attack request (seconds left to honour it); 0 = none. */
  attackBufferT: number;
  /** The MoveTiming the current swing is running; null when idle. */
  move: import("./constants").MoveTiming | null;

  /** Draws only where a wall covers the knight — you can never lose him. */
  silhouette: { mesh: THREE.Mesh; syncMap(): void; dispose(): void } | null;
}

export type ZombieMode = "idle" | "chase" | "windup" | "dead";

/**
 * Enemy family — same AI/combat pipeline; stats, art and behaviour flags differ
 * by kind:
 *  - zombie:  the baseline shambler (5 cosmetic variants).
 *  - spider:  fast, fragile, skittering.
 *  - brute:   big, slow, high-HP; a heavy bite with hard knockback.
 *  - spitter: hangs back and lobs an acid glob (ranged) instead of biting.
 */
export type EnemyKind = "zombie" | "spider" | "brute" | "spitter";

export interface Zombie extends Actor {
  /** Which enemy family — drives stats (speed/hp/damage) and which sheet. */
  kind: EnemyKind;
  hp: number;
  /** Full HP, for drawing a boss health bar (only set on the overlord). */
  maxHp?: number;
  /** True for the stairs-guarding mini-boss: health bar + reward on death. */
  boss?: boolean;
  mode: ZombieMode;
  speed: number;
  windupT: number;
  cooldown: number;
  flashT: number;
  /** Zombies never de-aggro — a horde that gives up isn't a horde. */
  aggro: boolean;
  /** Flame-puff immunity window — the cone burns in ticks, not per-puff. */
  burnT: number;
}

export interface GroundItem {
  kind: "weapon" | "gear" | "potion";
  id: string; // WeaponId | GearSlot | PotionId
  x: number;
  z: number;
  sprite: { mesh: THREE.Mesh; dispose(): void };
  bobPhase: number;
  /** Carried durability for weapons dropped in an exchange. Undefined = fresh. */
  durability?: number;
  /** Set on a just-dropped weapon: not grabbable until the player steps away. */
  blockedUntilAway?: boolean;
}

export interface Projectile {
  kind: ProjectileKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Seconds left before it just expires (range / speed). */
  life: number;
  maxLife: number;
  damage: number;
  /** True for enemy projectiles (the spitter's glob) — these hit the PLAYER, not zombies. */
  hostile?: boolean;
  mesh: THREE.Mesh;
  dispose(): void;
}

/** How many weapons the knight can carry. */
export const WEAPON_SLOTS = 2;

export const state = {
  active: false,
  onExitCallback: null as (() => void) | null,

  // DOM
  container: null as HTMLDivElement | null,
  hudEl: null as HTMLDivElement | null,
  gameOverEl: null as HTMLDivElement | null,
  /** The first-person rampage overlay (crosshair + gun + red vignette). */
  fpsOverlayEl: null as HTMLDivElement | null,
  /** The overlord boss health bar (top-centre, shown only when a boss lives). */
  bossBarEl: null as HTMLDivElement | null,
  /** Set by anything that changes a HUD number; core repaints once per frame at most. */
  hudDirty: true,

  // Three
  renderer: null as THREE.WebGLRenderer | null,
  scene: null as THREE.Scene | null,
  camera: null as THREE.OrthographicCamera | null,
  pixelPass: null as PixelPass | null,
  vfx: null as VfxSystem | null,

  // Run state
  level: 1,
  kills: 0,
  /** Gold earned THIS run — banked into the shared wallet as it's earned. */
  goldRun: 0,
  gameOver: false,
  /** Seed for the whole run; each level derives its own stream from it. */
  runSeed: 0,

  // Loadout — two weapon slots; an empty active slot fights as fists.
  weaponSlots: [freshWeapon("sword"), null] as Array<WeaponState | null>,
  activeSlot: 0,
  gear: {} as GearState,

  // The level
  grid: null as Grid | null,
  stairs: null as TilePos | null,
  maze: null as MazeHandle | null,
  groundItems: [] as GroundItem[],
  /** Non-interactive set dressing (bones, skulls, rubble). */
  props: [] as Array<{ sprite: { mesh: THREE.Mesh; dispose(): void } }>,

  // Actors
  player: null as Player | null,
  zombies: [] as Zombie[],
  projectiles: [] as Projectile[],
  /** One knight atlas per weapon, built lazily — a swap is a texture switch. */
  playerSheets: new Map<WeaponId, SpriteSheet>(),
  /** Which weapon's art the player sprite currently shows. */
  playerArtWeapon: null as WeaponId | null,
  zombieSheet: null as SpriteSheet | null,
  /** A small pool of cosmetic zombie-variant sheets; each spawn picks one by seed. */
  zombieVariantSheets: [] as SpriteSheet[],
  /** The giant-spider atlas — one look, built once per session. */
  spiderSheet: null as SpriteSheet | null,
  /** The brute (tank) atlas. */
  bruteSheet: null as SpriteSheet | null,
  /** The spitter (ranged) atlas. */
  spitterSheet: null as SpriteSheet | null,
  /** The overlord (mini-boss) atlas. */
  bossSheet: null as SpriteSheet | null,

  // AI
  flowField: null as Int32Array | null,
  flowTimer: 0,

  // Camera follow + screen shake
  camX: 0,
  camZ: 0,
  shakeT: 0,

  // ── RAMPAGE: the FPS "ultimate" ──
  // Charges from kills; when full the player can drop into a first-person
  // Doom/Wolfenstein view for a limited time and blast through the maze.
  /** 0..1 charge on the ultimate meter. */
  ultCharge: 0,
  /** True while the first-person rampage is active. */
  fpsActive: false,
  /** Seconds left in the current rampage. */
  fpsTimer: 0,
  /** Look yaw (radians) — where the FPS camera points on the ground plane. */
  fpsYaw: 0,
  /** Look pitch (radians), clamped — slight up/down freedom. */
  fpsPitch: 0,
  /** The perspective camera used only in rampage; built lazily. */
  fpsCamera: null as THREE.PerspectiveCamera | null,
  /** Shot cadence cooldown while in rampage. */
  fpsShotCd: 0,
  /** Muzzle-flash timer for the FPS gun overlay. */
  fpsFlashT: 0,
  /** Recoil: a transient upward pitch punch (radians) that decays each frame. */
  fpsKick: 0,
  /** Current kill-streak count during a rampage (resets if you go too long without a kill). */
  fpsStreak: 0,
  /** Seconds since the last rampage kill — the streak window. */
  fpsStreakT: 0,
  /** Hit-freeze: while > 0 the fixed-step sim is paused (VFX/render keep going). */
  hitstopT: 0,

  // Fixed-timestep accumulator
  accumulator: 0,

  // Loop
  animFrameId: null as number | null,
  lastTime: 0,
  elapsed: 0,

  // Style toggles (hidden debug keys Q/F/K/O)
  quantize: QUANTIZE_DEFAULT,
  dither: DITHER_DEFAULT,
  scanline: SCANLINE_DEFAULT,
  outline: OUTLINE_DEFAULT,

  // Listeners
  input: null as InputHandle | null,
  onKeyDown: null as ((e: KeyboardEvent) => void) | null,
  onResize: null as (() => void) | null,
};

/** What's in the active hand right now. An empty slot fights as fists. */
export function activeWeapon(): WeaponState {
  return state.weaponSlots[state.activeSlot] ?? { id: "fists", durability: Infinity };
}

export function freshPlayerFields(): Omit<Player, keyof Actor | "silhouette"> {
  return {
    hp: PLAYER_MAX_HP,
    facing: "S",
    attackT: -1,
    didHit: false,
    cooldown: 0,
    iframes: 0,
    flashT: 0,
    rageT: 0,
    hasteT: 0,
    shieldT: 0,
    stamina: STAMINA_MAX,
    staminaRegenDelay: 0,
    rollT: -1,
    rollDirX: 0,
    rollDirZ: 0,
    sprintCharge: 0,
    wallMoveT: -1,
    wallMoveDur: 0,
    wallMoveIfr: 0,
    wallMoveDist: 0,
    wallMoveDirX: 0,
    wallMoveDirZ: 0,
    wallMoveKind: null,
    comboStep: 0,
    comboWindowT: 0,
    chargeT: -1,
    attackBufferT: 0,
    move: null,
  };
}

export function resetState(): void {
  state.active = false;
  state.onExitCallback = null;
  state.container = null;
  state.hudEl = null;
  state.gameOverEl = null;
  state.fpsOverlayEl = null;
  state.bossBarEl = null;
  state.hudDirty = true;
  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.pixelPass = null;
  state.level = 1;
  state.kills = 0;
  state.goldRun = 0;
  state.gameOver = false;
  state.runSeed = 0;
  state.weaponSlots = [freshWeapon("sword"), null];
  state.activeSlot = 0;
  state.gear = {};
  state.grid = null;
  state.stairs = null;
  state.maze = null;
  state.groundItems = [];
  state.props = [];
  state.player = null;
  state.zombies = [];
  state.projectiles = [];
  state.playerSheets = new Map();
  state.playerArtWeapon = null;
  state.zombieSheet = null;
  state.zombieVariantSheets = [];
  state.spiderSheet = null;
  state.bruteSheet = null;
  state.spitterSheet = null;
  state.bossSheet = null;
  state.flowField = null;
  state.flowTimer = 0;
  state.camX = 0;
  state.camZ = 0;
  state.shakeT = 0;
  state.ultCharge = 0;
  state.fpsActive = false;
  state.fpsTimer = 0;
  state.fpsYaw = 0;
  state.fpsPitch = 0;
  state.fpsCamera = null;
  state.fpsShotCd = 0;
  state.fpsFlashT = 0;
  state.fpsKick = 0;
  state.fpsStreak = 0;
  state.fpsStreakT = 0;
  state.hitstopT = 0;
  state.vfx = null;
  state.accumulator = 0;
  state.animFrameId = null;
  state.lastTime = 0;
  state.elapsed = 0;
  state.input = null;
  state.onKeyDown = null;
  state.onResize = null;
}
