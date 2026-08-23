/**
 * FX — every transient visual effect in the dungeon, in one folder.
 *
 * Sibling to `sfx/`: one folder for everything you hear, one for everything you
 * see that is not an actor, a prop or the UI.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────────────
 *   system.ts     createVfx() — the composition root, and the public face
 *   color.ts      palette index → LINEAR rgb (the scene buffer is linear)
 *   puffs.ts      smoke + steam: alpha that ERODES rather than fades
 *   heat.ts       which things are hot, projected to screen for the shimmer
 *
 *   pools/        one file per effect family, plus `shared.ts` for what they
 *                 all need (PARTICLE_SCALE, rnd, the linear palette picks)
 *   elements/     TSL/WebGPU shader materials — fire, water, frost, goo, rod
 *   floor/        which FloorFxKind wears a shader, and its per-frame clock
 *
 * ── WHERE THE BOUNDARY WITH `entities/` IS ───────────────────────────────────
 * `entities/floor-fx.ts` owns the SIMULATION — burn damage, chill, skid, oil
 * ignition, the water quench — all of which `floor-fx.test.ts` asserts. `fx/`
 * owns only the LOOK. Nothing in here is asserted by a test in `entities/`, and
 * keeping it that way is what lets the art be retuned without touching gameplay.
 *
 * ── THE RULES THAT ARE NOT VISIBLE FROM THE CODE ─────────────────────────────
 *
 * 1. **Band to palette indices.** The pixel pass snaps every pixel to the nearest
 *    of 32 colours by a LUMA-WEIGHTED metric, so a smooth free-hex gradient lands
 *    wherever that metric points — a warm wash has measured 26.8% ROT GREEN here.
 *    `elements/noise.ts`'s `bandRamp` quantises each shader's own field AT palette
 *    entries, which makes the snap a no-op. Banding is the look, not a compromise.
 *
 * 2. **Banding is not enough for anything ADDITIVE.** What the pass snaps is
 *    `effect + scene`, and that sum is nobody's palette entry. Scale an additive
 *    effect's colour by its own intensity so its dim edge cannot tint what is
 *    behind it — fire rendered PINK before it did.
 *
 * 3. **Never clock a shader on TSL's `time`.** It is fed by `nodeFrame.update()`,
 *    which three calls only from its own internal rAF — and this game drives its
 *    own and never calls `setAnimationLoop`. A shader on `time` renders a
 *    perfectly STATIC image with zero errors, and a screenshot passes it. Use an
 *    explicit uniform poked from `sim/loop.ts` on REAL frame time (so effects keep
 *    moving through a hit-freeze), and prove motion with `scripts/fx-motion.mjs`.
 *
 * 4. **Every new material family must join `boot/warmup.ts`.** The frame is
 *    pipeline-count-bound, so an unwarmed material compiles cold mid-combat.
 *
 * 5. **Judge an effect over MORE THAN ONE backdrop.** Both of the worst bugs in
 *    this folder's history — pink fire and invisible smoke — were the effect
 *    colliding with what happened to be behind it on one floor.
 *
 * ── THE TOOLING, WHICH IS NOT OPTIONAL ───────────────────────────────────────
 *   __fx()                  the effects lab (`__lab` is monster-only)
 *   scripts/fx-motion.mjs   proves a shader is not frozen, with a frozen control
 *   scripts/fx-shot.mjs     full-frame contact sheet at real resolution
 *   scripts/heat-ab.mjs     the shimmer A/B, since it has nothing of its own to see
 *   scripts/fx-probe.mjs    ask the page a question instead of guessing
 */
export { createVfx } from "./system";
export type { VfxSystem } from "./system";
export { TrailRibbon, LaserMarkField, TRAIL_CAPACITY, TRAIL_PUSH_RATE } from "./system";
export type { SlashOpts, RingOpts, TrailStyle, TrailStyleName } from "./system";

export { makeSmokePool, makeSteamPool, PuffPool, SMOKE, STEAM } from "./puffs";
export { pushHeatField, droppedHeatSources, HEAT_SPOTS } from "./heat";
export { linColor, palLin, toLinear } from "./color";
