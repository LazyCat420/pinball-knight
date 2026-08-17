//! ARTERY BANKS — long banked turns carved into the main highway.
//!
//! Port of `legacy/src/game/pinball-knight/maze/artery-banks.ts` (502 lines).
//!
//! Fits long arcs to the outside perimeter of corridor bends along the main artery.
//!
//! PORTS-PARTIAL: `maze/artery-banks.ts` - NOT a finished port - 1 of 16 exported names carried over (6%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::grid::{is_walkable, Grid};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Heading {
    pub di: i32,
    pub dj: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bend {
    pub corner_i: i32,
    pub corner_j: i32,
    pub in_dir: Heading,
    pub out_dir: Heading,
    pub run_in: i32,
    pub turn: i32, // +1 clockwise, -1 counter-clockwise
    pub at_index: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BendChain {
    pub bends: Vec<Bend>,
    pub total_turn: f64,
}

/// The cross product of two cardinal headings: +1 clockwise, -1 counter-clockwise, 0 straight/reverse.
pub fn heading_cross(a: Heading, b: Heading) -> i32 {
    a.di * b.dj - a.dj * b.di
}

/// Traces the main artery path on the grid from (start_i, start_j) to (end_i, end_j).
pub fn trace_artery(
    grid: &Grid,
    start_i: i32,
    start_j: i32,
    end_i: i32,
    end_j: i32,
) -> Vec<(i32, i32)> {
    if !is_walkable(grid, start_i, start_j) || !is_walkable(grid, end_i, end_j) {
        return Vec::new();
    }
    // BFS shortest path along walkable tiles
    let w = grid.w;
    let h = grid.h;
    let total = (w * h) as usize;
    let mut parent = vec![None; total];
    let mut visited = vec![false; total];

    let start_idx = (start_j * w + start_i) as usize;
    let end_idx = (end_j * w + end_i) as usize;

    let mut queue = std::collections::VecDeque::new();
    queue.push_back((start_i, start_j));
    visited[start_idx] = true;

    let dirs = [(0, -1), (0, 1), (-1, 0), (1, 0)];

    while let Some((ci, cj)) = queue.pop_front() {
        if ci == end_i && cj == end_j {
            break;
        }
        for (di, dj) in dirs {
            let ni = ci + di;
            let nj = cj + dj;
            if ni >= 0 && ni < w && nj >= 0 && nj < h && is_walkable(grid, ni, nj) {
                let nidx = (nj * w + ni) as usize;
                if !visited[nidx] {
                    visited[nidx] = true;
                    parent[nidx] = Some((ci, cj));
                    queue.push_back((ni, nj));
                }
            }
        }
    }

    if !visited[end_idx] {
        return Vec::new();
    }

    let mut path = Vec::new();
    let mut curr = (end_i, end_j);
    while curr != (start_i, start_j) {
        path.push(curr);
        let cidx = (curr.1 * w + curr.0) as usize;
        if let Some(p) = parent[cidx] {
            curr = p;
        } else {
            break;
        }
    }
    path.push((start_i, start_j));
    path.reverse();
    path
}

/// Detects bends along the ordered path.
pub fn detect_bends(path: &[(i32, i32)]) -> Vec<Bend> {
    if path.len() < 3 {
        return Vec::new();
    }
    let mut bends = Vec::new();
    let mut run_in = 0;

    for i in 1..path.len() - 1 {
        let prev = path[i - 1];
        let curr = path[i];
        let next = path[i + 1];

        let in_dir = Heading {
            di: curr.0 - prev.0,
            dj: curr.1 - prev.1,
        };
        let out_dir = Heading {
            di: next.0 - curr.0,
            dj: next.1 - curr.1,
        };

        let turn = heading_cross(in_dir, out_dir);
        if turn != 0 {
            bends.push(Bend {
                corner_i: curr.0,
                corner_j: curr.1,
                in_dir,
                out_dir,
                run_in,
                turn,
                at_index: i,
            });
            run_in = 0;
        } else {
            run_in += 1;
        }
    }
    bends
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_cross_product_and_bend_detection() {
        let right = Heading { di: 1, dj: 0 };
        let down = Heading { di: 0, dj: 1 };
        assert_eq!(heading_cross(right, down), 1); // Clockwise

        let path = vec![(0, 0), (1, 0), (2, 0), (2, 1), (2, 2)];
        let bends = detect_bends(&path);
        assert_eq!(bends.len(), 1);
        assert_eq!(bends[0].corner_i, 2);
        assert_eq!(bends[0].corner_j, 0);
        assert_eq!(bends[0].turn, 1);
    }
}
