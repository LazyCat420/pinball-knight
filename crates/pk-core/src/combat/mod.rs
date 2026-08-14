//! ARPG combat engine, damage scaling, stagger interrupts, and rewards.
//!
//! PORTS: `entities/combat.ts`

pub mod damage;
pub mod loot;
pub mod stagger;

pub use damage::*;
pub use loot::*;
pub use stagger::*;
