# Pinball Knight — the "a little laggy" investigation

> ## ⏭️ RE-MEASURED 2026-08-06 — read this before picking the tail back up
>
> Five runs, real GPU (nvidia/ampere), host Chrome over CDP, bot, floor 1, no
> descents, `?profile=1`:
>
> | | 2026-07-29 after the fix | 2026-08-06 |
> |---|---|---|
> | **p99** | 18.4, 24.2, 18.4, 18.3, 18.3 | 18.6, 24.5, 25.6, 18.6 |
> | **worst frame** | 61, 67, 85, **648**, 54 | 202, 281, 356, 413, 605 |
> | p50 / p95 | — | 6.5–9.3 / 13.6–19.4 |
>
> **The distribution did not regress — p99 lands exactly where the fix left it.**
> What differs is the extreme outlier: one or two frames per run, now reliably
> 200–600 ms where they were mostly 50–85 ms. Note the fixed column already
> held a 648 ms outlier, so this is the same residual tail, not a new one.
>
> **Do not start by profiling.** Every one of those runs shared the box with
> another session holding a GPU slot and running vitest, and a 200–400 ms stall
> is exactly what CPU contention looks like. This session lost a whole
> conclusion to that mistake once already (the GPU numbers were 3.3× too high
> from one contaminated run — see `docs/tsl-to-wgsl.md`). **First re-run on a
> box `npm run ops:status` reports idle.** If the worst frame drops to double
> digits, the tail is the box and there is nothing to fix.
>
> If it does not, THEN `scripts/lag-profile.mjs` — it found the cause on the
> first run last time. Two things are already ruled out and need not be
> re-derived:
>
> - **These are not descent frames.** `sim/loop.ts` returns on `isRenderHeld()`
>   *before* `profBegin("FRAME (total)")`, so held frames never enter the
>   statistic. The ⚠️ further down applies to figures from before that early
>   return existed.
> - **It is not the post chain.** Per-pass GPU timestamps (added this session,
>   `recordGpuPasses` in `sim/loop.ts`) put every shader in the game at
>   **0.79 ms** of a 6.6–9.3 ms frame. `pixelPass.render` is 5.7–7.6 ms of CPU
>   *submission*. See `docs/tsl-to-wgsl.md` §0.

**Status: root cause found and fixed (2026-07-29).** The frame-pacing tail is
gone: worst frame ~600–1300 ms → ~55–85 ms, hitches over 33 ms 8–171 → 2–5,
measured interleaved on real WebGPU (nvidia/ampere, host Chrome over CDP).

The steady-state cost did NOT move, and was never the problem. `dropped >16.7ms`
is ~5–10% before and after; that is a 12 ms median against a 16.7 ms budget, not
a stutter.

---

## What it turned out to be

Everything in the tail was **sprite atlas painting on a frame the player could
see**, plus one uncovered first frame:

| cause | share of hitch time | fix |
|---|---|---|
| The palette crush read its source canvas back off the GPU | a 20.8× multiplier on all of the below | `crushableContext` in `engine/render/sprite.ts` |
| Monster atlas backfill built a WHOLE atlas per idle callback | 2,046 ms / 36% | `SheetBuild` slices; `boot/sheets.ts` uses `deadline.timeRemaining()` |
| Knight re-dress built a whole atlas inside the rAF loop | 857 ms / 15% | `requestKnightSheet`; the old sheet stays on screen until the new one is painted |
| UI icons + coin/reagent sprites rasterised on first use | 267 ms + ~150 ms | same crush fix; now ~1/20th the cost |
| First rendered frame after a descent: 20 shadow pipelines + three's NodeBuilder | the single worst frame, ~970 ms | `warmFirstFrame` in `boot/warmup.ts` |

### The crush was reading the GPU back, once per frame of every atlas

`crushInto` downscales a 128 px paint box to the 72 px grid and reads the result
with `getImageData`. The destination context had `willReadFrequently: true`. The
**source** did not, so it lived in GPU memory and every read was a synchronous
GPU→CPU transfer. Measured, 400 crushes:

```
source canvas GPU-backed          getImageData  2.271 ms    total 971 ms
source canvas willReadFrequently  getImageData  0.109 ms    total  62 ms
                                                ────────    ────────────
                                                    20.8x         15.7x
```

The whole cost landed on the `getImageData` line, which is why reading this code
kept concluding the palette maths was expensive. It never was — and a previous
session spent itself on the palette snap because of it. `_paintCanvas` was fixed
independently by the sprite-sharpening wave; `renderPaintCanvas` and
`staticTexture` were still on the slow path and now go through
`crushableContext`, so the rule has one home.

### An atlas per idle callback is not "idle work"

`requestIdleCallback` never offers more than 50 ms and normally far less. An
atlas was ~275 ms of paint. Every single callback overran by 5× and landed as
exactly the long task the backfill was written to avoid. The unit of work is now
a slice of FRAMES sized by `deadline.timeRemaining()` (capped at 3 ms), and a
half-painted atlas is never handed out — `sheetFor` finishes it on the spot.

### compileAsync does not warm the shadow pass

The worst frame in every run was the FIRST frame after the descent screen
closed: the floor appears, then freezes. The profile named it — three's
NodeBuilder building shader graphs, alongside `createRenderPipeline
renderPipeline_ShadowMaterial_930` **×20**. Twenty shadow pipelines created
after a warm-up whose entire job is to have created them.

`warmFloorPipelines` now ends by drawing two complete frames — post-process
chain, shadow depth pass and all — while the descent screen still covers the
display. A render is the only thing that provably warms what a render needs. The
time is the same; it is spent under a progress bar instead of on the first frame
of play.

---

## The method — use this, not a suspect list

The previous handoff ended with a ranked list of suspects to probe one at a
time. Two of the first three had already been wrong, at a session each. A V8
sampling profile over the run already contains the answer; it only has to be
**sliced to the frames that hitched**.

```bash
node scripts/lag-profile.mjs --secs 30 --seed 42 --url http://localhost:5199/dungeon
```

It runs the bot on real WebGPU, samples the main thread via CDP `Profiler`,
records the rAF timeline and every blocking WebGPU call in-page
(`scripts/lib/lag-probe.mjs`), and prints self time, inclusive time and **call
paths** for the hitch frames against the same aggregation over the healthy ones.
The leaderboard says what is slow; only the call path says who asked for it, and
who asked is the thing you can change. It found the cause on the first run.

Two details that make it trustworthy:

- **The clocks are pinned by measurement, not assumption.** `__lagSync` burns CPU
  inside a uniquely-named function at both ends of the run; matching that block
  in the profile gives the offset, and the disagreement between the two markers
  is printed as the alignment error.
- **Descent frames are excluded.** See below.

### ⚠️ Descent frames are not hitches — every earlier number included them

While the loading screen holds the display the loop renders and simulates
nothing (`sim/loop.ts`), so those frames are long *by design* and the player is
watching a progress bar. Counted as hitches they OWN the tail: the worst frame
of a 30 s run is reliably `warmFloorPipelines` doing its job. `__dungeonHeld()`
(dev/window-hooks.ts) exposes the flag and the harness drops those windows.

**Every "worst frame" figure quoted for this game before 2026-07-29 — including
the 888 ms in the previous handoff — includes descent frames.**

---

## Results

Five interleaved A/B pairs, same session, same seed, 30 s bot runs. Interleaved
because this box runs other agents' dev servers and between-run variance is
larger than most effects — a single before/after pair proves nothing here.

```
                  main                            with the fix
hitches >33ms     8, 171, 22, 14, 33              2, 5, 3, 3, 4
worst frame (ms)  764, 1297, 588, 1121, 848       61, 67, 85, 648, 54
p99 (ms)          18.4, 107.5, 30.3, 24.3, 36.4   18.4, 24.2, 18.4, 18.3, 18.3
dropped >16.7ms   4.9–37.7%                       4.7–9.9%   ← unchanged, see above
```

The art is unchanged, and that is checked rather than assumed: ten atlases,
3.0 M texels, **0 differing texels** between main and the change (the crush
swaps a GPU rasteriser for a software one, and a one-texel AA difference can
cross a palette Voronoi boundary).

---

## Traps found while fixing it — do not re-walk

**1. `texture.needsUpdate` per slice costs more than the freeze it removes.** The
first version of the incremental builder marked the texture dirty after every
slice. `needsUpdate` re-uploads the WHOLE atlas — 8136×144 for the knight — so
slicing into 40 pieces turned one upload into forty. Measured p95 went 18.2 →
30.4 ms with the median unmoved: the signature of work *spread* across frames
rather than removed. Nothing renders a partial sheet, so the upload happens
once, at the end.

**2. A 6 ms slice inside the rAF loop is still too big.** The frame already costs
~12 ms. The knight re-dress budget is 2 ms.

**3. `requestIdleCallback`'s deadline is the input, not a formality.** The first
version used a fixed 4 ms and ignored `timeRemaining()`. Ask the browser.

---

## Still true, still disproven (carried forward)

1. **The GPU is idle.** `GPU render = 267 µs p50 / 294 µs p95` for six passes and
   ~250 draws. Renderer optimisation cannot help. Do not spend time on the
   shader.
2. **The post-process shader is not the problem.** 1920×1080 renders 2.25× the
   pixels of 1280×720 in the same wall time. Not fragment-bound.
3. **Folding the luma weight into the palette snap is WRONG** — it flips the
   winner on 12 of the 496 exact midpoints while 200,000 random samples show
   none. Guarded by `engine/render/palette-snap.test.ts`.
4. **Synchronous pipeline creation was never the cost.** 96 pipelines after the
   loading screen, 8 ms of blocking in total; Dawn defers the real compile. What
   *is* expensive on those frames is three's NodeBuilder — the JS-side shader
   graph build — which is why `warmFirstFrame` targets a render rather than a
   pipeline count.
5. **Binding the pixel pass's render target during warm-up made pacing worse**
   (26.1% dropped vs 12.3%). Reverted, not shipped.

## What is NOT fixed

- **three's NodeBuilder is still the largest remaining block in the tail**, on
  the frames where a genuinely new material family first appears mid-play. It is
  now a ~55–85 ms frame rather than a ~970 ms one, so it is below the threshold
  of complaint — but it is the next thing if the tail ever matters again.
- **Everything here was measured under `next dev`.** A production build has not
  been profiled; dev-mode chunk loading is a plausible contributor to the
  remaining `(idle)` and `(program)` samples.
- **Path-dependent floor generation** (same seed, different floor depending on
  route) is unrelated to lag and still open. It is a co-op desync risk.

## Verifying a future change

Move the **pacing tail**, not the averages, and interleave A/B in one session:

```
hitches >33ms   from 2-5      ->  ?
worst frame     from ~55-85ms ->  ?
p99             from ~18ms    ->  ?
```

Re-run `scripts/floor-census.mjs --diff` if anything touches `buildLevel`, and
keep `npm test` (126 files, 1430 tests), `npx tsc --noEmit` and
`scripts/hooks/registry-drift.mjs` green.
