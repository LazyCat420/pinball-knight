// Parity test suite for Tavern Frame Presentation Decision Matrix.
// Replicates legacy/src/scenes/tavern/present.ts

use pk_core::tavern::present::{present_mode, PresentMode};

#[test]
fn present_mode_decisions_match_specification() {
    // Unready renderer always drops presentation
    assert_eq!(present_mode(false, false), PresentMode::None);
    assert_eq!(present_mode(false, true), PresentMode::None);

    // Normal rendering
    assert_eq!(present_mode(true, false), PresentMode::Scene);

    // Critical Invariant: Frozen NEVER maps to None — it maps to UiOnly
    assert_eq!(present_mode(true, true), PresentMode::UiOnly);
}
