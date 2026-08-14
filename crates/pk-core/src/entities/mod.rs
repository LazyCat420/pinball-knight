//! Game entities, NPCs, power-up actor simulations, and wall erosion.
//!
//! PORTS: `entities/npc.ts`, `entities/multiball.ts`, `entities/wall-erosion.ts`

pub mod multiball;
pub mod npc;
pub mod wall_erosion;

pub use multiball::*;
pub use npc::*;
pub use wall_erosion::*;
