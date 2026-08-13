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
//!
//! ## Lints this crate turns off, and why it is not laziness
//!
//! Most of what is here is a TRANSCRIPTION. The unit of review is a diff
//! against a specific `.ts` file, read side by side, hunting for the one line
//! that draws in a different order — and idiomatic Rust actively works against
//! that reading. These are switched off crate-wide rather than sprinkled at
//! call sites so the rule is stated once, where the reason lives.
//!
//! Nothing here is a correctness lint. Anything that could change a digest
//! stays on, and CI runs clippy at deny level per crate.
//!
//! PORTS:
#![allow(
    // `for i in 0..STATIONS.len()` mirrors `for (let i = 0; i < …; i++)`. The
    // iterator rewrite is better Rust and worse evidence: several of these
    // loops index two arrays at once or run a triangular `i+1..` pair scan, and
    // the enumerate/skip forms obscure exactly the ordering the port is being
    // checked for.
    clippy::needless_range_loop,
    // Ported functions keep the argument lists their TS originals have. Bundling
    // them into structs is a refactor to do AFTER parity is declared, not while
    // the two sides are being diffed.
    clippy::too_many_arguments
)]

pub mod bestiary;
pub mod cards;
pub mod collide;
pub mod combo;
pub mod economy;
pub mod enemies;
pub mod flow_field;
pub mod gambler;
pub mod grid;
pub mod intro;
pub mod items;
pub mod jsmath;
pub mod jssort;
pub mod maze;
pub mod movement;
pub mod pinball;
pub mod rail;
pub mod reagents;
pub mod recipes;
pub mod rng;
pub mod secrets;
pub mod state;
pub mod surfaces;
pub mod tavern;
pub mod tile_shape;
pub mod zombie_types;

