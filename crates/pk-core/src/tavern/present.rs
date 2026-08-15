//! Tavern Frame Presentation Decision Matrix — Resolves what a frame presents (3D scene, UI only, or none).
//!
//! PORTS: `legacy/src/scenes/tavern/present.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresentMode {
    None,
    UiOnly,
    Scene,
}

/// Computes what one tavern frame presents.
/// Invariant: `frozen` never maps to None (ensuring vendor panels & casino games remain interactive).
pub fn present_mode(renderer_ready: bool, frozen: bool) -> PresentMode {
    if !renderer_ready {
        return PresentMode::None;
    }
    if frozen {
        PresentMode::UiOnly
    } else {
        PresentMode::Scene
    }
}
