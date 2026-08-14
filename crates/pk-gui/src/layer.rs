//! GUI and World Multi-Layer Compositing Pipeline.
//!
//! PORTS: `gui/layer.ts`

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RenderPassKind {
    Background,
    WorldGround,
    WorldDecals,
    WorldEntities,
    WorldVfx,
    PostProcess,
    GuiCanvas,
    ModalSheet,
    ToastNotification,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RenderPassEntry {
    pub kind: RenderPassKind,
    pub order: i32,
    pub clear_depth: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayerCompositor {
    pub passes: Vec<RenderPassEntry>,
}

impl Default for LayerCompositor {
    fn default() -> Self {
        Self {
            passes: vec![
                RenderPassEntry {
                    kind: RenderPassKind::Background,
                    order: 0,
                    clear_depth: true,
                    enabled: true,
                },
                RenderPassEntry {
                    kind: RenderPassKind::WorldGround,
                    order: 10,
                    clear_depth: false,
                    enabled: true,
                },
                RenderPassEntry {
                    kind: RenderPassKind::WorldDecals,
                    order: 20,
                    clear_depth: false,
                    enabled: true,
                },
                RenderPassEntry {
                    kind: RenderPassKind::WorldEntities,
                    order: 30,
                    clear_depth: false,
                    enabled: true,
                },
                RenderPassEntry {
                    kind: RenderPassKind::WorldVfx,
                    order: 40,
                    clear_depth: false,
                    enabled: true,
                },
                RenderPassEntry {
                    kind: RenderPassKind::PostProcess,
                    order: 50,
                    clear_depth: false,
                    enabled: true,
                },
                RenderPassEntry {
                    kind: RenderPassKind::GuiCanvas,
                    order: 60,
                    clear_depth: true,
                    enabled: true,
                },
                RenderPassEntry {
                    kind: RenderPassKind::ModalSheet,
                    order: 70,
                    clear_depth: false,
                    enabled: true,
                },
                RenderPassEntry {
                    kind: RenderPassKind::ToastNotification,
                    order: 80,
                    clear_depth: false,
                    enabled: true,
                },
            ],
        }
    }
}

impl LayerCompositor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns all active render passes sorted in strictly ascending execution order.
    pub fn active_passes_sorted(&self) -> Vec<&RenderPassEntry> {
        let mut active: Vec<&RenderPassEntry> = self.passes.iter().filter(|p| p.enabled).collect();
        active.sort_by_key(|p| p.order);
        active
    }

    /// Toggles visibility/execution for a specific render pass kind.
    pub fn set_pass_enabled(&mut self, kind: RenderPassKind, enabled: bool) {
        if let Some(pass) = self.passes.iter_mut().find(|p| p.kind == kind) {
            pass.enabled = enabled;
        }
    }
}
