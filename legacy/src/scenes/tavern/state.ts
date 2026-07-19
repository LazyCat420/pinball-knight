/**
 * Tavern-scene state. Deliberately small.
 *
 * Everything PERSISTENT — gold, weapons, gear, the card stash, the belt — stays
 * where it already lives (`scenes/dungeon/state.ts` and the gold wallet), and
 * the tavern reads it directly. This module owns only what dies when you
 * descend: where the player is standing, which station they're near, and which
 * panel is open.
 */
import type * as THREE from "three";
import type { Station } from "./layout";
import type { Facing } from "../dungeon/render/animator";
import type { ActorSprite } from "../dungeon/render/sprite";

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

  renderer: THREE.WebGLRenderer | null;
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
  onDescend: (() => void) | null;

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
  disposers: [],
};

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
  tavern.disposers = [];
}
