# Maze lag spikes — audit of 2026-09-10

**Question asked:** the maze hitches during play; did the last few commits
(the slime and fries 3D rigs, the armoured knight, the level-5 boss release)
cause it, and what fixes it?

**Answer:** the spikes are real and measured, but they predate those commits.
Every profile, before and after them, is dominated by the same thing: sprite
atlases being painted WHILE THE PLAYER PLAYS. The fix moves that painting
behind the descent screen. Everything below is measured, not inferred; the
probes live in the session scratchpad and are described at the end so the
numbers can be reproduced.

## Method

Host Chrome (Windows, RTX 3090 Ti, real WebGPU via `--enable-unsafe-webgpu`)
driven over raw CDP against `vite dev` from an audit worktree, 1920×1080, the
in-game bot (`__dungeonBot({mode:"mixed", seconds:30})`) on floor 1 after a
15 s warm-up, with the V8 sampling profiler at 250 µs and the page-side lag
probe (frame timeline, WebGPU call log, long tasks). Frames slower than
33 ms are "hitches"; samples inside them are attributed by call path. Three
runs per build, different seeds, because a single run's worst frame varies
by 3× (see the table).

## Before and after the recent commits

| build | hitches >33 ms / 30 s | p50 | p95 | worst |
| --- | --- | --- | --- | --- |
| 62e51866 (before the art commits), 3 runs | 97 · 120 · 141 | 10–13 ms | 30–39 ms | 79 · 204 · 95 ms |
| 5b32cd4b (HEAD, after them), 3 runs | 48 · 48 · 46 | 9–12 ms | 24–27 ms | 273 · 277 · 72 ms |

CONFIRMED: HEAD hitches about half as often as the build before the recent
commits, with a lower p95. The recent commits did not add the lag. The
armoured knight's per-frame 3D render and the character pixel pass are steady
costs (p50 within noise before and after), not spikes.

The 270 ms worst frames on HEAD (2 of 3 runs) are JS-idle frames that
coincide with a `ShadowMaterial` render-pipeline creation, i.e. a first draw
of a new shadow pipeline variant blocking on compile. The baseline shows the
same class of stall at 204 ms in one run. LIKELY the same mechanism the
warm-up already documents (boot/warmup.ts); not attributable to a commit and
not fixed here.

## What the hitches are

In every run, the heaviest call path inside hitch frames is

```
step › paintUntil › paintFrame › crushToGridShared › crushInto › getImageData
requestKnightSheet › step › paintUntil › paintFrame › … › getImageData
```

i.e. the monster-atlas backfill (`boot/sheets.ts startSheetBackfill`, idle
slices during play) and the knight re-dress (`applyWeaponArt`, 2 ms slices
inside the rAF loop). A trace of every `getImageData` during a 30 s run:

- 97 slow readbacks (>4 ms), 719 ms total, max 21 ms, all on the 168×168
  paint canvas, all from the backfill.
- Forcing four weapon pickups: 269 slow readbacks, 4.3 s total, max 156 ms,
  and frames of 172 / 113 / 99 / 75 ms on the first re-dress.
- Driving the game's own idle-callback backfill for ten atlases with the bot
  playing: 92 readbacks, 1015 ms, max 93 ms; ZERO atlases finished in 25 s.

The same readback in isolation costs 0.3 ms (the canvas is
`willReadFrequently`; the painters are plain fills and ellipses). Rebuilding
the same atlases through the same builder on the title screen: 0.3 ms per
readback, ~110 ms per atlas. So the cost is not the art or the crush; it is
paying a readback on the main thread while the dungeon is rendering. The
slice budget in `paintUntil` cannot prevent it: the budget is checked after
the frame that already blew it, and no budget fits a 95 ms readback into a
16 ms frame.

UNKNOWN: which browser-side mechanism makes a `willReadFrequently` canvas
readback 4–95 ms during play and 0.3 ms otherwise. It reproduced through the
game's own scheduling every time and through a hand-driven builder
inconsistently, so the fix does not depend on the answer.

## The fix

1. `buildFloorSheets(level)` (boot/sheets.ts) paints every atlas in
   `keysForFloor(level)` during the descent hold, under a "PAINTING THE
   HORDE" phase of the progress bar, in 12 ms slices with a presented frame
   between them. The in-play backfill is no longer started.
2. `warmKnightSheets()` runs at the end of `warmFloorPipelines`, once the
   floor is built, and paints the knight's atlas for both weapon slots, every
   weapon lying on the floor, and every look one piece of ground gear away,
   so a pickup is a cache hit. The knight sheet cache grew from 10 to 16 so
   the warmed sheets survive until they are used.
3. A crushed-cell cache in `paintFrame` (engine/render/sprite.ts): a
   FramePaint crushed once at a palette is a `drawImage` of its cached 84 px
   cell on every later build, no paint and no readback. Imported cells are
   stable functions for the session, so a gear-change re-dress (which repaints
   the whole atlas for a look that only changes the painter-drawn clips)
   rebuilds from the cache.
4. The paint box is an `OffscreenCanvas`. Measured: the same forced
   re-dresses cost 269 slow readbacks / 4.3 s / max 156 ms on a document
   canvas and 179 / 1.8 s / max 36 ms offscreen — better, not enough on its
   own, which is why 1–3 exist.

Cost: a longer descent bar, once per floor tier, roughly 0.1 s per atlas on
a quiet page (floor 1 ≈ 7 atlases, floor 3 adds ~15), plus the knight warm.

## After the fix

Forced re-dresses (two weapon gives and three gear changes in 30 s, the
`redress-trace` probe), same box, same seed:

| | frames >33 ms | worst frame | slow readbacks (>4 ms) |
| --- | --- | --- | --- |
| before | 53 | 172 ms | 269, 4321 ms total |
| after | 5 | 60 ms | 0 |

⚠ The after-measurements ran while another process (the bittle RL trainer)
held the GPU at ~40 %, which inflates every idle-wait number; the readback
counts are JS-timed and unaffected. The full-run profiles taken under that
load are in the scratchpad (`fix2-*.log`) and are reported in the commit
message; they are not comparable to the quiet-box table above.

## Steady costs seen but not changed

- The 1920×1080 UI canvas is re-uploaded every frame
  (`copyExternalImageToTexture 1920x1080`, ~1.7 s of CPU per 30 s run, ~6%
  of samples) because the HUD repaints every frame. A dirty-tracked HUD
  would remove it.
- The armoured knight renders its rig to a 72×80 target every frame
  (render/pixel-knight.ts). Steady, within noise here.

## Reproducing

`ThreeJS/scripts/lag/` (see its README): `lag-cdp.mjs` (raw-CDP port of
braindeadbot-client/scripts/lag-profile.mjs), `readback-trace.mjs`,
`redress-trace.mjs`, `backfill-probe.mjs`, `atlas-cost.mjs`,
`raster-vs-readback.mjs`, `build-variants.mjs`. Each needs Vite serving the
worktree and host Chrome with `--remote-debugging-port`.
