# What is left after the WebGPU migration — braindeadbot-client

Status: **written 2026-08-07 on `main` @ f339a87. Phase A shipped; B–D open.**

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

### B0 — Census first, and per-kind. **Nothing else in Phase B starts until this exists.**

This repo has already shipped one plan built on an estimated draw count and been
wrong by 5× ("instance the torches, ~100 draws" — it was ~22). It has now been
wrong a second way: a **static** count of `new THREE.Mesh(` in `pinball-parts.ts`
reports a booster as 3 meshes. It is 6. The strips and chevrons are built in
`for` loops, so even the object count cannot be read off the source.

- [ ] Run `__dungeonDraws()` on 3+ floors and record **per part kind**, not just
      the `part:*` total. `dev/draw-census.ts` already labels by nearest named
      ancestor and `createPinballParts` already names groups `part:<kind>`, so
      the data is there — it needs collecting into a table.
- [ ] Record `culled` alongside `draws`. Instancing removes the cull, so a kind
      with a high culled count can get *worse*: 100 instances in one draw are
      100 instances submitted, where 100 separate meshes were 20 draws and 80
      skips. **This is the one way Phase B can lose, and the census is what
      predicts it.** Torches won because they are dense and mostly visible.
- [ ] Rank kinds by `draws`, and take them in that order. Booster is presumed
      first; the census gets to overrule that.

### B1 — The instancing substrate

- [ ] A `PartInstancer` that owns, per (kind, slot): one `InstancedMesh`, the
      shared geometry, one material, and a per-instance `Float32` attribute for
      emissive intensity.
- [ ] `createPinballParts` keeps building a `THREE.Group` per part for anything
      *not* yet instanced. Both paths coexist — this migrates one kind at a
      time, and a half-migrated floor must render correctly.
- [ ] `PinballPart.mesh` stays. Gameplay, collision (`entities/pinball-collide.ts`),
      `spawnPinballPart` and `disposePinballParts` must not learn about
      instancing. **Only the visual representation changes.**
- [ ] The material is a `MeshStandardNodeMaterial` with an
      `emissiveNode` reading the instanced attribute.

  > ⚠️ **It must use `colorNode`/stock material setup and must NEVER use
  > `fragmentNode`.** A `fragmentNode` material skips
  > `NodeMaterial.setupDiffuseColor`, writes an unassigned albedo into the MRT,
  > and renders as a **silhouette-shaped hole** with no error anywhere.
  > `mrt-coverage.test.ts` guards the source-visible half of this; the material
  > must also be built inside `withSceneContext` or it emits a 1-output shader
  > and fails the same way from the other direction. **`npm run playtest:gpu` is
  > the only check that sees it.**

### B2 — Migrate the booster (the 66)

- [ ] Three instanced slots: plate, strip, chevron. 66 draws → **3**, if the
      census agrees the boosters are actually visible together.
- [ ] The animator keeps its current maths and writes
      `attr.array[i] = intensity; attr.needsUpdate = true` per frame.
- [ ] **Visual parity before perf.** Fixed seed, fixed camera, fixed `animT`;
      screenshot the same floor before and after and diff. A wave that is a
      frame out of phase is a bug that looks like a rendering difference.
- [ ] Re-run the census. State the delta. If it is under ~10 draws, stop and say
      so rather than continuing down the ranked list on faith.

### B3 — The remaining kinds, in census order

- [ ] `ramp`, `boostcorner`, `boostcurve` — identical shape to the booster
      (chevron array + lip), so they follow almost mechanically.
- [ ] `bumper` — needs a per-instance **colour** as well, not just an intensity
      (`dome.emissive.setHex` switches between `C_SHOT` / `C_GOLD` / `C_ARCANE`).
      A `vec3` instanced attribute; do it after the scalar case is proven.
- [ ] Kinds whose animator moves geometry (`spring` scales a coil, `flipper`,
      `trapdoor`) need a per-instance matrix write, which is a different and more
      expensive path. **Take them last, and only if the census says they cost.**

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
