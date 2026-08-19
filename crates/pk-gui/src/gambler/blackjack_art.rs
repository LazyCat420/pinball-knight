//! BLACKJACK TABLE FURNITURE — Casino chip stacks, betting circle rasteriser, and chip denominations.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/blackjack-art.ts`

pub const MAX_STACK: usize = 8;
pub const CHIP_W: usize = 17;
pub const CHIP_PITCH: usize = 3;

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

pub fn chip_ink(value: u32) -> ChipInk {
    for ink in &CHIP_INKS {
        if ink.value == value {
            return *ink;
        }
    }
    CHIP_INKS[4]
}

pub fn chip_stack(mut amount: u32, cap: usize) -> Vec<u32> {
    let mut chips = Vec::new();
    for ink in &CHIP_INKS {
        while amount >= ink.value && chips.len() < cap {
            chips.push(ink.value);
            amount -= ink.value;
        }
    }
    chips
}

/// Greedy breakdown of a total bet amount into chip denominations, capped at MAX_STACK per pile.
pub fn breakdown_bet(mut amount: u32) -> Vec<(u32, usize)> {
    let mut out = Vec::new();
    for ink in &CHIP_INKS {
        if amount >= ink.value {
            let count = (amount / ink.value) as usize;
            let stack = count.min(MAX_STACK);
            out.push((ink.value, stack));
            amount -= ink.value * stack as u32;
        }
    }
    out
}

pub fn midpoint_circle_points(cx: i32, cy: i32, r: i32) -> Vec<(i32, i32)> {
    let mut points = Vec::new();
    let mut x = 0;
    let mut y = r;
    let mut d = 1 - r;

    let mut add_sym = |px: i32, py: i32| {
        points.push((cx + px, cy + py));
        points.push((cx - px, cy + py));
        points.push((cx + px, cy - py));
        points.push((cx - px, cy - py));
        points.push((cx + py, cy + px));
        points.push((cx - py, cy + px));
        points.push((cx + py, cy - px));
        points.push((cx - py, cy - px));
    };

    add_sym(x, y);
    while x < y {
        x += 1;
        if d < 0 {
            d += 2 * x + 1;
        } else {
            y -= 1;
            d += 2 * (x - y) + 1;
        }
        add_sym(x, y);
    }
    points
}

pub fn circle_outline(r: f64) -> Vec<(f64, f64)> {
    let steps = 32;
    let mut points = Vec::with_capacity(steps);
    for i in 0..steps {
        let theta = (i as f64) * std::f64::consts::PI * 2.0 / (steps as f64);
        points.push((r * theta.cos(), r * theta.sin()));
    }
    points
}

pub fn draw_chip(_cx: f64, _y_top: f64, _value: u32) {}

pub fn draw_chip_stack(_cx: f64, _y_base: f64, _amount: u32) {}

pub fn draw_betting_circle(_cx: f64, _cy: f64, _r: f64) {}

pub fn draw_shoe(_x: f64, _y: f64, _w: f64, _h: f64) {}

pub fn draw_chip_tray(_x: f64, _y: f64, _w: f64, _h: f64) {}
