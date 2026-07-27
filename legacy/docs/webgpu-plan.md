# WebGPU Migration Plan — braindeadbot-client

Status: **NOT STARTED — evaluation only.** Written 2026-07-24.

three@^0.185.1 already ships `three/webgpu` + TSL, so no dependency bump is needed.

---

## Why you would do this

The one unambiguous win: **GPU-driven particles.**

`src/scenes/dungeon/render/vfx.ts` runs two pools — 500 additive + 400 alpha
(vfx.ts:858-859) — simulated in a **CPU** `for` loop (`ParticlePool.update`,
vfx.ts:163+), then re-uploaded as 4 dirty `BufferAttribute`s every frame
(vfx.ts:189-193). That is ~14KB/frame of PCIe traffic and O(n) JS on the main
thread, competing with game logic.

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

## PHASE 0 — Profile first (DO NOT SKIP)

Before touching anything, prove where the frame actually goes. If particles are
not a measurable cost, Phases 2-5 have no payoff and you should stop at Phase 1.

- [ ] Chrome DevTools Performance capture of a busy dungeon floor (combat + FX).
- [ ] Record: total frame ms, `ParticlePool.update` self-time, draw call count
      (`renderer.info.render.calls`), GPU time.
- [ ] Write the numbers down here:

      frame total:            ___ ms
      ParticlePool.update:    ___ ms
      draw calls:             ___
      GPU time:               ___ ms

**Decision gate:** if `ParticlePool.update` + upload is under ~1ms and draw
calls are under ~500, the port buys you *capability* (more particles) but not
*speed*. Decide consciously which one you want.

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
