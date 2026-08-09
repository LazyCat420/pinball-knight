#!/usr/bin/env bash
# Cargo runner for the windows-gnullvm target: `cargo run --target
# x86_64-pc-windows-gnullvm -p pk-game` lands here with the exe path as $1.
# The exe needs libunwind.dll beside it (baked-in import in the prebuilt
# gnullvm std; missing = silent exit 53), then WSL2 interop launches it on
# the Windows desktop.
set -euo pipefail
EXE="$1"; shift
cp -u "$HOME/.local/opt/llvm-mingw/x86_64-w64-mingw32/bin/libunwind.dll" "$(dirname "$EXE")/"
exec "$EXE" "$@"
