/**
 * The reaper's atlas, built on FIRST USE and cached for the session.
 *
 * Lives on the game side rather than in `engine/render/sprite.ts`, where it
 * used to sit: the reaper is a specific monster in a specific game, and an
 * engine that knows about it is not an engine. The lazy-build mechanism is
 * generic and stayed behind as `lazySheet`.
 *
 * Every other actor's sheet is built up-front in core.ts's init, but the reaper
 * appears at most once per floor and only after REAPER_AFTER seconds — most
 * runs never see one. Building it lazily keeps the level boot cost unchanged
 * and means adding bespoke reaper art needs one line changed at the call site
 * instead of a new field threaded through state/init/dispose.
 */
import { lazySheet } from "../engine/render/sprite";
import { makeReaperPaints } from "./cel-painter";

export const reaperSheet = lazySheet(makeReaperPaints);
