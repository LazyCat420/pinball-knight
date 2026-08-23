/**
 * 🍺 THE TAVERN — the walkable between-floor hub.
 *
 * Public surface for the dungeon: hand it the run's stats and a way to descend,
 * and it takes the screen until the player pulls the plunger.
 *
 * Falls back to the original DOM tavern (`game/pinball-knight/tavern.ts`) when a
 * WebGL context can't be had, so a machine that can't run the scene still gets
 * a working shop rather than a dead screen.
 */
import { openTavernScene, closeTavern, isTavernSceneOpen } from "./core";
import { tavernScreen } from "../../game/pinball-knight/gui/screens/tavern";
import { push as pushUiScreen } from "../../game/pinball-knight/gui/stack";
import { installEngine } from "../../game/pinball-knight/GameEngine";
import type { TavernStats } from "./state";

export { closeTavern, isTavernSceneOpen };
export type { TavernStats };

export interface OpenTavernOptions {
  stats: TavernStats;
  /** Begin a descent. `floor` targets a specific depth (resume-after-death, or
   *  a JOIN from the who's-down-there board); omitted = the caller's default. */
  onDescend: (floor?: number) => void;
  /** Leave the run entirely — the walkable scene's game menu ABANDON. The DOM
   * fallback has no menu, so it simply never calls it. */
  onAbandon?: () => void;
  /**
   * LOBBY mode — this is the multiplayer entry hall, not a between-floors shop
   * stop. Only a lobby connects to the realtime server, shows other players +
   * the roster/countdown HUD, and turns the plunger gate into a READY toggle.
   * Between-floor taverns pass this falsy so they stay a quick, solo shop.
   */
  lobby?: boolean;
}

/**
 * Enter the tavern. Returns "scene" or "dom" so the caller can tell which path
 * it got (the DOM tavern owns its own teardown via closeTavern in that module).
 */
export function enterTavern(container: HTMLElement, opts: OpenTavernOptions): "scene" | "dom" {
  // The tavern borrows the dungeon's engine (camera, input, pixel pass, sprite
  // pipeline) and is reachable WITHOUT going through the dungeon first, so it
  // must install the engine config itself. installEngine is idempotent — it
  // overwrites the same config object — so doing it on both paths is safe.
  installEngine();
  if (openTavernScene(container, opts)) return "scene";
  // Fallback when the walkable scene cannot run: the flat tavern sheet. Same
  // economy either way — only the presentation differs.
  pushUiScreen(tavernScreen({ stats: opts.stats, onDescend: opts.onDescend }));
  return "dom";
}
