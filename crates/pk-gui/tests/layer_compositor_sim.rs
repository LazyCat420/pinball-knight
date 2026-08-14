// Parity test suite for GUI and World Layer Compositor.
// Replicates legacy/src/game/pinball-knight/gui/layer.ts

use pk_gui::layer::{LayerCompositor, RenderPassKind};

#[test]
fn layer_compositor_orders_passes_strictly_ascending() {
    let compositor = LayerCompositor::new();
    let passes = compositor.active_passes_sorted();

    assert_eq!(passes.len(), 9);
    for window in passes.windows(2) {
        assert!(window[0].order < window[1].order);
    }

    assert_eq!(passes[0].kind, RenderPassKind::Background);
    assert_eq!(passes[passes.len() - 1].kind, RenderPassKind::ToastNotification);
}

#[test]
fn disabling_render_pass_omits_from_execution_list() {
    let mut compositor = LayerCompositor::new();
    compositor.set_pass_enabled(RenderPassKind::PostProcess, false);

    let passes = compositor.active_passes_sorted();
    assert_eq!(passes.len(), 8);
    assert!(!passes.iter().any(|p| p.kind == RenderPassKind::PostProcess));
}
