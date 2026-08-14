// Parity test suite for Progressive Masonry Wall Erosion.
// Replicates legacy/src/game/pinball-knight/entities/wall-erosion.ts

use pk_core::entities::wall_erosion::WallErosionTracker;

#[test]
fn wall_erosion_accumulates_and_smashes_at_one() {
    let mut tracker = WallErosionTracker::new();

    // Hit 1: 0.35 erosion -> not smashed
    let smashed1 = tracker.erode_tile(5, 5, 0.35, 1);
    assert!(!smashed1);
    assert_eq!(tracker.get_erosion(5, 5), 0.35);

    // Hit 2: +0.35 -> 0.70 -> not smashed
    let smashed2 = tracker.erode_tile(5, 5, 0.35, 1);
    assert!(!smashed2);
    assert_eq!(tracker.get_erosion(5, 5), 0.70);

    // Hit 3: +0.35 -> 1.0 -> smashed!
    let smashed3 = tracker.erode_tile(5, 5, 0.35, 1);
    assert!(smashed3);
    assert_eq!(tracker.get_erosion(5, 5), 1.0);
}

#[test]
fn wall_erosion_sags_instance_height() {
    let mut tracker = WallErosionTracker::new();

    let initial_sag = tracker.get_sag(5, 5);
    assert_eq!(initial_sag, 1.0);

    tracker.erode_tile(5, 5, 0.5, 1);
    let mid_sag = tracker.get_sag(5, 5);
    assert!(mid_sag < 1.0 && mid_sag > 0.5);
}

#[test]
fn wall_erosion_clears_lazily_on_floor_change() {
    let mut tracker = WallErosionTracker::new();

    tracker.erode_tile(5, 5, 0.8, 1);
    assert_eq!(tracker.get_erosion(5, 5), 0.8);

    // Advance to floor 2 -> previous floor scars wiped
    tracker.erode_tile(10, 10, 0.2, 2);
    assert_eq!(tracker.get_erosion(5, 5), 0.0);
    assert_eq!(tracker.get_erosion(10, 10), 0.2);
}
