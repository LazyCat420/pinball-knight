//! ATLAS NOISE CENSUS — Quantitative metrics for evaluating sprite cell cleanliness.
//!
//! PORTS: `render/atlas-census.ts`

use std::collections::HashSet;

pub const IDX_CLEAR: i32 = -1;
pub const IDX_UNMATCHED: i32 = -2;
pub const OPAQUE_CUTOFF: u8 = 127;

#[derive(Clone, Debug, PartialEq)]
pub struct CellStats {
    pub opaque: usize,
    pub unmatched: usize,
    pub entries: usize,
    pub isolated_pct: f64,
    pub run_len: f64,
}

/// Computes pixel art cleanliness and noise metrics on an RGBA pixel buffer.
pub fn census_cell(
    rgba: &[u8],
    width: usize,
    height: usize,
    palette: &[[u8; 3]],
) -> CellStats {
    let mut map = vec![IDX_CLEAR; width * height];
    let mut opaque = 0;
    let mut unmatched = 0;
    let mut palette_entries = HashSet::new();

    for j in 0..height {
        for i in 0..width {
            let p_idx = (j * width + i) * 4;
            let a = rgba.get(p_idx + 3).copied().unwrap_or(0);
            if a > OPAQUE_CUTOFF {
                opaque += 1;
                let r = rgba[p_idx];
                let g = rgba[p_idx + 1];
                let b = rgba[p_idx + 2];

                let mut matched_idx = None;
                for (p_i, pal_rgb) in palette.iter().enumerate() {
                    if pal_rgb[0] == r && pal_rgb[1] == g && pal_rgb[2] == b {
                        matched_idx = Some(p_i as i32);
                        break;
                    }
                }

                if let Some(m_idx) = matched_idx {
                    map[j * width + i] = m_idx;
                    palette_entries.insert(m_idx);
                } else {
                    map[j * width + i] = IDX_UNMATCHED;
                    unmatched += 1;
                }
            }
        }
    }

    if opaque == 0 {
        return CellStats {
            opaque: 0,
            unmatched: 0,
            entries: 0,
            isolated_pct: 0.0,
            run_len: 0.0,
        };
    }

    // Isolated pixel count: opaque texels with NO orthogonal same-index neighbour
    let mut isolated = 0;
    for j in 0..height {
        for i in 0..width {
            let idx = map[j * width + i];
            if idx >= 0 {
                let mut has_neighbor = false;
                let neighbors = [
                    (i.wrapping_sub(1), j, i > 0),
                    (i + 1, j, i + 1 < width),
                    (i, j.wrapping_sub(1), j > 0),
                    (i, j + 1, j + 1 < height),
                ];
                for (nx, ny, valid) in neighbors {
                    if valid && map[ny * width + nx] == idx {
                        has_neighbor = true;
                        break;
                    }
                }
                if !has_neighbor {
                    isolated += 1;
                }
            }
        }
    }

    // Mean horizontal run length
    let mut runs = Vec::new();
    for j in 0..height {
        let mut cur_idx = IDX_CLEAR;
        let mut cur_len = 0;
        for i in 0..width {
            let idx = map[j * width + i];
            if idx >= 0 {
                if idx == cur_idx {
                    cur_len += 1;
                } else {
                    if cur_len > 0 {
                        runs.push(cur_len);
                    }
                    cur_idx = idx;
                    cur_len = 1;
                }
            } else {
                if cur_len > 0 {
                    runs.push(cur_len);
                    cur_len = 0;
                }
                cur_idx = IDX_CLEAR;
            }
        }
        if cur_len > 0 {
            runs.push(cur_len);
        }
    }

    let run_len = if !runs.is_empty() {
        runs.iter().sum::<usize>() as f64 / runs.len() as f64
    } else {
        0.0
    };

    CellStats {
        opaque,
        unmatched,
        entries: palette_entries.len(),
        isolated_pct: (isolated as f64 / opaque as f64) * 100.0,
        run_len,
    }
}
