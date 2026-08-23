// Parity test suite for Centralized Input Ownership Manager.
// Replicates legacy/src/utils/input-manager.ts

use pk_core::input::input_manager::InputOwnerState;

#[test]
fn input_owner_state_capture_and_release() {
    let mut state = InputOwnerState::new();
    assert!(!state.is_owned());
    assert_eq!(state.get_owner(), None);

    state.set_owner("pinball-table");
    assert!(state.is_owned());
    assert_eq!(state.get_owner(), Some("pinball-table"));

    state.clear_owner();
    assert!(!state.is_owned());
    assert_eq!(state.get_owner(), None);
}
