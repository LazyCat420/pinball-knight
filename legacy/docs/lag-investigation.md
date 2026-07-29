# Pinball Knight — the "a little laggy" investigation

**Status: diagnosed at the symptom level, root cause NOT yet found.** Written
2026-07-28 as a handoff. Everything below was measured on real WebGPU
(nvidia/ampere, host Chrome over CDP), not inferred.

Read the "already disproven" section before forming a theory. Three plausible
causes have already been tested and killed, and two of them cost a session each.

---

## The symptom, quantified

Frame *pacing* over a 45s bot run (`mode: mixed`, seed 42). Pacing, not
averages — the mean looks healthy while the game stutters:

```
p50  7.9ms      p95 24.6ms      p99 35.5ms
12.3% of frames miss 60Hz   ·   45 hitches >33ms   ·   11 >100ms
worst frames: 888ms, 633ms, 593ms, 557ms, 487ms
```

A 7.9ms median with 12% dropped frames is exactly what "a little laggy" feels
like. **The tail is the bug. Do not optimise the mean.**

---

## Instruments that now exist (all shipped)

| what | where | notes |
|---|---|---|
| **GPU time** | `# GPU render (µs)` in the playtest profile | WebGPU timestamp queries. Armed by `?profile=1` / `?playtest=1`. **This is the only GPU-truthful number in the codebase.** |
| **Per-frame draw calls** | `# draw calls`, `# triangles`, `# render passes` | Were reading a CUMULATIVE counter until 2026-07-28; any pre-existing figure quoted anywhere is wrong by ~12x. |
| **Renderer counters** | `__dungeonRenderInfo()` | `{programs, textures, geometries, drawCalls}`, so a harness can catch a compile on the exact frame. |
| **Scene size** | `sceneObjects` / `sceneMeshes` in `__dungeonCensus()` | Build-time snapshot — it does NOT track live adds/removes. Don't use it for before/after within one floor. |
| **Floor determinism** | `scripts/floor-census.mjs` | Unrelated to lag, but it is the gate for any change touching `buildLevel`. |

Run the standard profile with:

```bash
npm run playtest:gpu -- --secs 25 --seed 42 --url http://localhost:<port>/dungeon
```

⚠️ `scripts/playtest.mjs` pins a **1280×720** viewport, so every stock timing
describes a 720p window. A hook (`sun/.claude/hooks/guard_webgpu.py`) blocks any
agent harness run that would land on WebGL/SwiftShader.

---

## What is TRUE (measured)

1. **The GPU is idle.** `GPU render = 267µs p50 / 294µs p95`. Six passes, ~250
   draw calls, the whole post-process chain: 0.27ms of a 16.7ms budget.
   **Renderer optimisation cannot help.** Do not spend time on the shader.

2. **The cost is CPU-side.** `pixelPass.render` ~4.7ms and `FRAME (total)`
   ~5.6ms both bracket CPU *submission* and return before the GPU finishes.

3. **The scene is object-heavy**: 1378 scene objects / 1186 meshes on floor 5,
   to issue ~250 draws. three walks all of them per frame to cull and sort.
   Plausible contributor to the steady-state CPU cost; NOT the source of the
   hitches.

4. **Shader programs climb 2 → 129** over a run, with big rises clustered around
   3-8s and a trickle afterwards. This *correlates* with the hitches — but see
   disproven #3.

---

## ALREADY DISPROVEN — do not re-litigate

**1. "The post-process shader is too heavy."**
Killed by the GPU timestamp: 0.27ms. Also tested directly — 1920×1080 renders
2.25× the pixels of 1280×720 and measured the *same* wall time (4.4ms vs 4.7ms
p50). It is not fragment-bound. Capping `MAX_RENDER_W/H` buys nothing, and would
cost field of view: PPU is pinned at 64 so render width IS the FOV (see the long
note in `constants/render.ts`).

**2. "Fold the luma weight into the palette snap to save 96 multiplies/pixel."**
Arithmetically tempting, and WRONG: it flips the winner on 12 of the 496 exact
midpoints between palette pairs, while 200,000 random samples show zero
disagreements. Guarded by `engine/render/palette-snap.test.ts`. Moot anyway
given #1.

**3. ⚠️ "The hitches are synchronous pipeline creation."**
This was my leading theory and it is FALSE. Intercepting
`GPUDevice.prototype.createRenderPipeline` from the page shows **96 pipelines
created after the loading screen closes, costing 8ms of blocking IN TOTAL.**
Dawn defers the real compile, so the call returns fast. `info.memory.programs`
rising is therefore a *correlate*, not the cause — it marks the moment new
material families first appear, and something else on that same frame is what
actually costs 600ms.

**4. "Bind the pixel pass's render target during warm-up so pipelines get the
right attachment formats."** Tested: total programs fell 129 → 101 (so it does
affect pipeline keys) but frame pacing got **worse** — 26.1% dropped vs 12.3%,
p95 35.5ms vs 24.6ms. Reverted, not shipped.

**Partially true and already shipped:** `compileAsync` frustum-tests every mesh,
so the warm-up only compiled what was on camera at the spawn point. Culling is
now disabled for the warm-up walk (`boot/warmup.ts`). This removed the *trickle*
— last mid-play compile moved 31.7s → 9.2s — but did NOT touch the big early
burst.

---

## The open question

**What actually costs 600ms on the frames where new material families first
appear, given that pipeline creation is only 8ms of it?**

Ranked suspects, cheapest to test first:

1. **Texture upload / atlas construction.** `gpu textures` runs ~100-160 and
   `render/sprite.ts` clones a texture PER ACTOR (its own comment calls this
   "the ONE genuinely per-actor allocation… why the horde cannot simply become a
   single InstancedMesh"). `boot/sheets.ts` builds atlases lazily and backfills
   on idle, so a sheet can be painted — canvas `fillText`, per-actor canvas —
   and uploaded mid-play. **Test:** wrap `GPUQueue.prototype.writeTexture` and
   `copyExternalImageToTexture` the same way the pipeline probe wrapped
   `createRenderPipeline`, and attribute time per call.
2. **First *use* of a pipeline** (as opposed to its creation). Dawn may finish
   compilation lazily at first draw. **Test:** compare the frame a pipeline is
   created against the frame it is first drawn.
3. **GC.** Heavy per-frame allocation: `entities/floor-fx.ts` does
   `new THREE.Mesh(discGeo(), matFor(kind).clone())` per stamp (~50/s while
   grooving), plus per-coin/per-projectile scene adds. **Test:**
   `performance.measureUserAgentSpecificMemory()` or a long-run allocation
   profile in devtools.

### The probe that found #3, reuse it

```js
await page.addInitScript(() => {
  const w = window; w.__pipes = { sync: [], async: 0, t0: performance.now() };
  const hook = () => {
    if (!window.GPUDevice) return false;
    const proto = window.GPUDevice.prototype;
    const orig = proto.createRenderPipeline;
    proto.createRenderPipeline = function (desc) {
      const a = performance.now();
      const r = orig.call(this, desc);
      w.__pipes.sync.push({ label: desc?.label, ms: performance.now() - a });
      return r;
    };
    return true;
  };
  if (!hook()) { const i = setInterval(() => hook() && clearInterval(i), 5); }
});
```

Point it at `writeTexture` / `copyExternalImageToTexture` next. three labels its
descriptors, so the labels name the culprit directly.

---

## Verification for any fix

A fix must move the **pacing** numbers, not the averages:

```
dropped >16.7ms   from 12.3%   ->  ?
hitches >33ms     from 45      ->  ?
worst frame       from ~888ms  ->  ?
```

Measure by sampling rAF deltas over a 45s bot run, interleaved A/B against the
baseline **in the same session** — this box runs other agents' dev servers and
the between-run variance is large (`pixelPass` alone ranged 3.6-8.5ms on
unchanged code). A single before/after pair proves nothing here.

Also re-run `scripts/floor-census.mjs --diff` if anything touches `buildLevel`,
and keep `npm test` (161 files) and `npx tsc --noEmit` green.
