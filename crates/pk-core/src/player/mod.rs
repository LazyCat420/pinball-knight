//! Player movement verbs, inputs, inventory, and skill runtime progression.
//!
//! PORTS: `entities/movement.ts`
//! PORTS-PARTIAL: `state.ts` - NOT a finished port - no measurable port behind the claim. Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `skill-runtime.ts` - NOT a finished port - 4 of 12 exported names carried over (33%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod inventory;
pub mod skill_runtime;
pub mod types;
pub mod verbs;

pub use inventory::*;
pub use skill_runtime::*;
pub use types::*;
pub use verbs::*;
