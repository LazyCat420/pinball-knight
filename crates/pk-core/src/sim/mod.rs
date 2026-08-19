//! Simulation loop, step coordination, frame orchestration, and pause contracts.
//!
//! PORTS: `sim/paused.ts`

pub mod loop_orchestrator;
pub mod paused;

pub use loop_orchestrator::*;
pub use paused::*;
