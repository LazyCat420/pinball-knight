// Parity test suite for Floor Loading Descent Delegate.
// Replicates legacy/src/game/pinball-knight/floor-loading.ts

use pk_gui::floor_loading::{is_floor_loading_open, open_floor_loading};

#[test]
fn floor_loading_handle_lifecycle_and_progress() {
    let mut handle = open_floor_loading(4);
    assert_eq!(handle.level, 4);
    assert!(is_floor_loading_open(&handle));
    assert_eq!(handle.progress, 0.0);

    // 50% progress
    handle.update_progress(0.5, 1.0);
    assert!((handle.progress - 0.5).abs() < 1e-6);
    assert!(is_floor_loading_open(&handle));

    // Clamped progress
    handle.update_progress(1.5, 1.0);
    assert_eq!(handle.progress, 1.0);

    // Close screen
    handle.close();
    assert!(!is_floor_loading_open(&handle));
}
