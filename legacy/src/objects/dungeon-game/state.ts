/**
 * Module state singleton — same pattern as mouse-game/state.ts.
 */
import type * as THREE from "three";
import type { PixelPass } from "./render/pixel-pass";
import type { ActorSprite, SpriteSheet } from "./render/sprite";
import type { Animator, Facing } from "./render/animator";
import type { Grid, TilePos } from "./maze/generator";
import type { MazeHandle } from "./maze/build";
import type { InputHandle } from "./input";
import type { WeaponState, WeaponId, GearState, ProjectileKind } from "./items";
import { QUANTIZE_DEFAULT, DITHER_DEFAULT, SCANLINE_DEFAULT, OUTLINE_DEFAULT, PLAYER_MAX_HP } from "./constants";
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
  /** Draws only where a wall covers the knight — you can never lose him. */
  silhouette: { mesh: THREE.Mesh; syncMap(): void; dispose(): void } | null;
}

export type ZombieMode = "idle" | "chase" | "windup" | "dead";

export interface Zombie extends Actor {
  hp: number;
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
  kind: "weapon" | "gear";
  id: string; // WeaponId | GearSlot
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
  /** Set by anything that changes a HUD number; core repaints once per frame at most. */
  hudDirty: true,

  // Three
  renderer: null as THREE.WebGLRenderer | null,
  scene: null as THREE.Scene | null,
  camera: null as THREE.OrthographicCamera | null,
  pixelPass: null as PixelPass | null,

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

  // AI
  flowField: null as Int32Array | null,
  flowTimer: 0,

  // Camera follow + screen shake
  camX: 0,
  camZ: 0,
  shakeT: 0,

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
  };
}

export function resetState(): void {
  state.active = false;
  state.onExitCallback = null;
  state.container = null;
  state.hudEl = null;
  state.gameOverEl = null;
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
  state.flowField = null;
  state.flowTimer = 0;
  state.camX = 0;
  state.camZ = 0;
  state.shakeT = 0;
  state.accumulator = 0;
  state.animFrameId = null;
  state.lastTime = 0;
  state.elapsed = 0;
  state.input = null;
  state.onKeyDown = null;
  state.onResize = null;
}
