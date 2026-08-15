// Parity test suite for WebGPU Render Backend Selector.
// Replicates legacy/src/render/backend.ts

use pk_gui::render_backend::select_backend;

#[test]
fn webgpu_backend_strict_selection() {
    let hw = select_backend(false);
    assert_eq!(hw.backend, "webgpu");
    assert!(!hw.is_software_adapter);
    assert!(hw.adapter_info.contains("Discrete Hardware"));

    let sw = select_backend(true);
    assert_eq!(sw.backend, "webgpu");
    assert!(sw.is_software_adapter);
    assert!(sw.adapter_info.contains("Software CPU"));
}
