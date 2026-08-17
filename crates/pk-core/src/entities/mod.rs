//! Game entities, NPCs, power-up actor simulations, wall erosion, and continuous player locomotion.
//!
//! PORTS: `entities/wall-erosion.ts`
//! PORTS-PARTIAL: `entities/npc.ts` - NOT a finished port - 0 of 7 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `entities/multiball.ts` - NOT a finished port - 1 of 12 exported names carried over (8%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod multiball;
pub mod npc;
pub mod player;
pub mod wall_erosion;

pub use multiball::*;
pub use npc::*;
pub use player::*;
pub use wall_erosion::*;
