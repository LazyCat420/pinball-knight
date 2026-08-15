//! BLACKJACK TABLE FURNITURE — Casino chip stacks, betting circle rasteriser, and chip denominations.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/blackjack-art.ts`

pub const MAX_STACK: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChipInk {
    pub value: u32,
    pub base: &'static str,
    pub hi: &'static str,
    pub lo: &'static str,
    pub spot: &'static str,
}

pub const CHIP_INKS: [ChipInk; 5] = [
    ChipInk {
        value: 100,
        base: "#23252e",
        hi: "#4a4a52",
        lo: "#101219",
        spot: "#d9c47a",
    },
    ChipInk {
        value: 25,
        base: "#1f7a48",
        hi: "#48b06e",
        lo: "#0d3a29",
        spot: "#e8f0d8",
    },
    ChipInk {
        value: 10,
        base: "#2a4f96",
        hi: "#5a83c8",
        lo: "#152a58",
        spot: "#e0e6f4",
    },
    ChipInk {
        value: 5,
        base: "#a32a35",
        hi: "#d85a52",
        lo: "#5a1626",
        spot: "#f0dcc8",
    },
    ChipInk {
        value: 1,
        base: "#c9c0aa",
        hi: "#f0e8d0",
        lo: "#7a7466",
        spot: "#8a3540",
    },
];

/// Greedy breakdown of a total bet amount into chip denominations, capped at MAX_STACK per pile.
pub fn breakdown_bet(mut amount: u32) -> Vec<(u32, usize)> {
    let mut out = Vec::new();
    for ink in &CHIP_INKS {
        if amount >= ink.value {
            let count = (amount / ink.value) as usize;
            let stack = count.min(MAX_STACK);
            out.push((ink.value, stack));
            amount %= ink.value;
        }
    }
    out
}

/// Midpoint circle algorithm rasterising integer pixel points along the circumference.
pub fn midpoint_circle_points(cx: i32, cy: i32, radius: i32) -> Vec<(i32, i32)> {
    let mut points = Vec::new();
    let mut x = 0;
    let mut y = radius;
    let mut d = 1 - radius;

    while x <= y {
        points.push((cx + x, cy + y));
        points.push((cx - x, cy + y));
        points.push((cx + x, cy - y));
        points.push((cx - x, cy - y));
        points.push((cx + y, cy + x));
        points.push((cx - y, cy + x));
        points.push((cx + y, cy - x));
        points.push((cx - y, cy - x));

        if d < 0 {
            d += 2 * x + 3;
        } else {
            d += 2 * (x - y) + 5;
            y -= 1;
        }
        x += 1;
    }
    points
}
