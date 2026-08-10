//! SOCKETS — the plumbing repair passes. Port of `maze/track-socket.ts`.
//!
//! ## What the module is for
//!
//! The growth model in [`super::track_grow`] makes an interesting layout but not
//! a legible one. Measured on 20 generated floors before this existed: **105.8
//! dead ends** per floor (a walkable tile walled on three sides), **116.4 wall
//! stubs** (a wall tile with 3+ open neighbours — the nubs that jut into a room
//! and read as unfinished), and 11.3% of launchers firing into a wall within
//! three tiles. That is what made a floor read as "a bunch of walls that go
//! nowhere".
//!
//! The legacy header frames it as the CONSTRAINT-and-CHECK half of Wave Function
//! Collapse applied as a repair pass over a grid someone else generated — the
//! edge-compatibility table and the violation scan are the check, and the three
//! functions here are the repair.
//!
//! ## What is ported and what is not, deliberately
//!
//! Ported: the three passes the pipeline's `repair()` closure runs
//! ([`uncarve_dead_ends`], [`remove_wall_stubs`], [`heal_road_terminations`]),
//! plus the two predicates they stand on ([`near_sealed`],
//! [`find_road_terminations`]).
//!
//! NOT ported yet, and not by oversight: `socketAt` / `compatible` /
//! `findSocketViolations` (the acceptance scan — a gate script, not a pipeline
//! pass, and it belongs with the floor-rules port) and `clearRun` / `aimLauncher`
//! (parts placement, which is `decorate.ts`'s half B). Nothing in `PASS_ORDER`
//! calls them, so porting them here would be code with no oracle behind it.
//!
//! ## None of this draws
//!
//! Not one of these functions takes an rng, so the `repair-1` boundary's draw
//! count is identical to `grow-maze`'s — as is `connect_all`'s, which takes an
//! rng in the TS and never uses it. The gate at that boundary is therefore the
//! seven grid digests and the six counts, and nothing else.
//!
//! Measured on the ten corpus floors, which is what the digests are actually
//! made of:
//!
//! | | per floor |
//! |---|---|
//! | uncarve filled | 81-244 tiles (budget 296-1,044 — **it never binds**) |
//! | `connect_all` carved | **0, on every floor** |
//! | de-stub opened | 195-695 tiles |
//! | heal joined / demoted | 0 / 0-3 |
//!
//! So the `t` digest is carried almost entirely by uncarve and de-stub, `lane` by
//! the handful of demotions, and the sabotage sweep in `track_floor`'s header
//! reads directly off this table: the two passes doing hundreds of tiles' worth
//! of work are well gated, and the one doing nothing gates nothing.

use super::TrackMask;
use crate::grid::{at, idx, is_walkable, set_tile, Grid, T_CRACKED, T_FLOOR, T_STAIRS, T_WALL};
use crate::maze::track_launch::TilePos;

/// The four cardinal edges of a tile, in the fixed order the legacy `DIRS`
/// declares. It is a TIE-BREAK, not a set: `heal_road_terminations` scans it for
/// the nearest rejoin and takes the first at the winning distance, and
/// `uncarve_dead_ends` pushes newly-suspect neighbours onto a stack in this
/// order, which is the order they are popped in reverse.
pub const DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

/// Does a SEALED lane tile (see [`TrackMask::sealed`]) sit within two tiles?
///
/// Two rather than one because the repair passes reason about MEMBRANES: a wall
/// directly against the lane is the seal, and the one behind it is what stops
/// the seal from being a single tile thick — and a one-tile membrane is exactly
/// what [`remove_wall_stubs`] is built to delete.
pub fn near_sealed(g: &Grid, mask: &TrackMask, i: i32, j: i32) -> bool {
    for dj in -2..=2 {
        for di in -2..=2 {
            let x = i + di;
            let y = j + dj;
            if x < 0 || y < 0 || x >= g.w || y >= g.h {
                continue;
            }
            if mask.sealed[idx(g, x, y)] == 1 {
                return true;
            }
        }
    }
    false
}

/// ROAD TERMINATIONS — the real "highway that stops in mid-air".
///
/// A lane tile is a termination when the circuit cannot continue through it:
/// every neighbour is either solid or off-circuit. Riding into one at speed is
/// the moment the floor stops making sense, and it is the defect an
/// edge-compatibility table cannot express — a road's SIDES are walls by
/// definition (the legacy table forbade `road`↔`wall` at first and reported
/// ~2800 violations per floor, every one of them a road's own shoulder); only
/// its ENDS matter, and that is a property of the whole neighbourhood.
///
/// `exempt` is the spawn and the stairs: legitimately where the ride starts and
/// stops.
pub fn find_road_terminations(g: &Grid, mask: &TrackMask, exempt: &[TilePos]) -> Vec<TilePos> {
    let skip: Vec<usize> = exempt.iter().map(|p| idx(g, p.i, p.j)).collect();
    let mut out: Vec<TilePos> = Vec::new();
    for j in 1..g.h - 1 {
        for i in 1..g.w - 1 {
            let k = idx(g, i, j);
            if mask.lane[k] != 1 || !is_walkable(g, i, j) || skip.contains(&k) {
                continue;
            }
            let mut onward = 0;
            for (di, dj) in DIRS {
                let x = i + di;
                let y = j + dj;
                if is_walkable(g, x, y) && mask.lane[idx(g, x, y)] == 1 {
                    onward += 1;
                }
            }
            // 0 = an isolated lane tile, 1 = the road literally ends here.
            if onward <= 1 {
                out.push(TilePos { i, j });
            }
        }
    }
    out
}

/// UNCARVE — fill dead ends back in, cascading.
///
/// The classic pass from Nystrom's "Rooms and Mazes": a floor tile with walls on
/// three sides leads nowhere, so fill it; that may turn its one open neighbour
/// into a new dead end, so repeat. A worklist rather than repeated full sweeps,
/// because each fill only ever creates candidates among its own neighbours.
///
/// Two rules keep it safe and both matter: never uncarve a ROAD tile (the
/// circuit is the thing being protected, and a dead-end-looking lane tile is a
/// deliberate spur), and never uncarve a PROTECTED tile — filling in the stairs
/// would strand the run, which is the worst bug this generator can ship.
///
/// ⚠️ **THE LEGACY COMMENT'S ORDERING RATIONALE IS WRONG, and it is kept here
/// because the wrong version is the intuitive one.** It reads: *"Because it only
/// ever turns floor→wall it can DISCONNECT things, which is why it must run
/// before the final connectivity guarantee, not after."* The premise is true of
/// floor→wall passes in general and false of THIS one: `is_dead_end` requires
/// `open <= 1`, so every tile it fills is a leaf (or already isolated), and
/// removing a leaf from a 4-connected component leaves it connected. Measured —
/// `connect_all` carves **0 tiles on 10/10 corpus floors** behind this pass, and
/// `repair_1_stands_on_a_floor_that_is_already_connected` pins that.
///
/// The order is still right, for the other three call sites: at `repair-2` and
/// after, the CURVE passes fill concave corner pockets floor→wall with no degree
/// constraint at all, and those genuinely can strand a pocket.
///
/// ⚠️ **THE BUDGET IS NOT OPTIONAL.** An unbounded cascade does not trim stubs,
/// it UNRAVELS the maze: a 1-wide corridor that dead-ends has every tile become
/// a dead end the moment the one ahead of it is filled, so the whole passage
/// zips out of existence. Run unbounded this reduced off-track room floor to
/// **1.5% of the grid** — the maze disappeared and the floor read as one track
/// blob with nothing around it. `max_fill` is a fraction of open floor so it
/// scales with floor size.
///
/// Returns how many tiles were filled.
pub fn uncarve_dead_ends(
    g: &mut Grid,
    mask: Option<&TrackMask>,
    protected_tiles: &[TilePos],
    max_rounds: Option<i64>,
    max_fill_frac: Option<f64>,
) -> i64 {
    let keep: Vec<usize> = protected_tiles.iter().map(|p| idx(g, p.i, p.j)).collect();
    let mut open_count = 0_i64;
    for j in 0..g.h {
        for i in 0..g.w {
            if is_walkable(g, i, j) {
                open_count += 1;
            }
        }
    }
    // `Math.round` on a positive value — half UP, which `f64::round`'s half-away
    // -from-zero agrees with here because the product cannot be negative.
    let max_fill = ((open_count as f64) * max_fill_frac.unwrap_or(0.12))
        .round()
        .max(0.0) as i64;

    // A closure would need `&Grid` while the caller holds `&mut`, so this is a
    // free fn taking what it reads. Same predicate, same order of rejections.
    fn is_dead_end(g: &Grid, mask: Option<&TrackMask>, keep: &[usize], i: i32, j: i32) -> bool {
        if !is_walkable(g, i, j) {
            return false;
        }
        let k = idx(g, i, j);
        if keep.contains(&k) {
            return false;
        }
        if at(g, i, j) == T_STAIRS {
            return false;
        }
        if let Some(m) = mask {
            if m.lane[k] == 1 {
                return false; // never touch the circuit
            }
        }
        let mut open = 0;
        for (di, dj) in DIRS {
            if is_walkable(g, i + di, j + dj) {
                open += 1;
            }
        }
        open <= 1
    }

    // A STACK popped from the END, seeded row-major — so the sweep is worked
    // through backwards, and each fill's neighbours are examined before the rest
    // of the seed list. Both facts are load-bearing: `max_fill` cuts the cascade
    // off partway on some floors, and WHICH tiles were reached by then is
    // decided entirely by this order.
    let mut work: Vec<usize> = Vec::new();
    for j in 1..g.h - 1 {
        for i in 1..g.w - 1 {
            if is_dead_end(g, mask, &keep, i, j) {
                work.push(idx(g, i, j));
            }
        }
    }

    let mut filled = 0_i64;
    let cap = max_rounds.unwrap_or(40) * i64::from(g.w) * i64::from(g.h);
    let mut guard = 0_i64;
    let w = g.w as usize;
    while !work.is_empty() && guard < cap && filled < max_fill {
        guard += 1;
        let k = work.pop().unwrap();
        let i = (k % w) as i32;
        let j = (k / w) as i32;
        if !is_dead_end(g, mask, &keep, i, j) {
            continue;
        }
        set_tile(g, i, j, T_WALL);
        filled += 1;
        // Its neighbours may have just become dead ends.
        for (di, dj) in DIRS {
            let x = i + di;
            let y = j + dj;
            if x > 0 && y > 0 && x < g.w - 1 && y < g.h - 1 && is_dead_end(g, mask, &keep, x, y) {
                work.push(idx(g, x, y));
            }
        }
    }
    filled
}

/// DE-STUB — remove wall nubs poking into open space.
///
/// A wall tile with three or more open neighbours is a one-tile spike sticking
/// into a room. It is not a wall in any readable sense, and at pinball speed it
/// is worse than an eyesore: it is a random deflector in the middle of a lane.
/// Carving wall→floor only ever ADDS connectivity, so unlike
/// [`uncarve_dead_ends`] this is safe to run at any point.
///
/// Exempt, all three for the same reason — they are AUTHORED, not left over:
/// cracked (secret) walls, a curve's rim (`arc_idx >= 0`), and anything within
/// two tiles of a SEALED lane. That last one was live: opening a side wall of
/// the plunger hallway turns it into a corridor with a hole in it, and this pass
/// was doing exactly that on 23/60 floors.
///
/// ⚠️ **ITERATE TO A FIXED POINT, and the cap was the bug.** One pass is not
/// enough — opening a stub raises the open-neighbour count of the walls around
/// it, so its neighbours become stubs in turn (measured: 86 stubs down to 19,
/// and the 19 survivors were exactly the ones the first pass created). The cap
/// was 6, which is not a fixed point, it is "six waves"; the loop already exits
/// early when a round finds nothing, so the cap only ever bound on floors that
/// needed more, and on those it stopped MID-CASCADE and shipped the stubs its
/// own previous round had manufactured. Silently. It surfaced as the piece gate
/// going 0 → 9 violations per 150 floors after `perimeter_bias` moved the chute
/// to the map edge — a change that touches no repair pass; raising the cap took
/// both regimes to 0/150. **32 is a runaway guard, not an operative value.**
pub fn remove_wall_stubs(
    g: &mut Grid,
    mask: Option<&TrackMask>,
    min_open: i32,
    max_rounds: i32,
) -> i64 {
    let mut total = 0_i64;
    let w = g.w as usize;
    for _round in 0..max_rounds {
        let mut doomed: Vec<usize> = Vec::new();
        for j in 1..g.h - 1 {
            for i in 1..g.w - 1 {
                if is_walkable(g, i, j) {
                    continue;
                }
                if at(g, i, j) == T_CRACKED {
                    continue; // secret walls are deliberate
                }
                if let Some(ai) = g.arc_idx.as_ref() {
                    if ai[idx(g, i, j)] >= 0 {
                        continue; // a curve's rim
                    }
                }
                if let Some(m) = mask {
                    if near_sealed(g, m, i, j) {
                        continue;
                    }
                }
                let mut open = 0;
                for (di, dj) in DIRS {
                    if is_walkable(g, i + di, j + dj) {
                        open += 1;
                    }
                }
                if open >= min_open {
                    doomed.push(idx(g, i, j));
                }
            }
        }
        if doomed.is_empty() {
            break;
        }
        // Collected first, then applied: filling as we scan would let one
        // removal change the neighbour count of a tile not yet examined, so the
        // result would depend on scan order rather than on the input.
        for k in &doomed {
            set_tile(g, (k % w) as i32, (k / w) as i32, T_FLOOR);
        }
        total += doomed.len() as i64;
    }
    total
}

/// What one [`heal_road_terminations`] sweep did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Healed {
    pub joined: i64,
    pub demoted: i64,
}

/// HEAL road terminations — a lane that ends in mid-air is reconnected or
/// DEMOTED.
///
/// Two outcomes, and the choice is the point. If another lane tile sits within
/// `reach` along a straight run, carve the wall between them and the stub
/// becomes a real shortcut. Otherwise drop it from the lane mask: it stays
/// walkable (nothing is stranded) but stops claiming to be track, so no booster
/// or bank is sited along it and it no longer reads as a highway to nowhere.
/// Demotion rather than deletion matters — filling it in could disconnect the
/// floor, and this pass runs after the connectivity guarantee.
///
/// ⚠️ **THE PIPELINE PASSES `reach = 0`, so the join branch never fires.** With
/// reach 0 the `d = 2..=reach` scan is empty, `best` is always `None`, and every
/// termination is demoted. That is deliberate upstream: extending a stub chases
/// its own tail, since each extension creates a tile that is itself the new end
/// of the road ("joined" fired 8-24× per floor while the count never moved), and
/// the real cause was topological (degree-1 graph leaves) and is fixed in
/// `prune_leaves`. So the whole `best`/`joined` half of this function is
/// **unreachable from `PASS_ORDER`** and is ported for the default-argument
/// callers (debug spawners, tuning scripts) rather than gated by the corpus. Its
/// only test is the unit test below.
pub fn heal_road_terminations(
    g: &mut Grid,
    mask: &mut TrackMask,
    exempt: &[TilePos],
    reach: i32,
) -> Healed {
    let mut out = Healed::default();
    // Bounded rounds: healing one termination can create another (demoting a
    // tile may leave its neighbour as the new end of the road), and that should
    // settle rather than run away.
    for _round in 0..8 {
        let ends = find_road_terminations(g, mask, exempt);
        if ends.is_empty() {
            break;
        }
        for e in &ends {
            // Look for a lane tile to rejoin, nearest first, along a straight run.
            let mut best: Option<(i32, i32, i32)> = None;
            for (di, dj) in DIRS {
                let mut d = 2;
                while d <= reach {
                    let x = e.i + di * d;
                    let y = e.j + dj * d;
                    if x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1 {
                        break;
                    }
                    if mask.lane[idx(g, x, y)] == 1 && is_walkable(g, x, y) {
                        if best.is_none_or(|(_, _, bd)| d < bd) {
                            best = Some((di, dj, d));
                        }
                        break;
                    }
                    d += 1;
                }
            }
            match best {
                Some((di, dj, bd)) => {
                    for d in 1..bd {
                        let x = e.i + di * d;
                        let y = e.j + dj * d;
                        set_tile(g, x, y, T_FLOOR);
                        mask.lane[idx(g, x, y)] = 1;
                    }
                    out.joined += 1;
                }
                None => {
                    mask.lane[idx(g, e.i, e.j)] = 0; // demote to plain room floor
                    out.demoted += 1;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::T_FLOOR;

    /// An open room with a one-tile spur off it, on an all-wall grid.
    fn spur() -> Grid {
        let mut g = Grid::solid(9, 9);
        for j in 3..6 {
            for i in 2..7 {
                set_tile(&mut g, i, j, T_FLOOR);
            }
        }
        // The spur: (7,4) hangs off the room's east wall.
        set_tile(&mut g, 7, 4, T_FLOOR);
        g
    }

    #[test]
    fn uncarve_eats_a_spur_and_leaves_the_room() {
        let mut g = spur();
        let filled = uncarve_dead_ends(&mut g, None, &[], None, None);
        assert_eq!(filled, 1, "only the spur is a dead end");
        assert!(!is_walkable(&g, 7, 4));
        assert!(is_walkable(&g, 6, 4), "the room is untouched");
    }

    #[test]
    fn uncarve_refuses_a_protected_tile_and_the_lane() {
        let mut g = spur();
        let kept = uncarve_dead_ends(&mut g, None, &[TilePos { i: 7, j: 4 }], None, None);
        assert_eq!(kept, 0);

        let mut g = spur();
        let mut mask = TrackMask::for_grid(&g);
        mask.lane[idx(&g, 7, 4)] = 1;
        assert_eq!(uncarve_dead_ends(&mut g, Some(&mask), &[], None, None), 0);
    }

    /// The budget, which is the thing the legacy comment shouts about: a 1-wide
    /// corridor unravels completely without one.
    #[test]
    fn the_fill_budget_stops_the_unravelling() {
        let mut g = Grid::solid(21, 5);
        for i in 1..20 {
            set_tile(&mut g, i, 2, T_FLOOR);
        }
        let open = 19;
        // Unbounded (frac 1.0) the whole corridor goes: 19 tiles, and the last
        // one standing is a dead end too.
        let mut all = g.clone();
        assert_eq!(
            uncarve_dead_ends(&mut all, None, &[], None, Some(1.0)),
            open
        );
        // At the shipping 0.12 only round(19 * 0.12) = 2 tiles are eaten.
        assert_eq!(uncarve_dead_ends(&mut g, None, &[], None, None), 2);
    }

    /// A 3-tall wall spike standing in an open room. Its two END tiles have three
    /// open neighbours and go in round one; the MIDDLE has only two and is
    /// invisible until they do — which is the cascade the fixed point exists for,
    /// and exactly the shape the old `maxRounds = 6` cap truncated on real
    /// floors.
    fn spike_in_a_room() -> Grid {
        let mut g = Grid::solid(9, 9);
        for j in 1..8 {
            for i in 1..8 {
                set_tile(&mut g, i, j, T_FLOOR);
            }
        }
        for j in 3..6 {
            set_tile(&mut g, 4, j, T_WALL);
        }
        g
    }

    #[test]
    fn destub_iterates_to_a_fixed_point() {
        let mut g = spike_in_a_room();
        assert_eq!(remove_wall_stubs(&mut g, None, 3, 32), 3);
        for j in 3..6 {
            assert!(is_walkable(&g, 4, j), "spike tile at row {j} survived");
        }
    }

    /// The historical bug, reproduced as a control: capped at one round, the pass
    /// leaves behind the stub its own round manufactured. Silently — the return
    /// value is a positive number of removals either way.
    #[test]
    fn one_round_leaves_the_stub_it_manufactured() {
        let mut g = spike_in_a_room();
        assert_eq!(remove_wall_stubs(&mut g, None, 3, 1), 2);
        assert!(
            !is_walkable(&g, 4, 4),
            "the middle tile should still be walled after one round"
        );
    }

    #[test]
    fn destub_spares_a_sealed_lanes_membrane() {
        let mut g = Grid::solid(9, 9);
        for j in 1..8 {
            for i in 1..8 {
                if i != 4 {
                    set_tile(&mut g, i, j, T_FLOOR);
                }
            }
        }
        let mut mask = TrackMask::for_grid(&g);
        for j in 1..8 {
            mask.sealed[idx(&g, 3, j)] = 1;
        }
        assert_eq!(remove_wall_stubs(&mut g, Some(&mask), 3, 32), 0);
        for j in 1..8 {
            assert!(!is_walkable(&g, 4, j), "the seal's membrane was opened");
        }
    }

    /// Two ISOLATED lane tiles with a two-tile gap between them. Isolated on
    /// purpose — see the self-join test below for what happens when the stub has
    /// a run behind it.
    fn two_islands() -> (Grid, TrackMask) {
        let mut g = Grid::solid(15, 5);
        set_tile(&mut g, 3, 2, T_FLOOR);
        set_tile(&mut g, 6, 2, T_FLOOR);
        let mut mask = TrackMask::for_grid(&g);
        mask.lane[idx(&g, 3, 2)] = 1;
        mask.lane[idx(&g, 6, 2)] = 1;
        (g, mask)
    }

    /// `reach = 0` is what the pipeline passes, and it demotes rather than
    /// joining. `reach = 6` takes the other branch — the only coverage that
    /// branch has anywhere, since `PASS_ORDER` never reaches it.
    #[test]
    fn heal_demotes_at_reach_zero_and_joins_when_it_can() {
        let (mut g, mut mask) = two_islands();
        let r = heal_road_terminations(&mut g, &mut mask, &[], 0);
        assert_eq!(r.joined, 0, "reach 0 cannot reach anything");
        assert_eq!(r.demoted, 2);
        assert!(!is_walkable(&g, 4, 2), "demotion never carves");
        assert_eq!(mask.lane[idx(&g, 3, 2)], 0, "demoted to room floor");

        let (mut g, mut mask) = two_islands();
        let r = heal_road_terminations(&mut g, &mut mask, &[], 6);
        assert!(r.joined > 0, "reach 6 spans the two-tile gap");
        assert!(is_walkable(&g, 4, 2) && is_walkable(&g, 5, 2));
        assert_eq!(mask.lane[idx(&g, 4, 2)], 1, "the join is lane, not room");
    }

    /// ⚠️ **A DEFECT IN THE ORIGINAL, pinned rather than fixed.**
    ///
    /// The rejoin scan takes the NEAREST lane tile in any cardinal direction —
    /// and for a stub at the end of a run, the nearest lane tile is the one two
    /// steps BACK ALONG ITS OWN RUN. So `best` resolves backwards, the carve loop
    /// `1..best.d` writes `T_FLOOR` over a tile that is already floor, and
    /// `joined` is incremented for having done nothing.
    ///
    /// This is the mechanism behind the legacy comment's own measurement —
    /// *"joined fired 8-24× per floor while the count never moved"* — which reads
    /// as "the extension chases its own tail" and is worse than that: most of
    /// those joins never extended anything at all. The shipping pipeline is
    /// immune because it passes `reach = 0`, which is why this is pinned as
    /// behaviour rather than corrected: a fix would change no shipping floor and
    /// would desynchronise the port from the oracle.
    #[test]
    fn a_stub_rejoins_its_own_run_and_calls_it_a_join() {
        let mut g = Grid::solid(15, 5);
        for i in 1..5 {
            set_tile(&mut g, i, 2, T_FLOOR);
        }
        let mut mask = TrackMask::for_grid(&g);
        for i in 1..5 {
            mask.lane[idx(&g, i, 2)] = 1;
        }
        let before = g.t.clone();
        let r = heal_road_terminations(&mut g, &mut mask, &[], 6);
        assert!(r.joined > 0, "it reports joins");
        assert_eq!(r.demoted, 0, "and never demotes, so the stub stays a stub");
        assert_eq!(g.t, before, "…while carving absolutely nothing");
    }

    #[test]
    fn road_terminations_exempt_the_endpoints() {
        let mut g = Grid::solid(9, 5);
        for i in 1..8 {
            set_tile(&mut g, i, 2, T_FLOOR);
        }
        let mut mask = TrackMask::for_grid(&g);
        for i in 1..8 {
            mask.lane[idx(&g, i, 2)] = 1;
        }
        assert_eq!(find_road_terminations(&g, &mask, &[]).len(), 2);
        let ends = [TilePos { i: 1, j: 2 }, TilePos { i: 7, j: 2 }];
        assert!(find_road_terminations(&g, &mask, &ends).is_empty());
    }
}
