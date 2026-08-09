# pinball-knight

⚔️ **Pinball Knight** — a pinball game built with Rust and WebGPU.

Play as the guardian knight who deflects the pinball using flippers, scores points by hitting magical bumpers, and defends the table from the eternal siege!

## Features

- **Rust + WebGPU** rendering via [`wgpu`](https://wgpu.rs/)
- Physics simulation: gravity, wall/bumper/flipper collisions
- Knight character with sword & shield (celebration animations on bumper hits)
- Score bar and life-orb HUD
- Runs natively on desktop **and** in the browser via WebAssembly

## Controls

| Key | Action |
|-----|--------|
| `←` / `Z` / `Left Shift` | Left flipper |
| `→` / `X` / `Right Shift` | Right flipper |
| `Space` / `Enter` | Start game / launch ball |

## Building — Desktop (native)

```bash
cargo run --release
```

Requires a GPU with Vulkan, Metal, or DX12 support.

## Building — Web (WebAssembly)

Install `wasm-pack`:

```bash
cargo install wasm-pack
```

Build the WASM package:

```bash
wasm-pack build --target web
```

Then serve `index.html` with any static file server, e.g.:

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

WebGPU is currently available in Chrome 113+ and Edge 113+ (enable in Firefox Nightly with a flag).

## Running Tests

```bash
cargo test
```

## Project Structure

```
src/
  lib.rs       — crate root, WASM entry point
  main.rs      — native binary entry point
  game.rs      — App / window / event loop (winit)
  physics.rs   — Vec2, Ball, Flipper, Bumper, Wall, PhysicsWorld
  renderer.rs  — wgpu surface setup, geometry builders, render loop
  shader.rs    — WGSL vertex + fragment shader sources
index.html     — Browser shell for the WASM build
```

## License

MIT
