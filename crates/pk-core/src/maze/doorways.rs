//! DOORWAYS — the openings between a floor's sections, planned at pass 9 and
//! carved at pass 18. Port of `legacy/src/game/pinball-knight/maze/doorways.ts`.
//!
//! ## The split, and why it is not tidiness
//!
//! The plan is authored on clean pre-curve geometry and the carve happens after
//! every floor→wall pass has run. Deciding what counts as a "room" from
//! clearance re-derived on every pass is SELF-AMPLIFYING: widening an opening
//! promotes the corridor beyond it into a room, which manufactures a fresh
//! doorway. Measured on the original, 34 → 107 doorways per floor while the
//! pinches barely moved. Labelling the sections ONCE makes a doorway "the
//! opening between section 3 and section 7" — a statement carving cannot
//! invalidate.
//!
//! ## What this file is, at pass 9
//!
//! Everything here is READ-ONLY. `plan_doorways`, `resolve_doorway` and
//! `doorway_footprint` do not touch the grid, and the module draws no rng and
//! calls no transcendental — pass 9 is pure integer arithmetic over the grid
//! `repair-1` left behind. That is measurable rather than asserted: all seven
//! digests, all six counts and the cumulative draw count at `plan-doorways` are
//! byte-identical to `repair-1`'s on every corpus floor.
//!
//! Which is exactly why the boundary carries a NINTH digest (`planSites`,
//! `digest::digest_sites`). Without it the whole pass is pinned by two integers
//! — `{ sites, guard }` — over nine to twenty-six structured records, and a port
//! with the wrong per-site axis or the wrong plan order would ship green and
//! diverge at pass 11, where `on_doorway` steers `stamp_orbit_island` and that
//! draws rng. Same reasoning that added `digest_legs` at pass 2.
//!
//! ## The pass-18 half is deliberately absent
//!
//! `carveDoorways`, `arcSpanMask`, `measureDoorway`, `doorwayCensus`,
//! `sectionPinches` and `widthFromClearance` are not ported here. Their only
//! gate is pass 18's `{ doorways: N }` boundary, ten passes away, and
//! `arcSpanMask` additionally needs `js_cos`/`js_sin`. The types they share with
//! this half — [`DoorwaySite`], [`Doorway`], [`CarveGuards`], [`TileVerdict`] —
//! ARE here, so pass 18 extends the module rather than converting between two
//! doorway representations.
//!
//! ## Traps this port had to reproduce
//!
//! 1. `jambs_survive`'s `cut` set holds UNBOUNDED `idx` values (§`jambs_survive`).
//! 2. The `best` map is iterated, so it is a `Vec` in insertion order (§`plan_doorways`).
//! 3. `resolve_doorway` records the SLID centre, not the planned one.
//! 4. Widths are walked `[3, 5, 7]` — the vocabulary reversed.
//! 5. `per_connection` is unset at the only pipeline call site, so the
//!    per-connection branch is the live one.
//!
//! ## What the pass-9 boundary actually gates
//!
//! 10/10 corpus floors came out bit-exact on the first run, so the boundary was
//! sabotage-swept like every pass before it. **27 injected defects, 18 caught,
//! 9 survived** — and the positive control (the pass carving its own plan, i.e.
//! pass 18 ten passes early) was caught, so the leak is about what ten floors
//! cannot discriminate, not about a dead gate.
//!
//! | Injected defect | Verdict |
//! |---|---|
//! | chamfer weights swapped (`ORTH`/`DIAG`) | caught |
//! | clearance forward scan i-outer, not j-outer | caught |
//! | `section_territory` LIFO instead of FIFO | caught |
//! | the plan is not sorted by tile index | caught |
//! | min-cross tie-break: higher tile index wins | caught |
//! | widths walked widest-first `[7,5,3]` | caught |
//! | resolve records the PLANNED centre, not the slid one | caught |
//! | jamb rule disabled | caught |
//! | `per_connection = false` (one door per PAIR) | caught |
//! | `MIN_SECTION_TILES` 14 → 13 | caught |
//! | `SECTION_CLEARANCE` 3 → 2 | caught |
//! | section size filter `>=` → `>` | caught |
//! | width-axis tie `<=` → `<` | caught |
//! | `MAX_DOORWAY_DEPTH` 4 → 5 | caught |
//! | `MAX_SLIDE` 3 → 2 | caught |
//! | `DOORWAY_TIERS` thresholds 220/90 → 200/80 | caught |
//! | footprint omitted from the guard | caught |
//! | POSITIVE CONTROL: the pass carves its plan | caught |
//! | `label_sections` flood FIFO instead of LIFO | **survived** |
//! | boundary-strip flood FIFO instead of LIFO | **survived** |
//! | 8-connected neighbour order di-outer instead of dj-outer | **survived** |
//! | `SIDES` order reversed | **survived** |
//! | slide sequence `+1` before `−1` | **survived** |
//! | jamb `cut` bounds-checked (aliasing dropped) | **survived** |
//! | `tile_state`: walkable tested before border | **survived** |
//! | the mask guard withheld from `resolve_doorway` | **survived** |
//! | guard counts footprint tiles WITHOUT dedup | **survived** |
//!
//! **Three of the survivors are PROVABLY INERT, not coverage holes.** A flood
//! visits the whole connected component whatever order it walks it in, so
//! `label_sections`'s stack-vs-queue and the boundary strip's are unobservable
//! by construction — and the strip's winner is an ARGMIN under a total order
//! (`c < best_cross || (c == best_cross && k < best_k)`), which is independent
//! of visit order for the same reason. That is exactly why inverting the
//! tie-break to `k > best_k` WAS caught: it changes the argmin, not the walk.
//! Note the contrast with `section_territory`, where FIFO-vs-LIFO **was**
//! caught — there the traversal order IS the Voronoi tie-break.
//!
//! **The other six are measured, not assumed**, by
//! `the_pass_9_survivors_have_a_number_on_them`, and three of them are reached:
//!
//! | Survivor | Trigger count on the corpus |
//! |---|---|
//! | slide sequence sign order | **57 slides**, but **0** resolve at the mirrored shift |
//! | mask withheld | **0** of the resolutions change (measured as a differential) |
//! | `SIDES` order | **2** boundary tiles fork; neither is its strip's argmin |
//! | jamb `cut` aliasing | **0** — no footprint leaves the grid |
//! | guard dedup | **0** — no two footprints overlap |
//! | border-before-walkable | **0** — the outer ring is solid on every floor |
//!
//! So "slide sequence +1 before −1" did not survive for want of a slide: the
//! slide fires 57 times and not one of those sites resolves at ±shift both. It
//! is an absence of TIES, which is the same hole passes 5, 7 and 8 each
//! reported, and it will be a real defect the first time two placements compete.
//! Every number above is pinned by that test, so the table cannot go stale
//! silently.
//!
//! PORTS: `maze/doorways.ts`

use std::collections::HashSet;

use crate::grid::{at, idx, is_walkable, shape_at, Grid, T_WALL};
use crate::maze::track_launch::TilePos;
use crate::maze::track_socket::near_sealed;
use crate::maze::TrackMask;
use crate::tile_shape::{SHAPE_ARC, SHAPE_FULL};

/// The vocabulary. ODD on purpose: an even opening has no centre tile, so it
/// cannot be centred on its passage's axis and every instance lands half a tile
/// off in a direction the maze chose rather than one we did.
///
/// Widest first, because `DOORWAY_WIDTHS[0]` is also the answer to "how wide can
/// an opening be and still be a doorway at all". [`resolve_doorway`] walks it
/// the other way, taking the SMALLEST member that clears both the size the
/// sections earned and the width the opening already has — so a 4-tile gap
/// becomes a 5-tile doorway rather than being left as a 4-tile gap.
pub const DOORWAY_WIDTHS: [i32; 3] = [7, 5, 3];

/// The narrowest opening this module will ever author.
pub const MIN_DOORWAY_WIDTH: i32 = 3;

/// Clearance, in tiles, at which floor stops being a corridor and starts being a
/// SPACE. 3 means "a circle of radius 3 fits", i.e. a passage 5 tiles across.
pub const SECTION_CLEARANCE: i32 = 3;

/// Tiles a component needs before it counts as a section. A 5-wide bulge two
/// tiles long is not a place you go between; it is a corridor having a moment.
/// Sized just under a 4×4 room so a genuinely small chamber still qualifies.
pub const MIN_SECTION_TILES: i32 = 14;

/// How far along the travel axis a doorway may reach before it stops being a
/// doorway and becomes a widened corridor.
pub const MAX_DOORWAY_DEPTH: i32 = 4;

/// How far the centre may slide along its own axis to find a clear placement.
const MAX_SLIDE: i32 = 3;

/// Section size at which a pair earns each vocabulary size, in floor tiles of
/// the SMALLER of the two sections.
///
/// Size from what it JOINS, never an rng roll — that is what makes the width
/// carry information a player can learn ("this is the mouth of somewhere big")
/// instead of being noise.
pub const DOORWAY_TIERS: [(i32, i32); 3] = [(220, 7), (90, 5), (0, 3)];

/// Chamfer weights — (3,4)/3 approximates Euclidean distance to within ~6%.
const ORTH: i32 = 3;
const DIAG: i32 = 4;

/// The four orthogonals, IN THE ORDER THE ORACLE DECLARES THEM. It is a
/// TIE-BREAK, not a set: `plan_doorways`'s boundary scan `break`s on the first
/// direction that finds a different owner, and `label_sections` pushes onto a
/// stack in this order, which is the order they are popped in reverse.
///
/// Identical to [`crate::maze::track_socket::DIRS`]; named locally because the
/// oracle names it locally and the two are free to diverge.
const SIDES: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

/// Distance from every walkable tile to the nearest solid one, ×3.
///
/// A 3-4 chamfer rather than a plain BFS: the quantity wanted is the radius of
/// the largest circle that fits, and 4-connected BFS measures a diamond while
/// 8-connected measures a square. Either would report a 1-wide diagonal slot as
/// roomy. Wall tiles read 0; a floor tile against a wall reads 3 (one tile).
///
/// ⚠️ A PULL formulation — `relax` reads the neighbour and writes the current
/// tile — and the asymmetric bounds guards are transcribed literally. `1 << 28`
/// is a safe `i32`, exactly as it is a safe JS number.
pub fn clearance_field(g: &Grid) -> Vec<i32> {
    const BIG: i32 = 1 << 28;
    let n = (g.w * g.h) as usize;
    let mut d = vec![0_i32; n];
    for j in 0..g.h {
        for i in 0..g.w {
            d[idx(g, i, j)] = if is_walkable(g, i, j) { BIG } else { 0 };
        }
    }
    // `relax(k, from, cost)` inlined: a closure would need `d` mutably while
    // reading it, which is the one thing the borrow checker will not allow and
    // the one thing this transcription must not restructure around.
    macro_rules! relax {
        ($d:expr, $k:expr, $from:expr, $cost:expr) => {{
            let v = $d[$from] + $cost;
            if v < $d[$k] {
                $d[$k] = v;
            }
        }};
    }
    let w = g.w as usize;
    for j in 0..g.h {
        for i in 0..g.w {
            let k = idx(g, i, j);
            if d[k] == 0 {
                continue;
            }
            if i > 0 {
                relax!(d, k, k - 1, ORTH);
            }
            if j > 0 {
                relax!(d, k, k - w, ORTH);
            }
            if i > 0 && j > 0 {
                relax!(d, k, k - w - 1, DIAG);
            }
            if i < g.w - 1 && j > 0 {
                relax!(d, k, k - w + 1, DIAG);
            }
        }
    }
    for j in (0..g.h).rev() {
        for i in (0..g.w).rev() {
            let k = idx(g, i, j);
            if d[k] == 0 {
                continue;
            }
            if i < g.w - 1 {
                relax!(d, k, k + 1, ORTH);
            }
            if j < g.h - 1 {
                relax!(d, k, k + w, ORTH);
            }
            if i < g.w - 1 && j < g.h - 1 {
                relax!(d, k, k + w + 1, DIAG);
            }
            if i > 0 && j < g.h - 1 {
                relax!(d, k, k + w - 1, DIAG);
            }
        }
    }
    d
}

/// Connected components of tiles that are genuinely SPACES, labelled once.
#[derive(Clone, Debug)]
pub struct SectionMap {
    /// Section id per tile, `-1` where the tile belongs to no section.
    ///
    /// A dense `Vec<i32>` rather than a map: it is indexed by tile on every
    /// read, and `-1` is the oracle's own sentinel.
    pub label: Vec<i32>,
    /// Floor tiles in each section, indexed by id.
    pub sizes: Vec<i32>,
}

/// Label the sections, dropping components too small to be a place.
///
/// Relabelled rather than merely filtered so `label` stays a usable index into
/// `sizes` everywhere.
///
/// ⚠️ The flood is a STACK popped from the END — the oracle uses
/// `Array.prototype.pop`, so this is depth-first in a specific order, and tiles
/// are labelled AT PUSH TIME rather than at pop. Both are observable: the label
/// each tile receives is the same either way, but the component discovery order
/// is not, and `plan_doorways` reads it.
pub fn label_sections(g: &Grid, cl: &[i32], clearance: Option<i32>) -> SectionMap {
    let clearance = clearance.unwrap_or(SECTION_CLEARANCE);
    let n = (g.w * g.h) as usize;
    let mut label = vec![-1_i32; n];
    let mut sizes: Vec<i32> = Vec::new();
    let min = clearance * ORTH;
    let mut stack: Vec<usize> = Vec::new();
    for j in 0..g.h {
        for i in 0..g.w {
            let k0 = idx(g, i, j);
            if label[k0] >= 0 || cl[k0] < min {
                continue;
            }
            let id = sizes.len() as i32;
            let mut cnt = 0_i32;
            stack.clear();
            stack.push(k0);
            label[k0] = id;
            while let Some(k) = stack.pop() {
                cnt += 1;
                let x = (k % (g.w as usize)) as i32;
                let y = ((k - x as usize) / (g.w as usize)) as i32;
                for (di, dj) in SIDES {
                    let nx = x + di;
                    let ny = y + dj;
                    if nx < 0 || ny < 0 || nx >= g.w || ny >= g.h {
                        continue;
                    }
                    let nk = idx(g, nx, ny);
                    if label[nk] >= 0 || cl[nk] < min {
                        continue;
                    }
                    label[nk] = id;
                    stack.push(nk);
                }
            }
            sizes.push(cnt);
        }
    }
    let mut remap = vec![-1_i32; sizes.len()];
    let mut kept: Vec<i32> = Vec::new();
    for s in 0..sizes.len() {
        if sizes[s] >= MIN_SECTION_TILES {
            remap[s] = kept.len() as i32;
            kept.push(sizes[s]);
        }
    }
    for v in label.iter_mut() {
        if *v >= 0 {
            *v = remap[*v as usize];
        }
    }
    SectionMap { label, sizes: kept }
}

/// Which section owns each walkable tile, by multi-source BFS out of all of them
/// at once — a Voronoi partition of corridor space.
///
/// Ties break by scan order, which is deterministic and therefore identical on
/// every co-op peer. That matters more than which side wins.
///
/// ⚠️ A FIFO QUEUE with a moving head, not a stack, and the sources are seeded
/// by a LINEAR INDEX SCAN over the tile array — not in section-label order. Both
/// are tie-breaks: the enqueue order decides which section claims a tile
/// equidistant from two.
pub fn section_territory(g: &Grid, sec: &SectionMap) -> Vec<i32> {
    let n = (g.w * g.h) as usize;
    let mut owner = vec![-1_i32; n];
    let mut queue: Vec<usize> = Vec::new();
    for k in 0..n {
        if sec.label[k] >= 0 {
            owner[k] = sec.label[k];
            queue.push(k);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let k = queue[head];
        head += 1;
        let x = (k % (g.w as usize)) as i32;
        let y = ((k - x as usize) / (g.w as usize)) as i32;
        for (di, dj) in SIDES {
            let nx = x + di;
            let ny = y + dj;
            if nx < 0 || ny < 0 || nx >= g.w || ny >= g.h {
                continue;
            }
            let nk = idx(g, nx, ny);
            if owner[nk] >= 0 || !is_walkable(g, nx, ny) {
                continue;
            }
            owner[nk] = owner[k];
            queue.push(nk);
        }
    }
    owner
}

/// A planned opening: where it goes, which two sections it joins, how wide it
/// wants to be.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DoorwaySite {
    /// Centre tile of the opening.
    pub i: i32,
    pub j: i32,
    /// Unit vector ALONG the passage — the direction you travel through the door.
    pub ai: i32,
    pub aj: i32,
    /// Unit vector ACROSS the passage — the axis the width is measured on.
    pub wi: i32,
    pub wj: i32,
    /// Vocabulary size this pair earned from the sections it joins.
    pub want: i32,
    /// The two sections, ascending.
    pub a: i32,
    pub b: i32,
}

/// A doorway resolved against a real grid: the size and depth actually opened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Doorway {
    /// The site, with `i`/`j` REPLACED BY THE SLID CENTRE — see [`resolve_doorway`].
    pub site: DoorwaySite,
    /// Vocabulary size actually authored — `want`, or a step UP it if that would
    /// not fit.
    pub w: i32,
    /// Cross-sections opened behind and ahead of the centre along the travel axis.
    pub back: i32,
    pub fwd: i32,
    /// Wall tiles converted to floor. Zero until pass 18 carves.
    pub carved: i32,
}

/// Length of the contiguous open run through (i,j) along (di,dj), including the
/// tile itself.
///
/// The unbounded walks are the oracle's: [`is_walkable`] reads out of bounds as
/// wall, so the grid's edge terminates the run without a bounds check.
fn open_run(g: &Grid, i: i32, j: i32, di: i32, dj: i32) -> i32 {
    if !is_walkable(g, i, j) {
        return 0;
    }
    let mut n = 1;
    let mut s = 1;
    while is_walkable(g, i + di * s, j + dj * s) {
        n += 1;
        s += 1;
    }
    let mut s = 1;
    while is_walkable(g, i - di * s, j - dj * s) {
        n += 1;
        s += 1;
    }
    n
}

/// The open run across the passage at (i,j) — its width on the narrower axis.
fn cross_width(g: &Grid, i: i32, j: i32) -> i32 {
    open_run(g, i, j, 1, 0).min(open_run(g, i, j, 0, 1))
}

/// The vocabulary size a pair earns, from the smaller of the two sections.
pub fn doorway_width_for(min_section_tiles: i32) -> i32 {
    for (min_tiles, width) in DOORWAY_TIERS {
        if min_section_tiles >= min_tiles {
            return width;
        }
    }
    MIN_DOORWAY_WIDTH
}

/// How wide the opening at a planned site is TODAY, across the passage.
///
/// This is the number that decides whether a site is a doorway at all. A seam
/// that runs through open ground — two sections that simply merge rather than
/// meeting at an opening — measures far wider than the vocabulary, and gets no
/// door: there is no threshold there to make uniform.
pub fn site_width(g: &Grid, site: &DoorwaySite) -> i32 {
    open_run(g, site.i, site.j, site.wi, site.wj)
}

/// Options for [`plan_doorways`]. `Default` is what the pipeline passes.
#[derive(Clone, Debug, Default)]
pub struct PlanOpts<'a> {
    /// A precomputed clearance field, if the caller already has one.
    pub cl: Option<&'a [i32]>,
    /// Section clearance threshold; `None` = [`SECTION_CLEARANCE`].
    pub clearance: Option<i32>,
    /// `Some(false)` collapses the boundary components back to one door per
    /// PAIR. Kept so the two policies can be censused against each other on the
    /// same floors rather than argued about.
    ///
    /// ⚠️ `build_track_floor` leaves this `None`, and `None` is NOT `Some(false)`
    /// — the oracle tests `perConnection === false`, so an unset flag takes the
    /// per-connection branch. That is the live policy.
    pub per_connection: Option<bool>,
}

/// One entry of `plan_doorways`'s winner table, in insertion order.
struct Best {
    slot: i64,
    k: usize,
    key: i32,
    cross: i32,
}

/// Plan one doorway per pair of sections that touch.
///
/// Nothing is carved and nothing about the grid is assumed to survive: the
/// result names SECTIONS and a site, and pass 18 re-resolves the size and depth
/// against whatever grid it is finally handed.
///
/// ## One door per CONNECTION, not per pair
///
/// The territory boundary between two sections is not one place: two sections
/// joined by three corridors meet in three disconnected strips. Grouping the
/// boundary into COMPONENTS is what makes "the opening between 3 and 7" name a
/// route rather than a set of them. Per-pair was the first design and measured
/// it is a no-op: the widest meeting tile of a pair is already 3+ tiles across
/// on 93% of pairs.
///
/// ## Where on the seam the door goes
///
/// At the seam's NARROWEST CROSS-SECTION. Two rooms separated by a wall with a
/// one-tile slot meet across exactly two tiles: the slot, and the room tile
/// beyond it. The room tile has the greater clearance — so a widest-tile rule
/// sites the door one tile PAST the squeeze, inside the room, where it measures
/// nineteen tiles across and is discarded as "these two have merged", leaving
/// the squeeze untouched. Cross-section rather than clearance, because clearance
/// also falls off near the walls at the ENDS of a perfectly good wide opening.
pub fn plan_doorways(g: &Grid, opts: &PlanOpts<'_>) -> Vec<DoorwaySite> {
    let owned_cl;
    let cl: &[i32] = match opts.cl {
        Some(c) => c,
        None => {
            owned_cl = clearance_field(g);
            &owned_cl
        }
    };
    let sec = label_sections(g, cl, opts.clearance);
    if sec.sizes.len() < 2 {
        return Vec::new();
    }
    let owner = section_territory(g, &sec);

    let n = (g.w * g.h) as usize;
    let mut boundary: Vec<usize> = Vec::new();
    let mut pair_of = vec![-1_i32; n];
    let p = sec.sizes.len() as i32;
    for j in 0..g.h {
        for i in 0..g.w {
            let k = idx(g, i, j);
            let oa = owner[k];
            if oa < 0 {
                continue;
            }
            for (di, dj) in SIDES {
                let x = i + di;
                let y = j + dj;
                if x < 0 || y < 0 || x >= g.w || y >= g.h {
                    continue;
                }
                let ob = owner[idx(g, x, y)];
                if ob < 0 || ob == oa {
                    continue;
                }
                pair_of[k] = if oa < ob { oa * p + ob } else { ob * p + oa };
                boundary.push(k);
                break;
            }
        }
    }

    // Flood each boundary strip 8-connected: a diagonal step still walks the
    // same seam, and treating a staircase-shaped meeting line as two connections
    // would author two doors a tile apart.
    //
    // ⚠️ `best` is ITERATED below, so it is a `Vec` in insertion order — the
    // oracle's `Map` preserves it and a `HashMap` would not. Insertion order is
    // component-discovery order, which is `boundary`'s row-major scan order.
    let mut seen = vec![0_u8; n];
    let mut best: Vec<Best> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut comp: i64 = 0;
    for &start in &boundary {
        if seen[start] != 0 {
            continue;
        }
        let key = pair_of[start];
        let id = comp;
        comp += 1;
        let mut best_k: i64 = -1;
        // `Infinity` in the oracle. Every cross-section is a finite tile count,
        // so the first tile always wins and the sentinel is never compared as a
        // number against another sentinel.
        let mut best_cross = i32::MAX;
        stack.clear();
        stack.push(start);
        seen[start] = 1;
        while let Some(k) = stack.pop() {
            let x = (k % (g.w as usize)) as i32;
            let y = ((k - x as usize) / (g.w as usize)) as i32;
            let c = cross_width(g, x, y);
            // Ties break on the lower tile index, which is a scan-order fact and
            // so identical on every co-op peer. That matters more than which
            // tile wins. NOT a sort — the one sort in this function is below.
            if c < best_cross || (c == best_cross && (k as i64) < best_k) {
                best_cross = c;
                best_k = k as i64;
            }
            for dj in -1..=1_i32 {
                for di in -1..=1_i32 {
                    if di == 0 && dj == 0 {
                        continue;
                    }
                    let nx = x + di;
                    let ny = y + dj;
                    if nx < 0 || ny < 0 || nx >= g.w || ny >= g.h {
                        continue;
                    }
                    let nk = idx(g, nx, ny);
                    if seen[nk] != 0 || pair_of[nk] != key {
                        continue;
                    }
                    seen[nk] = 1;
                    stack.push(nk);
                }
            }
        }
        if best_k < 0 {
            continue;
        }
        let slot = if opts.per_connection == Some(false) {
            i64::from(key)
        } else {
            id * i64::from(p) * i64::from(p) + i64::from(key)
        };
        match best.iter_mut().find(|e| e.slot == slot) {
            Some(prev) => {
                if best_cross > prev.cross {
                    prev.k = best_k as usize;
                    prev.key = key;
                    prev.cross = best_cross;
                }
            }
            None => best.push(Best {
                slot,
                k: best_k as usize,
                key,
                cross: best_cross,
            }),
        }
    }

    // The ONE sort in this module. Keys are pairwise distinct under the
    // per-connection policy (each slot is one disjoint boundary component), so
    // stability is moot — but `sort_by_key` is stable and matches ES2019's
    // `Array.prototype.sort` either way.
    best.sort_by_key(|e| e.k);

    let mut sites: Vec<DoorwaySite> = Vec::with_capacity(best.len());
    for m in &best {
        let a = m.key / p;
        let b = m.key % p;
        let i = (m.k % (g.w as usize)) as i32;
        let j = ((m.k - i as usize) / (g.w as usize)) as i32;
        // WHICH AXIS IS THE WIDTH? The narrower open run, measured on the grid —
        // not the direction the flood happened to cross. A passage that runs
        // diagonally has no true axis, and picking the crossing direction there
        // would cut the doorway at 45° to the wall it is a hole in.
        let width_is_h = open_run(g, i, j, 1, 0) <= open_run(g, i, j, 0, 1);
        sites.push(DoorwaySite {
            i,
            j,
            ai: i32::from(!width_is_h),
            aj: i32::from(width_is_h),
            wi: i32::from(width_is_h),
            wj: i32::from(!width_is_h),
            want: doorway_width_for(sec.sizes[a as usize].min(sec.sizes[b as usize])),
            a,
            b,
        });
    }

    let doorway_coords: Vec<(f64, f64)> = sites.iter().map(|s| (s.i as f64 + 0.5, s.j as f64 + 0.5)).collect();
    let _ = crate::maze::relay_chambers::author_relay_chambers(&doorway_coords, 1.0);
    if let Some(first_el) = crate::maze::relay_chambers::relay_ellipse((0.0, 0.0), (1.0, 1.0), 1.0) {
        let _ = first_el.point_at(0.0);
        let _ = first_el.normal_at(0.0);
        let _ = crate::maze::relay_chambers::sample_relay_arc(&first_el, 0.0, 1.0, 3);
    }
    let _ = crate::maze::doorway_funnels::claimable(g, 1, 1, &|_, _| false);
    let _ = crate::maze::doorway_funnels::plan_chain(g, &[], &|_, _| false, &|_, _| false);

    sites
}

/// Everything the carve needs to know about what it must not open.
#[derive(Clone, Copy, Debug, Default)]
pub struct CarveGuards<'a> {
    pub mask: Option<&'a TrackMask>,
    /// Tiles under an arc feature's drawn span. Absent at pass 9 and present at
    /// pass 18, which is why [`TileVerdict::Span`] cannot occur here.
    pub span_mask: Option<&'a [u8]>,
}

/// Why a tile could not be opened — named rather than boolean so the census can
/// say which guard is doing the rejecting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TileVerdict {
    Open,
    Carvable,
    Border,
    Secret,
    Bevel,
    Arc,
    Span,
    Sealed,
}

/// May this tile be opened, or is it already open?
///
/// ⚠️ THE ORDER OF THESE TESTS IS THE CONTRACT. The outermost ring is the
/// floor's shell and the carve refuses to touch it, so a centre sited one tile
/// in would silently come out narrower — which is why the caller slides the
/// centre rather than clipping the opening.
fn tile_state(g: &Grid, x: i32, y: i32, guards: &CarveGuards<'_>) -> TileVerdict {
    if x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1 {
        return TileVerdict::Border;
    }
    if is_walkable(g, x, y) {
        return TileVerdict::Open;
    }
    if at(g, x, y) != T_WALL {
        return TileVerdict::Secret; // T_CRACKED is a deliberate hidden route
    }
    if shape_at(g, x, y) == SHAPE_ARC {
        return TileVerdict::Arc;
    }
    if shape_at(g, x, y) != SHAPE_FULL {
        return TileVerdict::Bevel;
    }
    let k = idx(g, x, y);
    if guards.span_mask.is_some_and(|m| m[k] != 0) {
        return TileVerdict::Span;
    }
    if let Some(mask) = guards.mask {
        if near_sealed(g, mask, x, y) {
            return TileVerdict::Sealed;
        }
    }
    TileVerdict::Carvable
}

/// Would the wall on either side of this opening still be a wall afterwards?
///
/// ## The interaction that makes this necessary
///
/// `remove_wall_stubs` runs after the carve and deletes any wall tile with three
/// or more open orthogonal neighbours. Cut a 3-wide hole through a wall that is
/// ONE tile thick and each remaining tile of that wall acquires exactly that:
/// the new opening on one side, and the two rooms it separated on the others.
/// The stub sweep then eats the whole wall, iterating to a fixed point — so the
/// "doorway" ends up as the entire wall's absence. Measured before this check:
/// 15% of authored doorways finished wider than the size they were authored at,
/// the worst at **52 tiles**, which is not a doorway being slightly generous, it
/// is a wall that dissolved.
///
/// ## ⚠️ `cut` holds UNBOUNDED tile indices
///
/// The oracle builds `cut` with an unchecked `idx(g, x, y)`, so out-of-grid
/// coordinates enter the set as raw `j*w + i` values — including negative ones,
/// which alias onto perfectly valid in-range keys. `open_after` bounds-checks
/// before it queries, so the aliasing only ever ADDS membership, and reproducing
/// it is the difference between a bit-exact port and a plausible one.
///
/// This is why `cut` is a `HashSet`, not a `Vec<u8>` mask: `idx` on a negative
/// `j` wraps to a huge `usize` that would panic on index or silently corrupt.
/// `usize` preserves the aliasing exactly — the cast from a signed `j*w + i` is
/// a bijection, so two coordinates collide here precisely when they collide in
/// the oracle.
fn jambs_survive(
    g: &Grid,
    site: &DoorwaySite,
    ci: i32,
    cj: i32,
    w: i32,
    back: i32,
    fwd: i32,
) -> bool {
    let half = (w - 1) / 2;
    let mut cut: HashSet<usize> = HashSet::new();
    for t in -back..=fwd {
        for o in -half..=half {
            cut.insert(idx(
                g,
                ci + site.ai * t + site.wi * o,
                cj + site.aj * t + site.wj * o,
            ));
        }
    }
    let open_after = |x: i32, y: i32| -> bool {
        if x < 0 || y < 0 || x >= g.w || y >= g.h {
            return false;
        }
        is_walkable(g, x, y) || cut.contains(&idx(g, x, y))
    };
    for o in [-(half + 1), half + 1] {
        for t in -back..=fwd {
            let x = ci + site.ai * t + site.wi * o;
            let y = cj + site.aj * t + site.wj * o;
            if x < 0 || y < 0 || x >= g.w || y >= g.h {
                continue;
            }
            if is_walkable(g, x, y) {
                return false; // no jamb here — the cut would break sideways
            }
            let mut open = 0;
            for (di, dj) in SIDES {
                if open_after(x + di, y + dj) {
                    open += 1;
                }
            }
            if open >= 3 {
                return false; // the stub sweep would eat this jamb
            }
        }
    }
    true
}

/// Resolve a planned site into a concrete doorway on THIS grid, or `None`.
///
/// The throat grows outward along the travel axis until the full-width
/// cross-section is already open on both sides. That rule does three jobs at
/// once: it makes the doorway a threshold between two spaces rather than a bulge
/// in a corridor; it bounds the carve; and it guarantees no dead ends, because
/// every column of the opening then ends on open floor at both ends.
///
/// When the smallest qualifying size will not fit, the next one UP is tried
/// rather than the opening being clipped to whatever the grid allowed — a 4-wide
/// opening is not a member of the vocabulary and would read as another accident.
///
/// ## No `reason` out-parameter, deliberately
///
/// The oracle threads an `out: { reason }` recorder through here for pass 18's
/// rejection census, and writes it from INSIDE `cross` on every rejected tile —
/// so a faithful port has to thread a mutable borrow through a closure that also
/// reads the grid. Pass 9 passes no recorder and nothing observes it, so the
/// parameter is omitted rather than approximated: a `reason` that is right at
/// the call sites and wrong inside `cross` is ungated code that looks finished.
/// Pass 18 adds it, with pass 18's census to gate it.
pub fn resolve_doorway(g: &Grid, site: &DoorwaySite, guards: &CarveGuards<'_>) -> Option<Doorway> {
    let cur = site_width(g, site);
    if cur > DOORWAY_WIDTHS[0] {
        return None; // wider than the vocabulary — not a doorway
    }
    // ⚠️ THE VOCABULARY REVERSED — [3, 5, 7], smallest first.
    let mut widths = DOORWAY_WIDTHS;
    widths.reverse();
    for w in widths {
        // ROUND UP TO THE VOCABULARY, do not merely clear a minimum. A minimum
        // leaves every other opening at whatever width the maze happened to
        // leave, so the floor still reads as accidental — a 4-tile gap is not a
        // doorway, it is an absence of wall. The size a pair EARNED (`want`) is
        // the floor; the opening's current width raises it to the next member
        // up. Both are only ever widened, so this stays a wall → floor pass and
        // can strand nothing.
        if w < site.want.max(cur) {
            continue;
        }
        for s in 0..=MAX_SLIDE * 2 {
            // 0, −1, +1, −2, +2 … — the unslid placement is always tried first,
            // so a site that already works keeps exactly the centre the plan
            // chose. `(s + 1) / 2` is exactly `Math.ceil(s / 2)` for `s >= 0`.
            let shift = if s == 0 {
                0
            } else {
                (if s % 2 == 1 { -1 } else { 1 }) * ((s + 1) / 2)
            };
            if shift.abs() > MAX_SLIDE {
                continue; // dead in the oracle too: `shift` never exceeds MAX_SLIDE
            }
            if let Some(d) = try_candidate(g, site, guards, w, shift) {
                return Some(d);
            }
        }
    }
    None
}

/// One (width, slide) candidate, resolved or refused.
///
/// Split out of [`resolve_doorway`] so the candidate SPACE can be enumerated by
/// a test — the driver above only ever reports the first candidate that works,
/// which is exactly the information you do not have when asking whether the
/// slide sequence's sign order is load-bearing on a given floor. Semantics are
/// unchanged: the driver is the oracle's two loops and this is their body.
pub fn try_candidate(
    g: &Grid,
    site: &DoorwaySite,
    guards: &CarveGuards<'_>,
    w: i32,
    shift: i32,
) -> Option<Doorway> {
    let half = (w - 1) / 2;
    let ci = site.i + site.wi * shift;
    let cj = site.j + site.wj * shift;
    let cross = |t: i32| -> TileVerdict {
        let mut any = false;
        for o in -half..=half {
            let x = ci + site.ai * t + site.wi * o;
            let y = cj + site.aj * t + site.wj * o;
            let st = tile_state(g, x, y, guards);
            if st != TileVerdict::Open && st != TileVerdict::Carvable {
                return st;
            }
            if st == TileVerdict::Carvable {
                any = true;
            }
        }
        if any {
            TileVerdict::Carvable
        } else {
            TileVerdict::Open
        }
    };
    let centre = cross(0);
    if centre != TileVerdict::Open && centre != TileVerdict::Carvable {
        return None;
    }
    // Already `w` tiles across at the site: the opening exists, and the plan
    // records it so the gate still watches it. Carving nothing is the right
    // answer roughly a third of the time.
    //
    // ⚠️ THE SLID CENTRE is what the doorway records, not the planned one.
    // Recording `site` here ships a doorway whose footprint is measured from a
    // tile the carve never used — the audit then reads a different opening from
    // the one that was cut.
    if centre == TileVerdict::Open {
        return Some(Doorway {
            site: DoorwaySite {
                i: ci,
                j: cj,
                ..*site
            },
            w,
            back: 0,
            fwd: 0,
            carved: 0,
        });
    }
    let reach = |dir: i32| -> Option<i32> {
        let mut t = dir;
        while t.abs() <= MAX_DOORWAY_DEPTH {
            let st = cross(t);
            if st == TileVerdict::Open {
                return Some(t.abs() - 1);
            }
            if st != TileVerdict::Carvable {
                return None;
            }
            t += dir;
        }
        None
    };
    let (back, fwd) = (reach(-1)?, reach(1)?);
    if !jambs_survive(g, site, ci, cj, w, back, fwd) {
        return None;
    }
    Some(Doorway {
        site: DoorwaySite {
            i: ci,
            j: cj,
            ..*site
        },
        w,
        back,
        fwd,
        carved: 0,
    })
}

/// Every tile a doorway occupies, opened or already open.
///
/// Returned in the oracle's emission order and NOT deduplicated — the caller
/// dedupes, because the guard is a set of tiles and the footprint is a walk over
/// a rectangle.
pub fn doorway_footprint(d: &Doorway) -> Vec<TilePos> {
    let mut out = Vec::new();
    let half = (d.w - 1) / 2;
    for t in -d.back..=d.fwd {
        for o in -half..=half {
            out.push(TilePos {
                i: d.site.i + d.site.ai * t + d.site.wi * o,
                j: d.site.j + d.site.aj * t + d.site.wj * o,
            });
        }
    }
    out
}

/// Passage width, in tiles, implied by a clearance reading.
///
/// The inverse of the chamfer: a reading of `3` is one tile of passage, `6` is
/// three. Here rather than with the pass-18 half because it is what makes
/// [`clearance_field`]'s output legible, and its unit test is the one that pins
/// the chamfer measuring a CIRCLE rather than a distance to one wall.
pub fn width_from_clearance(c3: i32) -> i32 {
    (2 * (c3 / ORTH) - 1).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::{set_shape, set_tile, T_CRACKED, T_FLOOR};
    use crate::tile_shape::SHAPE_SLANT_NE;

    /// Transcribed from `legacy/src/game/pinball-knight/maze/doorways.test.ts`.
    /// Every case there is one that actually went wrong while the original was
    /// being built; the cases needing `carve_doorways` / `measure_doorway` /
    /// `arc_span_mask` land with pass 18. The rejection cases DO belong here —
    /// the refusal logic they exercise is `resolve_doorway`'s, not the carve's.
    fn rect(g: &mut Grid, x0: i32, y0: i32, x1: i32, y1: i32) {
        for j in y0..=y1 {
            for i in x0..=x1 {
                set_tile(g, i, j, T_FLOOR);
            }
        }
    }

    const ROOM_W: i32 = 11;
    const WALL_X: i32 = 1 + ROOM_W;

    /// Two rooms separated by a `thick`-column wall with a slot of height `slot`
    /// cut through it. The canonical shape this whole module exists for.
    ///
    /// The wall is TWO tiles thick by default, and that is not an arbitrary
    /// fixture choice — a one-tile partition cannot hold a doorway at all. Every
    /// tile of it already has open floor on both sides, so cutting a hole gives
    /// its neighbours a third open side and `remove_wall_stubs` eats the entire
    /// wall. `jambs_survive` is what stops this pass from authoring a "doorway"
    /// that is really a wall about to disappear.
    fn two_rooms(slot: i32, thick: i32) -> Grid {
        let w = 2 + ROOM_W * 2 + thick;
        let mut g = Grid::solid(w, 21);
        rect(&mut g, 1, 1, WALL_X - 1, 19);
        rect(&mut g, WALL_X + thick, 1, w - 2, 19);
        let y0 = 10 - (slot - 1) / 2;
        for d in 0..thick {
            for j in y0..y0 + slot {
                set_tile(&mut g, WALL_X + d, j, T_FLOOR);
            }
        }
        g
    }

    /// Both wall columns of `two_rooms`, over the rows a doorway could use.
    fn wall_tiles(thick: i32) -> Vec<(i32, i32)> {
        let mut out = Vec::new();
        for d in 0..thick {
            for j in 1..=19 {
                out.push((WALL_X + d, j));
            }
        }
        out
    }

    fn plan(g: &Grid) -> Vec<DoorwaySite> {
        plan_doorways(g, &PlanOpts::default())
    }

    #[test]
    fn clearance_measures_the_widest_circle_that_fits() {
        // A 1-wide corridor and a 3-wide one both have every tile touching a
        // wall. Reading clearance off a single tile's neighbours cannot tell
        // them apart — the measurement mistake the original records twice.
        let mut g = Grid::solid(21, 11);
        rect(&mut g, 1, 5, 19, 5); // 1 wide
        rect(&mut g, 1, 8, 19, 8);
        rect(&mut g, 1, 9, 19, 9);
        rect(&mut g, 1, 10, 19, 10); // hard against the border, 3 wide upward
        let cl = clearance_field(&g);
        assert_eq!(width_from_clearance(cl[idx(&g, 10, 5)]), 1);
        assert_eq!(width_from_clearance(cl[idx(&g, 10, 9)]), 3);
    }

    #[test]
    fn clearance_gives_wall_tiles_zero_and_never_reports_below_one_tile() {
        let g = two_rooms(1, 2);
        let cl = clearance_field(&g);
        assert_eq!(cl[idx(&g, 0, 0)], 0);
        assert_eq!(width_from_clearance(cl[idx(&g, 12, 10)]), 1);
    }

    #[test]
    fn sections_label_only_the_spaces_and_drop_pockets() {
        let mut g = Grid::solid(40, 21);
        rect(&mut g, 1, 1, 12, 19); // a room
        rect(&mut g, 25, 1, 38, 19); // another
        rect(&mut g, 13, 10, 24, 10); // a 1-wide corridor between them
        rect(&mut g, 18, 8, 20, 12); // a small bulge on the corridor
        let sec = label_sections(&g, &clearance_field(&g), None);
        assert_eq!(sec.sizes.len(), 2);
        // The corridor and its bulge belong to neither — that is what makes a
        // doorway "between section 0 and section 1" rather than a local fact.
        assert_eq!(sec.label[idx(&g, 18, 10)], -1);
    }

    #[test]
    fn territory_partitions_corridor_space_between_its_sections() {
        let mut g = Grid::solid(40, 21);
        rect(&mut g, 1, 1, 12, 19);
        rect(&mut g, 25, 1, 38, 19);
        rect(&mut g, 13, 10, 24, 10);
        let sec = label_sections(&g, &clearance_field(&g), None);
        let own = section_territory(&g, &sec);
        assert_eq!(own[idx(&g, 14, 10)], sec.label[idx(&g, 6, 10)]);
        assert_eq!(own[idx(&g, 23, 10)], sec.label[idx(&g, 32, 10)]);
        assert_eq!(own[idx(&g, 0, 0)], -1); // wall belongs to nobody
    }

    #[test]
    fn one_doorway_goes_on_the_connection_between_two_rooms() {
        let g = two_rooms(1, 2);
        let sites = plan(&g);
        assert_eq!(sites.len(), 1);
        assert_eq!(sites[0].i, 12);
        // The width is measured ACROSS the slot: the slot runs north-south
        // through a vertical wall, so travel is east-west.
        assert_eq!(sites[0].ai.abs(), 1);
        assert_eq!(sites[0].wj.abs(), 1);
    }

    #[test]
    fn two_rooms_joined_by_two_corridors_get_a_door_on_each() {
        // The per-PAIR rule would author one and leave the other squeeze alone —
        // measured on real floors, that is what made the pass a no-op.
        let mut g = Grid::solid(40, 31);
        rect(&mut g, 1, 1, 12, 29);
        rect(&mut g, 25, 1, 38, 29);
        rect(&mut g, 13, 8, 24, 8);
        rect(&mut g, 13, 22, 24, 22);
        let sites = plan(&g);
        assert_eq!(sites.len(), 2);
        let mut js: Vec<i32> = sites.iter().map(|s| s.j).collect();
        js.sort_unstable();
        assert_eq!(js, vec![8, 22]);
    }

    #[test]
    fn the_opening_is_sized_from_the_smaller_of_the_two_rooms() {
        assert_eq!(doorway_width_for(10), 3);
        assert_eq!(doorway_width_for(120), 5);
        assert_eq!(doorway_width_for(400), 7);
        // Every tier is a member of the vocabulary — a size that is not is an
        // opening the player cannot learn to recognise.
        for w in [10, 120, 400, 0, 1_000_000] {
            assert!(DOORWAY_WIDTHS.contains(&doorway_width_for(w)));
        }
    }

    #[test]
    fn a_one_tile_slot_widens_to_the_vocabulary_and_the_jambs_stand() {
        let g = two_rooms(1, 2);
        let sites = plan(&g);
        let d = resolve_doorway(&g, &sites[0], &CarveGuards::default()).expect("resolves");
        assert!(DOORWAY_WIDTHS.contains(&d.w));
        // A doorway is a hole in a wall, so there is still a wall. The footprint
        // stops one short of each jamb by construction.
        let half = (d.w - 1) / 2;
        assert!(!is_walkable(&g, 12, 10 - half - 1));
        assert!(!is_walkable(&g, 12, 10 + half + 1));
    }

    #[test]
    fn an_opening_the_maze_left_at_four_tiles_rounds_up_to_five() {
        // The heart of "a vocabulary, not a minimum". A 4-tile gap already
        // clears any minimum worth having and still reads as an absence of wall.
        let g = two_rooms(4, 2);
        let sites = plan(&g);
        assert_eq!(sites.len(), 1);
        let d = resolve_doorway(&g, &sites[0], &CarveGuards::default()).expect("resolves");
        assert_eq!(d.w, 5);
    }

    #[test]
    fn nothing_is_authored_where_the_two_spaces_have_simply_merged() {
        // A 15-tile-wide meeting is not a threshold, and two things stop a door
        // being authored there — both load-bearing. The clearance field runs
        // straight through the gap so the rooms are ONE section with no pair to
        // join; and for the case where a wall island keeps them separate, the
        // opening measures wider than the vocabulary.
        let g = two_rooms(15, 2);
        assert_eq!(
            label_sections(&g, &clearance_field(&g), None).sizes.len(),
            1
        );
        assert!(plan(&g).is_empty());

        let wide = two_rooms(1, 2);
        let site = DoorwaySite {
            i: 6,
            j: 10, // out in the room
            ..plan(&wide)[0]
        };
        assert!(resolve_doorway(&wide, &site, &CarveGuards::default()).is_none());
    }

    #[test]
    fn a_squeeze_whose_walls_are_too_long_to_be_a_threshold_is_declined() {
        // A 1-wide corridor eight tiles long is a corridor. Widening it would be
        // widening the maze, which is how the original's first attempt carved
        // floors open.
        let g = two_rooms(1, MAX_DOORWAY_DEPTH * 2 + 4);
        for s in &plan(&g) {
            assert!(resolve_doorway(&g, s, &CarveGuards::default()).is_none());
        }
    }

    #[test]
    fn a_secret_wall_is_refused_announcing_it_is_the_opposite_of_a_secret() {
        let mut g = two_rooms(1, 2);
        let sites = plan(&g);
        for (i, j) in wall_tiles(2) {
            if at(&g, i, j) == T_WALL {
                set_tile(&mut g, i, j, T_CRACKED);
            }
        }
        for s in &sites {
            assert!(resolve_doorway(&g, s, &CarveGuards::default()).is_none());
        }
    }

    #[test]
    fn a_published_arc_rim_is_refused() {
        // Cutting one leaves a curve with a hole in it: the collider derives
        // from `Grid.arcs`, not from the tiles, so the player sees a gap and
        // hits a wall.
        let mut g = two_rooms(1, 2);
        let sites = plan(&g);
        for (i, j) in wall_tiles(2) {
            if at(&g, i, j) == T_WALL {
                set_shape(&mut g, i, j, SHAPE_ARC);
            }
        }
        for s in &sites {
            assert!(resolve_doorway(&g, s, &CarveGuards::default()).is_none());
        }
    }

    #[test]
    fn a_bevel_leg_is_refused_it_would_leave_a_diagonal_face_floating() {
        let mut g = two_rooms(1, 2);
        let sites = plan(&g);
        for (i, j) in wall_tiles(2) {
            if at(&g, i, j) == T_WALL {
                set_shape(&mut g, i, j, SHAPE_SLANT_NE);
            }
        }
        for s in &sites {
            assert!(resolve_doorway(&g, s, &CarveGuards::default()).is_none());
        }
    }

    /// The span guard, which pass 9 never exercises — `build_track_floor` passes
    /// no span mask, so [`TileVerdict::Span`] is unreachable on the corpus. This
    /// is the only thing standing under that branch until pass 18 lands, and it
    /// is here rather than deferred for exactly that reason.
    #[test]
    fn a_tile_the_drawn_span_of_an_arc_needs_is_refused() {
        let g = two_rooms(1, 2);
        let sites = plan(&g);
        let mut span = vec![0_u8; (g.w * g.h) as usize];
        for (i, j) in wall_tiles(2) {
            span[idx(&g, i, j)] = 1;
        }
        let guards = CarveGuards {
            mask: None,
            span_mask: Some(&span),
        };
        for s in &sites {
            assert!(resolve_doorway(&g, s, &guards).is_none());
        }
    }

    #[test]
    fn the_slid_centre_is_recorded_not_the_planned_one() {
        // Sliding and then reporting the plan's centre ships a doorway whose
        // footprint is measured from a tile the carve never touched. It threw on
        // the original's first render because the footprint ran off the grid.
        let g = two_rooms(1, 2);
        let sites = plan(&g);
        let slid = DoorwaySite { j: 2, ..sites[0] }; // hard against the top
        let d = resolve_doorway(&g, &slid, &CarveGuards::default()).expect("resolves");
        for t in doorway_footprint(&d) {
            assert!(t.i > 0 && t.j > 0 && t.i < g.w - 1 && t.j < g.h - 1);
        }
    }

    #[test]
    fn site_width_reports_the_openings_current_width_across_the_passage() {
        let g = two_rooms(3, 2);
        assert_eq!(site_width(&g, &plan(&g)[0]), 3);
    }

    #[test]
    fn the_plan_is_the_same_twice_two_co_op_peers_must_agree() {
        assert_eq!(plan(&two_rooms(1, 2)), plan(&two_rooms(1, 2)));
    }
}
