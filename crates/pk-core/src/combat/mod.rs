//! ARPG combat engine, damage scaling, stagger interrupts, and rewards.
//!
//! PORTS-PARTIAL: `entities/combat.ts` - NOT a finished port - 0 of 22 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod combo;
pub mod damage;
pub mod loot;
pub mod stagger;

pub use combo::*;
pub use damage::*;
pub use loot::*;
pub use stagger::*;
