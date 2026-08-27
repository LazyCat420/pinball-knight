# Load & warm-up perf wave — plan

_Written 2026-07-27. Scope: the **loading** cluster from the research audit —
first-frame and first-encounter pipeline stalls. Not balance, not the drop
bugs; those are the next wave._

Every claim below was verified against the working tree on the date above, and
against `node_modules/three` for the renderer behaviour. Line numbers are from
`src/game/pinball-knight/` unless noted.

---

## 0. What is already shipped — do NOT re-propose

The repeated failure mode in this project's plan docs is funding work that
exists. Verified present:

| Thing | Where | State |
|---|---|---|
| Descent-screen pipeline warm-up (`compileAsync` per scene child) | `core.ts:823-844` | **Works.** Cut a measured 5,103 ms first frame (`core.ts:744-745`) |
| Instanced particles (500 additive + 400 alpha), `frustumCulled = false` | `render/vfx.ts:104-147` | Warmed correctly today — the InstancedMesh is visible |
| Instanced walls / wash / pilasters / banners / crates / barrels | `maze/build.ts:1010-1417` | Shipped |
| Damage text pooled, 32 slots, no per-hit allocation | `engine/render/damage-text.ts:231` | Shipped |
| Entity caps: zombies 135, coins 28, ghosts 14, torch lights 6 | `constants.ts:2100-2109`, `vfx.ts:875` | Shipped |
| Frame profiler with stage timings + `# draw calls` | `engine/profiler.ts`, `core.ts:2434` | Shipped |

## 1. The defect — warm-up cannot see anything hidden

`Renderer._projectObject` (`node_modules/three/src/renderers/common/Renderer.js:3082`):

```js
_projectObject( object, camera, groupOrder, renderList, clippingContext ) {
    if ( object.visible === false ) return;          // ← skips the whole subtree
    ...
    } else if ( object.isMesh || object.isLine || object.isPoints ) {
        if ( ! object.frustumCulled || frustum.intersectsObject( object ) ) {   // ← line 3132
```

`compileAsync` walks the same `_projectObject`, so **an invisible object is
never compiled**, and a frustum-culled one is compiled only if it happens to be
on screen at warm-up time.

Every pooled VFX mesh is constructed invisible, and their groups *are* in the
scene at warm-up time (`vfx.ts:895-902`), so the existing loop reaches them and
skips all of them:

| Pool | Count | Built invisible at | Material |
|---|---|---|---|
| SlashPool | 10 | `vfx.ts:305` | `MeshBasic` + map, additive, DoubleSide |
| BoltPool | 40 | `vfx.ts:396` | `LineBasic`, additive |
| RingPool | 16 | `vfx.ts:516` | `MeshBasic` no map, additive, DoubleSide |
| BladeRing | 6 | `vfx.ts:768` | `MeshBasic` + map, additive, DoubleSide |
| SigilPool | 8 | `vfx.ts:679` | `MeshBasic` + map, additive, DoubleSide |
| DamageTextPool | 32 | `damage-text.ts:254` | `MeshBasic` + map, `depthTest: false` |

Two more material families the warm-up **cannot** have seen, because they do
not exist yet when it runs:

- **Ghosts** — `new MeshBasicMaterial` per dash, disposed on expiry
  (`vfx.ts:992`, `:1026`). Distinct key: `alphaTest: 0.4`.
- **Floor-fx decals** — `matFor(kind)` is **lazy** (`entities/floor-fx.ts:168`),
  so on a fresh floor none of the 5 kinds' materials exist. Each spawn then
  `.clone()`s the base (`:211`).

**Consequence:** the first slash, bolt, ring, blade, sigil, damage number,
dash-ghost and each floor-fx kind of a run compiles cold, mid-combat — exactly
the stall class the warm-up was built to remove.

## 2. Second defect — `state.floorFx` has no live cap

`spawnFloorFx` (`entities/floor-fx.ts:208-228`) pushes unconditionally. Unlike
coins (`COIN_LIVE_CAP = 28`) and ghosts (`GHOST_CAP = 14`), there is no guard —
verified: `state.floorFx.push` at `:216` has no length test.

The groove is the dominant producer. `carveGroove` (`:247`) stamps one entry per
`GROOVE_SPACING = 0.34` units travelled, with `GROOVE_LIFE = 26` s:

```
GROOVE_RAIL_MAX_SPEED 17 u/s ÷ 0.34 u  =  50 stamps/s
50 stamps/s × 26 s life                = 1,300 live decals
```

Each is a `THREE.Mesh` + a **cloned material** added straight to the scene —
1,300 extra draw calls and 1,300 materials in the worst case, on top of the
135-zombie draw-call budget the horde cap is explicitly protecting.

## 3. Third gap — no way to tell an honest measurement from a lie

`grep -rn "adapter.info|swiftshader|requestAdapter|timestamp-query"` over the
game folder returns only two prose comments. There is no software-adapter
guard, so a profile taken under SwiftShader looks like a real one, and no
pipeline/program counter, so "did the warm-up actually cover it" is currently
unanswerable.

`renderer.info.memory.programs` is public API and counts distinct compiled
shader programs (`node_modules/three/src/renderers/common/Info.js:420`) — that
is the number this wave has to hold flat through a fight.

---

## The checklist

> **SHIPPED — verified against the source 2026-08-26.** Every engineering item
> below (W1.1 through W4.2) is live in the tree; the boxes were simply never
> ticked, and for two weeks this doc has been the repo's largest apparent
> backlog while containing no remaining work. Spot checks:
> `engine/gpu-adapter.ts` · `probeGpuAdapter`/`isSoftwareAdapter`/`gpuAdapterLabel`
> wired at `engine/profiler.ts:32,186,224,242` · `__dungeonGpuInfo` at
> `engine/profiler.ts:266` · `profCount("gpu programs"…)` at `sim/loop.ts:496`
> and `"gpu textures"` at `:501` · `warmupTarget()`/`warmupReveal()` across
> `fx/pools/*` and `engine/render/{damage-text,canvas-backing}.ts` ·
> `warmFloorFxReveal`/`disposeFloorFxAssets` at `entities/floor-fx.ts` ·
> `warmFloorPipelines` at `boot/warmup.ts` (imported `core.ts:46`) ·
> `FLOOR_FX_MAX = 300` at `constants/pinball.ts:223`, evicted front-first by
> `while (state.floorFx.length >= FLOOR_FX_MAX) despawn(0)` at
> `entities/floor-fx.ts:386` · gates in `load-warmup.test.ts`.
>
> `[~]` marks the W4.3/W4.4/W5 rows: process steps (suite, `tsc`, commit,
> deploy, handoff) that leave no symbol behind and cannot be verified from the
> tree either way.

### W1 — Instrumentation first (rule #2: measure before you fix)

- [x] **W1.1** New `engine/gpu-adapter.ts`: `probeGpuAdapter()` caches
      `navigator.gpu.requestAdapter().info`; `isSoftwareAdapter()` matches
      `swiftshader|lavapipe|llvmpipe|software|basic render` over
      vendor+architecture+device+description.
- [x] **W1.2** `engine/profiler.ts`: print the adapter in the summary banner and
      a loud **UNTRUSTED** warning when it is software. Export `gpuAdapterLabel()`.
- [x] **W1.3** *(landed in `sim/loop.ts:496`, not `core.ts` — the render block moved out
      of `core.ts` before this wave shipped)* `profCount("gpu programs", info.memory.programs)`
      and `profCount("gpu textures", info.memory.textures)` beside the existing
      draw-call count.
- [x] **W1.4** `__dungeonGpuInfo()` console hook alongside `__dungeonProfile`.

### W2 — Make the warm-up see the pools

- [x] **W2.1** Each pool class exposes `warmupTarget()` returning its slot 0
      object (no new materials — warm exactly what will be drawn).
- [x] **W2.2** `createVfx` gains a persistent hidden **ghost prototype** mesh
      matching the runtime ghost descriptor (`map` + `alphaTest: 0.4`,
      `transparent`, `depthWrite: false`, `DoubleSide`) on a 1×1 dummy texture.
- [x] **W2.3** `VfxSystem.warmupReveal(): () => void` — sets `visible = true`
      and `frustumCulled = false` on one representative per pool, returns the
      restore closure. Position is untouched: `frustumCulled = false` skips the
      frustum test outright (Renderer.js:3132), so placement is irrelevant.
- [x] **W2.4** `entities/floor-fx.ts`: `warmFloorFxReveal(scene)` forces all 5
      `matFor(kind)` materials to exist and reveals one proxy mesh per kind
      (created once, module-level, disposed by `disposeFloorFxAssets`).
- [x] **W2.5** `warmFloorPipelines` calls both reveals before the loop and
      restores in a `finally`. **No change to the loop itself** — the proxies are
      already scene children, so the existing per-child walk picks them up.

### W3 — Cap the floor-fx population

- [x] **W3.1** `FLOOR_FX_MAX = 300` in `constants.ts` (≈6 s of trail at top
      speed; 4.3× under the 1,300 worst case).
- [x] **W3.2** `spawnFloorFx` evicts oldest-first via the existing `despawn(0)`
      so scene removal + material disposal + array splice stay in one place.
      Eviction is from the FRONT, so `carveGroove`'s
      `state.floorFx[state.floorFx.length - 1]` read (`:258`) still sees the
      entry it just made.

### W4 — Gates

- [x] **W4.1** New `load-warmup.test.ts`: every pool's `warmupTarget()` is a real
      Object3D; `warmupReveal()` leaves all targets visible + unculled and the
      restore closure returns every one to its prior state (asserts the actual
      saved flags, not a hardcoded `false`).
- [x] **W4.2** floor-fx cap test: spawn `FLOOR_FX_MAX + 50`, assert length is
      pinned, the newest survives, the oldest is gone, and disposal ran.
- [~] **W4.3** (process) `pnpm vitest run` full suite green.
- [~] **W4.4** (process) `tsc --noEmit` clean.

### W5 — Ship

- [~] **W5.1** (process) Commit on `perf/warmup-pipelines`, rebase onto `main`.
- [~] **W5.2** (process) Deploy from a clean worktree (`HEAD@<sha>` banner), copying the
      prebuilt `canvas` build dir first.
- [~] **W5.3** (process) Replace `HANDOFF.md`.

---

## Measurement protocol (how we know it worked)

Must run against a **real GPU adapter** — `__dungeonGpuInfo()` first; if it says
software, the numbers are void (this is the SwiftShader trap that invalidated an
earlier timing experiment).

1. Load a floor. Record `renderer.info.memory.programs` immediately after the
   descent screen closes → **P_warm**.
2. `__dungeonProfile(600)`, then fight: swing, cast a bolt, dash, take a hit,
   ride a groove, ignite oil.
3. Record `# gpu programs` **max** from the table → **P_fight**.

**Pass:** `P_fight − P_warm == 0`, and `# draw calls` max stops tracking groove
length. **Fail:** any positive delta names a material family the reveal missed.

Before/after on the same machine, same floor seed, is the only comparison that
means anything — `p95` of `FRAME (total)` across the first fight.

## Explicitly out of scope this wave

Deferred, with reasons, so the next reader does not think they were missed:

- **Torch-light sort allocation** (`core.ts:2335`, ~80 objects + a full sort per
  rendered frame) — per-frame cost, not loading.
- **`blob-pool.ts` is dead code** (zero call sites; every actor still gets its own
  blob mesh) — a real draw-call win, but it is a sprite-lifecycle change, not a
  warm-up one.
- **Per-actor texture clone** (`render/sprite.ts:477`) — needs the W1 counter to
  confirm (`info.memory.textures` ≈135 confirms, ≈20 refutes) before anyone
  costs a fix. W1.3 is what makes that measurable.
- **`mapSignature` string build per frame** (`map-render.ts:422`) and the
  13-string literal per sim step (`core.ts:2104`) — trivial, but per-frame.
