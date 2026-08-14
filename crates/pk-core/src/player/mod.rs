//! Player movement verbs, inputs, and state management.
//!
//! PORTS: `entities/movement.ts`, `entities/combat.ts`, `state.ts`

pub mod inventory;
pub mod types;
pub mod verbs;

pub use inventory::*;
pub use types::*;
pub use verbs::*;
