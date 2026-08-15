// Parity test suite for Gambler Offscreen Canvas Seam.
// Replicates legacy/src/scenes/tavern/gambler/offscreen.ts

use pk_core::gambler::offscreen::allocate_offscreen;

#[test]
fn allocate_offscreen_generates_exact_rgba_capacity() {
    let buf = allocate_offscreen(64, 32);
    assert_eq!(buf.width, 64);
    assert_eq!(buf.height, 32);
    assert_eq!(buf.data.len(), 64 * 32 * 4);

    // Verify all bytes are zero-initialized
    assert!(buf.data.iter().all(|&b| b == 0));
}
