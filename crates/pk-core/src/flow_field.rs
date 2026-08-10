//! BFS distance fields — port of `legacy/src/game/pinball-knight/engine/flow-field.ts`.
//!
//! In the shipping game this is the horde's pathing: one BFS per `FLOW_INTERVAL`
//! from the player's tile, and every zombie walks downhill on it. In the
//! GENERATOR it is the ruler — `pick_track_endpoints` measures the floor's
//! diameter with two sweeps of it, and `trace_artery` follows one downhill.
//!
//! ## The scratch buffer is deliberately NOT ported
//!
//! The TS keeps two module-level `Int32Array`s and hands back a reference to
//! one, because a fresh 210 KB field four times a second is ~0.8 MB/s of
//! garbage and GC pauses feel exactly like the hitching that pass was chasing.
//! It then needs a second entry point (`bfsDistancesOwned`) and a ⚠️ on the
//! first, because a retained field silently becomes some other query's answer.
//!
//! Rust has no such problem to solve: returning `Vec<i32>` is one allocation
//! the caller owns, and the borrow checker makes the aliasing bug unwritable.
//! When the per-frame field lands (P4) it wants a caller-supplied buffer, which
//! is the same optimisation without the shared-mutable-state seam. The
//! GENERATOR's uses are all one-shot, and two of them
//! (`pick_track_endpoints`'s `far`, `start_band`) hold a field across further
//! queries — i.e. they are `bfsDistancesOwned` callers in all but name.
//!
//! Bit-exactness note: this function's output is INTEGER, so it carries no
//! float hazard at all. What it does carry is a visit ORDER — the four
//! neighbours are examined up, down, left, right, and the queue is FIFO — and
//! the order decides nothing about the distances but everything about which of
//! several equidistant tiles a consumer's `>` comparison reaches first.

use crate::grid::{idx, is_walkable, Grid};

/// Distance in tiles from `(si, sj)` to every walkable tile; `-1` where
/// unreachable, and `-1` everywhere when the seed itself is not walkable.
///
/// A 4-neighbourhood, never 8: diagonals would let the horde clip wall corners.
pub fn bfs_distances(g: &Grid, si: i32, sj: i32) -> Vec<i32> {
    let n = (g.w * g.h) as usize;
    let mut dist = vec![-1_i32; n];
    if !is_walkable(g, si, sj) {
        return dist;
    }

    // Fixed-capacity queue: a BFS visits each tile at most once, so `n` entries
    // is a hard upper bound and it can never overflow. Kept as an explicit
    // head/tail pair rather than a `VecDeque` to mirror the TS exactly — same
    // pops, same order.
    let mut queue = vec![0_i32; n];
    let w = g.w as usize;
    queue[0] = idx(g, si, sj) as i32;
    let mut tail = 1_usize;
    dist[queue[0] as usize] = 0;
    let mut head = 0_usize;

    while head < tail {
        let cur = queue[head] as usize;
        head += 1;
        let ci = (cur % w) as i32;
        let cj = (cur / w) as i32;
        let d = dist[cur] + 1;

        // The four probes in the TS order: -j, +j, -i, +i. Each one indexes off
        // `cur` arithmetically (`cur - g.w`, `cur + 1`, …) which is only sound
        // because `is_walkable` has already rejected the out-of-range tile — so
        // the bounds check and the index are two separate statements, exactly as
        // they are there.
        if is_walkable(g, ci, cj - 1) && dist[cur - w] == -1 {
            dist[cur - w] = d;
            queue[tail] = (cur - w) as i32;
            tail += 1;
        }
        if is_walkable(g, ci, cj + 1) && dist[cur + w] == -1 {
            dist[cur + w] = d;
            queue[tail] = (cur + w) as i32;
            tail += 1;
        }
        if is_walkable(g, ci - 1, cj) && dist[cur - 1] == -1 {
            dist[cur - 1] = d;
            queue[tail] = (cur - 1) as i32;
            tail += 1;
        }
        if is_walkable(g, ci + 1, cj) && dist[cur + 1] == -1 {
            dist[cur + 1] = d;
            queue[tail] = (cur + 1) as i32;
            tail += 1;
        }
    }

    dist
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::{set_tile, T_FLOOR};

    /// A 5×5 with a wall down the middle column, open at the bottom row: the
    /// field has to go AROUND, which is the whole reason the generator measures
    /// with a BFS instead of `hypot`.
    fn u_shape() -> Grid {
        let mut g = Grid::solid(5, 5);
        for j in 0..5 {
            set_tile(&mut g, 1, j, T_FLOOR);
            set_tile(&mut g, 3, j, T_FLOOR);
        }
        set_tile(&mut g, 2, 4, T_FLOOR);
        g
    }

    #[test]
    fn distances_follow_the_walkable_route_not_the_straight_line() {
        let g = u_shape();
        let d = bfs_distances(&g, 1, 0);
        assert_eq!(d[idx(&g, 1, 0)], 0);
        assert_eq!(d[idx(&g, 1, 4)], 4);
        // (3,0) is two tiles away in a straight line and TEN by road: down
        // column 1 (4), across the bottom (2), back up column 3 (4).
        assert_eq!(d[idx(&g, 3, 0)], 10);
        assert_eq!(d[idx(&g, 2, 0)], -1, "a wall tile stays unreachable");
    }

    #[test]
    fn an_unwalkable_seed_returns_a_field_of_minus_one() {
        let g = u_shape();
        let d = bfs_distances(&g, 2, 0);
        assert!(d.iter().all(|&x| x == -1));
    }

    /// Not a nicety — `pick_track_endpoints` runs a sweep, then runs another
    /// from the result. The TS returns SHARED scratch there and gets away with
    /// it by never overlapping; this asserts the Rust field is genuinely the
    /// caller's, so a future consumer that does overlap cannot be silently
    /// answered by the wrong query.
    #[test]
    fn two_fields_coexist() {
        let g = u_shape();
        let a = bfs_distances(&g, 1, 0);
        let b = bfs_distances(&g, 3, 0);
        assert_eq!(a[idx(&g, 3, 0)], 10);
        assert_eq!(b[idx(&g, 3, 0)], 0);
        assert_eq!(a[idx(&g, 1, 0)], 0);
    }
}
