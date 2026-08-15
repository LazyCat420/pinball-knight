//! Engine boot sequences, callback bus wiring, run seed parameters, and initialization.
//!
//! PORTS: `boot/wiring.ts`, `boot/seed-param.ts`

pub mod seed_param;
pub mod wiring;

pub use seed_param::*;
pub use wiring::*;
