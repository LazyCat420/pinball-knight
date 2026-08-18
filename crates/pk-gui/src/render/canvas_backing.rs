//! Canvas Backing Store Allocation Policy — Guarantees backing buffer allocation before GPU upload.
//!
//! PORTS: `engine/render/canvas-backing.ts`

/// Allocates an RGBA backing buffer of the given dimensions, initialized to fully transparent zeroes.
///
/// Prevents WebGPU `CopyExternalImageToTexture` failures on freshly created or resized surfaces.
pub fn allocate_canvas_backing(width: u32, height: u32) -> Vec<u8> {
    let size = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    vec![0u8; size]
}

pub fn force_backing_store(width: u32, height: u32) -> Vec<u8> {
    allocate_canvas_backing(width, height)
}
