// Parity test suite for Canvas Backing Store Allocation Policy.
// Replicates legacy/src/game/pinball-knight/engine/render/canvas-backing.ts

use pk_gui::render::canvas_backing::allocate_canvas_backing;

#[test]
fn canvas_backing_allocates_exact_rgba_bytes() {
    let buf = allocate_canvas_backing(10, 20);
    assert_eq!(buf.len(), 10 * 20 * 4);
    assert!(buf.iter().all(|&b| b == 0));

    let empty = allocate_canvas_backing(0, 0);
    assert_eq!(empty.len(), 0);
}
