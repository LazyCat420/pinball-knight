//! `buildTrackFloor` — the 23-pass pipeline itself.
//!
//! Port of `legacy/src/game/pinball-knight/maze/track-floor.ts`. The individual
//! passes live in their own modules ([`super::track_grow`], [`super::track_path`],
//! [`super::track_carve`], …); this file is the ORDER, which the legacy source
//! calls the contract in two separate places and is right to. Every pass draws
//! from one shared rng stream and mutates the grid the next one reads, so
//! reordering any two changes every draw after them — into a completely
//! different floor that renders perfectly, throws nothing, and passes every
//! property test, because "connected", "solvable" and "has an exit" are all
//! still true of the wrong floor.
//!
//! ## Landing incrementally, and what that means for callers
//!
//! Passes arrive one at a time, each bit-identical at its boundary before the
//! next starts. Until all 23 land, [`build_track_floor`] returns a floor that is
//! correct as far as it goes and unfinished after that — it is driven by the
//! parity harness, not by the game, and `pk_core::state::demo_floor` is still
//! what the shell builds. [`PASSES_LANDED`] says how far it gets, and the replay
//! test reads that number rather than carrying its own copy.
//!
//! ## The probe
//!
//! `on_pass` is the twin of the TS `onPass` hook: it consumes no rng, allocates
//! nothing into the floor, and never touches the grid, so a floor built with a
//! probe is bit-identical to one built without. The TS makes `extra` a thunk so
//! an unobserved floor pays nothing; here the same job is done by building the
//! `PassExtra` only inside the `if let Some(p)`.
//!
//! Every emit site is `on_pass.as_mut()` — including the LAST one, where
//! `on_pass` could be moved instead. Uniform on purpose: the last emit stops
//! being the last one the moment the next pass lands, and a form that only
//! compiles while it is last is a trap set for that commit.
//!
//! ## What the pass-7 and pass-8 boundaries actually gate
//!
//! Both passes came out 10/10 bit-exact on the first run, so both were
//! sabotage-swept. **26 injected defects, 10 caught, 16 shipped green** — and
//! four positive controls (uncarve disabled, its round cap at 0, de-stub
//! disabled, `stairs` overwritten with `start`) were all caught, so the leak is
//! about what ten floors cannot discriminate, not about a dead gate.
//!
//! | Injected defect | Verdict |
//! |---|---|
//! | tie band 0.92 → 0.90 | caught (7) |
//! | windiness measured from the eye, not the sweep origin | caught (7) |
//! | sight-line filter removed (`min_boss_euclid` ignored) | caught (7) |
//! | exit swept from `chute.base`, not `chute.mouth` | caught (7) |
//! | perimeter score loses its `0.001` distance tie-break | caught (7) |
//! | exit tie-break: last tile wins instead of first | **survived** |
//! | start tie-break: last tile wins instead of first | **survived** |
//! | `js_hypot` → `libm::hypot` | **survived** |
//! | lane scan i-outer instead of j-outer | **survived** |
//! | band test `>=` → `>` | **survived** |
//! | relaxation ladder `[0.8, 0.65, 0.5]` removed | **survived** |
//! | `relaxed` branch never taken (always windiest) | **survived** |
//! | hall preference over the lane instead of the pool | **survived** |
//! | de-stub round cap back to the historical 6 | caught (8) |
//! | de-stub `min_open` 3 → 4 | caught (8) |
//! | sealed-membrane exemption dropped | caught (8) |
//! | heal `reach` 0 → 6 | caught (8) |
//! | heal skipped entirely | caught (8) |
//! | de-stub before `connect_all` (order swapped) | **survived** |
//! | uncarve budget unbounded (0.12 → 1.0) | **survived** |
//! | `repair_keep_out` not passed to `connect_all` | **survived** |
//! | uncarve worklist FIFO instead of LIFO | **survived** |
//! | endpoints not protected from the uncarve | **survived** |
//! | cracked-wall exemption dropped from de-stub | **survived** |
//! | `DIRS` order reversed | **survived** |
//! | uncarve `max_rounds` 40 → 1 | **survived** (a weak sabotage: the cap is
//!   `rounds · w · h`, so even 1 leaves ~4,000 iterations of headroom) |
//!
//! Five of the survivors are branches the corpus never reaches, measured rather
//! than assumed: the relaxation ladder and the `-euclid` score behind it fire on
//! 0/10 floors, `stairs_in` is `None` at this pass, `start_band` runs on 1/10
//! (L3 s1, the only chute-less floor), the heal's join half is unreachable at
//! `reach = 0`, and no `T_CRACKED` tile exists before `decorate`. Four more are
//! TIE-BREAKS with no tie to break — the same hole `launch-chute` reported, and
//! the same reading: **the corpus contains no two candidates that score exactly
//! equal**, so both sort stabilities and both scan orders are unverified.
//!
//! Three are structural and have their own test
//! (`repair_1_stands_on_a_floor_that_is_already_connected`): the floor is
//! already one walkable component when `repair-1` starts, so `connect_all`
//! carves 0 tiles on 10/10 floors and its keep-out mask — 36-92 marked tiles per
//! floor — is never consulted. Both of those defects are still real at
//! `repair-2`, behind the curve passes that CAN disconnect a floor.
//!
//! And one is a slack cap worth knowing about before it is ever tuned: the
//! uncarve budget is `round(open · 0.12)` and the corpus fills 81-244 tiles
//! against budgets of 296-1,044 — **it never binds on any corpus floor**, so the
//! 1.5%-of-grid unravelling the legacy comment describes is not reproducible
//! here and the cap's exact value is untested.
//!
//! `js_hypot` surviving deserves its own line, because it is the third time the
//! maze corpus has failed to see the wrong math library. Here the ratio
//! `wind / d` is a genuine SCORE rather than an inequality, and the corpus still
//! cannot tell the two hypots apart — the argmin does not move. The primitive
//! guarantees live in `jsmath_oracle.rs`; ten green floors are not a licence to
//! skip them.
//!
//! PORTS: `maze/track-floor.ts`

use super::archetypes::TrackProfile;
use super::track_carve::carve_chamber;
use super::track_grow::{grow_track, GrowTrackOpts, TrackGraph};
use super::track_launch::{carve_launch_chute, perimeter_score, LaunchChute, TilePos};
use super::track_path::{build_track_path, TrackPath, TrackPathOpts};
use super::track_socket::{heal_road_terminations, remove_wall_stubs, uncarve_dead_ends};
use super::{CountingRng, Extra, PassSnapshot, TrackMask};
use crate::flow_field::bfs_distances;
use crate::grid::{idx, is_walkable, Grid};
use crate::jsmath::js_hypot;
use crate::maze::archetypes::track_node_counts;
use crate::maze::doorways;
use crate::maze::track_carve::{carve_track, connect_all, grow_maze_around, sealed_walls};

/// Walls the connectivity repair should route AROUND if it can: a sealed lane's
/// side walls, plus every wall tile that carries a published arc face.
///
/// The arc half matters more than it looks. `connect_all` carves the SHORTEST
/// wall corridor into a stranded pocket, and a fillet's rim is a thin band of
/// wall — often the shortest thing between two open spaces. A corridor punched
/// through it leaves a curved wall with a doorway in the middle of the sweep:
/// the collider still reports the whole arc as solid (it derives from
/// `Grid.arcs`, not from the tiles), so the player sees a gap and hits a wall.
/// That is the see≠hit class of bug and it is worth a longer corridor to avoid.
///
/// A preference, never a prohibition — `connect_all` retries without the mask
/// rather than leave anything stranded.
fn repair_keep_out(g: &Grid, mask: &TrackMask) -> Vec<u8> {
    let mut out = sealed_walls(g, mask);
    if let Some(ai) = g.arc_idx.as_ref() {
        for (k, &a) in ai.iter().enumerate() {
            if a >= 0 {
                out[k] = 1;
            }
        }
    }
    out
}

/// What [`pick_track_endpoints`] decided, and what it had to stand down on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackEnds {
    pub start: TilePos,
    pub stairs: TilePos,
    /// `["boss-not-within-sight-of-spawn"]` when the sight-line floor could not
    /// be met by any tie band — see `far`'s relaxation ladder.
    pub relaxed: Vec<String>,
}

/// WHERE THE FLOOR OPENS AND WHERE IT LETS YOU OUT — both on the circuit.
///
/// Port of `pickTrackEndpoints`. Consumes NO rng, which is why the pass-7
/// boundary's draw count matches by construction and its `extra` (the two tile
/// coordinates) is the entire gate. Those two coordinates are, however, the
/// pass's whole output — see the harness memo about boundaries that pin a count
/// instead of a result; this one pins the result.
///
/// The shape of it, in the order the legacy source argues for it:
///
/// 1. A DOUBLE SWEEP for the diameter along the walkable surface, so the two
///    ends are a lap apart rather than merely far in a straight line.
/// 2. A TIE BAND, not an argmax. Every tile within `TIE` of the best distance is
///    "a lap away" for any purpose the player can perceive, so the preference
///    terms choose among equals rather than overriding the distance rule. The
///    shipped argmax produced an over-direct floor about once in 1200.
/// 3. A STRAIGHT-LINE FLOOR filtered FIRST, then the windiness preference among
///    the survivors. Ordering matters: the other way round the preference keeps
///    picking the nearest tile and the filter has nothing left to reject. The
///    exit is where the Reaper King is sited and his skulls ignore walls, so a
///    windy-but-adjacent exit is a boss shooting at your spawn from t=0
///    (measured 6.7 tiles on seed 1).
/// 4. RELAX IN STEPS, and record it. A small floor's top-8% band can contain
///    nothing far enough in a straight line; a shorter lap that is genuinely
///    separated beats a longer one that is not.
///
/// `stairs_in` is a preference for where the exit lands, inside the band — the
/// King's Hall asking "could a hall fit here" before it is carved and "is this
/// tile in the hall" after. Unused at pass 7 and supplied at `endpoints-final`.
pub fn pick_track_endpoints(
    g: &Grid,
    mask: &TrackMask,
    chute: Option<&LaunchChute>,
    perimeter_bias: f64,
    min_boss_euclid: f64,
    stairs_in: Option<&dyn Fn(i32, i32) -> bool>,
) -> Option<TrackEnds> {
    // Row-major, j outer — the order every scan below breaks its ties in.
    let mut lane: Vec<TilePos> = Vec::new();
    for j in 0..g.h {
        for i in 0..g.w {
            if mask.lane[idx(g, i, j)] != 0 && is_walkable(g, i, j) {
                lane.push(TilePos { i, j });
            }
        }
    }
    if lane.len() < 2 {
        return None;
    }

    /// Top of the distance band: within 8% of the best is "as far as it gets".
    const TIE: f64 = 0.92;

    // `from` is where the sweep ORIGINATES; `eye` is where the player actually
    // stands. With a launch chute they differ by the whole length of the hallway
    // — the exit is swept from the mouth so the lap is measured from where the
    // launch DELIVERS you, but the king shoots at the PARK TILE. Measuring the
    // sight line from the mouth let a 6.7-tile exit through on seed 1.
    let far = |from: TilePos, eye: TilePos| -> (TilePos, i32, bool) {
        let dist = bfs_distances(g, from.i, from.j);
        let mut best = -1_i32;
        for p in &lane {
            let d = dist[idx(g, p.i, p.j)];
            // `d < 0x3fffffff` is vestigial in the TS — this BFS marks
            // unreachable as -1, so the guard never fires. Carried anyway: it is
            // free, and a future field with a large sentinel would need it.
            if d > best && d < 0x3fff_ffff {
                best = d;
            }
        }
        if best <= 0 {
            return (from, best, false);
        }
        let in_band = |tie: f64| -> Vec<TilePos> {
            lane.iter()
                .copied()
                .filter(|p| {
                    let d = dist[idx(g, p.i, p.j)];
                    f64::from(d) >= f64::from(best) * tie && d < 0x3fff_ffff
                })
                .collect()
        };
        let clear_of = |band: &[TilePos]| -> Vec<TilePos> {
            band.iter()
                .copied()
                .filter(|p| {
                    js_hypot(f64::from(p.i - eye.i), f64::from(p.j - eye.j)) >= min_boss_euclid
                })
                .collect()
        };
        // TIE stays the FIRST value tried, so floors that can satisfy both keep
        // exactly the route they had. The guard is at the TOP of the loop: a
        // floor that clears the sight line at 0.92 never re-bands, and
        // `min_boss_euclid <= 0` breaks out before the first widening.
        let mut band = in_band(TIE);
        let mut clear = clear_of(&band);
        for tie in [0.8, 0.65, 0.5] {
            if !clear.is_empty() || min_boss_euclid <= 0.0 {
                break;
            }
            band = in_band(tie);
            clear = clear_of(&band);
        }
        // Nothing in the band is far enough in a straight line — a genuinely
        // small or tightly-coiled floor. Take the FARTHEST available rather than
        // the windiest, and let the caller record it: silently falling back to
        // the windiest would pick the CLOSEST, which is the defect.
        let pool: &[TilePos] = if clear.is_empty() { &band } else { &clear };
        let relaxed = clear.is_empty() && !band.is_empty() && min_boss_euclid > 0.0;
        // The exit prefers the hall we are about to carve for it — a preference,
        // and never a prohibition. If band and hall do not intersect the hall
        // loses: an exit close to the spawn is a worse defect than a king in a
        // corridor, and the latter is recoverable.
        let hall: Vec<TilePos> = match stairs_in {
            Some(f) => pool.iter().copied().filter(|p| f(p.i, p.j)).collect(),
            None => Vec::new(),
        };
        let choose: &[TilePos] = if hall.is_empty() { pool } else { &hall };
        let mut best_pos = from;
        let mut best_score = f64::INFINITY;
        for p in choose {
            let d = dist[idx(g, p.i, p.j)];
            let euclid = js_hypot(f64::from(p.i - eye.i), f64::from(p.j - eye.j));
            let wind = js_hypot(f64::from(p.i - from.i), f64::from(p.j - from.j));
            // Windiest among the compliant; farthest-in-sight when nothing
            // complies. Windiness is judged from the sweep origin (that is what
            // makes the ROUTE snake); the straight-line floor from the player.
            let score = if relaxed {
                -euclid
            } else {
                wind / f64::from(d)
            };
            // Strictly less — the first tile in lane order wins a tie.
            if score < best_score {
                best_score = score;
                best_pos = *p;
            }
        }
        (best_pos, dist[idx(g, best_pos.i, best_pos.j)], relaxed)
    };

    // ── WHERE THE FLOOR OPENS WITHOUT A CHUTE ────────────────────────────────
    //
    // The ~6% of floors (5 of 78 censused) where no straight sealed run fitted.
    // With a chute the spawn is the plunger's park tile and this is not ours to
    // choose; without one it was "the farthest lane tile from an arbitrary lane
    // tile", which quietly ignored the archetype's `perimeter_bias` on exactly
    // the minority of floors nobody looks at. A BAND again, not an argmax.
    let start_band = |from: TilePos| -> TilePos {
        let dist = bfs_distances(g, from.i, from.j);
        let mut best = -1_i32;
        for p in &lane {
            let d = dist[idx(g, p.i, p.j)];
            if d > best && d < 0x3fff_ffff {
                best = d;
            }
        }
        if best <= 0 {
            return from;
        }
        let mut pick = from;
        let mut pick_score = f64::NEG_INFINITY;
        for p in &lane {
            let d = dist[idx(g, p.i, p.j)];
            if f64::from(d) < f64::from(best) * TIE || d >= 0x3fff_ffff {
                continue;
            }
            // Perimeter decides; the tiny distance term only breaks exact ties,
            // so two equally-peripheral tiles resolve to the farther one
            // deterministically.
            let sc = perimeter_bias * perimeter_score(g, p.i, p.j)
                + (f64::from(d) / f64::from(best.max(1))) * 0.001;
            if sc > pick_score {
                pick_score = sc;
                pick = *p;
            }
        }
        pick
    };

    let a = match chute {
        Some(c) => c.base,
        None => start_band(lane[0]),
    };
    let (pos, d, was_relaxed) = far(
        match chute {
            Some(c) => c.mouth,
            None => a,
        },
        a,
    );
    if d <= 0 {
        return None;
    }
    Some(TrackEnds {
        start: a,
        stairs: pos,
        relaxed: if was_relaxed {
            vec!["boss-not-within-sight-of-spawn".to_string()]
        } else {
            Vec::new()
        },
    })
}

/// How many of `PASS_ORDER`'s 23 boundaries [`build_track_floor`] currently
/// reaches. Bumped in the same commit as the pass it counts.
///
/// A number rather than a comment because the replay test asserts against it:
/// a pass that lands without being counted here, or a count raised without a
/// pass, fails rather than silently changing what is under test.
pub const PASSES_LANDED: usize = 9;

/// What the pipeline hands back. Grows a field at a time with the passes that
/// author them — `start`/`stairs` at pass 7, `chute` at pass 5, and so on.
#[derive(Debug)]
pub struct TrackFloor {
    pub grid: Grid,
    pub graph: TrackGraph,
    pub path: TrackPath,
    pub mask: TrackMask,
    /// The plunger lane, or `None` when no straight sealed run fitted. When
    /// present, `start` IS `chute.base` — the floor opens parked at the closed
    /// end, and firing runs the hallway before the maze begins.
    pub chute: Option<LaunchChute>,
    /// Where the floor opens and where it lets you out.
    ///
    /// PROVISIONAL until `endpoints-final` (pass 14) re-picks on the post-curve
    /// grid — the value here is the pass-7 pick, which exists to tell the repair
    /// passes what not to fill in. `None` on a floor with fewer than two lane
    /// tiles, which the shipping pipeline answers by declining the floor at pass
    /// 14 rather than here.
    pub ends: Option<TrackEnds>,
    /// The doorway plan (pass 9), in plan order.
    ///
    /// Kept on the floor rather than consumed on the spot because it outlives
    /// its pass by nine of them: passes 11, 12 and 16 steer around
    /// [`Self::door_guard`], and pass 18 re-resolves THESE SITES against a grid
    /// the curve passes have changed. Re-planning at 18 instead is the
    /// self-amplifying failure the split exists to avoid.
    pub door_sites: Vec<doorways::DoorwaySite>,
    /// 1 where a resolved doorway's footprint lands — the tiles the curve passes
    /// must not stamp. Always `w * h` long.
    pub door_guard: Vec<u8>,
    /// Rules the generator could not satisfy and DELIBERATELY stood down on.
    ///
    /// Recorded rather than silently relaxed: constraints like "open at the
    /// edge" and "give the chute a long straight sealed run" can be jointly
    /// unsatisfiable on a floor whose circuit never reaches the border, and a
    /// rule that quietly gives up is indistinguishable from one that broke.
    pub relaxed: Vec<String>,
}

/// Knobs `authorFloor` hands the pipeline. `None` means "take the profile's".
#[derive(Clone, Debug, Default)]
pub struct BuildTrackFloorOpts<'a> {
    pub profile: Option<&'a TrackProfile>,
    pub min_loops: Option<i64>,
    pub link_chance: Option<f64>,
    pub fill: Option<f64>,
    pub density: Option<f64>,
}

/// Build a floor. `None` when the circuit came out unusable — no edges after
/// the prune, or no rideable straight — which the caller answers by falling
/// back to the growing-tree generator.
///
/// `cells_w`/`cells_h` are CELL counts, not tiles: the grid is `2c + 1` on each
/// axis, so the odd-coordinate lattice the maze grows on lines up.
pub fn build_track_floor(
    cells_w: i32,
    cells_h: i32,
    rng: &mut CountingRng,
    opts: &BuildTrackFloorOpts<'_>,
    mut on_pass: Option<&mut dyn FnMut(PassSnapshot<'_>)>,
) -> Option<TrackFloor> {
    let w = cells_w * 2 + 1;
    let h = cells_h * 2 + 1;
    let mut grid = Grid::solid(w, h);

    let default_profile = super::archetypes::DEFAULT_TRACK_PROFILE;
    let prof = opts.profile.unwrap_or(&default_profile);
    let (foods, relays) = track_node_counts(prof, w, h);

    // ── 1. grow-track ───────────────────────────────────────────────────────
    let graph = grow_track(
        w,
        h,
        rng,
        &GrowTrackOpts {
            foods: Some(foods as usize),
            relays: Some(relays as usize),
            min_loops: Some(opts.min_loops.unwrap_or(i64::from(prof.min_loops))),
            layout: Some(prof.layout),
            max_len_frac: Some(prof.max_len_frac),
            survive: Some(prof.survive),
            grow: None,
        },
    );
    if graph.edges.is_empty() {
        return None;
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "grow-track",
            grid: &grid,
            mask: None,
            sites: None,
            draws: rng.draws(),
            extra: vec![
                ("nodes", Extra::Int(graph.nodes.len() as i64)),
                ("edges", Extra::Int(graph.edges.len() as i64)),
                ("foods", Extra::Int(i64::from(foods))),
                ("relays", Extra::Int(i64::from(relays))),
            ],
        });
    }

    // ── 2. track-path ───────────────────────────────────────────────────────
    let path = build_track_path(
        &graph,
        &TrackPathOpts {
            radii: None,
            lane_scale: Some(prof.lane_scale),
        },
    );
    if path.legs.is_empty() {
        return None;
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "track-path",
            grid: &grid,
            mask: None,
            sites: None,
            draws: rng.draws(),
            extra: vec![("legs", Extra::Int(path.legs.len() as i64))],
        });
    }

    // ── 3. carve-track ──────────────────────────────────────────────────────
    let mut mask = carve_track(&mut grid, &path);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "carve-track",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── 4. plaza ────────────────────────────────────────────────────────────
    //
    // THE PLAZA GOES DOWN BEFORE THE MAZE, never after. Carved afterwards it
    // would bulldoze finished corridors and leave severed stubs pointing into
    // it; carved here it is simply part of the circuit, and the maze's keep-out
    // margin respects it like any other lane.
    //
    // AND IT HAS TO WIN. The Great Hall's card promises one vast chamber, and
    // censused over 36 floors it did not have the floor's biggest chamber —
    // a single `carveChamber` call that returned false on a bad site left the
    // archetype's only structural feature silently absent, with nothing
    // recording that it hadn't. So: try the largest radius the profile asks
    // for and step down until one fits, and if none does say so in `relaxed`
    // rather than shipping a Great Hall with no hall in it. Stepping down beats
    // moving the site, because the site is the topological centre of the
    // circuit and a chamber somewhere else is one the roads do not lead to.
    let mut relaxed: Vec<String> = Vec::new();
    if prof.plaza_frac > 0.0 && !graph.nodes.is_empty() {
        let cx = f64::from(w) / 2.0;
        let cz = f64::from(h) / 2.0;
        let mut hub = &graph.nodes[0];
        for n in &graph.nodes {
            // `(n.x - cx) ** 2` — squared distance, no sqrt, exactly as the TS.
            if (n.x - cx).powi(2) + (n.z - cz).powi(2) < (hub.x - cx).powi(2) + (hub.z - cz).powi(2)
            {
                hub = n;
            }
        }
        let want = f64::from(w.min(h)) * prof.plaza_frac;
        let mut carved = false;
        // `for (let r = want; r >= want * 0.6 && !carved; r -= 1)` — a f64
        // countdown, NOT an integer one: `want` is rarely integral and the
        // radii tried are `want`, `want-1`, … which are not whole numbers.
        let mut r = want;
        while r >= want * 0.6 && !carved {
            carved = carve_chamber(&mut grid, &mut mask, hub.x, hub.z, r);
            r -= 1.0;
        }
        if !carved {
            relaxed.push("archetype-has-its-chamber".to_string());
        }
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "plaza",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![("relaxed", Extra::Strs(relaxed.clone()))],
        });
    }

    // ── 5. launch-chute ─────────────────────────────────────────────────────
    //
    // Carved HERE, between the circuit and the maze, for the same reason the
    // plaza is: it must be part of the track by the time anything else looks at
    // the grid. Carved after `grow_maze_around` it would bulldoze finished
    // corridors; carved as decoration it would be a launch ritual with no lane
    // behind it. The archetype's spawn-placement weight reaches the chute here —
    // this call is what decides where the floor opens on 94% of floors.
    // `prof.rules?.perimeterBias ?? DEFAULT_RULE_WEIGHTS.perimeterBias` — the
    // profile carries only the keys it OVERRIDES, so the merge happens here.
    let rules = prof.rules.resolve();
    let bias = rules.perimeter_bias;
    let min_boss_euclid = rules.min_boss_euclid;
    let chute = carve_launch_chute(&mut grid, &mut mask, rng, bias);
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "launch-chute",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![(
                "chute",
                match &chute {
                    Some(c) => Extra::Ints(vec![
                        i64::from(c.base.i),
                        i64::from(c.base.j),
                        i64::from(c.mouth.i),
                        i64::from(c.mouth.j),
                    ]),
                    None => Extra::Null,
                },
            )],
        });
    }

    // ── 6. grow-maze ────────────────────────────────────────────────────────
    //
    // Everything the track did not claim, plus the on-ramps, plus the widening
    // pass and the connectivity repair behind it. This is where most of the
    // floor's rng goes.
    grow_maze_around(
        &mut grid,
        &mask,
        rng,
        // `margin` has no override in `authorFloor`; the legacy default is 1.
        1,
        opts.link_chance.unwrap_or(prof.link_chance),
        // ⚠️ `density` is `opts.density` with NO profile fallback — the TS passes
        // `density: opts.density`, which is `undefined` on every shipping call,
        // so `growMazeAround`'s own `?? 0.62` supplies it. Reading the profile
        // here would be a different floor.
        opts.density.unwrap_or(0.62),
        opts.fill.unwrap_or(prof.fill),
    );
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "grow-maze",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── 7. endpoints-early ──────────────────────────────────────────────────
    //
    // PROVISIONAL, and only two things come out of it: the tiles the repair
    // below must not fill in, and the exemptions the road-termination heal
    // honours. `endpoints-final` (pass 14) re-picks on a grid the curve passes
    // have changed and THAT is what ships — including the `relaxed` note, which
    // is why the one this pass produces is dropped on the floor here.
    let ends_early =
        pick_track_endpoints(&grid, &mask, chute.as_ref(), bias, min_boss_euclid, None);
    let protect: Vec<TilePos> = match &ends_early {
        Some(e) => vec![e.start, e.stairs],
        None => Vec::new(),
    };
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "endpoints-early",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: vec![
                (
                    "start",
                    match &ends_early {
                        Some(e) => Extra::Ints(vec![i64::from(e.start.i), i64::from(e.start.j)]),
                        None => Extra::Null,
                    },
                ),
                (
                    "stairs",
                    match &ends_early {
                        Some(e) => Extra::Ints(vec![i64::from(e.stairs.i), i64::from(e.stairs.j)]),
                        None => Extra::Null,
                    },
                ),
            ],
        });
    }

    // ── 8. repair-1 ─────────────────────────────────────────────────────────
    //
    // PLUMBING REPAIR, and the order inside the block is load-bearing:
    //
    //  1. UNCARVE first. It fills floor→wall and so can disconnect things, which
    //     is fine ONLY because `connect_all` runs after it.
    //  2. CONNECT next, restoring the one-component invariant uncarve may have
    //     broken. Carving wall→floor only adds connectivity, so nothing after
    //     this can strand the player.
    //  3. DE-STUB after both — widening leaves one-tile pillars when a corridor
    //     thickens, and the repair corridors carve fresh nubs of their own.
    //     Running it before either left 25.2 stubs + 5.2 isolated pillars per
    //     floor still standing.
    //  4. HEAL road terminations last, with reach 0: a lane still ending in
    //     mid-air is DEMOTED to plain room floor, so no booster or bank is ever
    //     sited along a road to nowhere.
    //
    // It is a CLOSURE in the TS because it runs FIVE times — here, and again
    // after each of the curve passes, because a concave fillet fills a corner
    // pocket floor→wall, which is precisely the operation that manufactures a
    // dead end. Here it is a fn taking what it needs: a closure capturing `grid`
    // and `mask` mutably cannot coexist with the probe that reads them.
    repair(&mut grid, &mut mask, &protect, ends_early.is_some());
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "repair-1",
            grid: &grid,
            mask: Some(&mask),
            sites: None,
            draws: rng.draws(),
            extra: Vec::new(),
        });
    }

    // ── DOORWAYS: PLANNED HERE, CARVED AT PASS 18 (maze/doorways.rs) ─────────
    //
    // Planned on clean pre-curve geometry and carved after every floor→wall pass
    // has run. The split is not tidiness, it is the fix for the failure that
    // sank the original's first attempt: deciding what counts as a "room" from
    // clearance re-derived on every pass is SELF-AMPLIFYING, because widening an
    // opening promotes the corridor beyond it into a room, which manufactures a
    // fresh doorway. Measured, 34 → 107 doorways per floor while the pinches
    // barely moved. Labelling the sections once, here, makes a doorway "the
    // opening between section 3 and section 7" — a statement carving cannot
    // invalidate.
    //
    // The plan is also what the curve passes are told to avoid. A fillet built
    // on a planned threshold is a curve the doorway would later have to cut
    // through, and cutting it un-backs the drawn arc; steering the curves around
    // the plan is far cheaper than arbitrating between them afterwards. Passes
    // 11 (`orbit-island`), 12 (`arc-sweeps`) and 16 (`artery-banks`) read
    // `door_guard`; pass 18 re-resolves `door_sites` against the changed grid.
    //
    // ⚠️ THIS PASS MUTATES NOTHING. Every function it calls is read-only, so all
    // seven digests, all six counts and the draw count at this boundary are
    // byte-identical to `repair-1`'s. If any of them move, the port has started
    // implementing pass 18 early.
    let door_sites = doorways::plan_doorways(&grid, &doorways::PlanOpts::default());
    // A `Vec<u8>` mask rather than a set, and that is not a liberty: the TS
    // `doorGuard` is only ever `.add`/`.has`/`.size`/copy-constructed — grepped
    // through pass 18 — so its iteration order is unobservable, and this matches
    // the `sealed_walls`/`in_maze` convention the carve passes already use.
    let mut door_guard = vec![0_u8; (grid.w * grid.h) as usize];
    let mut guard_count = 0_i64;
    for s in &door_sites {
        let guards = doorways::CarveGuards {
            mask: Some(&mask),
            // No span mask at pass 9 — it is pass 18 that has one, which is why
            // `TileVerdict::Span` cannot occur here.
            span_mask: None,
        };
        if let Some(d) = doorways::resolve_doorway(&grid, s, &guards) {
            for t in doorways::doorway_footprint(&d) {
                let k = idx(&grid, t.i, t.j);
                if door_guard[k] == 0 {
                    door_guard[k] = 1;
                    guard_count += 1;
                }
            }
        }
    }
    if let Some(p) = on_pass.as_mut() {
        p(PassSnapshot {
            pass: "plan-doorways",
            grid: &grid,
            mask: Some(&mask),
            sites: Some(&door_sites),
            draws: rng.draws(),
            extra: vec![
                ("sites", Extra::Int(door_sites.len() as i64)),
                ("guard", Extra::Int(guard_count)),
            ],
        });
    }

    Some(TrackFloor {
        grid,
        graph,
        path,
        mask,
        chute,
        ends: ends_early,
        door_sites,
        door_guard,
        relaxed,
    })
}

/// The four repair passes, in the one order that is safe. Called at `repair-1`
/// and after every curve pass; see the call site for why each step sits where it
/// does.
///
/// `keep` doubles as the uncarve protection AND the heal exemption, which is
/// what the TS closure's single `keep` parameter does.
///
/// `heal` is explicit rather than derived from `keep.is_empty()`, and the
/// distinction is a trap avoided rather than a style choice: the TS guards the
/// heal on `if (endsEarly)` — a variable captured from the enclosing scope, NOT
/// on the argument. The two agree at every call site that exists today, so a
/// derived guard would be green now and wrong the moment a later pass calls
/// `repair` with a keep list that is not the endpoints.
fn repair(grid: &mut Grid, mask: &mut TrackMask, keep: &[TilePos], heal: bool) {
    uncarve_dead_ends(grid, Some(mask), keep, None, None);
    // The keep-out steers the repair around any SEALED lane's walls — today the
    // launch chute's — and around published arc faces, because carving one is how
    // a swept curve becomes a curved wall with a hole in it. Neither can refuse a
    // connection; see `connect_all`.
    let avoid = repair_keep_out(grid, mask);
    connect_all(grid, Some(&avoid));
    remove_wall_stubs(grid, Some(mask), 3, 32);
    if heal {
        heal_road_terminations(grid, mask, keep, 0);
    }
}
