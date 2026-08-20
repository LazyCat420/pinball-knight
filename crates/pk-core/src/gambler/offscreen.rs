//! Gambler Offscreen Canvas Seam — Pure RGBA rasterization buffers for pre-baking static minigame art.
//!
//! Port of `legacy/src/scenes/tavern/gambler/offscreen.ts` (27 lines).
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/offscreen.ts`

pub trait OffscreenLike {
    fn width(&self) -> u32;
    fn height(&self) -> u32;
    fn data(&self) -> &[u8];
}

pub type CanvasFactory = fn(u32, u32) -> Box<dyn OffscreenLike>;

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

impl OffscreenLike for OffscreenBuffer {
    fn width(&self) -> u32 {
        self.width
    }
    fn height(&self) -> u32 {
        self.height
    }
    fn data(&self) -> &[u8] {
        &self.data
    }
}

pub fn dom_canvas_factory(w: u32, h: u32) -> Box<dyn OffscreenLike> {
    Box::new(OffscreenBuffer::new(w, h))
}

/// Allocates an offscreen RGBA rasterization backing store.
pub fn allocate_offscreen(w: u32, h: u32) -> OffscreenBuffer {
    OffscreenBuffer::new(w, h)
}
