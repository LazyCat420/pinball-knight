// Parity test suite for UI Scroll Region Geometry Probe.
// Replicates legacy/src/game/pinball-knight/gui/screens/scroll-probe.ts

use pk_gui::im::Rect;
use pk_gui::screens::scroll_probe::ScrollProbe;

#[test]
fn scroll_probe_tracks_clips_and_offsets() {
    let mut probe = ScrollProbe::new();

    // 1. Outside clip scope -> geometry not recorded in region_bottom
    probe.mark(0.0, 100.0);
    assert_eq!(probe.region_bottom, 0.0);

    // 2. Enter clip scope
    probe.rect(Rect {
        x: 10.0,
        y: 20.0,
        w: 400.0,
        h: 300.0,
    });
    probe.clip();
    assert_eq!(probe.clips.len(), 1);
    assert_eq!(probe.clips[0].w, 400.0);

    // 3. Inside clip scope -> region bottom updates
    probe.mark(50.0, 150.0); // bottom = 200.0
    assert_eq!(probe.region_bottom, 200.0);

    probe.mark(100.0, 250.0); // bottom = 350.0
    assert_eq!(probe.region_bottom, 350.0);

    // 4. Translate records inverted shift
    probe.translate(75.0);
    assert_eq!(probe.shifts, vec![-75.0]);

    // 5. Restore exits clip scope
    probe.restore();
    probe.mark(500.0, 500.0);
    assert_eq!(probe.region_bottom, 350.0); // Ignored after restore
}
