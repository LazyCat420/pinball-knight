/**
 * The three core-owned actions the extracted lifecycle modules call back into.
 *
 * ## Why this exists at all
 *
 * `run/` and `input/` are downstream of `core.ts` — core calls them, not the
 * other way round. But the run lifecycle genuinely does need to re-enter core:
 * dying leads to retrying (`startLevel`), descending leads to the loading screen
 * (`armFloorLoading`), and quitting leads to teardown (`exitDungeonGame`). Those
 * three, and only those three, cross back.
 *
 * Importing them would make a module cycle and `core-boundary.test.ts` would
 * reject it — correctly, because that cycle is exactly what the previous
 * decomposition spent eight commits avoiding. So they are pushed IN, matching
 * `setDebugActionDeps` and `DevHookDeps` next door.
 *
 * ⚠️ `armFloorLoading` stays in core deliberately. It writes the `floorLoad` and
 * `renderHeldForLoad` module flags that `startLevel` and `loop` both read; moving
 * it would drag the frame loop's own state into `run/` for one caller's benefit.
 *
 * The `setRunDeps` name is not decoration — `wiring.test.ts` treats any exported
 * `set*Deps` as an injection point and will fail if nothing ever calls it. An
 * unwired dep object here would otherwise fail SILENTLY, which is the failure
 * mode this whole pattern is prone to.
 */

export interface RunDeps {
  /** Build and enter a floor. */
  startLevel: (level: number) => void;
  /** Raise the descent screen, then run the continuation once it is up. */
  armFloorLoading: (level: number, then: () => void) => void;
  /** Full teardown back to whatever launched the game. */
  exitDungeonGame: () => void;
}

let deps: RunDeps | null = null;

/** Wire the lifecycle. Called once from `launchDungeonGame`. */
export function setRunDeps(d: RunDeps): void {
  deps = d;
}

/**
 * The wired deps.
 *
 * Throws rather than no-opping when unwired. A silent no-op here would look
 * like "the retry button does nothing" — a bug that reproduces once in a
 * hundred sessions and never in a test. If this throws, the boot order changed.
 */
export function runDeps(): RunDeps {
  if (!deps) throw new Error("run/deps: setRunDeps() was never called — the lifecycle is unwired");
  return deps;
}
