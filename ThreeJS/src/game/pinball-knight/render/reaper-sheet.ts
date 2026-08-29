/**
 * The reaper's atlas.
 *
 * This used to own a SECOND lazy-sheet cache of its own (`lazySheet(
 * makeReaperPaints)`), built and held outside `state.sheets` — so it survived
 * `resetState`, was invisible to `dispose.ts`, and made `reaper` the one
 * EnemyKind that `sheetKeyForKind` could not resolve. Every consumer carried a
 * `kind === "reaper" ?` special case to compensate.
 *
 * `reaper` is a SheetKey now, so this is a delegate kept only because a dozen
 * call sites read better as `reaperSheet()` than as `sheetFor("reaper")`. It
 * builds on first use exactly as before — `sheetFor` is itself lazy — and now
 * shares the one cache, the one teardown, and the one registry.
 */
import { sheetFor } from "../boot/sheets";
import type { SpriteSheet } from "../engine/render/sprite";

export function reaperSheet(): SpriteSheet {
  return sheetFor("reaper");
}
