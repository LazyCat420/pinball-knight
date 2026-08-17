//! Game entities, NPCs, power-up actor simulations, wall erosion, and continuous player locomotion.
//!
//! PORTS: `entities/wall-erosion.ts`, `entities/multiball.ts`
//! PORTS-PARTIAL: `entities/npc.ts` - NOT a finished port - 0 of 7 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod multiball;
pub mod npc;
pub mod player;
pub mod wall_erosion;

pub use multiball::*;
pub use npc::*;
pub use player::*;
pub use wall_erosion::*;
