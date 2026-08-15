//! 🍺 THE TAVERN — the walkable between-floor hub (P6).
//!
//! Port of `legacy/src/scenes/tavern/` minus the renderer: the floor plan,
//! the movement step, the diorama read, the keeper idle loops, the camera
//! targeting, room geometry, pipeline warmup, and the join board are all here, deterministic and testable.
//!
//! PORTS: `legacy/src/scenes/tavern/layout.ts`, `legacy/src/scenes/tavern/player.ts`, `legacy/src/scenes/tavern/npcs.ts`, `legacy/src/scenes/tavern/join-board.ts`, `legacy/src/scenes/tavern/build.ts`, `legacy/src/scenes/tavern/warmup.ts`

pub mod build;
pub mod camera;
pub mod join_board;
pub mod layout;
pub mod npcs;
pub mod player;
pub mod state;
pub mod warmup;

pub use build::*;
pub use camera::*;
pub use join_board::*;
pub use layout::*;
pub use npcs::*;
pub use player::*;
pub use state::*;
pub use warmup::*;
