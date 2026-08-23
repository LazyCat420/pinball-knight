//! Parity test suite for Player Death, Kit Serialization, and Corpse Pile Spawns.
//! Replicates legacy/src/game/pinball-knight/run/death.ts

use std::collections::HashMap;
use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::run::corpse_run::{local_knight_id, MAX_PILES_PER_FLOOR};
use pk_core::run::death::{
    collect_corpse_items, compute_corpse_item_fanout, compute_corpse_pile_spawns,
    on_player_death, WeaponSlotItem,
};

#[test]
fn collect_corpse_items_gathers_valid_kit_and_omits_fists() {
    let weapon_slots = vec![
        Some(WeaponSlotItem {
            id: "sword".to_string(),
            durability: Some(95.0),
            rarity: Some("rare".to_string()),
            cards: vec!["spidersilk".to_string()],
            upgrade: Some(2),
        }),
        Some(WeaponSlotItem {
            id: "fists".to_string(),
            durability: None,
            rarity: None,
            cards: vec![],
            upgrade: None,
        }),
        None,
    ];

    let mut gear = HashMap::new();
    gear.insert("helm".to_string(), 80.0);
    gear.insert("broken_boots".to_string(), 0.0);

    let card_stash = vec!["card_fireball".to_string(), "card_momentum".to_string()];

    let dropped = collect_corpse_items(&weapon_slots, &gear, &card_stash);

    assert_eq!(dropped.len(), 4);
    assert_eq!(dropped[0].kind, "weapon");
    assert_eq!(dropped[0].id, "sword");
    assert_eq!(dropped[0].upgrade, Some(2));

    assert_eq!(dropped[1].kind, "gear");
    assert_eq!(dropped[1].id, "helm");
    assert_eq!(dropped[1].durability, Some(80.0));

    assert_eq!(dropped[2].kind, "card");
    assert_eq!(dropped[2].id, "card_fireball");

    assert_eq!(dropped[3].kind, "card");
    assert_eq!(dropped[3].id, "card_momentum");
}

#[test]
fn compute_corpse_item_fanout_places_first_at_center_and_rest_on_ring() {
    let coords = compute_corpse_item_fanout(10.0, 20.0, 4);
    assert_eq!(coords.len(), 4);

    // Item 0 is dead center
    assert!((coords[0].0 - 10.0).abs() < 1e-6);
    assert!((coords[0].1 - 20.0).abs() < 1e-6);

    // Items 1..3 sit on 0.34 radius circle
    for (x, z) in &coords[1..] {
        let dist = ((x - 10.0).powi(2) + (z - 20.0).powi(2)).sqrt();
        assert!((dist - 0.34).abs() < 1e-6, "radius {dist} != 0.34");
    }
}

#[test]
fn compute_corpse_pile_spawns_redirects_wall_trapped_piles_to_nearest_open_tile() {
    let mut grid = Grid::solid(10, 10);
    // Set tile (3, 3) as walkable floor
    set_tile(&mut grid, 3, 3, T_FLOOR);

    let weapon = Some(WeaponSlotItem {
        id: "axe".to_string(),
        durability: Some(100.0),
        rarity: Some("legendary".to_string()),
        cards: vec![],
        upgrade: Some(1),
    });

    let mut piles = Vec::new();
    // Die at world pos (-2.5, -2.5) which corresponds to tile (2, 2) [WALL]
    on_player_death(
        &mut piles,
        1,
        -2.5,
        -2.5,
        &[weapon],
        &HashMap::new(),
        &[],
        Some("player1"),
    );

    let spawns = compute_corpse_pile_spawns(&piles, &grid, 1);
    assert_eq!(spawns.len(), 1);
    assert_eq!(spawns[0].id, "axe");
    // Tile (3,3) center on 10x10 grid is (-1.5, -1.5)
    let (cx, cz) = pk_core::grid::tile_center(&grid, 3, 3);
    assert!((spawns[0].x - cx).abs() < 1e-5);
    assert!((spawns[0].z - cz).abs() < 1e-5);
}

#[test]
fn on_player_death_accumulates_and_enforces_cap() {
    let mut piles = Vec::new();
    let weapon = Some(WeaponSlotItem {
        id: "dagger".to_string(),
        durability: Some(50.0),
        rarity: None,
        cards: vec![],
        upgrade: None,
    });

    for _ in 0..MAX_PILES_PER_FLOOR + 2 {
        on_player_death(
            &mut piles,
            1,
            5.0,
            5.0,
            &[weapon.clone()],
            &HashMap::new(),
            &[],
            Some(local_knight_id()),
        );
    }

    assert_eq!(piles.len(), MAX_PILES_PER_FLOOR);
    // Oldest pile items merged into next oldest
    assert!(piles[0].items.len() >= 2);
}
