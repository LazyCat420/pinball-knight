#!/usr/bin/env bash
# Windows-native build/run/debug — the day-to-day play loop.
#
#   scripts/pk-win.sh build [--release]   cross-compile pk-game.exe
#   scripts/pk-win.sh run   [--release]   build, then launch on the Windows
#                                         desktop (WSL2 interop; host GPU)
#   scripts/pk-win.sh lldb  [bin]         rust-lldb on the native LINUX build
#                                         (same sim; see note below)
#
# Prereq once: scripts/setup-win-toolchain.sh
#
# libunwind.dll: Rust's prebuilt gnullvm std is compiled against the
# libunwind IMPORT library, so the DLL reference is baked in — a `-static`
# link flag cannot remove it (measured: exit 53 = 0xC0000135
# STATUS_DLL_NOT_FOUND). The DLL ships next to the exe instead.
set -euo pipefail
cd "$(dirname "$0")/.."

TOOLCHAIN="$HOME/.local/opt/llvm-mingw"
TARGET=x86_64-pc-windows-gnullvm
CMD="${1:-run}"; shift || true

PROFILE=debug
CARGO_FLAGS=()
if [ "${1:-}" = "--release" ]; then PROFILE=release; CARGO_FLAGS=(--release); shift; fi

case "$CMD" in
build|run)
    [ -x "$TOOLCHAIN/bin/x86_64-w64-mingw32-clang" ] || {
        echo "toolchain missing — run scripts/setup-win-toolchain.sh first" >&2; exit 1; }
    cargo build --target $TARGET -p pk-game "${CARGO_FLAGS[@]}"
    OUT="target/$TARGET/$PROFILE"
    cp -u "$TOOLCHAIN/x86_64-w64-mingw32/bin/libunwind.dll" "$OUT/"
    echo "built $OUT/pk-game.exe"
    if [ "$CMD" = run ]; then
        # WSL2 interop launches it as a real Windows process on the host GPU.
        exec "$OUT/pk-game.exe"
    fi
    ;;
lldb)
    # Interactive debugging happens on the native Linux build: the sim
    # (pk-core) is deterministic across targets by design, and the Linux
    # lldb here cannot attach to a Windows process. lldb ships in the
    # llvm-mingw tarball; rust-lldb just needs it on PATH. For VSCode,
    # point the lldb-dap extension at $TOOLCHAIN/bin/lldb-dap.
    BIN="${1:-}"
    if [ -z "$BIN" ]; then
        cargo build -p pk-game
        BIN=target/debug/pk-game
    fi
    PATH="$TOOLCHAIN/bin:$PATH" exec rust-lldb "$BIN"
    ;;
*)
    echo "usage: $0 {build|run|lldb} [--release]" >&2; exit 2
    ;;
esac
