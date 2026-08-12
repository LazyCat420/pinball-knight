//! Pass 5 of 23 — `launch-chute`: the plunger lane, authored as maze geometry.
//!
//! Port of `legacy/src/game/pinball-knight/maze/track-launch.ts`.
//!
//! ```text
//! [BASE] ═══════ a straight, sealed, 3-wide hallway ═══════> [MOUTH]
//!  park          boosters live here (decorate)               merges onto
//!  here                                                      the circuit
//! ```
//!
//! Carved in the TRACK layer with the circuit's own brush ([`carve_stroke`]),
//! before the maze grows. That is the whole point of the pass and it buys four
//! properties for free rather than as four special cases: the maze's keep-out
//! margin respects `mask.lane` so the side walls stay solid rock; the dead-end
//! repair skips lane tiles so the closed end survives; the socket validator
//! types it as road; and the fillet passes see it as circuit, so the merge at
//! the mouth can be banked like any other junction.
//!
//! **This is the first pass since `grow-track` that DRAWS**, exactly once — the
//! pick out of the candidate pool. So unlike passes 2–4 the draw count is a live
//! localiser again: a mismatch there means the pool was a different size or the
//! floor took a different branch, not that the carve was wrong.
//!
//! ## What the corpus checks, and the three things it demonstrably does not
//!
//! Eleven sabotages, compiled and run against the ten corpus floors:
//!
//! ```text
//! caught      LAUNCH_CLEAR 3 -> 2                     9/10 floors
//! caught      seal the WHOLE spine (drop the -2)      9/10
//! caught      BAND_FRAC 0.30 -> 0.35                  3/10
//! caught      EDGE_NARROW 0.75 -> 0.70                2/10
//! caught      runout clamp min(12) -> min(24)         1/10
//! caught      perimeter scored at MOUTH not BASE      1/10
//! NOT CAUGHT  the score sort made UNSTABLE
//! NOT CAUGHT  the perimeter sort made UNSTABLE
//! NOT CAUGHT  CARDINALS rotated
//! NOT CAUGHT  the site scan made column-major
//! NOT CAUGHT  the compliance gate `>= 0.5` -> `> 0.5`
//! ```
//!
//! The pool arithmetic is well covered. The four uncaught ones are all
//! TIE-BREAKS — nothing in this corpus produces two sites whose scores collide
//! exactly, so discovery order never decides anything and the sort stability is
//! unverified. It is still written stable, and that is not superstition:
//! `Array.prototype.sort` has been stable since ES2019 and V8 implements it with
//! TimSort, so on the floor where a tie does occur the oracle will keep
//! discovery order and an unstable sort will not. Untested is not the same as
//! unnecessary — but do not read a green corpus as proof of it.
//!
//! The fifth is a coverage HOLE with a number on it: the corpus's
//! `perimeter_bias` values are 0.9, 0.85, 0.8, 0.7 and 0.15. The `>= 0.5`
//! threshold sits in an empty gap between 0.15 and 0.7, so which side of the
//! boundary `0.5` itself falls on is untested, and any archetype tuned into
//! that gap would be entering an unmeasured branch.
//!
//! One branch the corpus DOES exercise: L3 s1 fits no chute at all and takes the
//! `None` path, so "a floor can legitimately have no plunger lane" is covered
//! rather than assumed.
//!
//! ## The pool is narrowed in three steps and the last one can be skipped
//!
//! Band by geometry → sorted by perimeter and cut → filtered to compliant sites
//! *only if any comply*. The one rng draw happens after all three, so getting
//! any step wrong changes which site the same random number selects — which is
//! why `BAND_FRAC` and `EDGE_NARROW` are caught on floors whose geometry is
//! otherwise identical.
//!
//! PORTS: `maze/track-launch.ts`

use super::track_carve::carve_stroke;
use super::TrackMask;
use crate::grid::{idx, is_walkable, set_tile, Grid, T_WALL};
use crate::maze::CountingRng;

/// Half-width of the carved lane → a 3-tile-wide hallway. Matches `main`.
pub const LAUNCH_HALF: f64 = 1.5;
/// Below about 8 tiles the chute does not read as a hallway at all, it reads as
/// an alcove, and the whole point is that the launch has somewhere to BUILD.
pub const LAUNCH_MIN: i32 = 8;
/// Uncapped, a sparse floor donates a 40-tile tunnel that dominates the map and
/// eats the maze's space budget.
pub const LAUNCH_MAX: i32 = 20;
/// Clearance either side of the centreline before the chute may be carved:
/// `LAUNCH_HALF` for the lane plus a tile of rock, so the wall between the chute
/// and whatever is beside it is never one tile thin. A one-tile wall is what
/// `removeWallStubs` deletes and what a smashable crack punches straight
/// through — either way the lane stops being sealed.
pub const LAUNCH_CLEAR: i32 = 3;

/// Weight on the perimeter term, before the archetype's `perimeter_bias` (0..1)
/// scales it. Sized to break a tie between comparable sites, not to rescue a
/// short one: `len` runs to ~20 and runout contributes up to 24.
const PERIMETER_WEIGHT: f64 = 14.0;
/// Fraction of scored sites forming the candidate band.
const BAND_FRAC: f64 = 0.3;
/// How much of the band a full bias of 1.0 narrows away, keeping the most
/// peripheral sites. At 0.75 a max-bias archetype still draws from the top
/// quarter, which is what keeps two runs of one archetype from opening in the
/// identical spot.
const EDGE_NARROW: f64 = 0.75;
/// The perimeter score a high-bias floor must reach — `floor-rules.ts`'s
/// `PERIMETER_RULE_MIN`. One number, because two copies drifting apart is how a
/// "relaxation" gets recorded for a floor that actually complied.
pub const PERIMETER_RULE_MIN: f64 = 0.34;

const CARDINALS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

/// A tile position, the twin of the legacy `TilePos`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TilePos {
    pub i: i32,
    pub j: i32,
}

#[derive(Clone, Debug)]
pub struct LaunchChute {
    /// The most peripheral score any site in the candidate BAND could offer.
    ///
    /// The answer to "did the generator have a CHOICE?", and the difference
    /// between a spawn rule that was ignored and one that was impossible: on a
    /// floor whose circuit never reaches the border there is no peripheral chute
    /// to pick, and the caller records a declared relaxation rather than letting
    /// the rule fail silently.
    pub edge_best: f64,
    /// The closed end — where the knight is PARKED at floor open.
    pub base: TilePos,
    /// Where the chute merges onto the circuit.
    pub mouth: TilePos,
    /// Unit cardinal pointing base → mouth. The launch direction.
    pub dir_i: i32,
    pub dir_j: i32,
    /// Centre line, ordered base → mouth inclusive. Boosters ride this.
    pub spine: Vec<TilePos>,
    pub half: f64,
}

/// How peripheral is this tile? 1 at the border, 0 at the centre.
pub fn perimeter_score(g: &Grid, i: i32, j: i32) -> f64 {
    let half = f64::from(g.w.min(g.h)) / 2.0;
    if half <= 0.0 {
        return 0.0;
    }
    let d = i.min(j).min(g.w - 1 - i).min(g.h - 1 - j);
    // `Math.max(0, Math.min(1, x))`. Written as `clamp` and not as a
    // `.min().max()` chain because the two disagree on NaN and `clamp` is the
    // one that agrees with JS: Rust's `f64::min` DISCARDS a NaN operand (so the
    // chain would return 1.0), while `Math.min` propagates it, as `clamp` does.
    // Unreachable here — `d` is a finite integer and `half > 0` — but the next
    // transcription of this idiom may not be.
    (1.0 - f64::from(d) / half).clamp(0.0, 1.0)
}

/// Is the cross-section at (i,j) perpendicular to (di,dj) clear enough to carve?
///
/// The PERPENDICULAR band rather than a square block, because the chute is
/// straight: a square probe would reject a perfectly good run for rock thickness
/// it is about to travel through anyway.
fn cross_section_free(g: &Grid, mask: &TrackMask, i: i32, j: i32, di: i32, dj: i32) -> bool {
    let (pi, pj) = (-dj, di);
    for s in -LAUNCH_CLEAR..=LAUNCH_CLEAR {
        let x = i + pi * s;
        let y = j + pj * s;
        // The chute may not touch the border: it needs a wall on the far side of
        // its own side wall, and tile 0 has nothing beyond it.
        if x < 2 || y < 2 || x >= g.w - 2 || y >= g.h - 2 {
            return false;
        }
        if is_walkable(g, x, y) {
            return false;
        }
        if mask.lane[idx(g, x, y)] == 1 {
            return false;
        }
    }
    true
}

#[derive(Clone, Copy, Debug)]
pub struct ChuteSite {
    pub mouth: TilePos,
    pub base: TilePos,
    pub dir_i: i32,
    pub dir_j: i32,
    pub len: i32,
}

/// Every legal chute: a lane tile plus a cardinal with enough solid rock behind
/// it to hold a hallway.
///
/// The walk goes AWAY from the circuit and the chute then fires back toward it —
/// the opposite of how it plays, and the right way to search, because the
/// constraint ("does a straight sealed run fit here") is anchored at the merge
/// point. Anchoring at the far end would mean guessing a base tile in the middle
/// of undifferentiated rock and hoping it lines up with a lane.
///
/// ⚠️ The emission ORDER is the tie-break order downstream — row-major over
/// `j` then `i`, and `CARDINALS` innermost. The scoring sort is stable, so two
/// equal-scoring sites are separated by nothing but this.
pub fn find_chute_sites(g: &Grid, mask: &TrackMask) -> Vec<ChuteSite> {
    let mut out = Vec::new();
    for j in 2..g.h - 2 {
        for i in 2..g.w - 2 {
            if mask.lane[idx(g, i, j)] != 1 {
                continue;
            }
            if !is_walkable(g, i, j) {
                continue;
            }
            for (di, dj) in CARDINALS {
                // Walk backward from the mouth into the rock. `len` counts how
                // many tiles of chute can be carved; step 1 is the first rock.
                let mut len = 0;
                for s in 1..=LAUNCH_MAX {
                    if !cross_section_free(g, mask, i - di * s, j - dj * s, di, dj) {
                        break;
                    }
                    len = s;
                }
                if len < LAUNCH_MIN {
                    continue;
                }
                let base = TilePos {
                    i: i - di * len,
                    j: j - dj * len,
                };
                // THE CLOSED END NEEDS A REAL END CAP. `cross_section_free` only
                // checks the band PERPENDICULAR to the run, so nothing stopped
                // the base landing one tile off the border and leaving a
                // single-tile membrane behind it. The piece gate caught the
                // consequence: a sealed tile at (19,2) opening onto floor at
                // (19,1). Two tiles of stone behind the plunger, always.
                if base.i < 3 || base.j < 3 || base.i >= g.w - 3 || base.j >= g.h - 3 {
                    continue;
                }
                out.push(ChuteSite {
                    mouth: TilePos { i, j },
                    base,
                    dir_i: di,
                    dir_j: dj,
                    len,
                });
            }
        }
    }
    out
}

/// How far can the launch keep going, in a straight line, past the mouth?
///
/// A chute that empties onto a lane running ACROSS it delivers you into flow;
/// one that empties onto a lane running ALONG it delivers you into a head-on
/// wall a few tiles later — the same "booster into a curved wall" defect the
/// socket work killed elsewhere, just with the player's whole opening launch
/// instead of one pad.
pub fn runout_past(g: &Grid, i: i32, j: i32, di: i32, dj: i32, max: i32) -> i32 {
    let mut n = 0;
    for s in 1..=max {
        if !is_walkable(g, i + di * s, j + dj * s) {
            break;
        }
        n = s;
    }
    n
}

/// Carve the floor's one launch chute, or `None` if nothing fits.
///
/// MUST run after `carve_track` (it needs a circuit to feed) and BEFORE
/// `grow_maze_around` (so the maze grows around the chute rather than into it).
///
/// `None` is a legitimate outcome, not a failure: a very dense circuit on a small
/// floor can genuinely leave no straight 8-tile pocket of rock, and the caller
/// falls back to the free-air launch that shipped before this pass existed.
pub fn carve_launch_chute(
    g: &mut Grid,
    mask: &mut TrackMask,
    rng: &mut CountingRng,
    perimeter_bias: f64,
) -> Option<LaunchChute> {
    let sites = find_chute_sites(g, mask);
    if sites.is_empty() {
        return None;
    }

    // ── WHERE THE FLOOR OPENS ───────────────────────────────────────────────
    //
    // This decides the player's SPAWN on 94% of floors (censused: 73 of 78 fit a
    // chute, and `pick_track_endpoints` hands `start` straight to `chute.base`
    // when one exists). It used to score purely on hallway geometry with no
    // opinion about where on the map that hallway sat, which is why spawn landed
    // a mean 58–66% of the way to the centre on every archetype alike.
    //
    // `perimeter_bias` is added as a TERM, never as a filter. A filter would be
    // the wrong shape twice over: on a floor whose circuit never reaches the
    // border it would reject every site and silently produce no chute, and it
    // would override the runout gate that stops a chute firing into a wall —
    // trading a real playability guarantee for a cosmetic one.
    let bias = perimeter_bias;
    let mut scored: Vec<(ChuteSite, f64)> = sites
        .iter()
        .map(|c| {
            let score = f64::from(c.len)
                + 2.0 * f64::from(runout_past(g, c.mouth.i, c.mouth.j, c.dir_i, c.dir_j, 24).min(12))
                // Scored at the BASE, the tile the player actually stands on —
                // the mouth is by definition further in, so scoring there would
                // reward a chute pointing at the wall from inside the map.
                + bias * PERIMETER_WEIGHT * perimeter_score(g, c.base.i, c.base.j);
            (*c, score)
        })
        .collect();
    // STABLE, descending. See the module header: equal scores keep their
    // discovery order and that order is the tie-break.
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).expect("chute scores are finite"));
    let band_n = ((scored.len() as f64 * BAND_FRAC).ceil() as usize).max(1);
    let band = &scored[..band_n.min(scored.len())];

    // ── PERIMETER CHOOSES AMONG EQUALS ──────────────────────────────────────
    //
    // Scoring alone was not enough: with the term added but the band still
    // picked at random, 17 of 78 floors opened essentially dead centre. Raising
    // the weight until perimeter dominates is the wrong fix — `runout` is a term
    // and not a filter, so a perimeter weight large enough to always win is also
    // large enough to select a chute that fires straight into a wall.
    //
    // So the band stays a pure GEOMETRY band (its membership is what preserves
    // the quality floor) and the perimeter decides WITHIN it. Allocation, not
    // argmax.
    let by_edge: Vec<(ChuteSite, f64)> = if bias > 0.0 {
        let mut v = band.to_vec();
        v.sort_by(|x, y| {
            perimeter_score(g, y.0.base.i, y.0.base.j)
                .partial_cmp(&perimeter_score(g, x.0.base.i, x.0.base.j))
                .expect("perimeter scores are finite")
        });
        v
    } else {
        band.to_vec()
    };
    let edge_cut = if bias > 0.0 {
        (((by_edge.len() as f64) * (1.0 - bias * EDGE_NARROW)).ceil() as usize).max(1)
    } else {
        by_edge.len()
    };
    let mut pool: Vec<(ChuteSite, f64)> = by_edge[..edge_cut.min(by_edge.len())].to_vec();

    // ── RELAX ONLY WHEN FORCED ──────────────────────────────────────────────
    //
    // Narrowing to the most peripheral slice is not the same as satisfying the
    // rule, and the gap showed up as exactly one floor in 78: a ringkeep whose
    // pool ran 0.50 down to 0.28 and whose draw took the 0.28, with a qualifying
    // site sitting right there in the same pool. So when ANY candidate clears
    // the bar, only those are eligible; when none does the pool is left alone
    // and `build_track_floor` records a declared relaxation.
    if bias >= 0.5 {
        let compliant: Vec<(ChuteSite, f64)> = pool
            .iter()
            .filter(|x| perimeter_score(g, x.0.base.i, x.0.base.j) >= PERIMETER_RULE_MIN)
            .cloned()
            .collect();
        if !compliant.is_empty() {
            pool = compliant;
        }
    }

    // THE one draw this pass makes.
    let k = (rng.next_f64() * pool.len() as f64).floor() as usize;
    let pick = pool.get(k).unwrap_or(&pool[0]).0;
    let edge_best = band.iter().fold(0.0_f64, |m, x| {
        m.max(perimeter_score(g, x.0.base.i, x.0.base.j))
    });

    // Carve base → mouth with the circuit's own brush, so every downstream pass
    // treats the chute as track. Stroke to the mouth EXACTLY: overshooting would
    // widen the lane it merges into and blunt the junction.
    carve_stroke(
        g,
        mask,
        f64::from(pick.base.i) + 0.5,
        f64::from(pick.base.j) + 0.5,
        f64::from(pick.mouth.i) + 0.5,
        f64::from(pick.mouth.j) + 0.5,
        LAUNCH_HALF,
    );

    let spine: Vec<TilePos> = (0..=pick.len)
        .map(|s| TilePos {
            i: pick.base.i + pick.dir_i * s,
            j: pick.base.j + pick.dir_j * s,
        })
        .collect();

    // SEAL everything but the last two cross-sections. The on-ramp pass in
    // `grow_maze_around` opens any wall with track on one side, which is right
    // for the circuit and wrong for a launch lane — measured, it left only 28/60
    // floors with both chute walls intact. The mouth end stays unsealed on
    // purpose: that is where the chute is SUPPOSED to open, and sealing it would
    // isolate the junction from the maze around it.
    let (pi, pj) = (-pick.dir_j, pick.dir_i);
    let reach = LAUNCH_HALF.ceil() as i32;
    for s in 0..=(pick.len - 2) {
        let c = spine[s as usize];
        for d in -reach..=reach {
            let x = c.i + pi * d;
            let y = c.j + pj * d;
            if x < 0 || y < 0 || x >= g.w || y >= g.h {
                continue;
            }
            let k = idx(g, x, y);
            if mask.lane[k] == 1 {
                mask.sealed[k] = 1;
            }
        }
    }

    Some(LaunchChute {
        base: pick.base,
        mouth: pick.mouth,
        dir_i: pick.dir_i,
        dir_j: pick.dir_j,
        spine,
        half: LAUNCH_HALF,
        edge_best,
    })
}

/// Every tile of the chute's LANE (not just its centre line).
///
/// The content pass needs this to keep the hallway clear of everything that is
/// not the launch itself — a zombie, a chest or a stray bumper parked in the
/// plunger lane turns the opening commitment into a coin flip.
pub fn chute_tiles(g: &Grid, chute: &LaunchChute) -> Vec<TilePos> {
    let mut out = Vec::new();
    let (pi, pj) = (-chute.dir_j, chute.dir_i);
    let reach = chute.half.ceil() as i32;
    let mut seen = std::collections::HashSet::new();
    for c in &chute.spine {
        for d in -reach..=reach {
            let x = c.i + pi * d;
            let y = c.j + pj * d;
            if x < 0 || y < 0 || x >= g.w || y >= g.h {
                continue;
            }
            if !is_walkable(g, x, y) {
                continue;
            }
            // A `Set` of indices, matching the TS: dedup by TILE, and the
            // emission order is first-touch along the spine.
            if !seen.insert(idx(g, x, y)) {
                continue;
            }
            out.push(TilePos { i: x, j: y });
        }
    }
    out
}

/// Pass 17 — close any side door the connectivity repair had to punch into the
/// chute.
///
/// `connect_all` prefers to route around a sealed lane's walls but will go
/// through one rather than strand a pocket — correct precedence, and it leaves a
/// rare hole: measured, about one floor in forty ends up with a sealed tile
/// opening onto off-lane floor.
///
/// The ORDER of the two operations is the whole design. Sealing first and
/// checking after is what makes it safe: refusing the repair up front would
/// trade a cosmetic defect for a stranded player, which is the one bug this
/// generator may never ship. Here the seal is applied, connectivity is
/// re-checked with the caller's own reachability test, and the tile is put back
/// if it stranded anything. Worst case is exactly where we started.
///
/// Returns the number of tiles sealed.
pub fn reseal_chute(
    g: &mut Grid,
    mask: &TrackMask,
    chute: &LaunchChute,
    mut reaches: impl FnMut(&Grid) -> bool,
) -> u32 {
    let mut sealed = 0;
    for t in chute_tiles(g, chute) {
        if mask.sealed[idx(g, t.i, t.j)] != 1 {
            continue;
        }
        for (di, dj) in CARDINALS {
            let x = t.i + di;
            let y = t.j + dj;
            if x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1 {
                continue;
            }
            if !is_walkable(g, x, y) {
                continue;
            }
            if mask.lane[idx(g, x, y)] == 1 {
                continue; // part of the circuit: fine
            }
            let before = g.t[idx(g, x, y)];
            set_tile(g, x, y, T_WALL);
            if reaches(g) {
                sealed += 1;
            } else {
                // It was load-bearing — leave the door.
                let k = idx(g, x, y);
                g.t[k] = before;
            }
        }
    }
    sealed
}
