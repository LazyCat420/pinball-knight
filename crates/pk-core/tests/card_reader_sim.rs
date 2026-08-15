// Parity test suite for Floor Haul Card Reader.
// Replicates legacy/src/game/pinball-knight/card-reader.ts

use std::collections::HashSet;
use pk_core::cards::reader::{group_floor_haul, is_notable_pull, HaulEntry};

#[test]
fn notable_pulls_flag_high_tier_shiny_and_first_time_discoveries() {
    let mut seen = HashSet::new();
    seen.insert("spider_silk".to_string());

    // Seen common is not notable
    assert!(!is_notable_pull("spider_silk", false, 0, &seen));

    // Seen shiny is notable
    assert!(is_notable_pull("spider_silk", true, 0, &seen));

    // Seen rare (tier 2) is notable
    assert!(is_notable_pull("spider_silk", false, 2, &seen));

    // Unseen common is notable
    assert!(is_notable_pull("golem_core", false, 0, &seen));
}

#[test]
fn group_floor_haul_consolidates_stacks_and_preserves_order() {
    let mut seen = HashSet::new();
    seen.insert("iron_nail".to_string());

    let entries = vec![
        HaulEntry {
            card_id: "iron_nail".to_string(),
            socket_note: Some("SOCKETED INTO SWORD".to_string()),
        },
        HaulEntry {
            card_id: "spider_silk".to_string(),
            socket_note: None,
        },
        HaulEntry {
            card_id: "iron_nail".to_string(),
            socket_note: Some("STASHED".to_string()),
        },
    ];

    let stacks = group_floor_haul(&entries, &seen);
    assert_eq!(stacks.len(), 2);

    assert_eq!(stacks[0].card_id, "iron_nail");
    assert_eq!(stacks[0].count, 2);
    assert!(!stacks[0].fresh); // Already in seen
    assert_eq!(stacks[0].notes.len(), 2);

    assert_eq!(stacks[1].card_id, "spider_silk");
    assert_eq!(stacks[1].count, 1);
    assert!(stacks[1].fresh); // Novel discovery
}
