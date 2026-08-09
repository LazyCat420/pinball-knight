# Dev environment (WSL2, shared box)

## Run the game

- **Rust, browser (the real target):** `trunk serve` at the repo root, then
  open `http://localhost:8787` in **Windows host Chrome** (WebGPU; localhost
  forwards from WSL2). WASD/arrows to move.
- **Rust, native window:** `cargo run -p pk-game` (WSLg/X11 — fine for
  correctness, never for perf numbers).
- **Legacy TS game (the oracle):** `cd legacy && npm run dev`, open
  `http://localhost:5174`. Full game: monsters, combat, floors, forge.
- Headless wasm verification: real host Chrome over CDP via
  `legacy/scripts/lib/host-chrome.mjs` — SwiftShader cannot run this app
  (see Incidents).

## Loops

- **Logic loop** — `cargo test -p pk-core`: GPU-free, WSL-native, seconds.
  This is where most port hours live; keep it that way (pk-core never depends
  on Bevy or wgpu).
- **Visual loop** — `trunk serve` in WSL → open from **Windows host Chrome**
  (WSL2 localhost forwarding; fall back to binding 0.0.0.0 + the WSL IP).
- **Perf numbers only count** from host Chrome (wasm) or host-native builds.
  WSLg/llvmpipe and SwiftShader are wrong-perf mirages — the TS project
  learned this the hard way; it is codified here so it isn't relearned.
- Native Windows builds (also the Steam artifact): `cargo-xwin` targeting
  `x86_64-pc-windows-msvc`, run on the host.

## The box is shared

Heavy runs must not take every core. `.cargo/config.toml` caps build jobs at
10; the legacy suite meters itself through `legacy/scripts/ops/pk-run.sh`
(flock'd thread budget; exit 75 = "never started", not a red suite). Check
`cd legacy && npm run ops:status` before big runs. Wrap `wasm-opt` and release
builds with the same courtesy.

## Legacy toolchain

- `cd legacy && npm ci` once; `npm test` = the oracle suite (~131 s metered).
- `legacy/forge-dev.sh` starts the Next dev server + `/forge` UI for art
  authoring. ComfyUI backend expected at `~/comfy/` (start: `~/comfy/run.sh
  -d`); without it the forge API routes 404 by design.
- The debug surface (`__lab()`, `__dungeonBot()`, floor lock, etc.) is
  documented in the legacy tree and keeps working under the legacy dev server.
