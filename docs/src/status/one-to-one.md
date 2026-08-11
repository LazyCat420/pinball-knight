# The 1:1 plan — what "converted" means, and what is left

**Version 1 · 2026-08-11 · baseline `main` @ `a47a7a8` · method: VCPM
(`.agents/plan-verification-standard.md` in the sun workspace).**
Every number on this page was measured from the tree on that commit, with the
command that produced it named. Nothing here is estimated.

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
| Rust source | 38,411 lines / 6 crates | `find crates/*/src -name '*.rs' \| xargs wc -l` |
| **Legacy lines with NO Rust counterpart** | **63,441 (65%), 206 files** | two-signal scan, §2.3 |
| Maze passes landed | 9 of 23 | `PASSES_LANDED` — `crates/pk-core/src/maze/track_floor.rs:362` |
| Bit-exact fixtures | 10 | `ls assets/fixtures/` |
| Authored floors exported | 3 (L1/L3/L5, seed 1) | `ls assets/floors/` |
| Baked sprite atlases | **0** | `assets/sprites/` is empty; `cargo xtask bake` returns `ExitCode::FAILURE` with "not implemented yet" (`xtask/src/main.rs:59-77`) |
| CI | exists | `.github/workflows/ci.yml` |

The 65% figure was derived independently of the completion plan's "~60k of 104k
remain" and lands on the same answer from the other direction. That is
corroboration, not repetition.

### 2.2 Where the remaining 63k lives

| Legacy dir | Lines | With a Rust counterpart | Coverage |
|---|---:|---:|---:|
| `maze/` | 19,893 | 11,094 | 55% |
| `render/` | 15,231 | 251 | **1%** |
| root (`state.ts`, `cards.ts`, …) | 12,712 | 2,495 | 19% |
| `entities/` | 11,289 | 4,745 | 42% |
| `engine/` | 8,720 | 6,180 | 70% |
| `gui/` | 7,420 | 2,823 | 38% |
| `dev/` | 5,438 | 140 | **2%** |
| `constants/` | 3,906 | 2,948 | 75% |
| `fx/` | 3,817 | 869 | 22% |
| `spawn/` | 1,580 | 388 | 24% |
| `boot/` | 1,479 | 209 | 14% |
| `economy/` | 1,338 | 0 | **0%** |
| `sfx/` | 1,140 | 360 | 31% |
| `intro/` | 1,118 | 1,118 | 100% |
| `run/` | 1,036 | 0 | **0%** |
| `sim/` | 708 | 180 | 25% |
| `testkit/` | 292 | 0 | 0% |
| `input/` | 124 | 0 | 0% |

The twelve largest files with no Rust counterpart — most of the remaining
schedule, in twelve names:

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

**New finding, from measuring the payloads for B2:** `plan.rooms` is **empty on
all three exported floors** (L1, L3, L5), while every other section is populated
— parts 80/102/121, props 63/84/93, spawns 52/72/105, torches 48/41/64, items 10
each, secrets 3/6/8, plazas 3/4/4, circuits 1 each. Rooms are section 1 of
`decorateMaze` and everything after them is seeded by their archetype content.
Either these archetypes author no rooms, or the exporter drops the field.
**Resolve before the loader is written** (WORK ITEM 1b-0) — a loader built
against a payload with a silently missing section will look correct and be
wrong.

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

### Stage 1b — the authored floor becomes the dungeon *(blueprint B, corrected)*

| # | Item | Acceptance evidence |
|---|---|---|
| 1b-0 | Resolve `plan.rooms == []` on all three exports (§3.2) | either the archetypes provably author no rooms, or the exporter is fixed and the floors re-exported |
| 1b-1 | `crates/pk-game/src/authored_floor.rs`: serde structs, `include_str!`, `solidOut`→`solid_out`, `owner: String`→`Option<&'static str>`, default `kicks`/`lanes` empty | `cargo test -p pk-game`; `validate_runtime_floor` passes on L1/L3/L5 |
| 1b-2 | Authored is the DEFAULT source; `--rust-floor` selects the generator; **source printed in the banner** | `pk-check --no-build` green; banner legible in the screenshot |
| 1b-3 | Torches: sconce quad + flame quad per `plan.torches`, **6-light parked pool**, oracle constants from B7 | `pk-ab-dungeon --level 3 --seed 1`; live-light count asserted == 6 in a unit test |
| 1b-4 | Parts, props, items as per-kind placeholder geometry | A/B sheet: position and density match; 102 parts on L3-s1 |
| 1b-5 | `scripts/pk-win.sh build`, then look at the real exe | a screenshot from the Windows build, not the wasm one |

### Stage 2 — the surfaces

| # | Item | Acceptance evidence |
|---|---|---|
| 2-1 | **Profile** the maze bake (`__bakeParts`, per-surface timers), then set the target from the profile | a timing table per surface; the 13-minute biome explained, not guessed |
| 2-2 | Finish the bake; wall/floor/cap textures into `dungeon_render.rs`'s existing buckets | A/B sheet + the bake's provenance JSON |
| 2-3 | V3–V5: architecture/banners/stairs marker; shaped tiles at their real heights; cracked bands as removable meshes | A/B per item |

### Stage 3 — the generator (Track C1)

Passes 10–23, each 10/10 corpus floors bit-exact at its boundary, each with a
sabotage sweep. Then the `onPass` seam **inside `decorateMaze` before a line of
it is ported** — 5.4k lines with no oracle is the single most expensive mistake
available here. Then `authorFloor`'s remainder, `floor-populate`, `factory`.

Two sabotages ride into pass 13 (`repair-2`): `connect_all` carves nothing at
repair-1 and provably cannot, so "de-stub before connect" and "withhold the
keep-out mask" are un-gated until fillets fill pockets with no degree
constraint.

### Stage 4 — the mass nobody has started (§2.2's 0–2% rows)

`entities/` + combat + the nine `Record<EnemyKind,X>` registries (~20k),
`economy/` (1,338, **0%**), `run/` (1,036, **0%**), root `state.ts` / `cards.ts`
/ `abilities.ts` / `items.ts` / `skills.ts` / `secrets.ts`, `hud-face.ts`, the
GUI screens, and `dev/window-hooks.ts` — the `__lab()` surface the entire debug
workflow stands on, 1,054 lines at 2% coverage, and the way every future bug
gets reported.

### Stage 5 — sweep and cutover

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
