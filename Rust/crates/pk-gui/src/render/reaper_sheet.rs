//! Lazy Reaper Sprite Sheet Cache — On-demand atlas rasterization when Death Dealer appears.
//!
//! PORTS: `render/reaper-sheet.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct ReaperSheetCache {
    atlas_id: Option<u32>,
}

impl ReaperSheetCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether the reaper sheet atlas has been rasterized and cached.
    pub fn is_initialized(&self) -> bool {
        self.atlas_id.is_some()
    }

    /// Returns the cached atlas ID or initializes it using the provided builder.
    pub fn get_or_init<F: FnOnce() -> u32>(&mut self, builder: F) -> u32 {
        match self.atlas_id {
            Some(id) => id,
            None => {
                let id = builder();
                self.atlas_id = Some(id);
                id
            }
        }
    }

    /// Resets the cache (e.g. for texture reload / session end).
    pub fn reset(&mut self) {
        self.atlas_id = None;
    }
}
