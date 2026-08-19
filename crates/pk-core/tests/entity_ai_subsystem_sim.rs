// Comprehensive simulation test suite for Entity & AI Subsystem Cluster.
// Replicates legacy/src/game/pinball-knight/entities/npc.ts, entities/multiball.ts, bestiary.ts

use std::collections::HashMap;

use pk_core::bestiary::*;
use pk_core::entities::multiball::*;
use pk_core::entities::npc::*;
use pk_core::grid::Grid;
use pk_core::rng::Mulberry32;
use pk_core::state::{EnemyKind, SimState};

#[test]
fn npc_spawning_and_lifecycle() {
    let mut sim = SimState::new(Grid::solid(20, 20), (5.0, 5.0), 12345);
    let mut rng = Mulberry32::new(12345);

    spawn_frog(&mut sim, 5, 5);
    spawn_merchant(&mut sim, 10, 10);
    spawn_witch(&mut sim, 2.5, 3.5);

    assert_eq!(sim.npcs.len(), 3);
    assert_eq!(sim.npcs[0].kind, "frog");
    assert_eq!(sim.npcs[1].kind, "merchant");
    assert_eq!(sim.npcs[2].kind, "witch");

    let clock = roll_magician_clock(&mut rng);
    assert!(clock >= MAGICIAN_PERIOD - MAGICIAN_JITTER);
    assert!(clock <= MAGICIAN_PERIOD + MAGICIAN_JITTER);

    dispose_npcs(&mut sim);
    assert_eq!(sim.npcs.len(), 0);
}

#[test]
fn multiball_trail_and_echo_target_sampling() {
    let mut trail = Vec::new();
    push_trail(&mut trail, 0.0, 0.0, 0.0, MULTIBALL_TRAIL_SECONDS);
    push_trail(&mut trail, 5.0, 0.0, 0.5, MULTIBALL_TRAIL_SECONDS);
    push_trail(&mut trail, 10.0, 0.0, 1.0, MULTIBALL_TRAIL_SECONDS);

    let sample = sample_trail(&trail, 0.25).expect("sampled point");
    assert!((sample.0 - 2.5).abs() < 1e-4);
    assert!((sample.1 - 0.0).abs() < 1e-4);

    let target = echo_target(&trail, 1.0, 0.5, 1.0, 0.1).expect("echo target");
    assert!((target.0 - 5.0).abs() < 1e-4);
    // Offset sideways
    assert!((target.1 - 1.0).abs() < 1e-4 || (target.1 - (-1.0)).abs() < 1e-4);

    let mut echoes = spawn_multiball(0.0, 0.0);
    let mut clock = 1.0;
    update_multiball(&mut echoes, &mut trail, &mut clock, 12.0, 0.0, 0.1);
    assert!(echoes[0].x > 0.0);
}

#[test]
fn bestiary_metadata_and_progression_calculations() {
    assert_eq!(KIND_IDS.len(), 16);
    let info = kind_info_for(EnemyKind::Zombie);
    assert_eq!(info.label, "Zombie");

    let mut kills = HashMap::new();
    kills.insert("zombie".to_string(), 12);
    kills.insert("spider".to_string(), 5);

    let progress = bestiary_progress(&kills);
    assert_eq!(progress.0, 2);
    assert_eq!(progress.1, 16);

    let milestone = family_milestone(12);
    assert!(milestone.tier >= 1);
    assert!(milestone.affinity > 1.0);

    let bestiary = build_bestiary(&kills);
    assert_eq!(bestiary.len(), 16);
    let zombie_entry = bestiary.iter().find(|e| e.kind == EnemyKind::Zombie).unwrap();
    assert!(zombie_entry.seen);
    assert_eq!(zombie_entry.kills, 12);
    assert!(!zombie_entry.drops.is_empty());
}
