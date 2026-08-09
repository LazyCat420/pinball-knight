#!/usr/bin/env bash
# One-time setup for the Windows-native build (no sudo needed).
#
# Installs the llvm-mingw cross toolchain user-locally and adds the Rust
# x86_64-pc-windows-gnullvm target to the repo's pinned toolchain. The same
# tarball also provides lldb/lldb-dap/lldb-server, which is what makes
# rust-lldb work on this box (see docs: reference/dev-env.md).
#
# Why gnullvm and not msvc/cargo-xwin: xwin needs system clang-cl/lld-link
# (sudo), and rustup's plain windows-gnu std ships only crt objects — its
# link step needs a full mingw install (sudo again). llvm-mingw is a single
# self-contained tarball in ~/.local/opt.
set -euo pipefail

VER=20260616
DEST="$HOME/.local/opt/llvm-mingw"
URL="https://github.com/mstorsjo/llvm-mingw/releases/download/${VER}/llvm-mingw-${VER}-ucrt-ubuntu-22.04-x86_64.tar.xz"

if [ -x "$DEST/bin/x86_64-w64-mingw32-clang" ]; then
    echo "llvm-mingw already at $DEST"
else
    mkdir -p "$HOME/.local/opt"
    echo "downloading llvm-mingw ${VER} (~150 MB)..."
    curl -sL "$URL" | tar xJ -C "$HOME/.local/opt"
    rm -rf "$DEST"
    mv "$HOME/.local/opt/llvm-mingw-${VER}-ucrt-ubuntu-22.04-x86_64" "$DEST"
    echo "installed $DEST"
fi

# rust-toolchain.toml pins the toolchain; run from the repo so the target
# lands on the PINNED toolchain, not the default one (that bit us once:
# `rustup target add` outside the repo installed to `stable` and the build
# died with E0463 "can't find crate for std").
cd "$(dirname "$0")/.."
rustup target add x86_64-pc-windows-gnullvm

echo "OK — build with: scripts/pk-win.sh build"
