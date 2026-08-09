# Pinball Knight

A 3D top-down dungeon crawler with pinball movement — bumpers, springs, kickers,
rails, marble momentum — being ported from TypeScript/Three.js (WebGPU) to
**Rust + Bevy**. Targets: the web (wasm, WebGPU-only) and Steam (native).

## Layout

| Path | What |
|---|---|
| `crates/pk-core` | The deterministic sim: maze gen, collision, entities. Bevy-free, GPU-free. |
| `crates/pk-assets` | Sprite/atlas manifest schema (the art contract). |
| `crates/pk-game` | The Bevy app: render, input, GUI, fx. |
| `crates/pk-audio` | WebAudio-shaped synth layer (zero audio files — everything is synthesized). |
| `xtask` | `cargo xtask <docs\|bake\|dist>`. |
| `legacy/` | The full TypeScript game + sprite-forge, extracted from braindeadbot-client **with history**. It is the port oracle (its 2,600+ tests stay green) and the permanent art-authoring toolchain. |
| `assets/` | Baked per-rung sprite atlases + golden fixtures. |
| `docs/` | mdbook — architecture, port status, incidents. `cargo xtask docs`. |

## Quick start

```sh
cargo test                 # workspace tests (pk-core determinism pins, manifest parsing)
cargo run -p pk-game       # headless scaffold app (window/render lands in M1)
cargo xtask docs           # serve the docs book locally
cd legacy && npm ci && npm test   # the TS oracle (metered; see legacy/scripts/ops)
```

## Ground rules

- **Determinism**: pk-core is f64 + `libm` only, seeded PRNG only, no HashMap
  iteration in sim logic. Golden fixtures exported from `legacy/` must replay
  bit-equal, native and wasm.
- **WebGPU-only** on the web — no WebGL2 fallback (house policy carried from
  the TS game).
- **Parity before improvement**: no intentional behavior changes until the port
  reaches parity (M7). The legacy suite is the spec.
- The full migration plan and milestone board live in the docs book.
