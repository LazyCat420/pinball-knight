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
//!
//! PORTS: `engine/flow-field.ts`

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

/// The four neighbours, in the order every downhill/uphill scan visits them —
/// N, E, S, W. `flow_step` and `flow_away` both take the FIRST strict
/// improvement, so this order is not decoration: it is the tie-break, and
/// reordering it sends the horde down a different corridor at every junction
/// where two neighbours are equidistant. Same list as the TS `STEPS`
/// (`flow-field.ts:141-146`).
const STEPS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

/// The DOWNHILL step from `(i, j)`: the 4-neighbour with the smallest distance
/// strictly below this tile's. `None` at the seed's own tile, on walls, and
/// anywhere unreachable — port of `flowStep`.
pub fn flow_step(g: &Grid, dist: &[i32], i: i32, j: i32) -> Option<(i32, i32)> {
    let here = *dist.get(idx(g, i, j)).unwrap_or(&-1);
    if here <= 0 {
        return None;
    }
    let mut best = None;
    let mut best_d = here;
    for (di, dj) in STEPS {
        let (ni, nj) = (i + di, j + dj);
        if !is_walkable(g, ni, nj) {
            continue;
        }
        let d = dist[idx(g, ni, nj)];
        if d >= 0 && d < best_d {
            best_d = d;
            best = Some((ni, nj));
        }
    }
    best
}

/// The UPHILL step — one tile FURTHER from whatever the field was seeded on.
///
/// This is how something retreats through a maze rather than away from a
/// compass bearing: straight-line repulsion presses an agent into the nearest
/// wall and slides it along, which is why the oracle's merchant used to ride
/// the map's edge. `None` when no neighbour is further, i.e. cornered.
///
/// ⚠️ The guard is `here < 0`, NOT `here <= 0` as in `flow_step`: fleeing FROM
/// the seed tile is a legitimate move, while stepping downhill from it is not.
pub fn flow_away(g: &Grid, dist: &[i32], i: i32, j: i32) -> Option<(i32, i32)> {
    let here = *dist.get(idx(g, i, j)).unwrap_or(&-1);
    if here < 0 {
        return None;
    }
    let mut best = None;
    let mut best_d = here;
    for (di, dj) in STEPS {
        let (ni, nj) = (i + di, j + dj);
        if !is_walkable(g, ni, nj) {
            continue;
        }
        let d = dist[idx(g, ni, nj)];
        if d > best_d {
            best_d = d;
            best = Some((ni, nj));
        }
    }
    best
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

    /// Walking downhill from the far end of the U arrives at the seed, one
    /// tile per step, following the ROAD and not the straight line.
    #[test]
    fn flow_step_walks_the_field_home() {
        let g = u_shape();
        let d = bfs_distances(&g, 1, 0);
        let (mut i, mut j) = (3, 0); // ten tiles away by road, two in a line
        let mut steps = 0;
        while let Some((ni, nj)) = flow_step(&g, &d, i, j) {
            assert_eq!(
                d[idx(&g, ni, nj)],
                d[idx(&g, i, j)] - 1,
                "every downhill step must descend by exactly one"
            );
            i = ni;
            j = nj;
            steps += 1;
            assert!(steps <= 20, "walk did not terminate");
        }
        assert_eq!((i, j), (1, 0), "downhill must end on the seed tile");
        assert_eq!(steps, 10, "the road is ten tiles, not the two of the crow");
    }

    /// No step exists FROM the seed tile, on a wall, or anywhere unreachable.
    #[test]
    fn flow_step_refuses_where_there_is_no_downhill() {
        let g = u_shape();
        let d = bfs_distances(&g, 1, 0);
        assert_eq!(flow_step(&g, &d, 1, 0), None, "the seed has no downhill");
        assert_eq!(flow_step(&g, &d, 2, 0), None, "a wall has no downhill");
        assert_eq!(flow_step(&g, &d, 9, 9), None, "off-grid is not a step");
    }

    /// THE TIE-BREAK IS THE VISIT ORDER, and it is N/E/S/W.
    ///
    /// On an open floor every equidistant neighbour is an equally good step, so
    /// which one is taken is decided entirely by `STEPS`. That makes the order
    /// a behavioural pin rather than a detail: reorder it and the horde takes a
    /// different corridor at every junction, deterministically and invisibly.
    #[test]
    fn ties_break_in_fixed_north_east_south_west_order() {
        // Open 5x5 room, seeded in the middle.
        let mut g = Grid::solid(5, 5);
        for j in 0..5 {
            for i in 0..5 {
                set_tile(&mut g, i, j, T_FLOOR);
            }
        }
        let d = bfs_distances(&g, 2, 2);
        // (2,0) is two north of the seed. Its neighbours (1,0) and (3,0) are
        // both distance 3, and (2,1) is 1 — the strict downhill is unique here.
        assert_eq!(flow_step(&g, &d, 2, 0), Some((2, 1)));
        // A corner: (0,0) is distance 4, with (1,0) and (0,1) both 3. N is not
        // walkable from the top row, so E wins over S by the STEPS order.
        assert_eq!(d[idx(&g, 1, 0)], d[idx(&g, 0, 1)], "the tie must be real");
        assert_eq!(
            flow_step(&g, &d, 0, 0),
            Some((1, 0)),
            "E must beat S — the tie-break is the STEPS order, not proximity"
        );
        assert_eq!(STEPS[0], (0, -1), "N first");
        assert_eq!(STEPS[1], (1, 0), "then E");
        assert_eq!(STEPS[2], (0, 1), "then S");
        assert_eq!(STEPS[3], (-1, 0), "then W");
    }

    /// `flow_away` climbs, and — unlike `flow_step` — it is legal AT the seed.
    /// The two guards differ (`< 0` vs `<= 0`) and that difference is the whole
    /// of "can something standing on the player flee?".
    #[test]
    fn flow_away_climbs_and_may_start_on_the_seed() {
        let g = u_shape();
        let d = bfs_distances(&g, 1, 0);
        let up = flow_away(&g, &d, 1, 0);
        assert!(up.is_some(), "fleeing FROM the seed tile is a legal move");
        let (ni, nj) = up.unwrap();
        assert!(d[idx(&g, ni, nj)] > d[idx(&g, 1, 0)], "it must climb");
        // At the far end of the road nothing is further — cornered.
        assert_eq!(flow_away(&g, &d, 3, 0), None, "a dead end has no uphill");
    }
}
