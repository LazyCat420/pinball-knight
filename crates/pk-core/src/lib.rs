//! Pinball Knight simulation core.
//!
//! Bevy-free and GPU-free by design: everything in this crate must be
//! deterministic across native and wasm so golden fixtures exported from the
//! legacy TypeScript game (`legacy/`) replay bit-equal. See the determinism
//! rules in the workspace Cargo.toml.
//!
//! Port order (mirrors the migration plan milestones):
//!   rng      — DONE, pinned against the JS oracle
//!   grid     — DONE (engine/grid.ts)
//!   collide  — square-wall path DONE with ported tests; shaped tiles
//!              (slants/arcs/kick bands/lanes) land with tile-shape in M2
//!   state    — seed of state.ts/simulate.ts: player movement at fixed 60 Hz
//!   maze     — M3: maze/ generator with PRNG call-order parity
//!   entities — M4: combat, AI, spawn, economy, run

pub mod collide;
pub mod grid;
pub mod rng;
pub mod state;
pub mod surfaces;
pub mod tile_shape;
