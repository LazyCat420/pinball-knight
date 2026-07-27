# Pinball Knight — `core.ts` decomposition plan

**Target:** `src/scenes/dungeon/core.ts`, 4068 lines — the last monolith in an
otherwise well-decomposed 190-file scene.

**Baseline to hold green at every step** (measured 2026-07-26):
- `npx vitest run` → **1404 tests / 121 files passing**
- `npx tsc --noEmit` → 6063 errors repo-wide, **0 in `src/scenes/dungeon/`**.
  The noise is three.js typing drift in `objects/` and `room/`. The gate is
  *"still 0 in dungeon/"*, not *"6063"*.
- `node scripts/playtest.mjs --gpu --profile --backend webgpu --secs 20 --seed 42`
  → PASSED, 0 render errors, canvas painting.

---

## 1. Why this file is big (read before cutting)

This is **not** a neglected file. It is densely commented with *why*-comments
that encode expensive lessons (the `rendererReady` async-init gate, the
per-light shadow throttle, the negative-delta accumulator clamp). Those comments
are the most valuable thing in it. **Every extraction must carry its comments
with it.** A "cleanup" that drops them is a net loss, however tidy the result.

It is also **not** a god-object. The world state already lives in `state.ts`
(`export const state`, referenced 683× from core). Entities, maze, render, HUD,
audio, cards, and abilities are all already their own modules. What is left in
`core.ts` is genuinely four things braided together:

1. **Bootstrap** — build renderer/scene/lights/sheets, wire ~20 handler
   callbacks, mount HUD, start in the tavern.
2. **Dev/QA harness** — ~430 lines of `window.__dungeon*` hooks.
3. **Game rules** — spawning, level build, loot economy, death/descend, shop.
4. **The clock** — `simulate(dt)` and `loop(now)`.

The decomposition follows those seams. It does **not** invent an abstraction
layer; there is no "GameEngine class" to build here, and creating one would fight
the existing `state.ts` module-singleton design that 190 files already use.

> **Design decision — no `class GameEngine`.** The scene is a module singleton
> driven by `state.ts`. Wrapping it in a class would force either a second
> source of truth or a `this.state` indirection through 683 call sites, for no
> testability gain (the functions are already directly importable). We extract
> to **modules with explicit imports**, matching the pattern in `entities/`,
> `maze/`, and `render/`.

## 2. The one real structural problem

`launchDungeonGame` is **980 lines** (377→1356) with exactly **one** nested
closure (`beginRun` at 1281). It is a flat init sequence, which is why this is
low-risk: almost nothing captures local scope, so most of it moves without
rewriting. The module-level mutable state is only 7 variables (`sun`, `lamp`,
`ambient`, `hemi`, `touchControls`, `debugPanelDispose`, `shadowFrameCounter`,
`rendererReady`) — these need a home, not a refactor.

## 3. Target layout

```
src/scenes/dungeon/
  core.ts                    ~350   public API + launch/exit orchestration only
  boot/
    renderer.ts              ~120   WebGPURenderer, pixel pass, shadow throttle
    scene.ts                 ~110   lights, fog, biome pick
    sheets.ts                ~180   all buildSpriteSheet(...) atlas construction
    handlers.ts              ~230   the ~20 set*Handler wirings + coop hooks
  dev/
    window-hooks.ts          ~430   every window.__dungeon* QA hook (DEV-gated)
  spawn/
    zombie-factory.ts        ~250   makeZombie/spawnKind/reskin/expansion tables
    level.ts                 ~500   startLevel + corpse piles + pin crews
  economy/
    coins.ts                 ~250   coin split/cap/sweep/update + creditGold
    loot.ts                  ~230   drops: weapon/card/reagent/material
    pickups.ts               ~160   checkPickups, pickUpCard, pickUpWeapon
    shop.ts                  ~120   SHOP_STOCK, openShop/closeShop, potions/belt
  run/
    ledger.ts                ~140   beginRunLedger/Progression, currentRunStats,
                                    submitRunScore, gradeFloor
    death.ts                 ~200   onPlayerDeath, returnToTavern, tearGraveHole
    descend.ts               ~90    descend + boss reward
  sim/
    simulate.ts              ~130   fixed-step world tick
    loop.ts                  ~260   RAF frame: presentation, camera, render
```

`core.ts` keeps only: `launchDungeonGame`, `exitDungeonGame`,
`isDungeonGameActive`, `isSimPaused`, `bumpZombieNid`, and the module lights.

## 3b. PROGRESS (updated 2026-07-26, branch `refactor/core-decomposition`)

**core.ts 4068 → 2140 lines (47% removed) across 8 commits.** Every step gated
green: 1404 tests, 0 tsc errors in `scenes/dungeon`, no module importing back
into `core.ts`, playtest passing under real WebGPU.

| Step | Module(s) | core.ts after |
|---|---|---|
| 1 ✅ | `dev/window-hooks.ts` (565) | 3554 |
| 2 ✅ | `economy/ground-items.ts` (45), `economy/coins.ts` (234) | 3341 |
| 3 ✅ | `economy/loot.ts` (127), `pickups.ts` (164), `shop.ts` (169) | 2932 |
| 4-5 ✅ | `boot/lighting.ts` (143), `boot/sheets.ts` (75) | 2800 |
| 6 ✅ | `run/ledger.ts` (99) | 2715 |
| 7 ✅ | `spawn/factory.ts` (437), `maze/nearest-open-tile.ts` (32) | 2301 |
| 8 ✅ | `dev/debug-actions.ts` (200) | 2140 |

The economy came out as a strict DAG:
`ground-items → coins → {loot, shop} → pickups`.

**What actually mattered (revisions to the original plan):**

- The `__coinInternals` test bag is **gone**. `coins.test.ts` imports the real
  modules, and a negative control (sabotaging `creditGold`) failed 5 tests —
  proving the suite exercises the extracted code, not a stale copy.
- **Injected deps, not imports**, is what kept the graph acyclic. `dev/` and
  `spawn/` take core-owned actions (`spawnReaper`, `startLevel`, `descend`) as
  parameters. An injected dep that is never wired fails *silently*, so each one
  was verified live, not assumed.
- **Mutable module state got accessors** rather than being exported raw:
  `nextItemNid`/`resetItemNid`, `resetZombieNid`, `queueMini`/`queueSummon`.
- Three symbols (`coinCountFor`, `splitCoinValue`, `sweepCoins`) and
  `bumpZombieNid` left core's export surface; none had a consumer outside core.
  `scenes/dungeon/index.ts` is byte-identical to where it started.

**Remaining (steps 9-10), hardest last — and genuinely harder than the rest:**

`startLevel` (~490), the death/descend lifecycle (~430), and `simulate`/`loop`
(~330). Unlike everything above, these are mutually entangled: the death block
calls `startLevel`, `descend`, and `exitDungeonGame`, all of which are core's
floor orchestration. Extracting them means either a large injected-dep surface
or accepting that **core.ts's remaining job IS orchestration** — which is a
legitimate end state at ~2100 lines. Do not extract these just to make the
number smaller; the seam has to be real.

Whatever happens, `playtest.mjs --gpu` and a pixel-diff against HEAD are
mandatory for step 10 — frame ordering fails without throwing.

## 4. Sequencing — safest first

Each step is one commit, each ends with the full gate. Ordered so that the
riskiest (the clock) happens last, when the file is already small enough to read.

| # | Step | Lines moved | Risk | Why this order |
|---|------|-------------|------|----------------|
| 1 | `dev/window-hooks.ts` | ~430 | **very low** | DEV-only, no production path. Biggest single win. |
| 2 | `economy/coins.ts` | ~250 | low | Already has `coins.test.ts` + `__coinInternals` seam. |
| 3 | `economy/loot.ts` + `pickups.ts` + `shop.ts` | ~510 | low | Pure functions over `state`. |
| 4 | `boot/sheets.ts` | ~180 | low | Straight-line atlas construction. |
| 5 | `boot/renderer.ts` + `scene.ts` | ~230 | medium | Owns the `rendererReady` gate — **carry that comment**. |
| 6 | `boot/handlers.ts` | ~230 | medium | Handler wiring order is load-bearing; keep it. |
| 7 | `spawn/zombie-factory.ts` | ~250 | medium | Reskin/expansion tables + nid sequencing. |
| 8 | `spawn/level.ts` | ~500 | **high** | `startLevel` is the densest logic; co-op seed adoption. |
| 9 | `run/ledger.ts` + `death.ts` + `descend.ts` | ~430 | medium | Touches network + corpse persistence. |
| 10 | `sim/simulate.ts` + `loop.ts` | ~390 | **high** | Frame ordering is invisible-failure territory. |

## 5. Extraction rules (the part that keeps this honest)

1. **Move, don't rewrite.** Each step is cut/paste + add imports. Behaviour
   changes are a *separate* commit. If a step tempts a "while I'm here" fix,
   write it down and do it after.
2. **Comments travel with code.** Non-negotiable — see §1.
3. **Gate after every step:** `npx vitest run` (1404 pass) **and**
   `npx tsc --noEmit 2>&1 | grep -c 'scenes/dungeon'` → must stay `0`.
4. **Playtest at steps 5, 8, 10** — the ones that can render a black screen
   without throwing. A passing unit suite does **not** prove the frame renders;
   `playtest.mjs` has the blank-canvas + render-error gate for exactly this.
5. **No barrel re-exports of internals.** `core.ts` keeps its narrow public
   surface (11 exports today). Extracted modules import each other directly.
6. **`__coinInternals` stays** until `coins.test.ts` is repointed at the real
   module in step 2 — then it dies with its test updated in the same commit.

## 6. Circular-import hazard

`core.ts` currently calls *down* into everything, and handlers call *back* via
`set*Handler` injection. That injection pattern is what avoids cycles today and
must be preserved: extracted modules must **not** import `core.ts`. Where an
extracted module needs a core function (e.g. `loot.ts` needs `spawnCoin`), the
dependency goes through `state`/handler injection or a direct sibling import —
never back up to `core`.

Check after each step:
```bash
npx madge --circular --extensions ts src/scenes/dungeon/ 2>/dev/null || \
  grep -rn 'from "\.\./core"\|from "\./core"' src/scenes/dungeon/{boot,dev,spawn,economy,run,sim}/
```
The grep must return nothing.

## 7. Explicit non-goals

- **Not** merging or splitting `state.ts` (1240 lines). It is a data
  declaration, not logic; it reads fine and 190 files depend on its shape.
- **Not** touching `cel-painter.ts` (3372) or `constants.ts` (2279) — both are
  flat data/paint tables where length is inherent, not complexity.
- **Not** changing gameplay, balance, or visuals. Zero behaviour delta.
- **Not** adding a DI container, ECS, or engine class. See §1.
