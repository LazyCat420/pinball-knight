// Parity test suite for Renderer Boot Gate.
// Replicates legacy/src/game/pinball-knight/boot/renderer.ts

use pk_gui::boot::renderer::{is_renderer_ready, present_ui_frame, RendererBootState};

#[test]
fn renderer_boot_state_and_ui_present_gate() {
    let mut state = RendererBootState::new();
    assert!(!is_renderer_ready(&state));
    assert!(!present_ui_frame(&state));

    // Ready but no pixel pass
    state.set_ready(true);
    assert!(is_renderer_ready(&state));
    assert!(!present_ui_frame(&state));

    // Pixel pass active
    state.pixel_pass_active = true;
    assert!(present_ui_frame(&state));

    // Teardown
    state.set_ready(false);
    assert!(!present_ui_frame(&state));
}
