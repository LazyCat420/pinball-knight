// Parity test suite for Blackjack Table Furniture Art.
// Replicates legacy/src/scenes/tavern/gambler/blackjack-art.ts

use pk_gui::gambler::blackjack_art::{breakdown_bet, midpoint_circle_points};

#[test]
fn blackjack_art_chip_breakdown_greedy() {
    let breakdown = breakdown_bet(138);
    assert_eq!(breakdown, vec![(100, 1), (25, 1), (10, 1), (1, 3)]);

    let large_breakdown = breakdown_bet(999);
    // Stack is capped at 8 per denomination
    for &(_val, count) in &large_breakdown {
        assert!(count <= 8);
    }
}

#[test]
fn blackjack_art_midpoint_circle_perimeter() {
    let points = midpoint_circle_points(0, 0, 10);
    assert!(!points.is_empty());

    for (x, y) in points {
        let dist_sq = x * x + y * y;
        assert!(
            dist_sq >= 90 && dist_sq <= 110,
            "Point ({}, {}) distance squared {} outside tolerance",
            x,
            y,
            dist_sq
        );
    }
}
