# Architecture decisions

The decisions below were made at migration-planning time (2026-08-09), each
with the reasoning that produced it. Overturning one requires writing down why
here first.

## Sim-as-a-resource, not entity-shredded ECS

`pk_core::simulate(&mut SimState, &FrameInput)` is a pure port of the legacy
`sim/simulate.ts` with its hand-ordered call sequence intact, called from one
Bevy `FixedUpdate` system at 60 Hz. Bevy ECS entities are *views* — renderables
synced from `Sim` with `overstep_fraction()` interpolation.

Why: Bevy's parallel scheduler is nondeterministic in system and query-iteration
order; a deterministic co-op-lockstep sim cannot tolerate that. A single `step`
function also keeps `cargo test -p pk-core` GPU-free and is the shape golden
fixtures need. Pause is a `SimPaused` resource, not Bevy's virtual-time pause
(heat haze keeps animating while menus are open, as in the TS game).

## DECISION: no third-party physics engine

**Status: decided, and re-proposed twice.** Recorded here as a named decision
because an unwritten one gets re-derived — this is work item X-2.

The TS game hand-rolls circle-vs-tile-grid collision with axis-separated
sweep-and-clamp (`legacy/.../engine/collision.ts`), and its BLUEPRINT §1.5
explicitly keeps Rapier/cannon-es "on the shelf". The Rust port keeps that
stance: **no physics crate, while `legacy/` is the oracle.**

**The reason is bit-exact replay, and it is not a preference.** `pk_core`
reproduces the oracle's simulation to the last ulp — gated by the trace
fixtures in `assets/fixtures/`, by ported unit tests, and by a sabotage sweep on
every generator pass. That is only possible because `collide.rs` and
`pinball.rs` are transcriptions, down to the JS engine's own arithmetic via
`pk_core::jsmath` (both `std` and `libm` disagree with V8 by enough to flip a
threshold — see the Incidents chapter on `js_pow`).

A third-party solver has no bit-exact answer to reproduce. Adopting Rapier
would not add physics; it would **invalidate every fixture in the repo**, and
with them the only evidence the port has that it plays like the game it
replaces. It reads as progress and is a week of subtraction.

Both handed-in blueprints that proposed it are triaged in
`status/one-to-one.md` §3.1, and the chapter they came from
(`documentation/chapters/18-rust-webgpu-engine-port.md`) is retracted.

## Registries: the compiler replaces MOST of the drift hook

The nine `Record<EnemyKind, X>` tables become `EnumMap<EnemyKind, X>` +
exhaustive `match`. Adding a kind fails the build at every site.

⚠️ **That does NOT retire `legacy/scripts/hooks/registry-drift.mjs`, and an
earlier version of this page said it did.** The hook exists precisely because
four registries are invisible to `tsc` as well: the `spawnKind` switch, the
biome tables in `maze/prefabs.ts`, `EXPANSION_SKIN` vs `KIND_PORTRAIT`, and
`ESSENTIAL`. Exhaustive `match` reaches the nine and nothing else, so the port
inherits **thirteen** registries and the four leftovers need a Rust test of
their own — for which the hook is the specification.

## GUI: hand-rolled immediate-mode

A `Painter2d` (rect / atlas-sprite / pixel-font text / nine-patch / scissor →
one dynamic mesh per atlas, 2–3 draw calls) so the 7.4k lines of immediate-mode
GUI logic port near-mechanically with the pixel-font look intact. Not bevy_ui
(retained/flexbox = rewrite), not egui for game UI (wrong look). `bevy_egui`
is allowed for dev panels only, feature-gated out of release wasm.

## Audio: WebAudio-shaped, zero files

`pk-audio` mirrors WebAudio vocabulary (oscillator/gain/biquad, param ramps)
because every legacy sfx patch is written in it. Native backend: the
`web-audio-api` crate. wasm backend: the real browser AudioContext via
`web-sys` — parity by definition. Not rodio/bevy_audio (file-playback-shaped,
weak wasm story), not fundsp (would force re-authoring tuned patches).

*Status 2026-08-09: the traits are in place
(`AudioBackend`/`OscillatorNode`/`GainNode`/`AudioParam`) with a native
`web-audio-api` backend and a `web-sys` wasm backend; the Bevy side is
`pk-game/src/sfx.rs`. Not signed off by ear or by spectral diff. The remaining
patch families, the bus/gate, the wasm gesture unlock and the master mute are
P7 work — see the checklist.*

## FX: hand-translated TSL → WGSL, no bevy_hanabi

Custom Bevy `Material`s with storage-buffer instanced particles (a WebGPU-only
win). hanabi would mean translating TSL into its EDSL instead of into WGSL — a
lateral move — and every third-party Bevy crate is a lien against the next Bevy
upgrade. The GreaterDepth silhouette pass ("Diablo trick") is a second knight
material with `depth_compare: Greater`, depth-write off, transparent phase —
scheduled early (M1) to de-risk custom-render.

*Status 2026-08-09: the decision is being exercised — the ember/mote/spark pools
are one instanced additive material (`pk-game/src/fx/`), and the pixel/cel post
chain is hand-written WGSL (`pk-game/src/post/`: low-res target + integer
upscale, half-res bloom, SSAO/sRGB/vignette/cel composite). No hanabi, no
EffectComposer equivalent. The silhouette pass is still unwritten. Neither the
FX nor the post chain has passed a screenshot A/B against the TS game yet.*

## Determinism rules (CI-enforced as they land)

- f64 everywhere in pk-core — JS numbers are f64; f32 silently breaks fixtures.
- Transcendentals via `libm` only, never std.
- No HashMap iteration in sim logic (BTreeMap/IndexMap/slotmap).
- All randomness through the seeded `Mulberry32` in `SimState` — pinned against
  the JS oracle in `pk-core/src/rng.rs`.
- `pk-game` never mutates `Sim` outside the step system.
- PRNG **call order** is part of the contract: one extra draw desyncs everything
  after it. That loudness is the tripwire — keep it.
