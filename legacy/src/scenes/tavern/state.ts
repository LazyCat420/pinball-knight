/**
 * Tavern-scene state. Deliberately small.
 *
 * Everything PERSISTENT — gold, weapons, gear, the card stash, the belt — stays
 * where it already lives (`game/pinball-knight/state.ts` and the gold wallet), and
 * the tavern reads it directly. This module owns only what dies when you
 * descend: where the player is standing, which station they're near, and which
 * panel is open.
 */
import type * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { Station } from "./layout";
import type { Facing } from "../../game/pinball-knight/engine/render/animator";
import type { ActorSprite } from "../../game/pinball-knight/engine/render/sprite";

/** Run stats handed in by the dungeon when it opens the tavern. */
export interface TavernStats {
  grade: string;
  floor: number;
  kills: number;
  bestCombo: number;
}

export interface TavernPlayer {
  x: number;
  z: number;
  facing: Facing;
  /** Current speed, for the walk-cycle rate. */
  speed: number;
  /** Animation clock. */
  animT: number;
  sprite: ActorSprite;
}

export interface TavernState {
  active: boolean;
  container: HTMLElement | null;

  renderer: WebGPURenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.OrthographicCamera | null;

  player: TavernPlayer | null;

  /** The station within reach, or null. Drives the prompt and the spotlight. */
  focus: Station | null;
  /** The station whose panel is open. While set, movement is frozen. */
  openStation: Station | null;

  /** Where the camera is currently looking (smoothed toward its target). */
  camX: number;
  camZ: number;

  /** Seconds since the scene opened — drives flicker, bob and the diorama. */
  time: number;

  stats: TavernStats;
  onDescend: ((floor?: number) => void) | null;
  /** Leave the run for good (the game menu's confirmed ABANDON). The tavern
   * closes itself first, then hands the exit to the dungeon via this. */
  onAbandon: (() => void) | null;

  /** Per-frame disposal list for everything this scene allocated. */
  disposers: Array<() => void>;
}

export const tavern: TavernState = {
  active: false,
  container: null,
  renderer: null,
  scene: null,
  camera: null,
  player: null,
  focus: null,
  openStation: null,
  camX: 0,
  camZ: 0,
  time: 0,
  stats: { grade: "-", floor: 0, kills: 0, bestCombo: 0 },
  onDescend: null,
  onAbandon: null,
  disposers: [],
};

/**
 * How the central diorama should read for a given run.
 *
 * The pinball table is the room's thesis — a machine that reports the floor you
 * just cleared. Animating it on a free-running timer made it decorative instead:
 * the caps chased and the ball lapped identically after a perfect floor and
 * after a death on the stairs, which is worse than a dead machine, because it
 * looks like information and isn't.
 *
 * `TavernStats` is everything the dungeon hands over when it opens the tavern,
 * so this is the whole of the run that is legitimately reachable from here. Kept
 * pure and in this module (rather than in `props.ts`) so it can be tested
 * without a canvas, and so nothing in the tavern reaches into dungeon state to
 * find more.
 */
export interface DioramaState {
  /** How many bumper caps are lit — completed targets. */
  lit: number;
  /** Ball orbit rate, rad/s. 0 parks it: a weak floor leaves the machine still. */
  ballSpeed: number;
}

/** Letter grades, best first. Anything unrecognised (including "-") ranks 0. */
const GRADE_RANK: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 };

export function gradeRank(grade: string): number {
  return GRADE_RANK[grade.toUpperCase()] ?? 0;
}

/**
 * Targets are ordered easiest-first, so the caps light left-to-right as a run
 * gets better and a glance at the table tells you roughly how it went.
 */
export function readDiorama(stats: TavernStats, bumperCount: number): DioramaState {
  const rank = gradeRank(stats.grade);
  const targets = [stats.floor >= 1, stats.kills >= 10, stats.bestCombo >= 5, stats.kills >= 40, rank >= 4];
  const lit = Math.min(bumperCount, targets.filter(Boolean).length);
  // B or better sends the ball round, and it goes faster the better you did.
  const ballSpeed = rank >= 3 ? 0.3 + (rank - 3) * 0.32 : 0;
  return { lit, ballSpeed };
}

/** Wipe scene-local state. Persistent run state is untouched by design. */
export function resetTavernState(): void {
  tavern.active = false;
  tavern.container = null;
  tavern.renderer = null;
  tavern.scene = null;
  tavern.camera = null;
  tavern.player = null;
  tavern.focus = null;
  tavern.openStation = null;
  tavern.camX = 0;
  tavern.camZ = 0;
  tavern.time = 0;
  tavern.onDescend = null;
  tavern.onAbandon = null;
  tavern.disposers = [];
}
