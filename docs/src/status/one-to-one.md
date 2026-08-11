# The 1:1 plan — what "converted" means, and what is left

**Version 2 · 2026-08-11 · baseline `main` @ `db31ac2` · method: VCPM
(`.agents/plan-verification-standard.md` in the sun workspace).**
Every number on this page was measured from the tree on that commit, with the
command that produced it named. Nothing here is estimated.

> **What changed in v2.** The v1 baseline (`a47a7a8`) was two feature commits
> stale — `e86b299` (surfaces) and `072b57f` (the standing horde) landed after
> it. The coverage scan is now a committed script (`scripts/pk-coverage.sh`)
> instead of a one-off, so §2 is re-derivable at any commit rather than
> re-measured by hand. A third handed-in blueprint is triaged in §3.3, the
> remaining work is decomposed into the five tracks it proposed (§5), and its
> three open questions are answered from the tree in §5.6.

The other four status pages answer different questions and this one does not
replace any of them:

| Page | Question it answers |
|---|---|
| [port-checklist](port-checklist.md) | *what state is each subsystem in* — the inventory |
| [completion-plan](completion-plan.md) | *in what order, behind which gate* — the route |
| [build-out](build-out.md) | *what gets built next* — the queue |
| [handoff](handoff.md) | *where is the baton right now* |
| **this page** | *what does 1:1 mean, how much of it is left, and how do we know* |

It exists because "convert it 1:1" is not checkable as written. A phase board
can be all-green while a third of the legacy tree has never been read. This page
defines the finish line, measures the distance to it, and triages the two
conversion blueprints that were handed in on 2026-08-11.

---

## 1. What 1:1 means here

**1:1 is defined against `legacy/`, not against `braindeadbot-client`.**
`legacy/` is the 870-commit filtered extraction and it is the only tree with the
`onPass` harness seams in it. See §4 for the drift this creates and the gate it
needs.

Three exclusions are **decisions, not debt**. They are the reason the port is
finishable, and each is documented where the decision was made:

| Excluded from the port | Lines | Why | Decision |
|---|---:|---|---|
| `tools/sprite-forge/**` | 7,058 | the permanent art toolchain; it runs in Node against ComfyUI and always will | [art/pipelines](../art/pipelines.md) |
| `render/cel-painter.ts` | 4,785 | painters are RUN and their pixels shipped as PNGs, never re-implemented | [art/bake](../art/bake.md) |
| `maze/build.ts` painters | ~700 of 1,834 | same rule — Canvas2D + Skia; a second implementation is a permanent parity liability | [handoff](handoff.md) |

So the **port target is ~92k lines**, not 104k:

```
104,299  legacy/src/game/pinball-knight  *.ts, non-test   (find … ! -name '*.test.ts' | xargs wc -l)
 -7,058  tools/sprite-forge                                (never ported — decision)
 =97,241 portable surface
 -4,785  render/cel-painter.ts                             (baked — decision)
 -~700   maze/build.ts painter functions                   (baked — decision)
 ≈91,756 the actual 1:1 target
```

**Cutover — the day this plan ends — is a single event:** `legacy/` is demoted
from oracle to reference. Until that day `legacy/` is load-bearing and
`braindeadbot-client` keeps serving the live game untouched.

### 1.1 Two things "1:1" does NOT mean, as of the 2026-08-11 decisions

Both were settled with the user and they narrow the finish line rather than move
it ([handoff](handoff.md)):

1. **Bit-exact is for the SIM only.** Digest harnesses and sabotage sweeps stay
   on rng / physics / generator, where 1 ulp breaks replay. Content and art are
   verified *visually against a rig*, because a screenshot is the only evidence
   a texture claim can have — a grep proves presence, not legibility.
2. **The TS game is a DATA SOURCE, not only an oracle.** Finished floors are
   exported and rendered in Rust now; the generator that produces them is ported
   behind that. This is why "9 of 23 passes" and "a visible dungeon" are no
   longer the same milestone.

---

## 2. Measured baseline — 2026-08-11

### 2.1 Coverage

| Fact | Value | How it was measured |
|---|---:|---|
| Legacy portable source | 97,241 lines / 273 files | `find … -name '*.ts' ! -name '*.test.ts'`, `tools/` excluded |
| Legacy test source | 41,680 lines | same, `*.test.ts` |
| Rust source | 41,118 lines / 6 crates | `find crates/*/src -name '*.rs' \| xargs wc -l` (45,945 with `tests/` and `xtask/`) |
| **Legacy lines with NO Rust counterpart** | **61,936 (63%), 201 files** | `bash scripts/pk-coverage.sh` — the two-signal scan of §2.3, now a script |
| Maze passes landed | 9 of 23 | `PASSES_LANDED` — `crates/pk-core/src/maze/track_floor.rs:362` |
| Bit-exact fixtures | 10 | `ls assets/fixtures/` |
| Authored floors exported | 3 (L1/L3/L5, seed 1) | `ls assets/floors/` |
| Baked sprite atlases | **0** | `assets/sprites/` is empty; `cargo xtask bake` returns `ExitCode::FAILURE` with "not implemented yet" (`xtask/src/main.rs:59-77`) |
| CI | exists | `.github/workflows/ci.yml` |

The 63% figure was derived independently of the completion plan's "~60k of 104k
remain" and lands on the same answer from the other direction. That is
corroboration, not repetition.

**v1 → v2 movement, and what it costs to read it wrong.** 63,441 → 61,936 is
1,505 lines of counterpart gained across two commits, and **the directory that
moved is not the one that shipped**: `spawn/` 24% → 57% and `sim/` 25% → 96%
moved because `authored_floor.rs` and `dungeon_render.rs` now *cite* those
files, not because the horde got an AI. This is ASSUMPTION-1 in the wild — a
citation is a claim of provenance, not of behaviour, and §5.1's Stage 1c is the
honest description of what those two commits actually delivered.

### 2.2 Where the remaining 63k lives

Measured at `db31ac2` by `scripts/pk-coverage.sh`; the v1 column is kept so the
movement is visible.

| Legacy dir | Lines | Counterpart | Coverage | v1 (`a47a7a8`) |
|---|---:|---:|---:|---:|
| `maze/` | 19,893 | 11,385 | 57% | 55% |
| `render/` | 15,231 | 251 | **1%** | 1% |
| root (`state.ts`, `cards.ts`, …) | 12,712 | 2,495 | 19% | 19% |
| `entities/` | 11,289 | 4,745 | 42% | 42% |
| `engine/` | 8,720 | 6,180 | 70% | 70% |
| `gui/` | 7,420 | 2,823 | 38% | 38% |
| `dev/` | 5,438 | 140 | **2%** | 2% |
| `constants/` | 3,906 | 2,948 | 75% | 75% |
| `fx/` | 3,817 | 869 | 22% | 22% |
| `spawn/` | 1,580 | 913 | 57% | 24% |
| `boot/` | 1,479 | 392 | 26% | 14% |
| `economy/` | 1,338 | 0 | **0%** | 0% |
| `sfx/` | 1,140 | 360 | 31% | 31% |
| `intro/` | 1,118 | 1,118 | 100% | 100% |
| `run/` | 1,036 | 0 | **0%** | 0% |
| `sim/` | 708 | 686 | 96% | 25% |
| `testkit/` | 292 | 0 | 0% | 0% |
| `input/` | 124 | 0 | 0% | 0% |

The fifteen largest files with no Rust counterpart — most of the remaining
schedule, in fifteen names:

```
4785  render/cel-painter.ts        ← baked, never ported (excluded above)
1611  render/pinball-parts.ts
1330  hud-face.ts
1217  entities/zombie.ts
1204  entities/combat.ts
1054  dev/window-hooks.ts          ← the __lab() surface
 993  entities/floor-fx.ts
 991  dev/pattern-census.ts
 916  abilities.ts
 885  cards.ts
 856  render/monsters/stiltneck.ts
 821  constants/enemies.ts
 809  render/holo-card.ts
 809  gui/screens/menu.ts
 807  entities/projectiles.ts
```

### 2.3 The method, and what it cannot see

A legacy file counts as *having a counterpart* if **either** a Rust module
carries its snake_cased name, **or** its path or filename appears anywhere in a
`.rs` file (the port's module headers cite their source — `collide.rs:4` cites
`engine/collision.ts`, which is how a renamed port is still counted).

- **False "ported" is possible**: a Rust file that merely *mentions* a legacy
  file counts it. The per-directory numbers are therefore an **upper bound** on
  coverage.
- **False "unported" is possible**: logic ported into a differently-named module
  that never cites its source. Spot-checked against `engine/collision.ts` →
  `collide.rs`, which was correctly counted.

**ASSUMPTION-1 — the coverage table is an upper bound, not a ledger.**
*Risk:* the remaining work is under-stated by an unknown margin.
*Validation path:* WORK ITEM P-1 below makes it exact.

---

## 3. Triage of the two blueprints handed in on 2026-08-11

VCPM §2: classify before improving. Both documents were parsed into atomic
claims and every claim was checked against the tree.

### 3.1 Blueprint A — "TS-to-Rust Engine Port Blueprint (Developer Guide)"

**Verdict: do not build from this document.** 11 of 15 load-bearing claims are
false against the tree, and two of them would break the port's central
guarantee. It is triaged here so the same proposals are not re-derived.

| # | Claim | Class | Evidence |
|---|---|---|---|
| A1 | a `pk-render` crate holds the shaders | **FALSE** | workspace members are pk-core, pk-jsmath-probe, pk-assets, pk-audio, pk-game, pk-gui, xtask (`Cargo.toml:3-11`). Shaders live in `crates/pk-game/src/post/` |
| A2 | walls get Rapier3D `Collider::cuboid` + `RigidBody::Fixed`; monsters get `Collider::ball` | **FALSE, and destructive** | `rapier` appears in no `Cargo.toml` **and not in `Cargo.lock`**. Collision is `pk_core::collide`, a line-for-line port of `engine/collision.ts` gated by bit-exact traces. A third-party solver has no bit-exact answer to reproduce; adopting it invalidates every fixture in `assets/fixtures/` |
| A3 | the maze is generated in `BoardGen.ts` | **FALSE** | no such file and no such symbol anywhere in `legacy/src`. The shipping path is `maze/track-floor.ts buildTrackFloor` |
| A4 | port "the cellular automata or BSP tree logic" | **FALSE** | the only matches for those words under `maze/` are comments about a *hypothetical pluggable* generator (`archetypes.ts:315`, `generator.ts:10`). The real algorithm is a physarum circuit → track path → 23 carve/repair passes |
| A5 | put maze generation in Bevy systems in `floor_loading.rs` / `real_floor.rs` | **WRONG LAYER** | pk-core is "deterministic, Bevy-free, GPU-free" (`crates/pk-core/Cargo.toml:7`) and the generator lives there so it can be replayed headless. pk-game is the shell |
| A6 | grid as `Vec<Vec<TileType>>` | **WRONG SHAPE** | `pk_core::grid::Grid` is row-major flat `Vec<u8>` + parallel `shapes` + optional `surfaces` (`grid.rs:21-33`) — the JS layout, which is what makes the digests comparable |
| A7 | monsters are `MonsterNode` classes in TS | **FALSE** | no such symbol in `legacy/src` |
| A8 | entity state lives in Bevy components (`Health`, `AnimationState`) | **WRONG LAYER** (idea partly salvageable) | the port's shape is sim-as-a-resource: replayable state in pk-core, Bevy components as the *view*. A `Health` that exists only as a component cannot be trace-verified |
| A9 | use `TextureAtlasSprite`, `SpatialBundle`, `InstancedMesh` | **FALSE APIs** | bevy 0.17.3 (`Cargo.lock`). Grepped the vendored 0.17 sources: `TextureAtlasSprite` 0 hits, `SpatialBundle` 0 hits, `InstancedMesh` 0 hits (that one is three.js). `TextureAtlasLayout` **does** exist — 4 files |
| A10 | `cargo xtask bake` has been run, so `assets/sprites/rung-N/manifest.json` exists | **FALSE TODAY** | bare `bake` prints "not implemented yet" and returns `ExitCode::FAILURE`; only `--tavern` and `--gui-font` are real. `assets/sprites/` is empty |
| A11 | make `pk-assets` a Bevy `AssetLoader` | **WRONG DIRECTION** | pk-assets depends on serde only, deliberately. Art is embedded with `include_str!`/`image` in pk-game (`tavern_art.rs`), which is what makes native and wasm load identically |
| A12 | legacy loads textures with WebGL `ImageBitmap` | **FALSE** | WebGPU-only is house policy; the legacy renderer defeats the WebGL fallback on purpose (`src/render/backend.ts`) |
| A13 | `RungManifest` carries a `palettes` map | **VERIFIED** | `crates/pk-assets/src/lib.rs:51,60` |
| A14 | cel grade `cel=1.0, steps=10.0, saturation=1.15` | **VERIFIED — and already shipped** | `post/pipeline.rs:82-86` `CEL_STEPS=10.0`, `CEL_CURVE=0.5`, `CEL_SATURATION=1.15` |
| A15 | billboard quads with `AlphaMode::Mask(0.5)` | **VERIFIED — already shipped** | `tavern.rs:324,684` |

The three true claims (A13–A15) describe code that already exists. The document
has no net content and two live hazards (A2, A8).

### 3.2 Blueprint B — "Authored Floor Integration & Dungeon Lighting"

**Verdict: adopt, with five corrections.** It was written against
[handoff](handoff.md) and inherits that page's accuracy. Its structure — loader
→ torches → parts/props/items → bake profile — is the right order and matches
the queue.

| # | Claim | Class | Evidence / correction |
|---|---|---|---|
| B1 | exports are `L{1..3}-s1.json` | **CORRECTION** | the three exports are **L1, L3, L5** at seed 1 (`ls assets/floors/`) |
| B2 | L3-s1 has 41 torches | **VERIFIED** | counted from the payload. Also: L1 48, L5 64 |
| B3 | `serde` must be added to pk-game | **VERIFIED** | pk-game has `serde_json` only (`crates/pk-game/Cargo.toml:14`); the workspace already carries `serde` with `derive` |
| B4 | `include_str!` the payloads | **VERIFIED as the house pattern** | `tavern_art.rs` does exactly this. Payload size measured: three files, ~180 KB |
| B5 | run `validate_runtime_floor` on the result | **VERIFIED it exists** | `real_floor.rs:64,372` — an authored floor that is not standable must fail the way a generated one does |
| B6 | default to authored, `--rust-floor` for generated, source in the banner | **SOUND** | the flag/banner machinery exists (`real_floor.rs:196,247,387`). The banner rule is load-bearing: a screenshot whose source is ambiguous is not evidence |
| B7 | one `PointLight` per torch, `RGB(255,140,40)`, radius 8.0 | **FALSE — the oracle answers this** | `build.ts:1862-1866`: a **pool of `TORCH_LIGHT_POOL = 6`** (`constants/render.ts:667`) lights, parked on the nearest anchors, each `PointLight(PALETTE_HEX[16], intensity 6, distance 6, decay 2)` at `y = WALL_H*0.62 + 0.3` (`WALL_H = 1.1`, `constants/world.ts:19`). Plus one stair glow, `PointLight(PALETTE_HEX[31], 4.0, 5.5, 2)` (`build.ts:1744`). Sconce is `BoxGeometry(0.18, 0.3, 0.18)`, `MeshStandardMaterial(PALETTE_HEX[19], roughness 0.4, metalness 0.6)`. **Take the palette indices from `render/palette`; do not invent an RGB.** The torch *budget* is itself derived from the pool: `floorBudgets` sets `torches = min(round(walkable/70) + 6, 80)` precisely because only 6 are ever lit (`constants/level.ts:114-129`) |
| B8 | Open question: "pool by distance, or one light per torch?" | **ALREADY ANSWERED** — see B7. A parked pool of 6. Answering it any other way is a divergence, not an optimisation |
| B9 | Open question: rebuild the Windows exe after each pass? | **YES, and it is not optional** | the user plays the exe; `scripts/pk-win.sh build` after every merge or the report you get back is against a stale binary — this cost a day already ([handoff](handoff.md)) |
| B10 | reduce the maze bake from >13 min to **<30 s** | **UNVERIFIED TARGET** | the >13 min is measured; 30 s is a wish with no measurement behind it. The instruction is **profile first** (`__bakeParts` exists for it) — suspects: `fillStyle` re-parsed inside a 262k-iteration loop, `toDataURL` readback on software GL, a canvas scale ≠ 1. Rewrite as: *profile, then set the target from the profile* |
| B11 | render parts with placeholder primitives | **CORRECT AND DELIBERATE** | the A/B rig grades POSITION and DENSITY at this stage; baked art replaces placeholders later without moving a call site |
| B12 | "60 FPS on low-power devices" | **OUT OF SCOPE / UNFALSIFIABLE as stated** | no device class, no scene, no measurement. The project's FPS gate is pk-check on this box |

**Correction to B-row facts, measured while building the loader:** the export
carries BOTH `kicks` (5-6 bands per floor) and `lanes` (4-8) — the handoff says
it carries neither. It also omits `solidOut` on most arcs and `rarity` on 12 of
30 items, neither of which a key-union scan can see. **A union says "some entry
has this field"; only a per-entry count says "every entry does."** That mistake
cost two build-refuse cycles and is the reason every optional field in
`authored_floor.rs` carries its measured presence count in a comment.

**New finding, from measuring the payloads for B2:** `plan.rooms` is **empty on
all three exported floors** (L1, L3, L5), while every other section is populated
— parts 80/102/121, props 63/84/93, spawns 52/72/105, torches 48/41/64, items 10
each, secrets 3/6/8, plazas 3/4/4, circuits 1 each. Rooms are section 1 of
`decorateMaze` and everything after them is seeded by their archetype content.
Either these archetypes author no rooms, or the exporter drops the field.
**Resolve before the loader is written** (WORK ITEM 1b-0) — a loader built
against a payload with a silently missing section will look correct and be
wrong.

### 3.3 Blueprint C — "Pinball Knight 1:1 Rust/WebGPU Conversion Plan"

Handed in 2026-08-11, after v1 of this page shipped. **Verdict: adopt its
decomposition, reject one item outright, correct five.** It is the best of the
three documents — it was written against v1 and the queue, its structural
contribution (the remaining work as five parallel *tracks* rather than one
serial stage list) is real and is folded into §5 — but it carries one claim that
would spend a week undoing a standing decision.

| # | Claim | Class | Evidence / correction |
|---|---|---|---|
| C1 | baseline `a47a7a8`, Rust 38,411 lines / 6 crates | **STALE** | tree is `db31ac2`; `e86b299` (surfaces) and `072b57f` (the horde) landed after. 41,118 lines in `crates/*/src` |
| C2 | port target 91,756 after three exclusions | **VERIFIED** | reproduces §1's arithmetic from today's `wc -l` |
| C3 | 63,441 remaining (65%) | **STALE-DERIVED** | 61,936 (63%) at `db31ac2` — and still an upper bound (ASSUMPTION-1) |
| C4 | maze passes 1–9 landed bit-exact | **VERIFIED** | `PASSES_LANDED = 9`, `track_floor.rs:362` |
| C5 | passes 10–23, by name, in `PASS_ORDER` | **VERIFIED** | matches `maze/mod.rs:51-73` exactly, all fourteen |
| C6 | `decorateMaze` is 3,169 lines | **VERIFIED** | `wc -l maze/decorate.ts` |
| C7 | add the `onPass` seam to `decorateMaze` **before** porting any of it | **VERIFIED, and it is the most valuable line in the document** | `grep -rl onPass` returns `track-floor.ts` and the exporter, nothing else |
| C8 | **V1: port `makeFloorTexture` / `makeWallTexture` / `makeCapTexture` (`build.ts:356-670`) into `dungeon_render.rs`** | **FALSE — it contradicts the document's own §1.1** | those three functions live at `build.ts:356`, `:482`, `:623` — they *are* the "~700 lines of `maze/build.ts` painters" the plan's own exclusion table says are baked and never ported, and [handoff](handoff.md) says in as many words: *do not "fix" this by transcribing the painters into Rust*. Same shape as blueprint A's Rapier — an expensive divergence that reads as progress. The real V1 item is the **bake profile** (§5.2) |
| C9 | composite the GUI at `@binding(7)` | **FALSE** | `post/composite.wgsl:88-102` binds 0–5 (5 twice, MSAA-`cfg`d). Next free is **6** |
| C10 | `pk-ab-dungeon` asserts pixel-diff thresholds | **HALF-TRUE, and the half that is false is the gate** | diff stats are printed and **soft**; only console errors are hard. `--strict` is what gates, at `over32Frac > 0.02` (`pk-ab-dungeon.mjs:545`). Nothing runs `--strict` today |
| C11 | deploy via `npm run deploy` to the Synology NAS | **FALSE for this repo** | there is no root `package.json`; `deploy.sh` belongs to `legacy/` (braindeadbot-client's pipeline). PK ships `trunk build` + `xtask dist` |
| C12 | `cargo xtask coverage` reports line coverage | **NOT BUILT** | `xtask/src/main.rs:12-14` dispatches `docs`/`bake`/`dist` only. It is WORK ITEM P-1, unstarted — `scripts/pk-coverage.sh` (new in v2) is its cheap half |
| C13 | track sizes: C 31.7k + V 10k + E 20k + T 4.4k + F/G 5k | **SUMS TO 71.1k against 61.9k remaining** | ~15% over, and C8 is why: V1 counts excluded painter lines as portable work |
| C14 | `economy/tavern-shop.ts` 453 lines | **VERIFIED** | and `economy/` totals 1,338 at **0%** |
| C15 | C4–C5 floor population is 1,276 lines | **VERIFIED** | 388 + 363 + 525 = 1,276 exactly |
| C16 | `hud-face` 1,330 / `cards` 885 / `abilities` 916 | **VERIFIED** | |
| C17 | Windows cross-build clean, wasm passes `pk-check` | **VERIFIED as of the last run** — not a standing property | it is re-established per merge, not inherited ([handoff](handoff.md), B9) |

**What C omits, which matters more than what it got wrong.** Each of these is a
live item in the tree that a reader of C alone would not know exists:

1. **The maze bake does not complete** — one biome exceeds thirteen minutes
   ([handoff](handoff.md)). C's V1 walks straight past the actual blocker and
   proposes the forbidden workaround for it.
2. **The wall wash is unported.** 455 mud / 89 brass / 74 rubber wall tiles on
   L3 carry a surface id nothing paints.
3. **`SURFACE_ALBEDO_LUMA` is calibrated on placeholder albedos** and must be
   re-derived when V1 lands (`dungeon_light.rs` says so at the constant).
4. **The shell input wiring is still open.** The pinball sim verbs are ported
   and the game still only walks — P1's remainder is a *wiring* task C files
   under C6 as if it were the porting task.
5. **The A/B rig cannot grade monsters until they move** — the oracle's zombies
   have left their spawn tiles before the 4.5 s shutter.
6. **Nine `Record<EnemyKind, X>` registries are compile-enforced in TS** and a
   further four are not — `scripts/hooks/registry-drift.mjs` covers the
   `spawnKind` switch, `maze/prefabs.ts`'s biome tables, `EXPANSION_SKIN` vs
   `KIND_PORTRAIT`, and `ESSENTIAL`. Track E inherits thirteen tables, not nine.
7. **X-1/X-2** (§7) — the aspirational chapter that produced blueprint A is
   still in the tree, and the "no third-party physics" decision is still
   unwritten. It has now been proposed twice.

---

## 4. The drift nobody is gating: `braindeadbot-client` vs `legacy/`

Measured 2026-08-11, `diff -rq` over both PK trees:

- **3 source files differ**, and `legacy/` is ahead in all three:
  `boot/sheets.ts` (+4 lines, the spider/goblin/slime/reaper sheet registry),
  `maze/build.ts` (+54, the `bakeMazeSurfaces` seam),
  `maze/track-floor.ts` (+120, the `onPass` harness seam and `PassSnapshot`).
- **2 test files exist only in `legacy/`** (`port-fixtures.test.ts`,
  `port-maze-fixtures.test.ts`) — the exporters. By design.
- **2 forge artifacts exist only in `braindeadbot-client`**
  (`tools/sprite-forge/comfy/bench-dog.json`, `work/beaver/`) — art work, not
  game source.
- `braindeadbot-client`'s PK tree has had **no commit since 2026-08-09**
  (`7937bfe`), the extraction day.

So today the two trees are compatible and `legacy/` is the superset. **Nothing
enforces that.** A single gameplay fix landed in `braindeadbot-client` — the
live game — would silently make the oracle wrong, and every green fixture would
stay green while the port converged on a game that no longer exists.

**WORK ITEM D-1 (do this early; it is an hour):** a drift check in
`.github/workflows/ci.yml` that diffs the two PK trees, ignoring `tools/` and
the two `port-*.test.ts` exporters, and fails on any difference outside a
`legacy-ahead` allowlist. Acceptance: it goes red when a line is changed under
`braindeadbot-client/src/game/pinball-knight`, and green on today's tree.

**ASSUMPTION-2 — `braindeadbot-client` stays frozen for the duration.**
*Risk:* silent oracle rot. *Validation:* D-1 turns the assumption into a gate.

---

## 5. What is left, in the order it gets done

This is [build-out](build-out.md)'s queue with the 1:1 items that page does not
carry folded in. Each item names its acceptance evidence; an item without one is
not startable.

### Stage 1b — the authored floor becomes the dungeon — ✅ **SHIPPED 2026-08-11**

| # | Item | Status / evidence |
|---|---|---|
| 1b-0 | Resolve `plan.rooms == []` on all three exports | ✅ **NOT A DEFECT.** `spawn/floor-authoring.ts:162-171`: room rects are authored in half-scale cell coords on the growing-tree branch ONLY — "a track floor ships neither; decorateMaze's own sparse-region fill covers it" — and `buildTrackFloor` declined 0 times in 400 floors. Their one reader is the minimap outline, which draws none in the oracle either. Pinned by `every_embedded_floor_carries_its_content` |
| 1b-1 | `authored_floor.rs` — loader | ✅ 17 tests. `pk_core::maze::floor_spec::validate_runtime_grid` extracted so both sources get the SAME standability check rather than the authored path fabricating a `TrackFloor` |
| 1b-2 | Authored is the DEFAULT; `--rust-floor` selects the generator; source in the banner and in `__pk.floorSource` | ✅ `pk-check --no-build` ALL GATES PASSED; `--real-floor` ditto |
| 1b-3 | Torches + the **6-light parked pool** | ✅ and it needed a prerequisite nobody had listed — see below |
| 1b-4 | Parts, props, items as per-kind placeholders | ✅ 102 parts / 84 props / 10 items on L3-s1, all on the tiles the oracle chose |
| 1b-5 | Windows exe | ✅ `scripts/pk-win.sh build` green |

**The A/B numbers, before and after** (`pk-ab-dungeon --level 3 --seed 1`, 1920×1080, host Chrome):

| | diff mean | p95 | over32 | our median luma vs oracle's |
|---|---:|---:|---:|---:|
| first sheet | 43.1 | 94 | 58.3% | 23.2 vs 40.7 |
| after the stone fix | **33.1** | **80** | **39.1%** | **40.6 vs 40.7** |

#### Five findings, four of which were wrong assumptions in the plan above

1. **The dungeon's materials were `unlit: true`.** Every wall, floor and shaped
   tile. So "torches are the single largest visible change" was wrong by one
   step: an unlit material ignores every light, and 41 torches would have added
   41 quads and changed nothing. The light rig (`dungeon_light.rs`, a port of
   `boot/lighting.ts`) is the change; the torches are what it reveals.
2. **`solidOut` is absent on ~3 of 4 arcs**, because `tile-shape.ts:226` types it
   `solidOut?: boolean` and `JSON.stringify` drops `undefined`. A required field
   refused every floor. It is also 9 TRUE out of 10 present on L3 — "carries the
   key" and "is solid outside" are two different counts, and the first draft of
   the test asserted the wrong one.
3. **`dirI`/`dirJ` are floats.** A `boostcurve` carries `(0.447, -0.894)` =
   `(1,-2)/√5`. Typed `i32` they refuse the payload; rounded, they point the
   booster somewhere the ball is not thrown.
4. **`circuits[].links` are PARTS, not tiles** — they parse cleanly as tiles
   (both have `i`/`j`) and silently lose the kind and the facing. `Tile` now
   carries `deny_unknown_fields` so that class of error cannot recur.
5. **The floor was too dark because the ALBEDO was wrong, not the light.** The
   oracle bakes the biome's stone into every diffuse map (`build.ts:83-87`,
   `BIOME_STONE` + `css()`), so L3 is deep cold blue; the port's four greys were
   picked to look right unlit and answered to no biome. Porting the remap moved
   our median luma from 23.2 to 40.6 against the oracle's 40.7 — with the light
   rig untouched, which is the evidence that the rig's derivation was right and
   the albedo was the error.

Two instruments had to be repaired as part of this, both because they asked
`__pk.floor` — the GENERATED floor's field, now `null` by default:
`pk-ab-dungeon` accepts either source and reports which, and `pk-check`'s
real-floor gate asks for the generator by name (`&rust-floor=1`) because its
fixture is the generator's digest. **A default flip silently retargets every
gate that hard-codes the old default.**

### 5.1 Stage 1c — the floor is MADE of something, and the horde stands on it — ✅ **SHIPPED 2026-08-11**

The two commits v1 did not know about. Both are in `main`; neither is in
blueprint C.

| # | Item | Status / evidence |
|---|---|---|
| 1c-1 | `grid.surfaces` exported, loaded, washed (`e86b299`) | ✅ **and it was a PHYSICS gap, not only a visual one** — `pk_core::pinball` reads `surface_at` for friction and steering, so until this every tile answered "stone" and a ball crossing the oracle's sand kept stone friction. L3-s1: 624 sand / 440 steel / 462 flowstone floors. A/B 33.1 → 32.0 |
| 1c-2 | `spawn_standing_horde` — one billboard per `plan.spawns` tile (`072b57f`) | ⚠️ **THEY STAND, THEY DO NOT LIVE.** 52/72/105 a floor as one merged mesh. No AI, no flow field, no combat, no death |

⚠️ **Two vocabularies share the byte**: a walkable tile carries a `FLOOR_*` id
and a solid one a `WALL_*` id, numerically overlapping — branch on walkability
before reading it.

### 5.2 The remaining 61,936 lines, as seven tracks that SUM to it

Blueprint C's contribution, corrected. C's five tracks sum to ~71.1k against a
61.9k remainder — ~15% over, because V1 counted the excluded painters as
portable work. This decomposition is built from `scripts/pk-coverage.sh`'s
per-file output and **reconciles exactly**: every uncovered line is in exactly
one track, and the tracks plus the one exclusion add back to 61,936.

| Track | What it is | Lines | Sources |
|---|---|---:|---|
| **C** | generator & content: maze passes 10–23, `decorateMaze`, floor authoring/populate/factory | **9,175** | `maze/` 8,508 + `spawn/` 667 |
| **V** | visuals: parts/monster/prop renderers, FX pools, the sheet registry | **14,230** | `render/` 10,195 (net of `cel-painter`) + `fx/` 2,948 + `boot/` 1,087 |
| **E** | entities, combat, rules: AI, damage, the enemy registries, cards/abilities/items/secrets/boss | **12,247** | `entities/` 6,544 + `constants/` 958 + root rules 4,745 (`abilities` 916, `cards` 885, `boss` 772, `items` 535, `secrets` 409, `bestiary` 379, `zombie-types` 297, `shots` 222, `lamp-puzzle` 173, `skill-runtime` 157) |
| **T** | tavern economy: shop rules and the data tables behind them | **1,845** | `economy/` 1,338 + root tables 507 (`reagents` 147, `recipes` 86, `armor-styles` 127, `card-reader` 147) |
| **F** | HUD, screens, run flow, persistence | **8,597** | `gui/` 4,597 + `run/` 1,036 + root HUD/run 2,964 (`hud-face` 1,330, `map-render` 431, `corpse-run` 295, `fps` 276, `settings-save` 157, `delve` 151, `fog` 120, `run-score` 112, `hud-minimap` 92) |
| **G** | audio synthesis | **780** | `sfx/` |
| **D** | dev surface & engine remainder: `__lab()`, the censuses, profiler, input, testkit | **10,277** | `dev/` 5,298 + `engine/` 2,540 + root misc 2,001 + `testkit/` 292 + `input/` 124 + `sim/` 22 |
| | **subtotal** | **57,151** | |
| — | `render/cel-painter.ts` — baked, never ported (§1) | 4,785 | excluded by decision |
| | **total uncovered** | **61,936** | ✅ reconciles |

**What this decomposition says that a stage list does not:** track **D is the
third-largest**, at 10,277 lines and 2% coverage, and no plan handed in so far
has scheduled it. `dev/window-hooks.ts` alone is the `__lab()` surface — spawn,
ring, floor-jump, the headless bot — which is how every monster gets QA'd and
every future bug gets reported. Porting E without D means porting the horde with
no way to spawn one on demand.

### 5.3 Track C — the generator

Passes 10–23, each 10/10 corpus floors bit-exact at its boundary, each with a
sabotage sweep. Then the `onPass` seam **inside `decorateMaze` before a line of
it is ported** — 3,169 lines with no oracle is the single most expensive mistake
available here. Then `authorFloor`'s remainder, `floor-populate`, `factory`.

Two sabotages ride into pass 13 (`repair-2`): `connect_all` carves nothing at
repair-1 and provably cannot, so "de-stub before connect" and "withhold the
keep-out mask" are un-gated until fillets fill pockets with no degree
constraint.

**C is no longer on the critical path to a playable game.** Authored floors are
the default source (1b-2), so the generator's remaining 14 passes buy *seed
variety*, not a dungeon. Schedule it against that, not against "the floors do
not exist yet".

### 5.4 Track V — and the blocker C walks past

| # | Item | Acceptance evidence |
|---|---|---|
| V-0 | **Profile** the maze bake (`__bakeParts`, per-surface timers), then set the target from the profile | a timing table per surface; the 13-minute biome explained, not guessed. **This is the real V1** — not transcribing the painters (§3.3 C8) |
| V-1 | Finish the bake; wall/floor/cap textures into `dungeon_render.rs`'s existing buckets | A/B sheet + the bake's provenance JSON |
| V-2 | The WALL wash — 455 mud / 89 brass / 74 rubber wall tiles on L3 carry a surface id nothing paints | A/B sheet; bucket key extended by surface id |
| V-3 | Re-derive `SURFACE_ALBEDO_LUMA`, which is calibrated on placeholder albedos | the constant's own comment is the acceptance test |
| V-4 | Architecture, banners, stairs marker; shaped tiles at their real heights; cracked bands as removable meshes | A/B per item |
| V-5 | GUI pixel pass into `composite.wgsl` at **`@binding(6)`** (not 7 — §3.3 C9) | one frame with the GUI cel-graded, screenshotted |

### 5.5 Tracks E / T / F / G / D

- **E** inherits **thirteen** registries, not nine: the nine
  `Record<EnemyKind, X>` tables TypeScript compile-enforces, plus the four
  `scripts/hooks/registry-drift.mjs` covers because `tsc` cannot see them (the
  `spawnKind` switch, `maze/prefabs.ts`'s biome tables, `EXPANSION_SKIN` vs
  `KIND_PORTRAIT`, `ESSENTIAL`). A Rust port turns nine of those into
  exhaustive `match`es for free and the other four into nothing — **they need
  their own test, and the drift hook is the specification.**
- **T** is the cheapest whole track at 1,845 lines and it is **0% covered**
  while `pk-core::gambler` next door is fully ported with 250 tests. The shop
  rules are pure data + predicates: the highest ratio of shipped behaviour to
  ported lines left in the tree.
- **F** owns the persistence decision (native file vs wasm `localStorage`)
  that nothing has made yet.
- **G** is blocked on a rig that does not exist (§6).
- **D** is scheduled nowhere and is a prerequisite for QA'ing E (§5.2).

### 5.6 Blueprint C's three open questions, answered from the tree

1. **"Track C1 first (playable dungeons) or Track V1 first (lose the grey-box
   look)?"** — **Neither. The user settled this on 2026-08-11 and the order is
   by SCENE, not by track:**

   > *"in order finish the intro > finish the tavern > then work on the maze
   > last… we should have finished making the intro accurate with the textures
   > first so we know what order of operations of how to build 1:1 for the
   > rest."*

   **INTRO → TAVERN → MAZE**, each finished 1:1 — art, UI and behaviour —
   before the next one starts, each signed off by an A/B screenshot against the
   oracle. The reasoning is explicit and it is a better argument than the
   track-order one: the intro is the smallest complete scene in the game, so
   **finishing one scene to 1:1 establishes the method** — what "same style"
   means, what the art pipeline costs per asset, what a scene's UI parity gate
   looks like — and that method is what the two larger scenes then follow.
   Track order optimises for line count; scene order optimises for *learning
   the conversion loop on the cheapest possible scene*.

   The track table in §5.2 stays exactly as it is — it is the ledger, and it
   still has to reconcile. What changes is the traversal: scenes are cut
   *across* the tracks (the intro needs its slice of V and F; the tavern needs
   T and F and its own V), so each scene stage below names which track lines it
   burns down.

   Both of C's original options are answered on the way past: C1 does not gate
   playability (§5.3 — the authored floor is already the default source), and
   V1 as C defines it is forbidden work (§3.3 C8).
2. **"Frame drops on the Windows desktop vs WSL2?"** — a real question, and it
   is for the user, not the tree. It is **not blocking**: it should ride along
   with the next exe drop rather than gate a track. The project's own FPS gate
   is `pk-check` on this box (RISK-1).
3. **"Should D-1 run on every push to main?"** — **Yes.** It is a `diff -rq`
   over two trees; it costs seconds, and the failure it catches (silent oracle
   rot, §4) is invisible by construction — every fixture stays green while the
   oracle moves. There is no cheaper gate in the project, and CI can host it
   because it needs no GPU (RISK-1 excludes only the visual gates).

### 5.7 The scene order, and what "finished" means for each

Three stages, in the user's order. **A scene is finished when a side-by-side
A/B sheet against the oracle is signed off — not when its logic is ported.**
That is the whole point of doing the smallest scene first: the intro is where
the cost of "same style" gets measured, before it is paid twice more.

Each stage names the tracks it burns down, so §5.2's ledger stays the ledger.

| Stage | Scene | Burns down | Gate |
|---|---|---|---|
| **2** | **INTRO** — accurate, with its textures | V (sheets/backdrop), F (its own screens) | `scripts/pk-ab-intro.mjs` — **does not exist; building it is item 2-0** |
| **3** | **TAVERN** — every vendor you can walk up to does what the oracle's does | **T entire (1,845)**, F (counter screens), V (keeper paints, sign text) | `pk-ab-tavern.mjs` (exists) + one sheet per counter |
| **4** | **MAZE** — pinball verbs wired, textures, animations, physics | C, V-0…V-5, E | `pk-ab-dungeon.mjs` + `pk-check` |

**Stage 4 is where the four open items the user named land**, and they are
already sized above: *pinball functionality* is P1's shell-wiring remainder
(§3.3 omission 4 — the sim verbs are ported and unbound), *textures for the
map* is V-0/V-1 (blocked on the bake profile, and **not** on transcribing the
painters), *animations* is V + the clip-name interface, *physics hooked up* is
the same wiring as the verbs plus `surface_at`, which 1c-1 already delivered.

Track E's first slice (`pk_core::movement` — the 569-line `MovementKind`
dispatch table, ported behind a trace fixture) is **deferred to Stage 4** by
this decision. It was the right answer to a track-ordering question that the
user has replaced with a scene-ordering one, and it is written down here rather
than discarded because it is still the correct first cut of E when E's turn
comes: `movement.ts` is plain-data in, plain-data out — no `state`, no three,
no grid — and it is the substrate combat, boss phases and all eight zombie
sub-types steer through.

### 5.8 Stage 5 — sweep and cutover

P7 audio/FX remainder behind a spectral-diff rig that does not exist yet; P8
playtest bot, `xtask dist`, deploy; the P-1 ledger at 100%; then legacy is
demoted.

---

## 6. The two gates that must be built before the work they gate

1. **The `decorateMaze` `onPass` seam** (Stage 3). The seam exists in
   `track-floor.ts` **only** — grepped, no other module has one. All 23 green
   boundaries certify a floor's *shape* and nothing standing on it.
2. **The audio spectral diff** (Stage 5). P7 has signed off nothing, because the
   rig does not exist.

The dungeon A/B rig — the third missing gate as of last week — **now exists**
(`scripts/pk-ab-dungeon.mjs`, landed at `6bef067`).

---

## 7. Work items this plan adds

| ID | Item | Why | Acceptance |
|---|---|---|---|
| **P-1** | A provenance ledger: every Rust module carries `//! PORTS: <legacy path>`, and `cargo xtask coverage` emits ported / partial / not-started per legacy file | §2.3's number is an upper bound from a heuristic; 1:1 is not claimable from a heuristic | the tool runs in CI and prints a number that moves only when a file is ported |
| **D-1** | `braindeadbot-client` ↔ `legacy/` drift check in CI | §4 | red on a seeded change, green on today's tree |
| **X-1** | Correct or retire `documentation/chapters/18-rust-webgpu-engine-port.md` | it describes a `pk-render` crate and a Rapier3D physics layer that do not exist — the same two false claims as blueprint A, which is the likeliest place they came from | the chapter's crate tree matches `Cargo.toml` |
| **X-2** | Record the "no third-party physics engine" decision in [architecture](../game/architecture.md) | it has now been proposed twice; an unwritten decision gets re-proposed | a named decision record whose reason is bit-exact replay |
| **I-1** | `scripts/pk-ab-intro.mjs` — the intro's A/B rig, modelled on `pk-ab-tavern.mjs` | Stage 2's gate does not exist, and a scene cannot be signed off by eye ([[by-eye-is-not-a-measurement]]); the tavern and dungeon rigs both had to exist before their scenes could be called done | a sheet at `.checks/ab-intro-*.png` with the same diff statistics the other two rigs print |
| **C-1** | `scripts/pk-coverage.sh` in CI, printing the uncovered total | the number in §2 goes stale the moment it is written — v1's was two commits old within a day | CI prints it per run; a merge that ports a file moves it |

---

## 8. Risks and assumptions

| ID | Statement | Risk | Validation |
|---|---|---|---|
| ASSUMPTION-1 | The coverage table is an upper bound | remaining work under-stated | P-1 |
| ASSUMPTION-2 | `braindeadbot-client` stays frozen | silent oracle rot | D-1 |
| ASSUMPTION-3 | Content parity is verifiable by A/B screenshot alone | a wrong-but-plausible floor passes | grade position and density numerically in the rig, not by eye |
| RISK-1 | Every visual and end-to-end gate needs the host GPU — SwiftShader cannot run the Bevy wasm app at all | CI can never own the visual gate | keep pk-check and both A/B rigs manual on this box; CI owns everything else |
| RISK-2 | Class-2 gates (ported tests) certify silence — a wrong draw order passes | most of Stage 4 | prefer a trace fixture wherever the subsystem is deterministic, which is nearly everywhere |
| RISK-3 | Any call resolving through the target's libc is ungated until it is run on all three targets | a floor that is right on Linux and wrong in the exe | `node scripts/jsmath-wasm-check.mjs` + `cargo test --target x86_64-pc-windows-gnullvm -p pk-core --test jsmath_oracle` whenever a primitive lands |
| RISK-4 | The oracle can be wrong and still be the oracle (pass 2's `radii[0]` tangency defect, 1.81 tiles) | "fixing" it during the port destroys parity | reproduce bit-exactly, pin as its own test, fix after parity is declared |

## 9. Rollback

Every stage is a worktree branch merged `--ff-only`; the rollback is the merge
commit. The two irreversible-shaped moves and their triggers:

- **Authored floors as the default source (1b-2)** — reverts by flipping the
  default back to the generator; the flag stays either way. Trigger: the A/B
  sheet is worse than the generated floor's.
- **Cutover (Stage 5)** — `legacy/` stays in the tree as reference after
  demotion. Nothing is deleted, so the rollback is to re-promote it.

## 10. Self-audit against the VCPM quality gates

- Claims classified: 100% (§3's tables; every §2 number carries its command).
- Unverifiable claims: **0** — B10's "<30 s" and B12's "60 FPS on low-power
  devices" were reclassified as an unmeasured target and an out-of-scope claim
  rather than carried forward as facts.
- Source density: 3 assumptions and 4 risks are labelled; everything else is
  Verified or has a named verification task. **≥80% met.**
- Every implementation item in §5 and §7 has acceptance evidence.
- Version, date, baseline commit and method stamped at the top.
