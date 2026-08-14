// Parity test suite for Corpse Run recovery persistence and Floor Descent rewards.
// Replicates legacy/src/game/pinball-knight/corpse-run.ts and run/descend.ts

use pk_core::run::corpse_run::{
    claim_corpse_pile, highest_unclaimed_floor, record_corpse_pile, CorpseItem, CorpsePile,
    MAX_PILES_PER_FLOOR,
};
use pk_core::run::descend::{calculate_descent_rewards, BOSS_GOLD, GOLD_PER_DESCENT};

#[test]
fn multiple_deaths_accumulate_corpse_piles_and_merges_at_cap() {
    let mut piles = Vec::new();

    // Die 3 times on Floor 5
    for i in 1..=3 {
        record_corpse_pile(
            &mut piles,
            CorpsePile {
                id: format!("pile_{}", i),
                floor: 5,
                x: 10.0 + i as f64,
                z: 10.0,
                owner: "player1".to_string(),
                items: vec![CorpseItem {
                    kind: "weapon".to_string(),
                    id: format!("sword_{}", i),
                    durability: Some(100.0),
                    rarity: Some("common".to_string()),
                    cards: vec![],
                    upgrade: Some(0),
                }],
            },
        );
    }

    assert_eq!(piles.len(), 3);
    assert_eq!(piles[0].items.len(), 1);
    assert_eq!(piles[1].items.len(), 1);
    assert_eq!(piles[2].items.len(), 1);

    // 4th death on Floor 5 -> should merge pile_1 into pile_2, leaving 3 piles
    record_corpse_pile(
        &mut piles,
        CorpsePile {
            id: "pile_4".to_string(),
            floor: 5,
            x: 14.0,
            z: 10.0,
            owner: "player1".to_string(),
            items: vec![CorpseItem {
                kind: "card".to_string(),
                id: "card_momentum".to_string(),
                durability: None,
                rarity: Some("rare".to_string()),
                cards: vec![],
                upgrade: None,
            }],
        },
    );

    assert_eq!(piles.len(), MAX_PILES_PER_FLOOR);
    // Oldest pile (pile_1) items merged into the second oldest (pile_2)
    assert_eq!(piles[0].id, "pile_2");
    assert_eq!(piles[0].items.len(), 2);
    assert_eq!(piles[0].items[0].id, "sword_2");
    assert_eq!(piles[0].items[1].id, "sword_1");
}

#[test]
fn claim_corpse_pile_enforces_ownership() {
    let mut piles = vec![
        CorpsePile {
            id: "pile_mine".to_string(),
            floor: 3,
            x: 5.0,
            z: 5.0,
            owner: "player1".to_string(),
            items: vec![CorpseItem {
                kind: "gear".to_string(),
                id: "helm".to_string(),
                durability: None,
                rarity: None,
                cards: vec![],
                upgrade: None,
            }],
        },
        CorpsePile {
            id: "pile_solo".to_string(),
            floor: 2,
            x: 4.0,
            z: 4.0,
            owner: "".to_string(),
            items: vec![],
        },
    ];

    // Unauthorized claimer rejected
    let rejected = claim_corpse_pile(&mut piles, "pile_mine", "intruder");
    assert!(rejected.is_none());
    assert_eq!(piles.len(), 2);

    // Authorized owner claims
    let claimed = claim_corpse_pile(&mut piles, "pile_mine", "player1");
    assert!(claimed.is_some());
    assert_eq!(claimed.unwrap()[0].id, "helm");
    assert_eq!(piles.len(), 1);

    // Solo pile claimed by anyone
    let solo_claimed = claim_corpse_pile(&mut piles, "pile_solo", "anyone");
    assert!(solo_claimed.is_some());
    assert_eq!(piles.len(), 0);
}

#[test]
fn highest_unclaimed_floor_retrieval() {
    let piles = vec![
        CorpsePile {
            id: "p1".to_string(),
            floor: 2,
            x: 0.0,
            z: 0.0,
            owner: "p1".to_string(),
            items: vec![],
        },
        CorpsePile {
            id: "p2".to_string(),
            floor: 7,
            x: 0.0,
            z: 0.0,
            owner: "p1".to_string(),
            items: vec![],
        },
        CorpsePile {
            id: "p3".to_string(),
            floor: 12,
            x: 0.0,
            z: 0.0,
            owner: "other_player".to_string(),
            items: vec![],
        },
    ];

    assert_eq!(highest_unclaimed_floor(&piles, "p1"), Some(7));
    assert_eq!(highest_unclaimed_floor(&piles, "other_player"), Some(12));
    assert_eq!(highest_unclaimed_floor(&piles, "nobody"), None);
}

#[test]
fn descent_rewards_and_boss_bonuses() {
    // Normal floor S rank
    let r_s = calculate_descent_rewards(1, false, 15, 10, 25.0, 30.0);
    assert_eq!(r_s.gold_reward, GOLD_PER_DESCENT);
    assert_eq!(r_s.grade_letter, "S");
    assert_eq!(r_s.total_gold, GOLD_PER_DESCENT + 50);

    // Boss floor clear
    let r_boss = calculate_descent_rewards(5, true, 1, 1, 40.0, 45.0);
    assert_eq!(r_boss.gold_reward, GOLD_PER_DESCENT);
    assert_eq!(r_boss.bonus_gold, BOSS_GOLD + 50);
    assert_eq!(r_boss.grade_letter, "S");
    assert_eq!(r_boss.total_gold, GOLD_PER_DESCENT + BOSS_GOLD + 50);
}
