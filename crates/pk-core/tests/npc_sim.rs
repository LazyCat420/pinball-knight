// Parity test suite for Dungeon NPCs (Magician, Speed Witch, Oracle Frog, Merchant).
// Replicates legacy/src/game/pinball-knight/entities/npc.ts

use pk_core::entities::npc::{
    check_witch_touch, step_magician, step_merchant, step_oracle_frog, MagicianActor,
    MagicianPhase, MerchantActor, OracleFrogActor, SpeedWitchActor, MAGICIAN_BOW,
};
use pk_core::grid::{set_tile, tile_center, Grid, T_FLOOR};
use pk_core::maze::flow_loops::FlowPart;

fn make_open_grid(w: i32, h: i32) -> Grid {
    let mut g = Grid::solid(w, h);
    for i in 1..w - 1 {
        for j in 1..h - 1 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    g
}

#[test]
fn magician_lifecycle_and_trick_furniture_swap() {
    let mut magician = MagicianActor {
        x: 0.0,
        z: 0.0,
        phase: MagicianPhase::Hidden,
        timer: 44.9,
        next_visit: 45.0,
    };

    let mut parts = vec![
        FlowPart {
            kind: "bumper".to_string(),
            pos: (3, 3),
            dir: (0.0, 0.0),
        },
        FlowPart {
            kind: "slingshot".to_string(),
            pos: (4, 4),
            dir: (0.0, 0.0),
        },
    ];

    // Trigger visit
    step_magician(&mut magician, &mut parts, 0.0, 0.0, 0.2);
    assert_eq!(magician.phase, MagicianPhase::Appearing);

    // Advance to Bowing
    step_magician(&mut magician, &mut parts, 0.0, 0.0, 0.6);
    assert_eq!(magician.phase, MagicianPhase::Bowing);

    // Advance through Bowing to Trick
    step_magician(&mut magician, &mut parts, 0.0, 0.0, MAGICIAN_BOW + 0.1);
    assert_eq!(magician.phase, MagicianPhase::Trick);

    // Execute Trick -> transitions to Vanishing and swaps parts
    let swapped = step_magician(&mut magician, &mut parts, 0.0, 0.0, 0.016);
    assert!(swapped);
    assert_eq!(magician.phase, MagicianPhase::Vanishing);

    // Verify furniture swapped positions!
    assert_eq!(parts[0].pos, (4, 4));
    assert_eq!(parts[1].pos, (3, 3));
}

#[test]
fn speed_witch_touch_activates_and_consumes() {
    let mut witch = SpeedWitchActor {
        x: 10.0,
        z: 10.0,
        revealed: false,
        used: false,
        interacted: false,
    };

    // Not revealed -> cannot touch
    assert!(!check_witch_touch(&mut witch, 10.0, 10.0));

    witch.revealed = true;
    // Player far away -> no touch
    assert!(!check_witch_touch(&mut witch, 5.0, 5.0));

    // Player steps on witch -> activated
    assert!(check_witch_touch(&mut witch, 10.2, 10.1));
    assert!(witch.used);

    // Already used -> cannot re-activate
    assert!(!check_witch_touch(&mut witch, 10.0, 10.0));
}

#[test]
fn oracle_frog_pathfinds_to_stairs() {
    let g = make_open_grid(15, 15);
    let (fx, fz) = tile_center(&g, 2, 2);
    let mut frog = OracleFrogActor {
        x: fx,
        z: fz,
        cooldown: 0.0,
        active: true,
    };

    let stairs = (12, 12);
    let path = step_oracle_frog(&mut frog, &g, stairs, fx + 0.1, fz + 0.1, 0.016);
    assert!(path.is_some());

    let route = path.unwrap();
    assert!(!route.is_empty());
    assert_eq!(route.first().unwrap(), &(2, 2));
    assert_eq!(route.last().unwrap(), &(12, 12));

    // Cooldown set -> immediate second touch returns None
    assert!(step_oracle_frog(&mut frog, &g, stairs, fx + 0.1, fz + 0.1, 0.016).is_none());
}

#[test]
fn merchant_flees_and_can_be_caught() {
    let g = make_open_grid(30, 30);
    let (mx, mz) = tile_center(&g, 15, 15);
    let mut merchant = MerchantActor {
        x: mx,
        z: mz,
        vx: 0.0,
        vz: 0.0,
        caught: false,
    };

    // Player approaches from West within flee range (dist = 3.0)
    let caught = step_merchant(&mut merchant, &g, mx - 3.0, mz, 0.1);
    assert!(!caught);
    // Merchant flees eastward (+x) away from player
    assert!(merchant.x > mx);

    // Player catches merchant
    let cur_mx = merchant.x;
    let cur_mz = merchant.z;
    let caught_now = step_merchant(&mut merchant, &g, cur_mx + 0.2, cur_mz, 0.1);
    assert!(caught_now);
    assert!(merchant.caught);
}
