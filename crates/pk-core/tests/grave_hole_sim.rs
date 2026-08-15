// Parity test suite for Departing Knight Grave Hole Set Piece.
// Replicates legacy/src/game/pinball-knight/run/grave-hole.ts

use pk_core::run::grave_hole::{plan_grave_blast, GraveBlastEnemy, GRAVEPIT_BLAST_DAMAGE};

#[test]
fn grave_blast_damages_living_enemies_within_radius() {
    let center = (10.0, 10.0);
    let enemies = vec![
        GraveBlastEnemy {
            id: 1,
            x: 11.0,
            z: 10.0,
            is_dead: false,
        }, // Distance 1.0 < 3.5 -> Hit
        GraveBlastEnemy {
            id: 2,
            x: 10.0,
            z: 15.0,
            is_dead: false,
        }, // Distance 5.0 > 3.5 -> Miss
        GraveBlastEnemy {
            id: 3,
            x: 10.5,
            z: 10.5,
            is_dead: true,
        }, // Distance 0.71, but dead -> Ignored
    ];

    let hits = plan_grave_blast(center, &enemies);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].enemy_id, 1);
    assert_eq!(hits[0].damage, GRAVEPIT_BLAST_DAMAGE);
    assert!((hits[0].dir_x - 1.0).abs() < 1e-4);
    assert_eq!(hits[0].dir_z, 0.0);
}
