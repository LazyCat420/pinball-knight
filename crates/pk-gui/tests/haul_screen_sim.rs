// Parity test suite for Floor Haul Summary Screen.
// Replicates legacy/src/game/pinball-knight/gui/screens/haul.ts

use pk_gui::screens::haul::{
    compute_haul_summary, HaulCardEntry, DESIGN_HEIGHT, DESIGN_WIDTH, FACE_H, FACE_W, SHEET_HEIGHT,
    SHEET_WIDTH,
};

#[test]
fn haul_screen_dimensions_meet_design_budget() {
    assert_eq!(DESIGN_WIDTH, 600);
    assert_eq!(DESIGN_HEIGHT, 338);
    assert_eq!(SHEET_WIDTH, 584);
    assert_eq!(SHEET_HEIGHT, 322);
    assert_eq!(FACE_W, 104);
    assert_eq!(FACE_H, 146);
}

#[test]
fn compute_haul_summary_stacks_and_counts_cards() {
    let entries = vec![
        HaulCardEntry {
            id: "card_iron_nail".to_string(),
            level: 1,
            is_shiny: false,
            is_new: true,
        },
        HaulCardEntry {
            id: "card_iron_nail".to_string(),
            level: 2,
            is_shiny: true,
            is_new: false,
        },
        HaulCardEntry {
            id: "card_fire_orb".to_string(),
            level: 1,
            is_shiny: false,
            is_new: true,
        },
    ];

    let summary = compute_haul_summary(3, &entries);
    assert_eq!(summary.floor, 3);
    assert_eq!(summary.total_cards, 3);
    assert_eq!(summary.distinct_kinds, 2);
    assert_eq!(summary.new_cards, 2);
    assert_eq!(summary.shiny_cards, 1);

    // Stacks
    assert_eq!(summary.stacks.len(), 2);
    let nail_stack = summary.stacks.iter().find(|s| s.id == "card_iron_nail").unwrap();
    assert_eq!(nail_stack.count, 2);
    assert!(nail_stack.is_fresh);
    assert!(nail_stack.is_shiny);
}
