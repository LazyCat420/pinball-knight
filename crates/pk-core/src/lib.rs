//! Pinball Knight simulation core.
//!
//! Bevy-free and GPU-free by design: everything in this crate must be
//! deterministic across native and wasm so golden fixtures exported from the
//! legacy TypeScript game (`legacy/`) replay bit-equal. See the determinism
//! rules in the workspace Cargo.toml.
//!
//! Port order (mirrors the migration plan milestones):
//!   rng      — DONE, pinned against the JS oracle
//!   collide  — M2: engine/{collision,grid,tile-shape,surfaces}.ts
//!   maze     — M3: maze/ generator with PRNG call-order parity
//!   entities — M4: combat, AI, spawn, economy, run
//!   state    — grows alongside; SimState mirrors legacy state.ts

pub mod rng;
