/**
 * 🍺 THE TAVERN — the walkable between-floor hub.
 *
 * Public surface for the dungeon: hand it the run's stats and a way to descend,
 * and it takes the screen until the player pulls the plunger.
 *
 * Falls back to the original DOM tavern (`scenes/dungeon/tavern.ts`) when a
 * WebGL context can't be had, so a machine that can't run the scene still gets
 * a working shop rather than a dead screen.
 */
import { openTavernScene, closeTavern, isTavernSceneOpen } from "./core";
import { openTavern as openDomTavern } from "../dungeon/tavern";
import type { TavernStats } from "./state";

export { closeTavern, isTavernSceneOpen };
export type { TavernStats };

export interface OpenTavernOptions {
  stats: TavernStats;
  onDescend: () => void;
  /** Leave the run entirely — the walkable scene's game menu ABANDON. The DOM
   * fallback has no menu, so it simply never calls it. */
  onAbandon?: () => void;
}

/**
 * Enter the tavern. Returns "scene" or "dom" so the caller can tell which path
 * it got (the DOM tavern owns its own teardown via closeTavern in that module).
 */
export function enterTavern(container: HTMLElement, opts: OpenTavernOptions): "scene" | "dom" {
  if (openTavernScene(container, opts)) return "scene";
  openDomTavern(container, { stats: opts.stats, onDescend: opts.onDescend });
  return "dom";
}
