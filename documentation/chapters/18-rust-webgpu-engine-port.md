---
part: Archive
status: abandoned
updated: 2026-08-11
---

# Chapter 18 — TS-to-Rust/WebGPU Conversion Blueprint · **RETRACTED**

**Status: `RETRACTED` (2026-08-11).** This chapter described a workspace that
does not exist and a physics design that was refused. It is kept as a stub
rather than deleted because deleting it would not stop it being re-derived —
it has already produced two handed-in blueprints that had to be triaged and
rejected, and a reader who finds nothing here will simply write it a third time.

**What to read instead**, all of it measured against the tree:

| Question | Page |
|---|---|
| what "converted" means, and how much is left | `docs/src/status/one-to-one.md` |
| what state each subsystem is in | `docs/src/status/port-checklist.md` |
| what gets built next | `docs/src/status/build-out.md` |
| where the baton is right now | `docs/src/status/handoff.md` |
| the crate layout, and the physics decision | `docs/src/game/architecture.md` |

## What this chapter got wrong, claim by claim

Every row was checked against the tree on 2026-08-11. The full triage, with
evidence for each, is `one-to-one.md` §3.1.

| Claim here | Reality |
|---|---|
| a `crates/pk-render/` holds the shaders | No such crate. Members are `pk-core`, `pk-jsmath-probe`, `pk-assets`, `pk-audio`, `pk-game`, `pk-gui`, `xtask`. Shaders live in `crates/pk-game/src/post/`. |
| **physics is Rapier3D** (`RigidBody::Dynamic`, `Collider::ball`, a `pk-game/src/physics.rs`) | **Refused — see below.** `rapier` appears in no `Cargo.toml` and not in `Cargo.lock`. There is no `physics.rs`. Collision is `pk_core::collide`, a line-for-line port of `engine/collision.ts`. |
| the maze is generated in `BoardGen.ts`, via cellular automata or a BSP tree | No such file and no such symbol in `legacy/src`. The real path is `maze/track-floor.ts buildTrackFloor`: a physarum circuit, a track path, then 23 carve/repair passes. |
| generation belongs in Bevy systems | `pk-core` is deliberately Bevy-free and GPU-free so the generator can be replayed headless against a digest. `pk-game` is the shell. |
| the grid is `Vec<Vec<TileType>>` | `pk_core::grid::Grid` is a row-major flat `Vec<u8>` plus parallel `shapes`/`surfaces` — the JS layout, which is what makes the digests comparable at all. |
| `TextureAtlasSprite`, `SpatialBundle`, `InstancedMesh` | None of the three exist in Bevy 0.17 (`InstancedMesh` is a three.js type). `TextureAtlasLayout` does. |
| `pk-assets` should be a Bevy `AssetLoader` | It depends on `serde` only, deliberately. Art is embedded with `include_bytes!` in `pk-game`, which is what makes native and wasm load identically. |

## The decision this chapter kept proposing away (X-2)

**Pinball Knight uses NO third-party physics engine, and this is not
negotiable while `legacy/` is the oracle.**

The port's central guarantee is bit-exact replay: `pk_core` reproduces the
oracle's simulation to the last ulp, gated by trace fixtures in
`assets/fixtures/` and by sabotage sweeps on every generator pass. That is only
possible because the collision and pinball code is a transcription of
`engine/collision.ts` and `entities/pinball.ts` — including the JS engine's own
arithmetic, via `pk_core::jsmath`, because `libm` and `std` each disagree with
V8 in ways that flip a threshold.

A third-party solver has no bit-exact answer to reproduce. Adopting Rapier
would not "add physics"; it would **invalidate every fixture in the repo** and
delete the only evidence the port has that it plays like the game it is
replacing. It reads as progress and is a week of subtraction.

Recorded here, and in `docs/src/game/architecture.md`, because an unwritten
decision gets re-proposed — this one now twice.
