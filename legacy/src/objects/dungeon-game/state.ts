/**
 * Module state singleton — same pattern as mouse-game/state.ts.
 */
import type * as THREE from "three";
import type { PixelPass } from "./render/pixel-pass";
import type { ActorSprite } from "./render/sprite";
import type { Animator } from "./render/animator";
import { SPRITES_LIT_DEFAULT, QUANTIZE_DEFAULT, DITHER_DEFAULT, SCANLINE_DEFAULT } from "./constants";

export interface Actor {
  sprite: ActorSprite;
  anim: Animator;
  x: number;
  z: number;
}

export const state = {
  active: false,
  onExitCallback: null as (() => void) | null,

  // DOM
  container: null as HTMLDivElement | null,
  hudEl: null as HTMLDivElement | null,

  // Three
  renderer: null as THREE.WebGLRenderer | null,
  scene: null as THREE.Scene | null,
  camera: null as THREE.OrthographicCamera | null,
  pixelPass: null as PixelPass | null,

  // Actors
  player: null as Actor | null,
  zombies: [] as Actor[],

  // Torch flicker
  torchLights: [] as THREE.PointLight[],

  // Loop
  animFrameId: null as number | null,
  lastTime: 0,
  elapsed: 0,

  // Style toggles — all live-switchable from the sandbox HUD
  spritesLit: SPRITES_LIT_DEFAULT,
  quantize: QUANTIZE_DEFAULT,
  dither: DITHER_DEFAULT,
  scanline: SCANLINE_DEFAULT,

  // Listeners
  onKeyDown: null as ((e: KeyboardEvent) => void) | null,
  onResize: null as (() => void) | null,
};

export function resetState(): void {
  state.active = false;
  state.onExitCallback = null;
  state.container = null;
  state.hudEl = null;
  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.pixelPass = null;
  state.player = null;
  state.zombies = [];
  state.torchLights = [];
  state.animFrameId = null;
  state.lastTime = 0;
  state.elapsed = 0;
  state.onKeyDown = null;
  state.onResize = null;
}
