//! OPEN SPACE — where the floor's furniture ISN'T, as numbers with bands.
//!
//! Port of `legacy/src/game/pinball-knight/maze/open-space.ts` (415 lines).
//!
//! PORTS: `maze/open-space.ts`

use super::doorways::{clearance_field, label_sections};
use super::track_launch::TilePos;
use crate::grid::{idx, is_walkable, Grid};

/// Chamfer weights, x3. Identical to `clearance_field`'s so that a barren reading
/// and a clearance reading are in the same units.
pub const ORTH: i32 = 3;
pub const DIAG: i32 = 4;

/// A walkable tile no part can reach at all (sealed pocket, or no parts).
pub const BARREN_UNREACHED: i32 = -1;

/// How far you may travel over open floor before meeting something, in TILES (0.80s at BOOSTER_SPEED).
pub const R_DEAD: i32 = 12;

/// `R_DEAD` in the field's own x3 units.
pub const R_DEAD_3: i32 = R_DEAD * ORTH;

const STEPS: &[(i32, i32, i32)] = &[
    (1, 0, ORTH),
    (-1, 0, ORTH),
    (0, 1, ORTH),
    (0, -1, ORTH),
    (1, 1, DIAG),
    (1, -1, DIAG),
    (-1, 1, DIAG),
    (-1, -1, DIAG),
];

/// Geodesic distance (x3) from every walkable tile to the nearest tile holding a part,
/// over walkable tiles only. Implements Dial's algorithm with a 5-bucket wheel for O(V) performance.
pub fn barren_field(g: &Grid, parts: &[TilePos]) -> Vec<i32> {
    let n = (g.w * g.h) as usize;
    let mut dist = vec![BARREN_UNREACHED; n];
    const WHEEL: usize = (DIAG + 1) as usize; // 5 buckets
    let mut buckets: [Vec<usize>; WHEEL] = [
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    ];
    let mut live = 0;

    for p in parts {
        if p.i < 0 || p.j < 0 || p.i >= g.w || p.j >= g.h {
            continue;
        }
        if !is_walkable(g, p.i, p.j) {
            continue;
        }
        let k = idx(g, p.i, p.j);
        if dist[k] == 0 {
            continue; // two parts on one tile
        }
        dist[k] = 0;
        buckets[0].push(k);
        live += 1;
    }
    if live == 0 {
        return dist;
    }

    let mut d = 0_i32;
    let mut batch = Vec::new();

    while live > 0 {
        let b_idx = (d as usize) % WHEEL;
        if buckets[b_idx].is_empty() {
            d += 1;
            continue;
        }

        // Drain current bucket
        batch.clear();
        std::mem::swap(&mut batch, &mut buckets[b_idx]);

        for &k in &batch {
            live -= 1;
            if dist[k] != d {
                continue;
            }
            let x = (k % (g.w as usize)) as i32;
            let y = (k / (g.w as usize)) as i32;

            for &(di, dj, cost) in STEPS {
                let nx = x + di;
                let ny = y + dj;
                if nx < 0 || ny < 0 || nx >= g.w || ny >= g.h {
                    continue;
                }
                if !is_walkable(g, nx, ny) {
                    continue;
                }
                let nk = idx(g, nx, ny);
                let nd = d + cost;
                if dist[nk] != BARREN_UNREACHED && dist[nk] <= nd {
                    continue;
                }
                dist[nk] = nd;
                buckets[(nd as usize) % WHEEL].push(nk);
                live += 1;
            }
        }

        d += 1;
    }

    dist
}

/// One labelled section's furniture, for the per-room rollup.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionDensity {
    pub id: usize,
    pub tiles: usize,
    pub parts: usize,
    pub parts_per_1k: f64,
    /// Worst barren reading inside this section, in TILES.
    pub max_barren: f64,
    /// Centroid coords.
    pub ci: i32,
    pub cj: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenSpaceMetrics {
    pub walkable: usize,
    pub parts: usize,
    /// The furthest you can travel from the emptiest walkable tile before meeting anything, in TILES.
    pub worst_barren: f64,
    /// Share of walkable tiles whose barren reading exceeds `R_DEAD`.
    pub dead_share: f64,
    /// Share of walkable tiles that are BOTH open and barren past `R_DEAD`.
    pub open_dead_share: f64,
    /// Walkable tiles that are open by the clearance test.
    pub open_tiles: usize,
    pub sections: Vec<SectionDensity>,
    /// Largest section parts/1k over the whole floor's parts/1k.
    pub biggest_section_ratio: f64,
}

/// Measure open space distribution on one floor.
pub fn measure_open_space(g: &Grid, parts: &[TilePos], cl: Option<&[i32]>) -> OpenSpaceMetrics {
    let cl_buf;
    let clearance = match cl {
        Some(c) => c,
        None => {
            cl_buf = clearance_field(g);
            &cl_buf
        }
    };
    let sec = label_sections(g, clearance, None);
    let barren = barren_field(g, parts);
    let open_min = SECTION_CLEARANCE * ORTH;

    let mut walkable = 0;
    let mut open_tiles = 0;
    let mut dead = 0;
    let mut open_dead = 0;
    let mut worst3 = 0;

    let num_secs = sec.sizes.len();
    let mut sec_tiles = vec![0_usize; num_secs];
    let mut sec_parts = vec![0_usize; num_secs];
    let mut sec_worst = vec![0_i32; num_secs];
    let mut sec_sum_i = vec![0_i64; num_secs];
    let mut sec_sum_j = vec![0_i64; num_secs];

    for j in 0..g.h {
        for i in 0..g.w {
            if !is_walkable(g, i, j) {
                continue;
            }
            let k = idx(g, i, j);
            walkable += 1;
            let open = clearance[k] >= open_min;
            if open {
                open_tiles += 1;
            }
            let b = barren[k];
            if b == BARREN_UNREACHED {
                continue;
            }
            if b > worst3 {
                worst3 = b;
            }
            let is_dead = b > R_DEAD_3;
            if is_dead {
                dead += 1;
            }
            if is_dead && open {
                open_dead += 1;
            }
            let s = sec.label[k];
            if s >= 0 && (s as usize) < num_secs {
                let su = s as usize;
                sec_tiles[su] += 1;
                sec_sum_i[su] += i as i64;
                sec_sum_j[su] += j as i64;
                if b > sec_worst[su] {
                    sec_worst[su] = b;
                }
            }
        }
    }

    for p in parts {
        if p.i < 0 || p.j < 0 || p.i >= g.w || p.j >= g.h {
            continue;
        }
        let s = sec.label[idx(g, p.i, p.j)];
        if s >= 0 && (s as usize) < num_secs {
            sec_parts[s as usize] += 1;
        }
    }

    let mut sections = Vec::with_capacity(num_secs);
    for s in 0..num_secs {
        let t = sec_tiles[s];
        let p = sec_parts[s];
        sections.push(SectionDensity {
            id: s,
            tiles: t,
            parts: p,
            parts_per_1k: if t > 0 { (p as f64 * 1000.0) / t as f64 } else { 0.0 },
            max_barren: sec_worst[s] as f64 / ORTH as f64,
            ci: if t > 0 { (sec_sum_i[s] as f64 / t as f64).round() as i32 } else { 0 },
            cj: if t > 0 { (sec_sum_j[s] as f64 / t as f64).round() as i32 } else { 0 },
        });
    }

    let floor_per_1k = if walkable > 0 {
        (parts.len() as f64 * 1000.0) / walkable as f64
    } else {
        0.0
    };
    let biggest = sections.iter().max_by_key(|s| s.tiles);
    let biggest_section_ratio = match biggest {
        Some(b) if floor_per_1k > 0.0 => b.parts_per_1k / floor_per_1k,
        _ => 0.0,
    };

    OpenSpaceMetrics {
        walkable,
        parts: parts.len(),
        worst_barren: worst3 as f64 / ORTH as f64,
        dead_share: if walkable > 0 { dead as f64 / walkable as f64 } else { 0.0 },
        open_dead_share: if walkable > 0 { open_dead as f64 / walkable as f64 } else { 0.0 },
        open_tiles,
        sections,
        biggest_section_ratio,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenSpaceConstraints {
    pub max_worst_barren: f64,
    pub max_dead_share: f64,
    pub max_open_dead_share: f64,
}

pub const DEFAULT_OPEN_SPACE: OpenSpaceConstraints = OpenSpaceConstraints {
    max_worst_barren: 64.0,
    max_dead_share: 0.28,
    max_open_dead_share: 0.11,
};

pub fn check_open_space(m: &OpenSpaceMetrics, c: &OpenSpaceConstraints) -> Vec<String> {
    let mut bad = Vec::new();
    if m.worst_barren > c.max_worst_barren {
        bad.push(format!(
            "worstBarren {:.1} > {} tiles",
            m.worst_barren, c.max_worst_barren
        ));
    }
    if m.dead_share > c.max_dead_share {
        bad.push(format!(
            "deadShare {:.3} > {}",
            m.dead_share, c.max_dead_share
        ));
    }
    if m.open_dead_share > c.max_open_dead_share {
        bad.push(format!(
            "openDeadShare {:.3} > {}",
            m.open_dead_share, c.max_open_dead_share
        ));
    }
    bad
}

pub fn format_open_space(m: &OpenSpaceMetrics) -> String {
    let emptiest = m.sections.iter().max_by(|a, b| a.max_barren.partial_cmp(&b.max_barren).unwrap_or(std::cmp::Ordering::Equal));
    let emptiest_str = match emptiest {
        Some(s) => format!("emptiest section #{} @({},{}) {}t {}p maxBarren {:.1}t", s.id, s.ci, s.cj, s.tiles, s.parts, s.max_barren),
        None => "no sections".into(),
    };
    format!(
        "walkable {}  parts {}\nworstBarren {:.1}t  deadShare {:.1}%  openDeadShare {:.1}%\nsections {}  biggestSectionRatio {:.2}\n{}",
        m.walkable,
        m.parts,
        m.worst_barren,
        m.dead_share * 100.0,
        m.open_dead_share * 100.0,
        m.sections.len(),
        m.biggest_section_ratio,
        emptiest_str
    )
}

pub use super::doorways::{SectionMap, MIN_SECTION_TILES, SECTION_CLEARANCE};
