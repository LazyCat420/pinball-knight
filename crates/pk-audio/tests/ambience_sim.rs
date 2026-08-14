// Parity test suite for Sustained Ambience Audio Beds.
// Replicates legacy/src/game/pinball-knight/sfx/ambience.ts

use pk_audio::ambience::{AmbienceKind, AmbienceManager, AMB_HOLD};

#[test]
fn ambience_accumulates_levels_additively() {
    let mut mgr = AmbienceManager::new();

    // Two fires contributing 0.3 and 0.4 volume
    mgr.refresh_source(AmbienceKind::Fire, 0.3);
    mgr.refresh_source(AmbienceKind::Fire, 0.4);

    let voice = mgr.voices.get(&AmbienceKind::Fire).unwrap();
    assert!((voice.frame_level - 0.7).abs() < 0.001);
}

#[test]
fn ambience_voice_fades_in_and_decays_without_refreshes() {
    let mut mgr = AmbienceManager::new();

    // Frame 1: Refresh fire
    mgr.refresh_source(AmbienceKind::Fire, 0.8);
    mgr.step(0.05);

    let lvl1 = mgr.get_level(AmbienceKind::Fire);
    assert!(lvl1 > 0.0);

    // Frame 2-5: Multiple refreshes -> level rises towards 0.8
    for _ in 0..5 {
        mgr.refresh_source(AmbienceKind::Fire, 0.8);
        mgr.step(0.05);
    }
    let lvl2 = mgr.get_level(AmbienceKind::Fire);
    assert!(lvl2 > lvl1);

    // Stop refreshing and step past hold duration (0.35s + decay time)
    for _ in 0..20 {
        mgr.step(0.05);
    }

    let final_lvl = mgr.get_level(AmbienceKind::Fire);
    assert_eq!(final_lvl, 0.0);
}
