# What is left after the WebGPU migration — braindeadbot-client

Status: **2026-08-07. Phase A, B0, B1 and B2 shipped. B3/B4, C and D open.**

Camera draws on the reference floor are **227 → 164** and the booster row is
**66 → 3**. What that buys in frame time is measured but NOT settled — see B2.

`docs/webgpu-plan.md` is the **pre-migration** plan and is now history — its
Phases 1–4 describe adopting WebGPU, which happened. Read it only for its
PHASE 0 measurement and its MRT postscript. This file is the forward one.

The migration is **done**, and that is the first thing to get straight, because
the next plan is not "replace Three.js with WebGPU". It is:

> Finish the WebGPU-only audit, keep Three.js as the scene/resource layer, and
> spend rendering effort on **draw-call count**, which is the one number the
> measurements actually indict.

---

## 0. What is already true (do not re-do these)

| | evidence |
|---|---|
| `WebGPURenderer` is the only backend | `src/render/backend.ts` — `createGPURenderer` nulls three's private `_getFallback` so `init()` *rejects* instead of silently resolving on WebGL2 |
| No runnable GLSL path | the glass twins were deleted with the WebGL2 backend; `glass.test.ts` fails if a `glslFn` comes back |
| 21 hand-authored WGSL functions live in `.wgsl` files | `src/shaders/wgsl/`, `src/shaders/glass/wgsl/`, `src/room/wgsl/`; one function per file, loaded by `scripts/wgsl-loader.cjs`, shape asserted by `src/shaders/wgsl-contract.test.ts` |
| Per-pass GPU timing | `recordGpuPasses` in `sim/loop.ts` |
| Draw attribution | `__dungeonDraws()` / `dev/draw-census.ts` / `scripts/draw-census.mjs` |
| Torches instanced | 248 → 227 camera draws |

**The frame, measured (nvidia/ampere, 1080p):** the whole six-pass GPU chain is
**0.79 ms** against a 6.6–9.3 ms frame. GPU work is ~10% of the frame. Whatever
is next, it is **not** a shader-throughput problem — see `docs/tsl-to-wgsl.md`.

---

## 1. Four corrections to the incoming proposal

The plan this file grew out of was right in shape and wrong in four checkable
details. Each was verified against the tree at f339a87.

**1. `tsc` cannot verify the type audit.** The baseline is **6131 errors**
(`npx tsc --noEmit | wc -l`, 9s), and the files the audit touches are among the
worst — `wormhole-transition.ts` alone carries 213. `next.config.js` sets
`ignoreBuildErrors`, so nothing gates on it. A renderer-type change is therefore
**unverifiable by the compiler** and must be enforced by a source-scan test, the
way `wgsl-contract.test.ts`, `mrt-coverage.test.ts` and `glass.test.ts` already
are. Phase A does that.

**2. The app *does* construct a `WebGLRenderer`.** The proposal said the
remaining hits "appear to be stale contracts rather than evidence that the app
constructs a legacy renderer". `app/admin/bird-viewer/page.tsx:26` is
`new THREE.WebGLRenderer({ canvas, antialias: true })` — a live one. It is a
dev-only turntable and `/admin` is redirected away in production, so it is not a
user-facing bug; it is the one file that makes the invariant ungreppable, and it
was the one file the proposal's list omitted.

**3. The annotations are not cosmetic — one is a field that holds the wrong
class at runtime.** `src/room/room-controller.ts:22` declares
`public renderer: THREE.WebGLRenderer`. The value it holds is built at
`src/main.ts:128` by `createGPURenderer()` and passed through
`initRoomManager` (`main.ts:296` → `room-manager.ts:56`). The constructor takes
an untyped `ctx`, which is exactly why nothing ever errored. So the type is a
standing licence to call a WebGL-only method and have it type-check —
`dispose.ts:120` already records that hazard for `forceContextLoss`. The other
sites are genuinely JSDoc-only, and the APIs actually called through them
(`render`, `clear`, `autoClear`, `setRenderTarget`, `setSize`, `compileAsync`,
`toneMapping`) all exist on `WebGPURenderer` — so this is a latent trap, not a
live break.

**4. The instancing unit is finer than "one material per part family".** The
proposal's "shader-driven animation plus instancing" is the right destination
but skips the cheap half. Read `PART_ANIMATORS` in `render/pinball-parts.ts`:
for `booster`, `ramp`, `boostcorner`, `boostcurve` the *entire* per-frame
mutation is `emissiveIntensity` on a handful of `stdOwn` materials. Nothing
moves. The chevrons of every booster on a floor are the **same cone geometry at
the same local offsets**, differing only by their part's world transform. So one
`InstancedMesh` per (kind, slot) with a per-instance emissive scalar collects
almost the whole draw-call win **while the JS animator keeps running unchanged**
— it writes a float into an attribute instead of into a material. Moving the
sine into the shader is a second, separable increment that buys CPU, not draws.

---

## 2. Phase A — one renderer type, and a test that keeps it ✅ SHIPPED

Cheap, self-contained, no behaviour change. Its value is that it makes
"WebGPU only" a **greppable invariant** instead of a claim in a docblock.

- [x] `src/render/renderer-types.ts` — a `GpuRenderer` type exported from the
      one module that is already allowed to import `three/webgpu`.
- [x] Replace the 12 `THREE.WebGLRenderer` annotations (7 files) with it.
- [x] Convert `app/admin/bird-viewer/page.tsx` to `createGPURenderer`.
- [x] `src/render/backend-invariant.test.ts` — scans `src/`, `app/`,
      `components/` for `WebGLRenderer` / `WebGL1Renderer` / `forceWebGL`
      outside an explicit reasoned allowlist, separately forbids *constructing*
      one, checks the allowlist has no dead entries, and self-tests that the
      scan reports a planted hit (a scan that cannot fail is not a check).
      **It caught three live hits on its first run** — the bird-viewer, a
      `forceWebGL` comment in `main.ts`, and its own planted fixture.

**Consequence, deliberately accepted:** `/admin/bird-viewer` now needs a secure
context, because WebGPU does. A dev opening it over `http://` to a bare LAN IP
loses a viewer that used to work there. It says so on the page rather than
showing a black canvas — the same trade `backend.ts` already made for the game.

**Deliberately NOT in Phase A:** the `GpuRenderer` type stays a **type alias for
`WebGPURenderer`**, not a hand-written structural interface. An interface
narrowed to "methods the app uses" is a second copy of the renderer's API that
drifts silently, and the compiler is not checking it anyway (correction 1).

**Follow-up, not done:** 9 `THREE.WebGLRenderTarget` sites, one of them
`pixel-pass.ts`. Despite the name it is a live, correct class under
`WebGPURenderer` — three also exports the base `RenderTarget`, which
`WebGLRenderTarget` extends — so this is a rename for readability, not a fix,
and the invariant test deliberately does **not** ban it. Banning it would make a
red test out of working code.

---

## 3. Phase B — instanced pinball parts (the actual project)

**The claim to beat:** parts are **130 of 248** camera draws; boosters alone
**66**. `mergeStaticGroup` moves 130 → 124 (2.4%) because a mesh that animates
cannot be merged — and the animation is exactly why parts cost 130 draws.
**Do not re-attempt the merge.** See HANDOFF, measurement 2.

### B0 — Census first, and per-kind ✅ **DONE 2026-08-07 — and it reorders B3**

This repo has already shipped one plan built on an estimated draw count and been
wrong by 5× ("instance the torches, ~100 draws" — it was ~22). It has now been
wrong a second way: a **static** count of `new THREE.Mesh(` in `pinball-parts.ts`
reports a booster as 3 meshes. It is 6. The strips and chevrons are built in
`for` loops, so even the object count cannot be read off the source.

Measured on `main` @ f339a87, real adapter (nvidia/ampere through host Chrome),
1920×1080, 14 s of bot play per run:

    scripts/ops/pk-run.sh --class webgpu -- node scripts/draw-census.mjs \
      --secs 14 --seed <42|777|1337>

**draws / culled, per kind, three floors:**

| kind | seed 42 | seed 777 | seed 1337 | verdict |
|---|---|---|---|---|
| **booster** | **66** / 0 | **30** / 48 | **36** / 66 | **#1 on every floor, by 2–3×. Instance it.** |
| spinpad | 20 / 15 | 5 / 25 | 0 / 5 | second on one floor only |
| bumper | 18 / **75** | 9 / **84** | 6 / **69** | **DO NOT instance — see below** |
| rollover | 12 / 12 | 0 / 24 | 4 / 20 | marginal |
| electric | 10 / 0 | – | – | clean but small |
| deflector | 0 / 18 | 12 / 3 | 3 / 12 | floor-dependent |
| jumppad | 0 / 24 | 8 / 16 | 8 / 16 | floor-dependent |
| target | 4 / 28 | 4 / 28 | 0 / 32 | ~all culled |
| ramp | 0 / 7 | 0 / 7 | 7 / 0 | ~nothing |
| boostcurve / boostcorner / pit / trapdoor / firevent | ≤2 | ≤2 | ≤2 | nothing |
| **all parts** | **130** of 227 | **71** of 165 | **64** of 159 | |

Seed 42 reproduces HANDOFF's independent "130 of 248" exactly (227 now, after
torch instancing), which is the cross-check that says the tool is measuring the
same thing it measured last week.

**Three findings, two of which contradict the plan they were written for:**

1. **Booster is the whole project.** #1 on all three floors at 2–3× the runner-up,
   and on seed 42 it is **66 draws with ZERO culled** — every booster in the
   scene is visible. Instancing it is unambiguous.
2. **Do not instance bumpers.** 6–18 drawn against **69–84 culled**. Instancing
   collapses ~12 draws and submits ~85 instances that the frustum currently
   throws away for free. This is the losing case B0 was written to catch, and it
   was second on the B3 list before the census ran. **Struck.**
3. **`ramp` / `boostcorner` / `boostcurve` cost nothing** — 0–7 draws across
   three floors. They were on B3 as "identical shape, follows mechanically".
   Mechanical is not a reason. **Struck.** They come along only if the booster
   substrate makes them free.

**The `renderer says 0` line — hypothesis now CONFIRMED, and it has a fix.**
The census prints `renderer says 0` on every run: `__dungeonRenderInfo()`
returns populated `memory` counters and `render.drawCalls: 0`. B2 settled why.
The *playtest* profiler reads the same counter and gets **349 / 389** — a number
that matches this census's own camera+shadow total exactly, on both arms of the
A/B. So the counter works; **what breaks it is reading it from an out-of-frame
`page.evaluate()`**, after three's per-frame `info.reset()` and before the next
frame's draws. The attribution was never affected (`dev/draw-census.ts`
reimplements the cull and never reads `renderer.info`).

- [ ] Fix: have `draw-census.mjs` read the value the profiler already samples
      inside the frame loop, instead of calling `__dungeonRenderInfo()` cold.
      `window-hooks.ts:844`, `scripts/draw-census.mjs:46`.

### B1 — The instancing substrate ✅ SHIPPED
### B2 — The booster ✅ SHIPPED — **66 → 3 draws**

`render/part-instancer.ts` + `render/part-instancer.test.ts`. One
`InstancedMesh` per (kind, slot); `INSTANCED_KINDS` holds `booster` and nothing
else, because the allowlist is the census's output and not a shape test.

**Measured, three floors, real adapter, 1080p — and the accounting is exact:**

| seed | camera draws before | after | Δ | booster |
|---|---|---|---|---|
| 42 | 227 | **164** | −63 (−28%) | 66 → 3 |
| 777 | 165 | **138** | −27 (−16%) | 30 → 3 |
| 1337 | 159 | **126** | −33 (−21%) | 36 → 3 |

Every floor's total falls by exactly what the booster row lost — no other row
moved. `npm run playtest:gpu`: **PASSED, 0 render errors, canvas painting 101
distinct colours**, which is the check that the node material writes its albedo
(see the `fragmentNode` warning below — it is the failure this gate exists for).

**Frame time: suggestive, NOT established.** Three interleaved A/B pairs on a
box another session was using, seed 42, 25 s each:

| pair | baseline p50 | instanced p50 | Δ |
|---|---|---|---|
| 1 | 5.6 ms | 4.8 ms | −0.8 |
| 2 | 6.3 ms | 5.5 ms | −0.8 |
| 3 | 6.2 ms | 6.2 ms | 0.0 |

Two pairs agree at −0.8 ms (~13%); the third is null and its instanced arm's p95
nearly doubled (8.1 → 12.7 ms), which is what a contaminated run looks like, not
a regression. **Do not quote 13%.** The absolute wall-clock fps swung 38 → 97
across rounds, which is why only the paired differences are readable at all.
Settle it on an idle box: `npm run ops:status` clear, then the same interleave.

### Four things B2 learned that the next slot family will hit

1. **The layout must be READ, not restated.** The instancer builds one part with
   the ordinary builder and takes the child transforms off it, so `buildBooster`
   stays the single source of where a chevron sits. Hard-coding `-0.26 + k*0.26`
   would have been shorter and would drift the first time the art moved.
2. **And the prototype has to be checked.** Reading one prototype is only sound
   if children sit in the same LOCAL place whichever way the part faces.
   `directionInvariant` builds a second prototype facing elsewhere and refuses
   the kind if anything moved. A builder that folded facing into its children
   would otherwise render every instance with the first prototype's geometry,
   silently.
3. **A kind whose animator MOVES a child cannot be instanced.** Instance
   matrices are written once at load, so `lipMesh.scale.y` in `ramp`'s animator
   would simply stop happening and the part would render correctly-but-inert —
   the worst failure to notice. The tell is an `Object3D` parked in `userData`,
   and that is what `animatesGeometry` refuses on. `ramp` is a live example and
   the test asserts it.
4. **The bounding sphere is a live trap.** three computes an `InstancedMesh`'s
   bounding sphere from its instance matrices **on first frustum test, and
   caches it**. Tested before the matrices are written, every booster on the
   floor is culled everywhere with nothing logged. `finalise()` computes it once
   from a known-populated state; a test asserts the radius actually covers the
   parts.

**One animator body serves both paths.** `PART_ANIMATORS` writes
`emissiveIntensity` on whatever it finds in `userData`; an instanced part puts
`EmissiveSink` objects there, which write into the instance attribute.
`MeshStandardMaterial` satisfies `EmissiveSink` structurally, so the Group path
needed no adapter and no animator got a branch — two write paths for one
animation is how they drift.

> ⚠️ **The material must never use `fragmentNode`.** It skips
> `NodeMaterial.setupDiffuseColor`, writes an unassigned albedo into the scene
> MRT, and renders as a **silhouette-shaped hole** with no error anywhere.
> `mrt-coverage.test.ts` guards the source-visible half; `playtest:gpu` is the
> only check that sees the rendered frame. Note also that `emissiveNode`
> *replaces* three's `emissive × emissiveIntensity` product rather than
> multiplying into it, so the per-instance attribute carries exactly what
> `emissiveIntensity` used to and the colour is folded into the node.

### B3 — The remaining kinds — **mostly struck, and the re-census is done**

The census reordered this list and deleted most of it. What survives:

**The post-B2 ranking (seed 42, 164 draws total), which is now the live one:**

| kind | draws | culled | verdict |
|---|---|---|---|
| spinpad | 20 | 15 | the new #1 part row, and it is floor-dependent (5 and 0 on the other two floors) |
| bumper | 18 | 75 | still struck — the ratio did not change |
| rollover | 12 | 12 | marginal |
| electric | 10 | 0 | small but clean, like the booster was |
| booster | **3** | 0 | done |

- [ ] **Nothing here is worth a session on its own.** The whole remaining part
      surface is ~60 draws spread over four kinds, none of which is #1 on more
      than one floor — where the booster was #1 on all three at 2–3×. The honest
      read is that Phase B has taken the win that was there, and the next real
      question is whether draw count is still what the frame is bound by.
- [ ] If one is done anyway, `electric` (10/0) is the right shape — clean, no
      cull to lose — and the B1 substrate should make it nearly free: add the
      kind to `INSTANCED_KINDS` and the prototype guards do the rest. **Re-run
      the census first anyway**; these numbers are one floor each.

~~`ramp`, `boostcorner`, `boostcurve` — identical shape, follows mechanically.~~
**Struck: 0–7 draws across three floors. "Mechanical" is not a reason to spend.**

~~`bumper` — a per-instance colour after the scalar case is proven.~~
**Struck: 6–18 drawn against 69–84 culled. Instancing would trade ~12 draws for
~85 instances the frustum currently discards for free.** Revisit only if a
future floor puts many bumpers on screen at once — which the census would show.

~~Kinds whose animator moves geometry (`spring`, `flipper`, `trapdoor`).~~
**Struck: none of them appear in the census at all.** A per-instance matrix path
would be built for parts that cost nothing.

### B4 — Only then, animation into the shader

- [ ] Replace the JS `emissiveIntensity` loop with a per-instance `phase` +
      `hitT` attribute and the wave computed in TSL/WGSL. This removes the CPU
      loop; it does **not** remove any draws — B2/B3 already did.
- [ ] Gate it on a measurement: `updatePinballParts` has to show up in the
      profile first. `vfx.pools` taught this repo that an assumed CPU cost can be
      50× under the threshold.

---

## 4. Phase C — WGSL only for maths kernels

The split already in the tree is the right one and needs no change: **WGSL owns
pure reusable maths; TSL owns bindings, varyings, texture sampling and material
integration.** `docs/tsl-to-wgsl.md` has the recipe and the measured reason.

- [ ] **Do not port a function merely because it is TSL.** The dumped post
      shader is already flat SSA with no duplicated subexpressions, and GPU work
      is ~10% of the frame. A wholesale rewrite has **no measured payoff** and
      buys readability only.
- [ ] Add a `.wgsl` file when a maths kernel becomes hard to read in TSL, and
      when it does, obey the contract: one function per file, declaration first,
      no leading comment, named after the file, `fn main` collides.
      `wgsl-contract.test.ts` enforces it.
- [ ] Candidates, gated on need, not scheduled: part chevron/pulse envelopes
      (arrives naturally with B4), shared floor-effect noise/SDF/palette ramps,
      particle lifetime easing, ribbon/beam falloff.

---

## 5. Phase D — the coverage gap that ships green

**A crash inside `buildMaze` passes the full 2892-test suite and deploys.** A
shadowed `at` put its callers in the temporal dead zone; every floor threw and
built nothing, and the suite was green throughout, because `buildMaze` needs
THREE and a live scene so no unit test calls it. `deploy.sh` gates on that suite.
`npm run playtest:gpu` is the only thing that catches the class.

- [ ] A scene-construction smoke gate that runs *without* a GPU: call `buildMaze`
      for N seeds and assert it returns a populated grid and a non-empty group.
- [ ] **Check first whether this is honest.** `headless-floor-harness` is already
      known to build a *different* floor than the real one; a smoke test that
      stubs enough THREE to run in vitest may be testing its own stubs. If it
      cannot be made faithful, the correct outcome is to **wire `playtest:gpu`
      into the deploy gate for changes under `maze/`** and say so — not to ship a
      test that passes for both states.

---

## 6. Non-goals, stated so they stop being re-proposed

- Replacing Three's scene graph, matrices, frustum culling, geometry/texture
  lifetime, or render-target management.
- Rewriting stock/toon/sprite materials — `WebGPURenderer` already emits them as
  WGSL.
- Hand-writing the pixel pass's generated WGSL. It is not the bottleneck.
- Raw `ShaderMaterial` anywhere. `WebGPURenderer` rejects it.
- Porting the particle pools to compute. Measured at **0.02 ms/frame**, 50×
  under the threshold that would justify it (`docs/webgpu-plan.md` PHASE 0).
- Eliminating Three.js. That is a new renderer project — device management,
  pipeline cache, bind-group allocator, loaders, memory lifetime, render graph,
  culling, lights, shadows, atlas, post stack — not the remainder of this one.

---

## 7. Verification protocol (this is the part that keeps being skipped)

1. **Baseline on an idle box.** `npm run ops:status` must show the meter clear.
   Every frame measurement this repo has taken shared the machine with another
   session, and a 200–400 ms stall is what CPU contention looks like.
2. **Never quote a single GPU run on this box.** One contaminated run put the
   post composite at 1.31 ms; it is 0.39 ms. Repeat the run, check a second
   resolution scales linearly (720p must be half of 1080p), and reproduce a
   prior independent record. That correction voided an entire approved track.
3. **One material family per commit.** Never combine a shader conversion with an
   art or gameplay change — there is no way to bisect the result.
4. **Test shader loading in the production build, not only vitest.** Turbopack's
   `type: "raw"` resolves to `undefined`, `next build` succeeds, and the material
   reaches the GPU as `wgslFn(void 0)` and draws nothing.
5. **Real adapter only.** A software adapter or a WebGL fallback invalidates the
   run; `?gpu=cpu` exists for diagnostics and never for measuring.
6. **`npm run playtest:gpu` for anything touching `maze/build.ts`, a material,
   or the MRT.** It is the only gate that sees a rendered frame.
7. **A worktree needs a real `pnpm install`, not a symlinked `node_modules`.**
   Turbopack refuses the symlink outright — `Symlink [project]/node_modules is
   invalid, it points out of the filesystem root` — so `next dev` never starts
   and no GPU run is possible. `pnpm install --prefer-offline` in the worktree
   takes ~4 s off the store. Vitest is happy with the symlink, which is why this
   only bites at the point you try to render something.
8. **Interleave the A/B; never run all of one arm then all of the other.** Two
   dev servers, alternate the runs, read only the paired differences. B2's
   wall-clock fps swung 38 → 97 across three rounds on the same build — an
   unpaired comparison would have measured the other session, not the change.
