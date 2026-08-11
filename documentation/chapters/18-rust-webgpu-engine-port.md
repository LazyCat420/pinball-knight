# Rust / WebGPU Engine Architecture & Asset Baking

**Status: `IN PROGRESS` (2026-08-10)** · Produces: Rust native & WASM/WebGPU renderer for Pinball Knight.

> **Summary**: Pinball Knight is transitioning from the legacy TypeScript canvas/WebGPU prototype to a high-performance Rust workspace (`crates/pk-game`, `crates/pk-assets`, `crates/pk-render`).

---

## 1. Rust Workspace Crates

- `crates/pk-game` — Main game loop, Bevy ECS integration, input, physics, and state machines.
- `crates/pk-assets` — Manifest schema parser (`published` legacy sheets vs `baked` per-rung atlas pages).
- `xtask` — Cargo task runner (`cargo xtask bake`, `cargo xtask docs`, `cargo xtask dist`).

---

## 2. Asset Pipeline & Baking

1. **Published Legacy Manifests**:
   - Reside in `legacy/public/sprites/<name>-<dir>.json` and `<name>-<dir>.png`.
   - Contain matted source sheets, grid pitches, and clip cell rects.

2. **Baked Atlases (`cargo xtask bake`)**:
   - Pre-packs and pre-crushes per-rung atlas pages into `assets/sprites/rung-<N>/manifest.json`.
   - Loaded natively by `pk-assets` crate at runtime.

---

## 3. Running & Building

- **Native Windows Cross-Build**:
  ```bash
  cargo run --release --target x86_64-pc-windows-gnullvm -p pk-game
  ```
- **WASM WebGPU Build**:
  ```bash
  cargo xtask dist
  ```
