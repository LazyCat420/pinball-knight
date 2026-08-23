// Parity test for Pinball Assemblies, Machine Library, and Assembly Placer.
// Replicates legacy/src/game/pinball-knight/maze/assembly.ts, assembly-lib.ts, assembly-place.ts

use pk_core::grid::{at, Grid, T_FLOOR, T_WALL};
use pk_core::maze::assembly::{orientations_of, rotate_assembly, rotate_dir, E, N, S, W};
use pk_core::maze::assembly_lib::{MACHINES, ORBIT, SLING_PAIR};
use pk_core::maze::assembly_place::{can_place_assembly, stamp_assembly};

#[test]
fn rotate_dir_rotates_cardinal_vectors_clockwise() {
    assert_eq!(rotate_dir(N), E);
    assert_eq!(rotate_dir(E), S);
    assert_eq!(rotate_dir(S), W);
    assert_eq!(rotate_dir(W), N);
}

#[test]
fn rotate_assembly_transforms_dimensions_and_components() {
    let machine = ORBIT.clone();
    assert_eq!(machine.w, 4);
    assert_eq!(machine.h, 3);

    // Rotate 90° CW
    let r90 = rotate_assembly(&machine);
    assert_eq!(r90.w, 3);
    assert_eq!(r90.h, 4);

    let booster = &r90.parts[0];
    assert_eq!(booster.ci, 2);
    assert_eq!(booster.cj, 1);
    assert_eq!(booster.dir, S);

    // 4 rotations -> all 8 orientations
    let orients = orientations_of(&machine);
    assert!(!orients.is_empty());
}

#[test]
fn all_library_machines_have_valid_structure() {
    assert_eq!(MACHINES.len(), 8);

    for m in MACHINES.iter() {
        assert!(m.w > 0 && m.h > 0);
        assert!(!m.floor.is_empty());
        assert!(!m.parts.is_empty());
        assert!(!m.ports.is_empty());

        // Ensure all floor tiles sit within [0, w) x [0, h)
        for &(fi, fj) in &m.floor {
            assert!(fi >= 0 && fi < m.w);
            assert!(fj >= 0 && fj < m.h);
        }

        // Ensure all parts sit within bounding box
        for p in &m.parts {
            assert!(p.ci >= 0 && p.ci < m.w);
            assert!(p.cj >= 0 && p.cj < m.h);
        }
    }
}

#[test]
fn stamp_assembly_carves_floor_and_places_parts() {
    let mut g = Grid::solid(20, 20);
    let slingshot = SLING_PAIR.clone();

    assert!(can_place_assembly(&g, &slingshot, 5, 5));

    let parts = stamp_assembly(&mut g, &slingshot, 5, 5);
    assert_eq!(parts.len(), 2);

    // Verify carved floor
    for &(fi, fj) in &slingshot.floor {
        assert_eq!(at(&g, 5 + fi, 5 + fj), T_FLOOR);
    }

    // Uncarved tiles remain wall
    assert_eq!(at(&g, 0, 0), T_WALL);
}
