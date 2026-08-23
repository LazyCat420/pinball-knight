//! Best-Depth Persistence Store — Offline personal best floor record tracking.
//!
//! PORTS: `best-depth.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct BestDepthStore {
    pub depth: u32,
}

impl BestDepthStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_stored(val: u32) -> Self {
        Self { depth: val }
    }

    /// Highest floor ever reached, or 0 if unknown/unreadable.
    pub fn load_best_depth(&self) -> u32 {
        self.depth
    }

    /// Records a floor if it beats the stored best. Returns true when a new record was set.
    pub fn save_best_depth(&mut self, floor: u32) -> bool {
        if floor == 0 || floor <= self.depth {
            return false;
        }
        self.depth = floor;
        true
    }
}
