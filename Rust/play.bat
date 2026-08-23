@echo off
REM Pinball Knight Windows Batch Launcher
cargo run --release --target x86_64-pc-windows-gnullvm -p pk-game -- %*
