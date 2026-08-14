// Parity test for Interactive Lamp & Brazier Puzzle Placement.
// Replicates legacy/src/game/pinball-knight/maze/lamp-puzzle.ts, lamp-puzzle.test.ts

use pk_core::grid::{at, set_tile, Grid, T_FLOOR};
use pk_core::maze::lamp_puzzle::{author_lamp_puzzle, lamp_count_for};
use pk_core::rng::Mulberry32;

#[test]
fn lamp_count_scales_from_three_to_five_with_floor_depth() {
    assert_eq!(lamp_count_for(1), 3);
    assert_eq!(lamp_count_for(3), 4);
    assert_eq!(lamp_count_for(6), 5);
    assert_eq!(lamp_count_for(12), 5);
}

#[test]
fn author_lamp_puzzle_places_braziers_and_vault_on_reachable_floor() {
    let mut g = Grid::solid(20, 20);
    // Fill entire 18x18 interior with floor
    for j in 1..19 {
        for i in 1..19 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }

    let mut rng = Mulberry32::new(101);
    let start = (2, 2);
    let lamp_count = lamp_count_for(2);

    let plan = author_lamp_puzzle(&g, start, |_i, _j| false, &mut rng, lamp_count);
    assert!(plan.is_some(), "Should author valid lamp puzzle on open floor");

    let p = plan.unwrap();
    assert_eq!(p.lamps.len(), lamp_count);
    assert_eq!(at(&g, p.vault.0, p.vault.1), T_FLOOR);

    for lamp in &p.lamps {
        assert_eq!(at(&g, lamp.0, lamp.1), T_FLOOR);
        assert_ne!(*lamp, p.vault, "Brazier must not overlap vault chest");
    }

    assert_eq!(p.loot.len(), 3, "Loot table must contain 3 potion rewards");
}
