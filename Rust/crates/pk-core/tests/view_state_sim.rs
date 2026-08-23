// Parity test suite for Engine View State Model.
// Replicates legacy/src/game/pinball-knight/engine/view-state.ts

use pk_core::engine::view_state::EngineViewState;

#[test]
fn engine_view_state_initializes_and_resets_scalars() {
    let mut state = EngineViewState::new();
    assert_eq!(state.cam_x, 0.0);
    assert_eq!(state.cam_z, 0.0);
    assert_eq!(state.shake_t, 0.0);
    assert_eq!(state.hitstop_t, 0.0);

    state.cam_x = 120.5;
    state.cam_z = -45.0;
    state.shake_t = 0.35;
    state.hitstop_t = 0.08;

    state.reset_view_scalars();
    assert_eq!(state.cam_x, 0.0);
    assert_eq!(state.cam_z, 0.0);
    assert_eq!(state.shake_t, 0.0);
    assert_eq!(state.hitstop_t, 0.0);
}
