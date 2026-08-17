//! ARPG combat engine, damage scaling, stagger interrupts, and rewards.
//!
//! Port of `legacy/src/game/pinball-knight/entities/combat.ts` (1,204 lines).
//!
//! PORTS: `entities/combat.ts`

pub mod combo;
pub mod damage;
pub mod loot;
pub mod stagger;

pub use combo::*;
pub use damage::*;
pub use loot::*;
pub use stagger::*;
