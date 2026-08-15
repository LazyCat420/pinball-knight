//! Game entities, NPCs, power-up actor simulations, wall erosion, and continuous player locomotion.
//!
//! PORTS: `entities/npc.ts`, `entities/multiball.ts`, `entities/wall-erosion.ts`, `entities/player.ts`

pub mod multiball;
pub mod npc;
pub mod player;
pub mod wall_erosion;

pub use multiball::*;
pub use npc::*;
pub use player::*;
pub use wall_erosion::*;
