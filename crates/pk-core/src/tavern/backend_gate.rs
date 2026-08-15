//! Tavern Backend Initialization Gate — Drives WebGPU startup with safety timeouts and error catches.
//!
//! PORTS: `legacy/src/scenes/tavern/backend-gate.ts`

pub const WARM_BUDGET_MS: u64 = 5000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackendGateOutcome {
    Ready { warmed: bool },
    Failed { error: String },
}

/// Drives backend initialization. Enforces that exactly one outcome is settled and never hangs indefinitely.
pub fn open_backend_gate(
    init_res: Result<(), &str>,
    warm_duration_ms: Option<u64>,
    budget_ms: Option<u64>,
) -> BackendGateOutcome {
    if let Err(err) = init_res {
        return BackendGateOutcome::Failed {
            error: err.to_string(),
        };
    }

    let budget = budget_ms.unwrap_or(WARM_BUDGET_MS);
    let warmed = if let Some(duration) = warm_duration_ms {
        duration <= budget
    } else {
        false
    };

    BackendGateOutcome::Ready { warmed }
}
