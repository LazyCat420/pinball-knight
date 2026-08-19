// Comprehensive simulation test suite for Loot Drops & Armor Styles Cluster.
// Replicates legacy/src/game/pinball-knight/economy/loot.ts, armor-styles.ts

use pk_core::armor_styles::*;
use pk_core::economy::loot::*;
use pk_core::grid::Grid;
use pk_core::reagents::ReagentId;
use pk_core::rng::Mulberry32;
use pk_core::state::{EnemyKind, SimState};

#[test]
fn loot_drop_pipeline_and_spawns() {
    let mut sim = SimState::new(Grid::solid(20, 20), (5.0, 5.0), 12345);
    let mut rng = Mulberry32::new(12345);

    drop_weapon(&mut sim, "claymore", 3.0, 4.0);
    assert_eq!(sim.ground_items.len(), 1);
    assert_eq!(sim.ground_items[0].kind, "weapon");
    assert!(sim.ground_items[0].life > 0.0);

    // Guaranteed boss card drop
    drop_card_maybe(&mut sim, 5.0, 5.0, true, EnemyKind::Spider, 1.0, &mut rng);
    assert_eq!(sim.ground_items.len(), 2);
    assert_eq!(sim.ground_items[1].kind, "card");

    // Reagent mote drop
    drop_reagents_maybe(&mut sim, 6.0, 6.0, EnemyKind::Spider, true, 1.0, &mut rng);
    assert!(sim.ground_items.len() >= 3);

    // Marble material drop
    spawn_material_drop(&mut sim, 7.0, 7.0, "steel");
    assert_eq!(sim.ground_items.last().unwrap().kind, "material");
    assert_eq!(sim.ground_items.last().unwrap().id, "steel");

    // Credit reagent straight into haul
    credit_reagent(&mut sim, ReagentId::Silk);
    assert_eq!(sim.haul.len(), 1);
    assert_eq!(sim.haul[0].id, "silk");
}

#[test]
fn armor_styles_catalog_and_unlock_mechanics() {
    reset_armor_styles_cache();
    assert_eq!(ARMOR_STYLE_IDS.len(), 5);
    assert_eq!(ELEMENTAL_STYLE_IDS.len(), 4);

    // Iron is unlocked by default
    assert!(is_style_unlocked(ArmorStyleId::Iron));
    assert_eq!(active_style(), ArmorStyleId::Iron);

    // Glacier plate is locked initially
    assert!(!is_style_unlocked(ArmorStyleId::Ice));
    assert!(!set_active_style(ArmorStyleId::Ice));

    // Unlock and wear Glacier plate
    unlock_style(ArmorStyleId::Ice);
    assert!(is_style_unlocked(ArmorStyleId::Ice));
    assert_eq!(active_style(), ArmorStyleId::Ice);

    // Verify gear defense grant
    let base_helmet = 10;
    let base_armor = 20;
    let boosted_helmet = style_gear_grant("helmet", base_helmet, ArmorStyleId::Ice);
    let boosted_armor = style_gear_grant("armor", base_armor, ArmorStyleId::Ice);
    let boots = style_gear_grant("boots", 1, ArmorStyleId::Ice);

    assert_eq!(boosted_helmet, 12);
    assert_eq!(boosted_armor, 23);
    assert_eq!(boots, 1); // Boots soak never absorbs
}
