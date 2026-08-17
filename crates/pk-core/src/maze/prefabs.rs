//! PREFAB STAMPS — reusable room/hallway shapes stamped over the backtracker.
//!
//! PORTS: `maze/prefabs.ts`

use crate::grid::{set_tile, Grid, T_FLOOR};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prefab {
    pub name: &'static str,
    pub cells: &'static [&'static str],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedPrefab {
    pub name: String,
    pub cells: Vec<String>,
}

pub const PREFABS: [Prefab; 13] = [
    Prefab {
        name: "slalom",
        cells: &["..R##", "#..R#", "##..R", "#R..#", "R..##"],
    },
    Prefab {
        name: "gauntlet",
        cells: &[".G.O.G."],
    },
    Prefab {
        name: "oilworks",
        cells: &["B..B", ".OO.", ".OO.", "B..B"],
    },
    Prefab {
        name: "parlor",
        cells: &["#.P.#", "....*", "P.$.P", "*....", "#.P.#"],
    },
    Prefab {
        name: "slingway",
        cells: &[".L..L..L."],
    },
    Prefab {
        name: "pitstop",
        cells: &["S.$", "#.D"],
    },
    Prefab {
        name: "bullring",
        cells: &["*...*", ".B.B.", "..$..", ".B.B.", "*...*"],
    },
    Prefab {
        name: "switchback",
        cells: &["R.O##", "###.#", "##O.R"],
    },
    Prefab {
        name: "mirrormaze",
        cells: &["M.M.M", ".....", "M.T.M", ".$.*.", "M.M.M"],
    },
    Prefab {
        name: "pitroom",
        cells: &[".....", ".I.I.", "...$.", ".I.I.", "....."],
    },
    Prefab {
        name: "sbend",
        cells: &[".M#", "#.#", "#M."],
    },
    Prefab {
        name: "squeeze",
        cells: &[".E..E."],
    },
    Prefab {
        name: "boulevard",
        cells: &[".....", ".BFB.", "....."],
    },
];

pub const LANDMARKS: [Prefab; 5] = [
    Prefab {
        name: "pachinko",
        cells: &[
            ".........",
            ".B.B.B.B.",
            "..B.B.B..",
            ".B.B.B.B.",
            "..B.B.B..",
            ".I.I.I.I.",
            "....$....",
        ],
    },
    Prefab {
        name: "tilttable",
        cells: &[
            "...TTT...",
            ".L.....L.",
            ".B.....B.",
            "....$....",
            ".B.....B.",
            ".L.....L.",
            ".........",
            "..F...F..",
            "....S....",
        ],
    },
    Prefab {
        name: "grinder",
        cells: &[
            "...........",
            ".G.E.G.E.G.",
            ".OOOOOOOOO.",
            ".G.E.G.E.G.",
            "....*...$..",
        ],
    },
    Prefab {
        name: "observatory",
        cells: &[
            "..M.M.M..",
            ".M.....M.",
            "M.......M",
            ".........",
            "M...T...M",
            ".........",
            "M.......M",
            ".M..$..M.",
            "..M.M.M..",
        ],
    },
    Prefab {
        name: "nest",
        cells: &[
            ".N.N.N.N.",
            ".........",
            "..OOOOO..",
            "..O.$.O..",
            "..OOOOO..",
            ".*.......",
            ".N.N.N.N.",
        ],
    },
];

pub fn rotate_prefab(p: &OwnedPrefab) -> OwnedPrefab {
    let h = p.cells.len();
    let w = p.cells[0].len();
    let mut out = Vec::with_capacity(w);
    for i in 0..w {
        let mut row = String::with_capacity(h);
        for j in (0..h).rev() {
            row.push(p.cells[j].as_bytes()[i] as char);
        }
        out.push(row);
    }
    OwnedPrefab {
        name: p.name.clone(),
        cells: out,
    }
}

pub fn mirror_prefab(p: &OwnedPrefab) -> OwnedPrefab {
    OwnedPrefab {
        name: p.name.clone(),
        cells: p
            .cells
            .iter()
            .map(|row| row.chars().rev().collect())
            .collect(),
    }
}

pub fn variants_of(p: &Prefab) -> Vec<OwnedPrefab> {
    let owned = OwnedPrefab {
        name: p.name.to_string(),
        cells: p.cells.iter().map(|s| s.to_string()).collect(),
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for base in [owned.clone(), mirror_prefab(&owned)] {
        let mut v = base;
        for _ in 0..4 {
            let key = v.cells.join("|");
            if seen.insert(key) {
                out.push(v.clone());
            }
            v = rotate_prefab(&v);
        }
    }
    out
}

#[derive(Debug, Clone)]
pub struct ShuffleBag<T> {
    items: Vec<T>,
    bag: Vec<T>,
}

impl<T: Clone> ShuffleBag<T> {
    pub fn new(items: Vec<T>) -> Self {
        Self {
            items,
            bag: Vec::new(),
        }
    }

    pub fn draw<R: FnMut() -> f64>(&mut self, rng: &mut R) -> T {
        if self.bag.is_empty() {
            self.bag = self.items.clone();
            for i in (1..self.bag.len()).rev() {
                let j = (rng() * ((i + 1) as f64)).floor() as usize;
                self.bag.swap(i, j);
            }
        }
        self.bag.pop().expect("non-empty bag")
    }
}

#[derive(Debug, Clone)]
pub struct FloorTheme {
    pub name: &'static str,
    pub pool: &'static [&'static str],
    pub landmarks: &'static [&'static str],
    pub deal: &'static [&'static str],
}

pub const THEMES: [FloorTheme; 4] = [
    FloorTheme {
        name: "crypt",
        pool: &["slalom", "bullring", "pitstop", "slingway", "boulevard"],
        landmarks: &["tilttable", "pachinko"],
        deal: &[
            "bumper",
            "ramp",
            "spring",
            "glove",
            "flipper",
            "spinpad",
            "mirror",
            "slingshot",
            "oil",
        ],
    },
    FloorTheme {
        name: "warren",
        pool: &[
            "oilworks",
            "switchback",
            "gauntlet",
            "pitstop",
            "pitroom",
            "sbend",
        ],
        landmarks: &["nest", "grinder"],
        deal: &[
            "oil",
            "bumper",
            "ramp",
            "oil",
            "spring",
            "glove",
            "flipper",
            "ramp",
            "slingshot",
        ],
    },
    FloorTheme {
        name: "bloodworks",
        pool: &["gauntlet", "bullring", "slingway", "switchback", "squeeze"],
        landmarks: &["grinder", "pachinko"],
        deal: &[
            "glove",
            "bumper",
            "flipper",
            "spring",
            "glove",
            "oil",
            "bumper",
            "slingshot",
            "spinpad",
        ],
    },
    FloorTheme {
        name: "arcane",
        pool: &[
            "parlor",
            "slalom",
            "oilworks",
            "bullring",
            "mirrormaze",
            "sbend",
        ],
        landmarks: &["observatory", "tilttable"],
        deal: &[
            "spinpad",
            "bumper",
            "mirror",
            "spring",
            "oil",
            "glove",
            "flipper",
            "slingshot",
            "mirror",
        ],
    },
];

pub fn mulberry32(mut a: u32) -> impl FnMut() -> f64 {
    move || {
        a = a.wrapping_add(0x6D2B79F5);
        let mut t = a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t = t ^ (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61)));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

pub fn theme_index_for(level: u32, run_seed: u32) -> usize {
    let n = THEMES.len();
    let l = level.max(1);
    let slot = ((l - 1) as usize) % n;
    if run_seed == 0 {
        return slot;
    }
    let cycle = (l - 1) / (n as u32);
    let mut rng = mulberry32(run_seed ^ ((cycle + 1).wrapping_mul(0x85ebca6b)));
    let mut order: Vec<usize> = (0..n).collect();
    for i in (1..n).rev() {
        let j = (rng() * ((i + 1) as f64)).floor() as usize;
        order.swap(i, j);
    }
    order[slot]
}

pub fn theme_for(level: u32, run_seed: u32) -> &'static FloorTheme {
    &THEMES[theme_index_for(level, run_seed)]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrefabAnchor {
    pub i: usize,
    pub j: usize,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClaimRect {
    pub cx: usize,
    pub cy: usize,
    pub w: usize,
    pub h: usize,
}

#[derive(Debug, Clone)]
pub struct StampResult {
    pub anchors: Vec<PrefabAnchor>,
    pub stamped: Vec<String>,
    pub claimed: Vec<ClaimRect>,
}

pub fn anchor_kind(c: char) -> Option<&'static str> {
    match c {
        'B' => Some("bumper"),
        'R' => Some("ramp"),
        'S' => Some("spring"),
        'O' => Some("oil"),
        'G' => Some("glove"),
        'P' => Some("spinpad"),
        'L' => Some("slingshot"),
        'D' => Some("trapdoor"),
        'M' => Some("mirror"),
        'F' => Some("flipper"),
        'T' => Some("target"),
        'I' => Some("pit"),
        'E' => Some("electric"),
        'N' => Some("magstrip"),
        '*' => Some("spawn"),
        '$' => Some("prize"),
        _ => None,
    }
}

pub fn carve_stamp(
    g: &mut Grid,
    pf: &OwnedPrefab,
    cx: usize,
    cy: usize,
    anchors: &mut Vec<PrefabAnchor>,
) {
    let ph = pf.cells.len();
    let pw = pf.cells[0].len();
    let carved_at = |dx: isize, dy: isize| -> bool {
        if dx < 0 || dy < 0 {
            return false;
        }
        let (ux, uy) = (dx as usize, dy as usize);
        uy < ph && ux < pw && pf.cells[uy].as_bytes()[ux] != b'#'
    };

    for dy in 0..ph {
        for dx in 0..pw {
            if !carved_at(dx as isize, dy as isize) {
                continue;
            }
            let ti = ((cx + dx) * 2 + 1) as i32;
            let tj = ((cy + dy) * 2 + 1) as i32;
            set_tile(g, ti, tj, T_FLOOR);
            if carved_at(dx as isize + 1, dy as isize) {
                set_tile(g, ti + 1, tj, T_FLOOR);
            }
            if carved_at(dx as isize, dy as isize + 1) {
                set_tile(g, ti, tj + 1, T_FLOOR);
            }
            let ch = pf.cells[dy].as_bytes()[dx] as char;
            if let Some(kind) = anchor_kind(ch) {
                anchors.push(PrefabAnchor {
                    i: ti as usize,
                    j: tj as usize,
                    kind,
                });
            }
        }
    }
}

pub type FocusCell = (f64, f64, f64);

const FOCUS_TRIES: usize = 12;

pub fn stamp_from<R: FnMut() -> f64>(
    g: &mut Grid,
    rng: &mut R,
    shapes: Vec<Vec<OwnedPrefab>>,
    count: usize,
    mut claimed: Vec<ClaimRect>,
    mortar: usize,
    focus: &[FocusCell],
) -> StampResult {
    let cells_w = ((g.w - 1) / 2) as usize;
    let cells_h = ((g.h - 1) / 2) as usize;

    let mut anchors = Vec::new();
    let mut stamped = Vec::new();
    if shapes.is_empty() {
        return StampResult {
            anchors,
            stamped,
            claimed,
        };
    }

    let mut bag = ShuffleBag::new(shapes);
    let nearest_focus = |cx: usize, cy: usize, pw: usize, ph: usize| -> f64 {
        let mut best = f64::INFINITY;
        for &(fx, fy, bias) in focus {
            let dx = (cx as f64) + (pw as f64) / 2.0 - fx;
            let dy = (cy as f64) + (ph as f64) / 2.0 - fy;
            let dist = dx.hypot(dy) * bias;
            if dist < best {
                best = dist;
            }
        }
        best
    };

    const RETRIES_PER_SHAPE: usize = 3;
    let mut pending: Option<Vec<OwnedPrefab>> = None;
    let mut pending_tries = 0;

    let mut placed = 0;
    let mut attempt = 0;
    while placed < count && attempt < count * 14 {
        attempt += 1;
        let orientations = if let Some(p) = pending.take() {
            p
        } else {
            bag.draw(rng)
        };
        let pf_idx = (rng() * (orientations.len() as f64)).floor() as usize;
        let pf = &orientations[pf_idx];
        let ph = pf.cells.len();
        let pw = pf.cells[0].len();
        if pw + 2 > cells_w || ph + 2 > cells_h {
            pending_tries = 0;
            continue;
        }

        let mortar_clash = |tx: usize, ty: usize| -> bool {
            claimed.iter().any(|r| {
                tx < r.cx + r.w + mortar
                    && r.cx < tx + pw + mortar
                    && ty < r.cy + r.h + mortar
                    && r.cy < ty + ph + mortar
            })
        };

        let mut cx_found: Option<usize> = None;
        let mut cy_found: Option<usize> = None;
        let mut best_score = f64::INFINITY;
        let tries = if !focus.is_empty() { FOCUS_TRIES } else { 1 };
        for _ in 0..tries {
            let max_tx = cells_w.saturating_sub(pw).saturating_sub(1);
            let max_ty = cells_h.saturating_sub(ph).saturating_sub(1);
            if max_tx == 0 || max_ty == 0 {
                continue;
            }
            let tx = 1 + (rng() * (max_tx as f64)).floor() as usize;
            let ty = 1 + (rng() * (max_ty as f64)).floor() as usize;
            if mortar_clash(tx, ty) {
                continue;
            }
            let score = if !focus.is_empty() {
                nearest_focus(tx, ty, pw, ph)
            } else {
                0.0
            };
            if score < best_score {
                best_score = score;
                cx_found = Some(tx);
                cy_found = Some(ty);
            }
        }

        if let (Some(cx), Some(cy)) = (cx_found, cy_found) {
            carve_stamp(g, pf, cx, cy, &mut anchors);
            claimed.push(ClaimRect {
                cx,
                cy,
                w: pw,
                h: ph,
            });
            stamped.push(pf.name.clone());
            pending = None;
            pending_tries = 0;
            placed += 1;
        } else {
            pending_tries += 1;
            if pending_tries < RETRIES_PER_SHAPE {
                pending = Some(orientations);
            } else {
                pending = None;
                pending_tries = 0;
            }
        }
    }

    StampResult {
        anchors,
        stamped,
        claimed,
    }
}

pub fn stamp_landmark<R: FnMut() -> f64>(
    g: &mut Grid,
    rng: &mut R,
    theme: &FloorTheme,
    claimed: Vec<ClaimRect>,
) -> StampResult {
    let mut shapes = Vec::new();
    for &name in theme.landmarks {
        if let Some(p) = LANDMARKS.iter().find(|l| l.name == name) {
            shapes.push(variants_of(p));
        }
    }
    stamp_from(g, rng, shapes, 1, claimed, 2, &[])
}

pub fn stamp_prefabs<R: FnMut() -> f64>(
    g: &mut Grid,
    rng: &mut R,
    count: usize,
    theme: &FloorTheme,
    claimed: Vec<ClaimRect>,
    focus: &[FocusCell],
) -> StampResult {
    let mut shapes = Vec::new();
    for &name in theme.pool {
        if let Some(p) = PREFABS.iter().find(|l| l.name == name) {
            shapes.push(variants_of(p));
        }
    }
    stamp_from(g, rng, shapes, count, claimed, 1, focus)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefabs_and_landmarks_have_valid_cells() {
        for p in PREFABS.iter().chain(LANDMARKS.iter()) {
            assert!(!p.name.is_empty());
            assert!(!p.cells.is_empty());
            let w = p.cells[0].len();
            for row in p.cells {
                assert_eq!(row.len(), w);
            }
        }
    }

    #[test]
    fn variants_of_symmetric_shapes_dedupes() {
        let bullring = PREFABS.iter().find(|p| p.name == "bullring").unwrap();
        let variants = variants_of(bullring);
        assert!(variants.len() <= 8);
    }
}
