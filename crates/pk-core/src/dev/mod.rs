//! Developer tooling, diagnostic harnesses, testing overrides, diagnostic bundle entries, ghost workbench floors, headless floor generation, circuit census, mega floors, monster lab, floor SVG export, FX lab, debug actions, doorway funnel census, pattern diversity census, and window dev hooks.
//!
//! PORTS: `dev/floor-lock.ts`, `dev/mega-entry.ts`, `dev/ghost-maze.ts`, `dev/headless-floor.ts`, `dev/circuit-census.ts`, `dev/mega-floor.ts`, `dev/monster-lab.ts`, `dev/floor-svg.ts`, `dev/fx-lab.ts`
//! PORTS-PARTIAL: `dev/ghost-command.ts` - NOT a finished port - 11 rust code lines against 53 legacy (21%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `dev/debug-actions.ts` - NOT a finished port - 46 rust code lines against 200 legacy (23%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `dev/funnel-census.ts` - NOT a finished port - 41 rust code lines against 326 legacy (13%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `dev/pattern-census.ts` - NOT a finished port - 71 rust code lines against 699 legacy (10%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `dev/window-hooks.ts` - NOT a finished port - 56 rust code lines against 631 legacy (9%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod circuit_census;
pub mod debug_actions;
pub mod floor_lock;
pub mod floor_svg;
pub mod funnel_census;
pub mod fx_lab;
pub mod ghost_command;
pub mod ghost_maze;
pub mod headless_floor;
pub mod mega_entry;
pub mod mega_floor;
pub mod monster_lab;
pub mod pattern_census;
pub mod window_hooks;

pub use circuit_census::*;
pub use debug_actions::*;
pub use floor_lock::*;
pub use floor_svg::*;
pub use funnel_census::*;
pub use fx_lab::*;
pub use ghost_command::*;
pub use ghost_maze::*;
pub use headless_floor::*;
pub use mega_entry::*;
pub use mega_floor::*;
pub use monster_lab::*;
pub use pattern_census::*;
pub use window_hooks::*;
