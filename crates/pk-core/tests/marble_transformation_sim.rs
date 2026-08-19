use pk_core::state::{SimState, FrameInput};
use pk_core::grid::{Grid, set_tile, tile_center, T_FLOOR, T_WALL};

fn make_open_grid(w: i32, h: i32) -> Grid {
    let mut g = Grid::solid(w, h);
    for i in 0..w {
        for j in 0..h {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    g
}

#[test]
fn test_sprint_overcharge_and_ball_form_transition() {
    let grid = make_open_grid(20, 20);
    let start_pos = tile_center(&grid, 10, 10);
    let mut sim = SimState::new(grid, start_pos, 1);
    sim.plunger_armed = false;
    assert_eq!(sim.player.is_ball(), false);
    assert_eq!(sim.player.overcharge, 0.0);
    assert_eq!(sim.player.sprint_charge, 0.0);

    // Hold sprint and move east
    let input_sprint = FrameInput {
        move_x: 1.0,
        move_z: 0.0,
        sprint: true,
        dodge: false,
        attack: false,
        swap_weapon: false,
        ability_1: false,
        ability_2: false,
        ability_ult: false,
    };

    // Step 95 ticks (1.58 sec) to spool sprint_charge
    for _ in 0..95 {
        pk_core::state::simulate(&mut sim, &input_sprint);
    }

    // Sprint charge should be fully spooled (1.0)
    assert!(sim.player.sprint_charge >= 0.99);

    // Step another 90 ticks (1.5 sec) to overflow into overcharge
    for _ in 0..90 {
        pk_core::state::simulate(&mut sim, &input_sprint);
    }

    assert!(sim.player.overcharge >= 0.99);
    assert!(sim.player.is_ball());
}

#[test]
fn test_ballform_potion_direct_transformation() {
    let grid = make_open_grid(20, 20);
    let start_pos = tile_center(&grid, 10, 10);
    let mut sim = SimState::new(grid, start_pos, 1);
    assert_eq!(sim.player.is_ball(), false);

    // Consume ballform potion directly
    sim.player.iron_t = 14.0;
    assert!(sim.player.is_ball());
}

#[test]
fn test_wall_bounce_squash_and_pinball_ride() {
    let mut grid = make_open_grid(20, 20);
    // Place wall immediately east at tile (11, 10)
    set_tile(&mut grid, 11, 10, T_WALL);

    let start_pos = (tile_center(&grid, 10, 10).0 + 0.2, tile_center(&grid, 10, 10).1);
    let mut sim = SimState::new(grid, start_pos, 1);
    sim.plunger_armed = false;
    sim.player.overcharge = 1.0;
    sim.player.sprint_charge = 1.0;

    let input_sprint_east = FrameInput {
        move_x: 1.0,
        move_z: 0.0,
        sprint: true,
        dodge: false,
        attack: false,
        swap_weapon: false,
        ability_1: false,
        ability_2: false,
        ability_ult: false,
    };

    // Step into wall
    for _ in 0..10 {
        pk_core::state::simulate(&mut sim, &input_sprint_east);
    }

    // Player should have bounced into pinball momentum ride!
    assert!(sim.player.mom_speed > 0.0);
    assert!(sim.player.is_ball());
}
