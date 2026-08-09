# Dev environment (WSL2, shared box)

## Run the game

- **Rust, Windows native (the play/dev target):** `scripts/pk-win.sh run` —
  cross-compiles `pk-game.exe` (`x86_64-pc-windows-gnullvm`, user-local
  llvm-mingw; one-time `scripts/setup-win-toolchain.sh`) and launches it as a
  real Windows process on the host GPU via WSL2 interop. No browser, no port
  forwarding. `libunwind.dll` must sit next to the exe (the script copies
  it): Rust's prebuilt gnullvm std bakes in the dynamic import, and a missing
  DLL dies silently as exit 53 (`0xC0000135` STATUS_DLL_NOT_FOUND).
- **Rust, browser (the parity gate + web ship):** `trunk serve` at the repo
  root, then open `http://localhost:8787` in **Windows host Chrome** (WebGPU;
  localhost forwards from WSL2). WASD/arrows to move.
- **Rust, WSLg window:** `cargo run -p pk-game` (WSLg/X11 — fine for
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
- **Perf numbers only count** from host Chrome (wasm) or the Windows-native
  exe. WSLg/llvmpipe and SwiftShader are wrong-perf mirages — the TS project
  learned this the hard way; it is codified here so it isn't relearned.
- **Debugging:** `scripts/pk-win.sh lldb [bin]` runs `rust-lldb` against the
  native **Linux** build — pk-core is deterministic across targets by
  design, so sim bugs reproduce there, and a Linux lldb cannot attach to a
  Windows process anyway. lldb 22 ships inside the llvm-mingw tarball
  (`~/.local/opt/llvm-mingw/bin`); VSCode users: point the lldb-dap
  extension at `.../bin/lldb-dap`.
- Toolchain choice, for the record: `cargo-xwin`/msvc needs system
  clang-cl + lld-link (sudo we don't have), and rustup's plain
  `windows-gnu` std ships only crt startup objects — the link needs a full
  mingw install. llvm-mingw + `gnullvm` is one user-local tarball, and the
  same tarball supplies lldb. A fresh cross build of pk-game is ~2 min.

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
