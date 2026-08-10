# Pinball Knight

A 3D top-down dungeon crawler with pinball movement — bumpers, springs, kickers,
rails, marble momentum — being ported from TypeScript/Three.js (WebGPU) to
**Rust + Bevy**. Targets: the web (wasm, WebGPU-only) and Steam (native).

## Quick start

The Windows-native **exe is the play/dev target**: it cross-builds from WSL2 and
interop launches it on the Windows desktop, on the host GPU.

```sh
scripts/setup-win-toolchain.sh   # once — user-local llvm-mingw + the gnullvm target
scripts/pk-win.sh run            # cross-build pk-game.exe, then play it
scripts/pk-win.sh run --release  # same, optimized (use this for any perf number)
scripts/pk-win.sh lldb           # rust-lldb — on the native LINUX build (same sim)
```

- `setup-win-toolchain.sh` unpacks llvm-mingw into `~/.local/opt/llvm-mingw` (no
  sudo) and adds `x86_64-pc-windows-gnullvm`. It `cd`s into the repo first on
  purpose: `rustup target add` run from anywhere else installs the target onto
  `stable` instead of the pinned 1.94.1, and the build then dies with E0463.
- Every build copies `libunwind.dll` beside the exe. Rust's prebuilt gnullvm std
  bakes in that import, so a missing DLL is a silent exit 53 (`0xC0000135`).
- `pk-win.sh` forwards no game flags. To pass them, use plain cargo — the
  `runner` in `.cargo/config.toml` does the same DLL + interop dance:
  `cargo run --target x86_64-pc-windows-gnullvm -p pk-game -- --dungeon`.

Web, gates and chores:

```sh
trunk serve                       # http://localhost:8787 — open in WINDOWS HOST Chrome
node scripts/pk-check.mjs         # the parity gate (add --no-build to reuse web/dist)
cargo test                        # workspace tests: determinism pins, fixtures, manifests
cargo xtask docs                  # mdbook serve --open — port plan, status board, incidents
cargo xtask bake --tavern         # bake the tavern art via the legacy painters
cd legacy && npm ci && npm test   # the TS oracle (metered — see legacy/scripts/ops)
```

WebGPU needs a secure context, which `localhost` is. **Host Chrome only**:
headless SwiftShader cannot run this app at all (it fails a 4-byte mapped
buffer — `docs/src/status/incidents.md`), and WSLg/llvmpipe numbers are mirages.
`pk-check` runs `trunk build`, serves `web/dist`, drives real host Chrome over
CDP (boot, sim rate, input, intro, tavern, console-clean) and writes screenshots
to `.checks/`; exit 0 means every gate passed.

## Flags & keys

Boot flow: **intro → tavern hub → DESCEND board → dungeon floor**.

| Native | Web | What |
|---|---|---|
| `--tavern` · `PK_SCENE=tavern` | `?tavern=1` | boot straight into the hub |
| `--dungeon` · `PK_SCENE=dungeon` | `?dungeon=1` | dev hatch: skip the hub, build a floor |
| `--no-intro` · `PK_NO_INTRO=1` | `?no-intro=1` · `?autostart=1` | skip the title sequence |
| `PK_MUTE=1` | `?mute=1` | silence the synth — **planned, not wired yet** |

Keys: **WASD/arrows** move · **Shift** sprint (tavern) · **E** interact /
DESCEND · **Esc** close panel · **T** dungeon → tavern. Bottom-right shows how
old the running build is; top-center shows frame time.

## Layout

| Path | What |
|---|---|
| `crates/pk-core` | The deterministic sim: maze gen, collision, entities, tavern, intro. Bevy-free, GPU-free. |
| `crates/pk-assets` | Sprite/atlas manifest schema (the art contract). |
| `crates/pk-game` | The Bevy app: render, post chain, input, GUI, fx — the playable slice. |
| `crates/pk-audio` | WebAudio-shaped synth layer (zero audio files — everything is synthesized). |
| `xtask` | `cargo xtask <docs\|bake\|dist>`. |
| `legacy/` | The full TypeScript game + sprite-forge, extracted from braindeadbot-client **with history**. It is the port oracle (its 2,600+ tests stay green) and the permanent art-authoring toolchain. |
| `assets/` | Baked per-rung sprite atlases + golden fixtures. |
| `docs/` | mdbook — architecture, port status, incidents. `cargo xtask docs`. |

## Ground rules

- **Determinism**: pk-core is f64 + `libm` only, seeded PRNG only, no HashMap
  iteration in sim logic. Golden fixtures exported from `legacy/` must replay
  bit-equal, native and wasm.
- **WebGPU-only** on the web — no WebGL2 fallback (house policy carried from
  the TS game).
- **Parity before improvement**: no intentional behavior changes until the port
  reaches parity (M7). The legacy suite is the spec.

Full dev environment (metering, loops, toolchain traps):
[`docs/src/reference/dev-env.md`](docs/src/reference/dev-env.md). The migration
plan, phase checklist and status board live in the docs book (`cargo xtask docs`).
