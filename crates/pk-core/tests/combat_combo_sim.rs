// Parity test for Combat Combo Chain, Finisher Multipliers, and Weapon Heft.
// Replicates legacy/src/game/pinball-knight/combo.test.ts, entities/combat.ts

use pk_core::combat::combo::{CombatComboState, ComboStage, BASE_SWING_DURATION, COMBO_RESET_WINDOW};
use pk_core::items::WeaponId;

#[test]
fn combo_chains_from_combo1_to_finisher() {
    let mut combo = CombatComboState::default();
    let sword = WeaponId::Sword.def();

    // Swing 1
    assert!(combo.trigger_attack(&sword));
    assert_eq!(combo.stage, ComboStage::Combo1);
    assert_eq!(combo.stage.damage_multiplier(), 1.0);

    // Finish swing 1 within window
    combo.update(combo.swing_duration);
    assert!(!combo.is_swinging);

    // Swing 2
    assert!(combo.trigger_attack(&sword));
    assert_eq!(combo.stage, ComboStage::Combo2);
    assert_eq!(combo.stage.damage_multiplier(), 1.25);

    // Finish swing 2 within window
    combo.update(combo.swing_duration);

    // Swing 3 (Finisher)
    assert!(combo.trigger_attack(&sword));
    assert_eq!(combo.stage, ComboStage::Finisher);
    assert_eq!(combo.stage.damage_multiplier(), 1.75);
}

#[test]
fn heavy_weapon_has_longer_swing_duration_than_light_weapon() {
    let mut combo_sword = CombatComboState::default();
    let mut combo_hammer = CombatComboState::default();

    let sword = WeaponId::Sword.def();
    let hammer = WeaponId::Warhammer.def();

    assert!(hammer.heft > sword.heft);

    combo_sword.trigger_attack(&sword);
    combo_hammer.trigger_attack(&hammer);

    assert!(combo_hammer.swing_duration > combo_sword.swing_duration);
}

#[test]
fn combo_resets_after_window_expires() {
    let mut combo = CombatComboState::default();
    let sword = WeaponId::Sword.def();

    combo.trigger_attack(&sword);
    combo.update(combo.swing_duration);

    // Wait for window to expire
    combo.update(COMBO_RESET_WINDOW + 0.1);

    // Next swing is Combo1 again
    combo.trigger_attack(&sword);
    assert_eq!(combo.stage, ComboStage::Combo1);
}
