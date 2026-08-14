//! Floor pipeline warm-up scheduler — precompiles render pipelines during loading.
//!
//! PORTS: `boot/warmup.ts`

pub const DEFAULT_MAX_GROUP_SIZE: usize = 16;

#[derive(Clone, Debug, PartialEq)]
pub struct WarmupUnit {
    pub id: usize,
    pub name: String,
    pub is_leaf: bool,
    pub compiled: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WarmupScheduler {
    pub units: Vec<WarmupUnit>,
    pub current_idx: usize,
    pub max_group_size: usize,
}

impl Default for WarmupScheduler {
    fn default() -> Self {
        Self {
            units: Vec::new(),
            current_idx: 0,
            max_group_size: DEFAULT_MAX_GROUP_SIZE,
        }
    }
}

impl WarmupScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds an individual item or mesh to the compilation queue.
    pub fn add_item(&mut self, name: &str) {
        let id = self.units.len();
        self.units.push(WarmupUnit {
            id,
            name: name.to_string(),
            is_leaf: true,
            compiled: false,
        });
    }

    /// Adds a group of objects. If the group has more than `max_group_size` children,
    /// it decomposes the group into granular leaf units to prevent loading bar stalls.
    pub fn add_group(&mut self, group_name: &str, child_count: usize) {
        if child_count <= self.max_group_size {
            self.add_item(group_name);
        } else {
            for i in 0..child_count {
                let leaf_name = format!("{}/part_{}", group_name, i);
                self.add_item(&leaf_name);
            }
        }
    }

    /// Adds representative invisible pool instances so their shaders compile before first trigger.
    pub fn add_representative_pool_reveals(&mut self) {
        let pool_types = [
            "fx_pool/slash",
            "fx_pool/bolt",
            "fx_pool/ring",
            "fx_pool/blade",
            "fx_pool/sigil",
            "fx_pool/damage_number",
            "fx_pool/floor_fx_blood",
            "fx_pool/floor_fx_fire",
            "fx_pool/floor_fx_acid",
            "fx_pool/floor_fx_ice",
            "fx_pool/floor_fx_tar",
        ];

        for &fx in &pool_types {
            self.add_item(fx);
        }
    }

    /// Compiles the next unit in the queue. Returns progress [0.0..1.0] or `None` if finished.
    pub fn tick(&mut self) -> Option<f32> {
        if self.current_idx >= self.units.len() {
            return None;
        }

        self.units[self.current_idx].compiled = true;
        self.current_idx += 1;

        Some(self.progress())
    }

    /// Computes the fractional progress [0.0..1.0].
    pub fn progress(&self) -> f32 {
        if self.units.is_empty() {
            1.0
        } else {
            (self.current_idx as f32) / (self.units.len() as f32)
        }
    }

    /// Returns whether all warmup units have finished compiling.
    pub fn is_complete(&self) -> bool {
        self.current_idx >= self.units.len()
    }
}
