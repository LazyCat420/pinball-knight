# Dev environment (WSL2, shared box)

## Run the game

- **Rust, Windows native (the play/dev target):**
  `cargo run --target x86_64-pc-windows-gnullvm -p pk-game` — plain cargo;
  the `runner` in `.cargo/config.toml` (`scripts/win-runner.sh`) drops
  `libunwind.dll` beside the exe and WSL2 interop launches it as a real
  Windows process on the host GPU. No browser, no port forwarding. One-time
  toolchain setup: `scripts/setup-win-toolchain.sh` (user-local llvm-mingw).
  `scripts/pk-win.sh run [--release]` is the shorthand for the same thing
  (`build` stops after the exe; `--release` must follow the subcommand).
  It passes **no arguments through to the game** — to boot with `--tavern` /
  `--dungeon` / `--no-intro`, use the plain-cargo form with `-- <flags>`.
  Why the DLL dance: Rust's prebuilt gnullvm std bakes in the dynamic
  import, and a missing DLL dies silently as exit 53 (`0xC0000135`
  STATUS_DLL_NOT_FOUND). The in-game frame-time readout sits top-center
  (ms + fps, smoothed); the build-age stamp sits bottom-right (`build.rs`
  emits `PK_BUILD_EPOCH` at compile time, so it answers "am I looking at a
  stale window?" — it refreshes when **pk-game** recompiles, not when a
  pk-core-only edit relinks it).
- **Rust, browser (the parity gate + web ship):** `trunk serve` at the repo
  root, then open `http://localhost:8787` in **Windows host Chrome** (WebGPU;
  localhost forwards from WSL2, and localhost is a secure context, which
  WebGPU requires). `Trunk.toml` binds `0.0.0.0` so the WSL IP works when
  localhost forwarding flakes. WASD/arrows to move.
- **Rust, WSLg window:** `cargo run -p pk-game` (WSLg/X11 — fine for
  correctness, never for perf numbers).
- **Legacy TS game (the oracle):** `cd legacy && npm run dev`, open
  `http://localhost:5174`. Full game: monsters, combat, floors, forge.
- Headless wasm verification: real host Chrome over CDP via
  `legacy/scripts/lib/host-chrome.mjs` — SwiftShader cannot run this app
  (see Incidents).

### Boot flags & keys

Boot order is hub-first: **intro → tavern → DESCEND board → dungeon floor**.
Native reads argv/env; wasm reads the query string (`main.rs::dungeon_boot_gate`,
`tavern::tavern_boot_gate`, `pk_core::intro::should_skip_intro`).

| Native | Web | Effect |
|---|---|---|
| `--tavern`, `PK_SCENE=tavern` | `?tavern=1` | boot into the hub |
| `--dungeon`, `PK_SCENE=dungeon` | `?dungeon=1` | dev hatch — skip the hub, build a floor (this is what pk-check's sim/input gates use) |
| `--no-intro`, `PK_NO_INTRO=1` | `?no-intro=1`, `?autostart=1` | skip the title sequence; a skipped intro still lands in the tavern |
| `PK_MUTE=1` | `?mute=1` | silence the synth — **planned, not wired yet**: no `mute` gate exists in `crates/` as of this writing, so setting it does nothing |
| — | `window.__skipDungeonIntro`, `prefers-reduced-motion` | also skip the intro (legacy contract) |

Keys: WASD/arrows move · Shift sprints (tavern movement only — the dungeon
`FrameInput` has no sprint axis yet) · E interacts / DESCENDs · Escape closes
the open panel · T returns to the tavern from the dungeon (the stand-in for the
P5 run flow).

### The browser gate: `node scripts/pk-check.mjs`

Runs `trunk build` (skip with `--no-build`), serves `web/dist` on :8791, and
drives **real Windows host Chrome** over CDP: wasm boots and `window.__pk`
publishes, sim ticks 45–75 Hz, scripted input moves the knight, an rAF FPS
sample (reported, not yet budget-gated), the intro phase/skip gates, the tavern
gates (boot, movement, station focus, panel open/close, walk to the DESCEND
board, hand-off to a live dungeon sim), and a zero-console-errors gate over all
of it. Screenshots land in `.checks/` (gitignored) as
`pk-check-*.png`, `pk-intro-title-*.png`, `pk-tavern-*.png`. Exit 0 = every gate
passed; non-zero = the port regressed; exit 2 = the harness itself broke.

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

## The Windows toolchain, concretely

- Tarball: llvm-mingw `20260616` ucrt, unpacked to `~/.local/opt/llvm-mingw`
  by `scripts/setup-win-toolchain.sh` (idempotent — it no-ops if
  `bin/x86_64-w64-mingw32-clang` is already there).
- Linker is pinned by absolute path in `.cargo/config.toml`
  (`[target.x86_64-pc-windows-gnullvm] linker = …/bin/x86_64-w64-mingw32-clang`),
  so a toolchain installed anywhere else needs that line edited.
- The DLL lives at
  `~/.local/opt/llvm-mingw/x86_64-w64-mingw32/bin/libunwind.dll`; both
  `pk-win.sh` and `win-runner.sh` `cp -u` it next to the exe on every build.
- `rust-toolchain.toml` pins Rust **1.94.1** and declares both targets
  (`wasm32-unknown-unknown`, `x86_64-pc-windows-gnullvm`) — which is why
  `rustup target add` must run *inside* the repo (outside, it lands on
  `stable` and the build fails with E0463 "can't find crate for `std`").
- Output: `target/x86_64-pc-windows-gnullvm/{debug,release}/pk-game.exe`.
  There is no shared `CARGO_TARGET_DIR`, so **each git worktree builds its own
  `target/`** — a fresh worktree pays a full cold build (and a full disk copy
  of it).

## The box is shared

Heavy runs must not take every core. `.cargo/config.toml` caps build jobs at
10 (raise per-invocation with `-j` only when you hold the box); the legacy suite
meters itself through `legacy/scripts/ops/pk-run.sh` (flock'd thread budget;
exit 75 = "never started", not a red suite). Check
`cd legacy && npm run ops:status` before big runs. Wrap `wasm-opt` and release
builds with the same courtesy.

`pk-check` is also exclusive in practice: it attaches to the **one** real host
Chrome (`legacy/scripts/lib/host-chrome.mjs`) and binds :8791, so two concurrent
runs fight over the browser and the port. Run it alone, and don't trust FPS from
a run that shared the box with a build.

## Legacy toolchain

- `cd legacy && npm ci` once; `npm test` = the oracle suite (~131 s metered).
- `legacy/forge-dev.sh` starts the Next dev server + `/forge` UI for art
  authoring. ComfyUI backend expected at `~/comfy/` (start: `~/comfy/run.sh
  -d`); without it the forge API routes 404 by design.
- The debug surface (`__lab()`, `__dungeonBot()`, floor lock, etc.) is
  documented in the legacy tree and keeps working under the legacy dev server.
