//! PIXEL PLAYING CARDS ART — Font-free pixel playing cards with inverted indices and hand-authored suit pips.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/cards-art.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct CardSize {
    pub w: f64,
    pub h: f64,
    pub corner_rad: f64,
    pub pip_size: f64,
}

pub fn card_size(h: f64) -> CardSize {
    CardSize {
        w: h * 0.7,
        h,
        corner_rad: 3.0,
        pip_size: 7.0,
    }
}

pub fn pip_layout(rank: u32) -> Vec<(f64, f64)> {
    let l = 0.0;
    let c = 0.5;
    let r = 1.0;
    match rank {
        2 => vec![(c, 0.0), (c, 1.0)],
        3 => vec![(c, 0.0), (c, 0.5), (c, 1.0)],
        4 => vec![(l, 0.0), (r, 0.0), (l, 1.0), (r, 1.0)],
        5 => vec![(l, 0.0), (r, 0.0), (c, 0.5), (l, 1.0), (r, 1.0)],
        6 => vec![
            (l, 0.0),
            (r, 0.0),
            (l, 0.5),
            (r, 0.5),
            (l, 1.0),
            (r, 1.0),
        ],
        7 => vec![
            (l, 0.0),
            (r, 0.0),
            (c, 0.25),
            (l, 0.5),
            (r, 0.5),
            (l, 1.0),
            (r, 1.0),
        ],
        8 => vec![
            (l, 0.0),
            (r, 0.0),
            (c, 0.25),
            (l, 0.5),
            (r, 0.5),
            (c, 0.75),
            (l, 1.0),
            (r, 1.0),
        ],
        9 => vec![
            (l, 0.0),
            (r, 0.0),
            (l, 1.0 / 3.0),
            (r, 1.0 / 3.0),
            (c, 0.5),
            (l, 2.0 / 3.0),
            (r, 2.0 / 3.0),
            (l, 1.0),
            (r, 1.0),
        ],
        10 => vec![
            (l, 0.0),
            (r, 0.0),
            (c, 1.0 / 6.0),
            (l, 1.0 / 3.0),
            (r, 1.0 / 3.0),
            (l, 2.0 / 3.0),
            (r, 2.0 / 3.0),
            (c, 5.0 / 6.0),
            (l, 1.0),
            (r, 1.0),
        ],
        _ => vec![(c, 0.5)],
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct CardDrawOpts {
    pub rank: String,
    pub suit: String,
    pub face_up: bool,
    pub is_ace: bool,
}

pub fn draw_card(_opts: &CardDrawOpts) {}

pub fn painted_suits() -> Vec<&'static str> {
    vec!["hearts", "diamonds", "spades", "clubs"]
}

pub fn painted_ranks() -> Vec<&'static str> {
    vec!["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
}

/// Returns a 3x5 bitmap for card ranks (A, 2-10, J, Q, K).
pub fn rank_bitmap_3x5(rank: &str) -> [u8; 15] {
    match rank {
        "A" => [0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1],
        "2" => [1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1],
        "3" => [1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
        "4" => [1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1],
        "5" => [1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1],
        "6" => [1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1],
        "7" => [1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        "8" => [1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1],
        "9" => [1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
        "10" => [1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1],
        "J" => [0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1],
        "Q" => [1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1],
        "K" => [1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1],
        _ => [0; 15],
    }
}

/// Rotates a 3x5 bitmap by 180 degrees by reading cells in reverse order.
pub fn rotate_180_3x5(b: &[u8; 15]) -> [u8; 15] {
    let mut out = [0u8; 15];
    for i in 0..15 {
        out[i] = b[14 - i];
    }
    out
}

/// Hand-authored 5x5 corner suit pips.
pub fn suit_pip_5x5(suit: &str) -> [u8; 25] {
    match suit {
        "hearts" | "heart" => [
            0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0,
        ],
        "diamonds" | "diamond" => [
            0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0,
        ],
        "spades" | "spade" => [
            0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0,
        ],
        "clubs" | "club" => [
            0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0,
        ],
        _ => [0; 25],
    }
}

/// Hand-authored 7x7 center suit pips.
pub fn suit_pip_7x7(suit: &str) -> [u8; 49] {
    match suit {
        "hearts" | "heart" => [
            0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
            1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        ],
        "diamonds" | "diamond" => [
            0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0,
            1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0,
        ],
        "spades" | "spade" => [
            0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0,
        ],
        "clubs" | "club" => [
            0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
            1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0,
        ],
        _ => [0; 49],
    }
}

pub const COURT_KING_ROWS: [&str; 18] = [
    ".....G...G...G......",
    ".....g.g.g.g.g......",
    ".....gggggggggg.....",
    ".....gGgggggggg.....",
    "......wwwwwwww......",
    "......wwwwwwww......",
    "......wiwwwwiw......",
    "......wwwwwwww......",
    "......wwiiiiww......",
    "......iwwwwwwi......",
    "......iiiiiiii......",
    ".....riiiiiiiir.....",
    "....rrrrrgirrrrr....",
    "...rrrrrrgirrrrrr...",
    "..rrrrrrrgirrrrrrr..",
    "..riiirrrgirrriiir..",
    "..rrrrrrrgirrrrrrr..",
    "..rrrrrrrgirrrrrrr..",
];

pub const COURT_QUEEN_ROWS: [&str; 18] = [
    "......G.G.G.G.......",
    ".....gggggggggg.....",
    ".....g.gGGGg.g......",
    ".....gggggggggg.....",
    ".....iwwwwwwwwi.....",
    ".....iwwwwwwwwi.....",
    ".....iwiwwwwiwi.....",
    ".....iwwwwwwwwi.....",
    ".....iwwwiiwwwi.....",
    ".....iiwwwwwwii.....",
    "......iiwwwwii......",
    "......rriiiirr......",
    "....rrrrrgGrrrrr....",
    "...rrrrrrgGrrrrrr...",
    "..rrrrrrrgGrrrrrrr..",
    "..rriirrrgGrrriirr..",
    "..rrrrrrrgGrrrrrrr..",
    "..rrrrrrrgGrrrrrrr..",
];

pub const COURT_JACK_ROWS: [&str; 18] = [
    "..........G.........",
    ".........Gg.........",
    ".....iiiiigg........",
    "....iiiiiiiii.......",
    "....iiiiiiiiii......",
    "......wwwwwwww......",
    "......wiwwwwiw......",
    "......wwwwwwww......",
    "......wwwiiwww......",
    "......wwwwwwww......",
    ".......iiiiii.......",
    "......rriiiirr......",
    "....rrrrrgirrrrr....",
    "...rrrrrrgirrrrrr...",
    "..rrrrrrrgirrrrrrr..",
    "..rriirrrgirrriiir..",
    "..rrrrrrrgirrrrrrr..",
    "..rrrrrrrgirrrrrrr..",
];

pub fn court_matrix(rank: &str) -> &'static [&'static str] {
    match rank {
        "K" => &COURT_KING_ROWS,
        "Q" => &COURT_QUEEN_ROWS,
        "J" => &COURT_JACK_ROWS,
        _ => &[],
    }
}
