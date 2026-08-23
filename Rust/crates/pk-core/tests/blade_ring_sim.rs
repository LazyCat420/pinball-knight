// Parity test suite for Orbiting Blade Ring VFX Pool.
// Replicates legacy/src/game/pinball-knight/fx/pools/blade-ring.ts

use pk_core::fx::blade_ring::{BladeRing, BLADE_HOLD, BLADE_MAX};

#[test]
fn blade_ring_initializes_preallocated_instances() {
    let ring = BladeRing::new();
    assert_eq!(ring.meshes.len(), BLADE_MAX);
    assert_eq!(ring.active_count(), 0);
}

#[test]
fn refresh_positions_blades_on_orbit_circumference() {
    let mut ring = BladeRing::new();
    ring.refresh([10.0, 1.0, 20.0], 0.0, 4, 5.0, 0xffaa00, || 0.5);

    assert_eq!(ring.active_count(), 4);
    assert_eq!(ring.hold, BLADE_HOLD);

    // Blade 0 at angle 0.0 -> x + 5.0, z
    let b0 = &ring.meshes[0];
    assert!((b0.pos[0] - 15.0).abs() < 1e-4);
    assert!((b0.pos[2] - 20.0).abs() < 1e-4);

    // Blade 2 at angle PI -> x - 5.0, z
    let b2 = &ring.meshes[2];
    assert!((b2.pos[0] - 5.0).abs() < 1e-4);
    assert!((b2.pos[2] - 20.0).abs() < 1e-4);

    // Blade 4 and 5 remain inactive
    assert!(!ring.meshes[4].visible);
    assert!(!ring.meshes[5].visible);
}

#[test]
fn update_auto_hides_blades_when_hold_expires() {
    let mut ring = BladeRing::new();
    ring.refresh([0.0, 0.0, 0.0], 0.0, 3, 2.0, 0xffffff, || 0.5);
    assert_eq!(ring.active_count(), 3);

    ring.update(0.05);
    assert_eq!(ring.active_count(), 3);

    ring.update(0.10); // Total 0.15 > 0.12 -> expired
    assert_eq!(ring.active_count(), 0);
}
