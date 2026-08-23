// Parity test suite for Pinball Shot Identity and Combo Tracker.
// Replicates legacy/src/game/pinball-knight/shots.ts

use pk_core::pinball::shots::{ShotTracker, SKILL_SHOT_GOLD};

#[test]
fn shot_tracker_evaluates_named_combos() {
    let mut tracker = ShotTracker::new();

    // Sequence: ramp -> orbit -> bank => "TRIFECTA" (300 gold)
    assert_eq!(tracker.record_shot("ramp"), None);
    // At ramp -> orbit, RAMP_RUNNER matches (150 gold)
    assert_eq!(tracker.record_shot("orbit"), Some(("RAMP_RUNNER", 150)));

    // Now bank completes TRIFECTA (300 gold)
    assert_eq!(tracker.record_shot("bank"), Some(("TRIFECTA", 300)));

    // Repeating the same combo on the same floor does not pay again
    tracker.chain.clear();
    tracker.record_shot("ramp");
    assert_eq!(tracker.record_shot("orbit"), None);
}

#[test]
fn skill_shot_pays_on_direct_target_hit() {
    let mut tracker = ShotTracker::new();

    // Hit target during initial launch window
    let payout = tracker.record_shot("target");
    assert_eq!(payout, Some(("SKILL_SHOT", SKILL_SHOT_GOLD)));
    assert!(!tracker.skill_shot_active);
}

#[test]
fn orbit_laps_ladder_bonuses_before_timeout() {
    let mut tracker = ShotTracker::new();

    let lap1_gold = tracker.record_orbit_lap(); // 50
    assert_eq!(lap1_gold, 50);

    let lap2_gold = tracker.record_orbit_lap(); // 50 + 100 = 150
    assert_eq!(lap2_gold, 150);

    // Timeout lapses laps
    tracker.step(4.0);
    assert_eq!(tracker.orbits_completed, 0);
}
