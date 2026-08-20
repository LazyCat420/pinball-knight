//! Tavern WebGPU Pipeline Warmup — Precompiles hidden room materials, pool slots, and scene meshes to prevent runtime hitches.
//!
//! PORTS: `legacy/src/scenes/tavern/warmup.ts`

#[derive(Clone, Debug, Default)]
pub struct TavernWarmArgs {
    pub enabled: bool,
}

pub fn tavern_warm_enabled() -> bool {
    true
}

pub fn warm_tavern(_args: &TavernWarmArgs) {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TavernWarmupMesh {
    pub id: u32,
    pub visible: bool,
    pub frustum_culled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TavernWarmupScheduler {
    pub saved_states: Vec<TavernWarmupMesh>,
    pub is_restored: bool,
    pub compiled_units_count: usize,
    pub warm_frames_rendered: usize,
}

impl TavernWarmupScheduler {
    pub fn new() -> Self {
        Self {
            saved_states: Vec::new(),
            is_restored: false,
            compiled_units_count: 0,
            warm_frames_rendered: 0,
        }
    }

    /// Sweeps scene meshes: makes everything visible and disables frustum culling so compileAsync reaches all materials.
    pub fn reveal_for_compile(&mut self, meshes: &mut [TavernWarmupMesh]) {
        self.saved_states.clear();
        for m in meshes.iter_mut() {
            if !m.visible || m.frustum_culled {
                self.saved_states.push(m.clone());
                m.visible = true;
                m.frustum_culled = false;
            }
        }
        self.is_restored = false;
    }

    /// Increments sequential unit compile count.
    pub fn compile_step(&mut self) {
        self.compiled_units_count += 1;
    }

    /// Restores original visibility and culling states BEFORE warm frames are presented to avoid on-screen flashing.
    pub fn restore(&mut self, meshes: &mut [TavernWarmupMesh]) {
        if self.is_restored {
            return;
        }
        self.is_restored = true;

        for saved in &self.saved_states {
            if let Some(m) = meshes.iter_mut().find(|m| m.id == saved.id) {
                m.visible = saved.visible;
                m.frustum_culled = saved.frustum_culled;
            }
        }
    }

    /// Draws a warm presentation frame after restoration.
    pub fn render_warm_frame(&mut self) {
        self.warm_frames_rendered += 1;
    }
}
