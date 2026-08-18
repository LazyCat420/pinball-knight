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
//! PORTS: `economy/shop.ts`, `engine/gamepad.ts`, `settings-save.ts`, `best-depth.ts`, `GameEngine.ts`
//! PORTS-PARTIAL: `playtest-bot.ts` - NOT a finished port - 0 of 4 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `coop.ts` - NOT a finished port - 85 rust code lines against 336 legacy (25%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `core.ts` - NOT a finished port - 72 rust code lines against 352 legacy (20%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
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

pub mod abilities;
pub mod best_depth;
pub mod bestiary;
pub mod boot;
pub mod boss;
pub mod camera;
pub mod cards;
pub mod collide;
pub mod combat;
pub mod combo;
pub mod config;
pub mod constants;
pub mod coop;
pub mod debug;
pub mod dev;
pub mod dungeon_session;
pub mod economy;
pub mod enemies;
pub mod enemy_rules;
pub mod engine;
pub mod entities;
pub mod flow_field;
pub mod fps;
pub mod fx;
pub mod gambler;
pub mod game_engine;
pub mod grid;
pub mod hazards;
pub mod input;
pub mod intro;
pub mod items;
pub mod jsmath;
pub mod jssort;
pub mod marble;
pub mod maze;
pub mod monsters;
pub mod movement;
pub mod pinball;
pub mod player;
pub mod playtest_bot;
pub mod profiler;
pub mod projectiles;
pub mod rail;
pub mod reagents;
pub mod recipes;
pub mod ricochet;
pub mod rng;
pub mod run;
pub mod secrets;
pub mod settings_save;
pub mod sim;
pub mod skills;
pub mod spawn;
pub mod stagger;
pub mod state;
pub mod surfaces;
pub mod tavern;
pub mod tile_shape;
pub mod zombie_ai;
pub mod zombie_types;

pub use best_depth::*;
pub use coop::*;
pub use dungeon_session::*;
pub use game_engine::*;
pub use playtest_bot::*;
pub use settings_save::*;
pub use sim::*;
