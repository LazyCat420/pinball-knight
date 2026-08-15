//! Gambler Offscreen Canvas Seam — Pure RGBA rasterization buffers for pre-baking static minigame art.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/offscreen.ts`

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OffscreenBuffer {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl OffscreenBuffer {
    pub fn new(width: u32, height: u32) -> Self {
        let byte_len = (width as usize) * (height as usize) * 4;
        Self {
            width,
            height,
            data: vec![0u8; byte_len],
        }
    }
}

/// Allocates an offscreen RGBA rasterization backing store.
pub fn allocate_offscreen(w: u32, h: u32) -> OffscreenBuffer {
    OffscreenBuffer::new(w, h)
}
