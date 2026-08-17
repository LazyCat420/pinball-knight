//! Simulation loop, step coordination, frame orchestration, and pause contracts.
//!
//! PORTS: `sim/paused.ts`
//! PORTS-PARTIAL: `sim/loop.ts` - NOT a finished port - 50 rust code lines against 216 legacy (23%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod loop_orchestrator;
pub mod paused;

pub use loop_orchestrator::*;
pub use paused::*;
