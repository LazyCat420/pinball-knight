// Parity test suite for Tavern Backend Initialization Gate.
// Replicates legacy/src/scenes/tavern/backend-gate.ts

use pk_core::tavern::backend_gate::{open_backend_gate, BackendGateOutcome, WARM_BUDGET_MS};

#[test]
fn backend_init_failure_triggers_failed_outcome() {
    let outcome = open_backend_gate(Err("WebGPU context lost"), None, None);
    assert_eq!(
        outcome,
        BackendGateOutcome::Failed {
            error: "WebGPU context lost".to_string(),
        }
    );
}

#[test]
fn warmup_within_budget_settles_as_warmed_ready() {
    let outcome = open_backend_gate(Ok(()), Some(3500), Some(WARM_BUDGET_MS));
    assert_eq!(outcome, BackendGateOutcome::Ready { warmed: true });
}

#[test]
fn warmup_exceeding_budget_still_settles_ready_for_lazy_render() {
    let outcome = open_backend_gate(Ok(()), Some(6000), Some(WARM_BUDGET_MS));
    assert_eq!(outcome, BackendGateOutcome::Ready { warmed: false });
}
