# WebGPU Migration Plan — braindeadbot-client

Status: **PHASE 0 MEASURED 2026-08-02 — the gate says STOP. Written 2026-07-24.**

The compute-particle port described below is **not worth doing for speed**. The
pools cost `0.02 ms` per frame with ~490 particles alive. See PHASE 0.

Also note this document predates the WebGPU port, which has since **shipped** —
the client runs `WebGPURenderer` everywhere and the fallback is
`WebGPURenderer({ forceWebGL: true })`, not `WebGLRenderer` (`src/render/backend.ts`).
So "Why you would do this" below is now about *compute shaders only*, not about
adopting WebGPU. Two of its facts are stale and corrected in place.

three@^0.185.1 already ships `three/webgpu` + TSL, so no dependency bump is needed.

---

## Why you would do this

The one unambiguous win: **GPU-driven particles.**

> **PATH AND FIGURE CORRECTED 2026-08-02.** `src/scenes/dungeon/render/vfx.ts`
> no longer exists; the code lives under `src/game/pinball-knight/fx/`. And it is
> four pools, not two: `additive` 500 + `alpha` 400 (`fx/system.ts`, via
> `fx/pools/particle-pool.ts`) plus `smokePool` 160 + `steamPool` 120
> (`fx/puffs.ts`) — 1180 slots. The "~14KB/frame" below undercounts by ~3×; the
> real worst case was ~40KB, now ~27KB (see the spawn-only fix, 2026-08-02).

The pools are simulated in a **CPU** `for` loop (`ParticlePool.update`), then
re-uploaded as dirty `InstancedBufferAttribute`s every frame. That is PCIe
traffic and O(n) JS on the main thread, competing with game logic.

A compute-shader pool removes the CPU from the loop entirely: 900 → 50,000+
particles for *less* main-thread cost than today.

Secondary upsides: compute shaders unlock work not currently possible at all;
lower per-draw-call overhead (relevant to the instanced maze walls); potentially
faster shader compile (see the 6s intro stall).

## Why you might not

- ~4000 lines of working, tuned GLSL rewritten in TSL.
- The dungeon renders at **1280x720 with `setPixelRatio(1)`**
  (pixel-pass.ts:374, `computeRenderSizing` at :308). It is not GPU-bound and
  not draw-call-bound. WebGPU does not make the same workload faster — it
  reduces submission overhead you are not currently paying.
- **Known lag sources are NOT fixed by this port**: the 6s synchronous shader
  LINK at intro, and unscoped jungle lights. Both are authoring problems.
- You will maintain **both** renderers indefinitely (browser fallback).
- **The QA harness breaks.** Playwright + SwiftShader is a *WebGL* software
  rasterizer. Headless WebGPU needs Dawn / Vulkan-SwiftShader. Screenshot QA for
  dungeon FX is dead until that is rebuilt.

**Do this for the particles and the compute capability. Do NOT do it expecting
the existing frame to get faster.**

---

## PHASE 0 — Profile first (DO NOT SKIP) — **DONE 2026-08-02**

Before touching anything, prove where the frame actually goes. If particles are
not a measurable cost, Phases 2-5 have no payoff and you should stop at Phase 1.

- [x] Measured on a **real GPU** — `nvidia / ampere` (RTX 3090 Ti) through the
      host's Chrome over CDP, the only way to reach a real adapter from WSL2:

          pnpm dev -p 5184
          node scripts/playtest.mjs --gpu --profile --secs 40 --seed 4242 \
            --url "http://localhost:5184/dungeon?no-intro=1"

      The profiler printed `GPU: nvidia / ampere` and zero `UNTRUSTED RUN`
      banners. A SwiftShader run would have been worthless — see
      `engine/gpu-adapter.ts`.

- [x] The numbers, `avg / p50 / p95`, over 2700 frames with **~490 particles
      alive at p50** (`# live particles`, peak 727):

          frame total:            5.5  / 5.0  / 9.9   ms
          vfx.pools:              0.02 / 0    / 0.1   ms   ← the four particle pools
          vfx.update (fx only):   0.03 / 0    / 0.1   ms   ← all twelve pools
          elements.tick:          0.00 / 0    / 0.0   ms
          pixelPass.render:       4.64 / 4.2  / 8.2   ms   ← 84% of the frame
          draw calls:             301  / 290  / 462
          GPU time:               392  / 393  / 459   µs

      `vfx.pools` read `0.02 ms` in all three branch runs — this is not a lucky
      sample.

**Decision gate: TRIPPED — STOP.** `ParticlePool.update` + upload is `0.02 ms`
against the ~1ms threshold (**50× under**), and draw calls are 290 at p50
against the 500 threshold. Per this document's own rule, the compute port buys
*capability* (more particles) and **not speed**. Nobody has asked for more
particles, so it is not scheduled.

**What the frame is actually spent on.** `pixelPass.render` is 84% of it — and
that bucket is CPU *submission* time, not GPU time: the GPU finishes the whole
six-pass chain in 392 µs. So the frame is bound by the cost of *telling* the GPU
what to do, not by any work measured here. Compute shaders would not touch it.
This agrees with `docs/lag-investigation.md`: *"The GPU is idle… Renderer
optimisation cannot help."* Any future effort belongs on submission cost —
draw-call count and three's NodeBuilder — not on the particles.

---

## PHASE 1 — Spike, throwaway (~half a day)

Prove the pixel-art look survives. This is the highest-risk unknown: the whole
game's identity is the palette-quantized pixel pass.

- [ ] Branch. Build a standalone page with `WebGPURenderer` rendering ONE quad
      through a TSL port of `FINAL_FRAG` (pixel-pass.ts) — quantize + dither +
      scanline only.
- [ ] Compare against a WebGL screenshot **pixel-for-pixel**. Palette
      quantization and ordered dither are exact-match operations; any float
      precision drift between backends shows up immediately as banding.

**Kill gate:** if the dither/quantize output does not match exactly and cannot
be made to, stop. The look is non-negotiable and the port is not worth losing
it.

---

## PHASE 2 — Renderer abstraction (no behaviour change, ship this)

Valuable on its own even if you never continue. Do it on main.

- [ ] Introduce a `Renderer` type alias + a `createRenderer()` factory. Today it
      returns `WebGLRenderer` and nothing changes.
- [ ] Replace the ~30 `THREE.WebGLRenderer` type annotations with the alias.
      Sites: `src/main.ts:74`, `src/scenes/dungeon/core.ts:348`,
      `src/room/room-controller.ts:22`, `src/scenes/tavern/core.ts:421`,
      `src/objects/*` (mouse-room, mahjong-crazy-3d, cosmic-pool,
      chinese-checkers-game, mouse-game/core, raccoon-tornado/core),
      `src/transitions/*`, `src/scenes/dungeon/render/pixel-pass.ts:363`.
- [ ] Replace 7 `WebGLRenderTarget` sites with the `RenderTarget` alias
      (pixel-pass.ts:387/408/409, raccoon-intro.ts:42,
      wormhole-transition.ts:207).
- [ ] Fix the raw-GL capability probe at
      `src/scenes/dungeon/render/atlas-loader.ts:35` — it calls
      `getContext("webgl2")` directly for max-texture-size detection. Route it
      through a backend-agnostic helper.
- [ ] Add a WebGPU branch to the renderer-construction fallback documented at
      `src/scenes/dungeon/tavern.ts:23`.

Ship it. Zero visual change, and the codebase stops hard-coding a backend.

---

## PHASE 3 — Port the shaders, easiest first (~2-4 days)

12 `ShaderMaterial` instances / ~28 shader bodies across 7 files. **Good news:
ZERO `onBeforeCompile`** — you never patch three's built-in chunks, which is the
migration case that turns into a nightmare. All custom shading is cleanly
isolated.

Order matters: build TSL fluency on the small ones before the big ones.

- [ ] `src/room/fireflies.ts` (113 lines) — smallest, one Points material.
- [ ] `src/room/ambient.ts` (134 lines)
- [ ] `src/shaders/terrain-shader.ts` (128 lines)
- [ ] `src/shaders/sky-shader.ts` (151 lines)
- [ ] `src/scenes/dungeon/render/pixel-pass.ts` (627 lines) — **the critical
      one.** 4 passes: bright / blur H / blur V / final, plus the `blit()` helper
      (:469). Depth-texture-driven outline + AO. Keep `uResolution` tracking the
      render target (see the warning at :449) — a stale value silently misaligns
      AO, outline taps and scanlines.
- [ ] `src/scenes/dungeon/render/vfx.ts` (1029 lines) — VFX is palette-native;
      preserve exact palette colours.
- [ ] `src/transitions/wormhole-transition.ts` (2054 lines) — biggest. Do last;
      it is a transition, so a temporary WebGL fallback here is acceptable.

Per file: port to TSL, screenshot-diff against the WebGL reference, commit
individually so any regression bisects cleanly.

---

## PHASE 4 — Async render loop

- [ ] `renderer.render()` → `renderAsync()` (or accept the implicit path).
      22 `renderer.render` call sites; the ripple is into every frame loop.
- [ ] Audit the 11 `setRenderTarget` calls — the manual blit chain in
      pixel-pass is the fiddly part.
- [ ] `renderer.compileAsync` (2 sites) — verify semantics carried over. This is
      also where you check whether the **6s intro shader-link stall** improved;
      measure, do not assume.

---

## PHASE 5 — THE PAYOFF: compute-shader particles

Everything above is setup. This is the part you actually wanted.

- [ ] Rewrite `ParticlePool` (vfx.ts:81-190) as a TSL compute pass. Position /
      velocity / life / size live in storage buffers; the CPU only *spawns*.
- [ ] Delete the per-frame `needsUpdate` uploads (vfx.ts:189-193).
- [ ] Raise pool sizes from 500/400 to 20,000+ and re-profile.
- [ ] Consider GPU particles for the other systems once proven: `intro-particles.ts`
      (already InstancedMesh), `pirate-controller.ts:1142`, `asteroids-game/space.ts`.

---

## PHASE 6 — Rebuild QA

- [ ] Headless WebGPU via Dawn or Vulkan-SwiftShader; the current
      Playwright + SwiftShader recipe will not work.
- [ ] Re-point the dungeon FX screenshot QA recipe (see HANDOFF) at it.
- [ ] Keep the WebGL path in CI as the visual reference for diffing.

---

## Rollback

Keep `?renderer=webgl` as a permanent query-flag escape hatch. Given browser
support gaps you are keeping the WebGL path anyway — make that explicit rather
than accidental.

---

## Found while measuring, NOT fixed — live MRT pipeline failures (2026-08-02)

Every real-GPU run above, on `main` as well as on the measuring branch, emits
13-15 of these:

    THREE.WebGPURenderer: Render pipeline creation failed
    (renderPipeline_MeshBasicMaterial_728): Color target has no corresponding
    fragment stage output but writeMask (ColorWriteMask::(Red|Green|Blue|Alpha))
    is not zero.
     - While validating targets[1] framebuffer output.

followed by `GPUValidationError: [Invalid RenderPipeline …] is invalid due to a
previous error` and an **invalid command buffer reaching `[Queue].Submit`**.
`playtest.mjs` exits non-zero on them, which is why `--gpu --profile` currently
cannot pass.

`targets[1]` is the `albedo` slot of the scene MRT (`pixel-pass.ts`, `mrt({
output, albedo: diffuseColor })`). These materials produce no albedo output
while the framebuffer still expects one — the exact hazard
`render/mrt-coverage.test.ts` was written to prevent, except that test scans
sources for `.fragmentNode =` and cannot see materials that reach the MRT pass
without one. The named materials are stock `MeshBasicMaterial` /
`MeshStandardMaterial` / `MeshBasicNodeMaterial`, so the source scan finds
nothing to flag.

**This is pre-existing and not caused by the fx work.** Verified by control: an
identical run against unmodified `main` on its own dev server produced 13 of
them, the branch 15 — same regime, and the branch touches no material or MRT
code. Not fixed here because it is a rendering-correctness bug in its own right,
not a perf item. Whoever picks it up: the guard test needs to move from scanning
sources to asserting on the *live* material set during a `withSceneContext`
compile, since that is where the shape is actually knowable.
