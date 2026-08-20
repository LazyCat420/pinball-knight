// Parity test suite for Floor Haul Card Reader.
// Replicates legacy/src/game/pinball-knight/card-reader.ts

use std::collections::HashSet;

use pk_core::cards::reader::{is_notable_pull, stack_haul, HaulEntry};

#[test]
fn notable_pulls_flag_high_tier_shiny_and_first_time_discoveries() {
    let mut seen = HashSet::new();
    seen.insert("spidersilk".to_string());

    // Seen common is not notable
    assert!(!is_notable_pull("spidersilk", &seen));

    // Seen shiny is notable
    assert!(is_notable_pull("spidersilk#1s", &seen));

    // Seen epic (tier >= 2) is notable
    assert!(is_notable_pull("hulkknuckle", &seen));

    // Unseen common is notable
    assert!(is_notable_pull("shamblerhide", &seen));
}

#[test]
fn stack_haul_consolidates_stacks_and_orders_best_pull_first() {
    let entries = vec![
        HaulEntry {
            id: "spidersilk".to_string(),
            note: Some("SOCKETED INTO SWORD".to_string()),
            fresh: false,
        },
        HaulEntry {
            id: "golemcore".to_string(), // Legendary
            note: None,
            fresh: true,
        },
        HaulEntry {
            id: "spidersilk".to_string(),
            note: Some("STASHED".to_string()),
            fresh: false,
        },
    ];

    let stacks = stack_haul(&entries);
    assert_eq!(stacks.len(), 2);

    // Golem Core is Legendary -> leads the stack
    assert_eq!(stacks[0].id, "golemcore");
    assert_eq!(stacks[0].count, 1);
    assert!(stacks[0].fresh);

    // Spider Silk is Common -> second stack with count 2
    assert_eq!(stacks[1].id, "spidersilk");
    assert_eq!(stacks[1].count, 2);
    assert!(!stacks[1].fresh);
    assert_eq!(stacks[1].notes.len(), 2);
}
