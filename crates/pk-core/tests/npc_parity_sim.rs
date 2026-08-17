//! Comprehensive parity test suite for legacy/src/game/pinball-knight/entities/npc.ts.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use pk_core::entities::npc::*;
use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::rng::Mulberry32;

#[test]
fn magician_clock_roll() {
    let mut rng = Mulberry32::new(42);
    let clock = roll_magician_clock(&mut rng);
    assert!(clock >= MAGICIAN_PERIOD - MAGICIAN_JITTER);
    assert!(clock <= MAGICIAN_PERIOD + MAGICIAN_JITTER);
}

#[test]
fn frog_navigation_and_cooldown() {
    let mut grid = Grid::solid(20, 20);
    for y in 1..19 {
        for x in 1..19 {
            set_tile(&mut grid, x, y, T_FLOOR);
        }
    }

    let mut frog = FrogActor {
        x: 5.5,
        z: 5.5,
        cooldown: 0.0,
        active: true,
    };

    let path = touch_frog(&mut frog, &grid, 5.0, 5.0, 10, 10);
    assert!(path.is_some());
    assert!(frog.cooldown > 0.0);

    // Cooldown prevents immediate re-trigger
    let path_re = touch_frog(&mut frog, &grid, 5.0, 5.0, 10, 10);
    assert!(path_re.is_none());
}

#[test]
fn witch_interaction_and_merchant_flee() {
    let mut witch = WitchActor {
        x: 3.0,
        z: 3.0,
        revealed: true,
        used: false,
        interacted: false,
    };
    assert!(touch_witch(&mut witch, 3.2, 3.2));
    assert!(witch.interacted);
    assert!(!touch_witch(&mut witch, 3.2, 3.2)); // Cannot interact twice

    let mut grid = Grid::solid(20, 20);
    for y in 1..19 {
        for x in 1..19 {
            set_tile(&mut grid, x, y, T_FLOOR);
        }
    }

    let caught_flag = Arc::new(AtomicBool::new(false));
    let flag_clone = caught_flag.clone();
    set_merchant_caught_handler(move || {
        flag_clone.store(true, Ordering::Relaxed);
    });

    let mut merchant = MerchantActor {
        x: 5.0,
        z: 5.0,
        vx: 0.0,
        vz: 0.0,
        caught: false,
    };

    // Close contact triggers catch handler
    let caught = step_merchant(&mut merchant, &grid, 5.2, 5.2, 0.1);
    assert!(caught);
    assert!(merchant.caught);
    assert!(caught_flag.load(Ordering::Relaxed));

    dispose_npcs();
}
