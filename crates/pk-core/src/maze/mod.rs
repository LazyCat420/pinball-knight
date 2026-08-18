//! Floor generation — the port of `legacy/src/game/pinball-knight/maze/`.
//!
//! ## The shape of the problem, and why the harness comes first
//!
//! `build_track_floor` is twenty-three ordered passes sharing ONE rng stream,
//! each mutating the grid the next one reads. The legacy source says it plainly
//! and in two places (`spawn/floor-authoring.ts`, `maze/track-floor.ts`): the
//! ORDER OF THE DRAWS IS THE CONTRACT. Reorder any two and every draw after
//! them changes — a completely different floor that renders perfectly, throws
//! nothing, and passes every property test, because "connected", "solvable" and
//! "has an exit" are all still true of the wrong floor.
//!
//! So a whole-floor comparison cannot debug this port. It can only ever say
//! "wrong", on 3,975 tiles, with every pass after the real mistake wrong too.
//!
//! What this module ships FIRST, before a single pass is ported:
//!
//!   · [`digest`] — the exact hash the legacy exporter uses, certified against
//!     pinned vectors so a broken instrument can never present as a broken
//!     generator.
//!   · [`PassProbe`] — the observation seam every pass reports through, the
//!     twin of the `onPass` hook now carried by `maze/track-floor.ts`.
//!   · [`PassRecord`] — one boundary's fingerprint: seven digests, six exact
//!     counts, the cumulative rng draw count, and the pass's own small scalars.
//!
//! The generator then lands pass by pass against `PASS_ORDER`, and each new
//! pass is either bit-identical to the oracle at its boundary or it is not
//! finished.
//!
//! PORTS: `spawn/floor-authoring.ts`, `maze/assembly-check.ts`, `maze/relay-chambers.ts`, `maze/floor-density.ts`, `lamp-puzzle.ts`, `dev/open-space-census.ts`, `maze/sweep-axis.ts`, `fog.ts`, `engine/spacing-grid.ts`, `maze/floor-seed.ts`, `maze/nearest-open-tile.ts`, `maze/generator.ts`, `maze/track-floor.ts`, `maze/floor-rules.ts`, `maze/floor-metrics.ts`, `maze/piece-rules.ts`, `maze/open-space.ts`

pub mod fog;
pub mod spacing_grid;

pub use fog::*;
pub use spacing_grid::*;

pub mod arc_contract;
pub mod arc_sweeps;
pub mod archetypes;
pub mod artery_banks;
pub mod assembly;
pub mod assembly_check;
pub mod assembly_lib;
pub mod assembly_place;
pub mod circuit;
pub mod conic_fit;
pub mod decorate;
pub mod digest;
pub mod doorway_funnels;
pub mod doorways;
pub mod floor_density;
pub mod floor_metrics;
pub mod floor_rules;
pub mod floor_seed;
pub mod floor_spec;
pub mod flow_loops;
pub mod flow_orient;
pub mod generator;
pub mod interactive;
pub mod lamp_puzzle;
pub mod lamp_runtime;
pub mod modifiers;
pub mod nearest_open_tile;
pub mod open_space;
pub mod open_space_census;
pub mod piece_rules;
pub mod prefabs;
pub mod relay_chambers;
pub mod sweep_axis;

pub use assembly_check::*;
pub use floor_density::*;
pub use floor_seed::*;
pub use generator::*;
pub use lamp_runtime::*;
pub use nearest_open_tile::*;
pub use open_space_census::*;
pub use relay_chambers::*;
pub use sweep_axis::*;
pub mod surface_paint;
pub mod track_carve;
pub mod track_floor;
pub mod track_grow;
pub mod track_launch;
pub mod track_path;
pub mod track_socket;

use crate::grid::{is_walkable, Grid};

/// THE PASS ORDER IS THE CONTRACT — written out, not derived.
///
/// Derived from a run it would assert nothing: a pipeline that lost a pass
/// would produce a shorter list and match its own shorter list. Written out, a
/// dropped or reordered pass fails here, next to the names, instead of as
/// twenty-two shifted digests. Must equal the TS exporter's `PASS_ORDER`.
pub const PASS_ORDER: [&str; 23] = [
    "grow-track",
    "track-path",
    "carve-track",
    "plaza",
    "launch-chute",
    "grow-maze",
    "endpoints-early",
    "repair-1",
    "plan-doorways",
    "publish-arcs",
    "orbit-island",
    "arc-sweeps",
    "repair-2",
    "endpoints-final",
    "boss-chamber",
    "artery-banks",
    "reseal-chute",
    "carve-doorways",
    "funnels-relays",
    "compact-fixed-point",
    "stairs",
    "arc-rails",
    "done",
];

/// The track's footprint on the grid — port of `maze/track-carve.ts TrackMask`.
///
/// Carried alongside the grid rather than derived from it, because the two
/// things it records cannot be re-derived: which tiles the CIRCUIT carved (a
/// lane and a room look identical once both are floor), and which of those must
/// stay sealed. `sealed` is the launch chute today: a plunger lane whose sides
/// the on-ramp pass has drilled is not a plunger lane.
#[derive(Clone, Debug, PartialEq)]
pub struct TrackMask {
    /// 1 = carved as track surface. Row-major, same layout as `Grid.t`.
    pub lane: Vec<u8>,
    /// Distance in tiles from the track centreline (`f32::INFINITY` off-track).
    pub dist: Vec<f32>,
    /// 1 = lane tile nothing may tap into, tunnel through, or open beside.
    pub sealed: Vec<u8>,
}

impl TrackMask {
    /// An empty mask sized to a grid: nothing carved, everything off-track.
    pub fn for_grid(g: &Grid) -> Self {
        let n = (g.w * g.h) as usize;
        Self {
            lane: vec![0; n],
            dist: vec![f32::INFINITY; n],
            sealed: vec![0; n],
        }
    }
}

/// A small scalar a pass reports about itself — the Rust twin of the TS
/// `PassExtra` values, which are exactly these four JSON shapes.
///
/// Pinned VERBATIM rather than digested: `{"arcs":68,"lanes":10} → {...:9}`
/// tells you what went wrong, and a hash of it tells you only that something
/// did. Cheap enough to store in full because there are a handful per pass.
#[derive(Clone, Debug, PartialEq)]
pub enum Extra {
    Int(i64),
    Ints(Vec<i64>),
    Strs(Vec<String>),
    Null,
}

/// A pass's scalars, IN THE ORDER THE PASS REPORTS THEM — the same order the
/// TS object literal is written in, so the two sides compare position by
/// position without either having to sort.
pub type PassExtra = Vec<(&'static str, Extra)>;

/// What a pass boundary hands the observer. `mask` is `None` for the two passes
/// that run before the track is carved.
pub struct PassSnapshot<'a> {
    pub pass: &'static str,
    pub grid: &'a Grid,
    pub mask: Option<&'a TrackMask>,
    pub extra: PassExtra,
    /// The doorway plan, on the one pass that owns it — LIVE, like the grid.
    ///
    /// Here for the reason the TS snapshot carries `graph`/`path`:
    /// `plan-doorways` writes nothing to the grid, so a boundary that only
    /// digests tiles certifies `repair-1`'s output a second time and calls the
    /// plan verified. See [`digest::digest_sites`] for the measurement.
    pub sites: Option<&'a [doorways::DoorwaySite]>,
    /// Cumulative draws at this boundary.
    ///
    /// Reported BY the pipeline rather than read from the rng by the observer,
    /// because the pipeline holds the only mutable borrow of it while a pass is
    /// running. The TS exporter wraps the stream in its own `countingRng` and
    /// reads the wrapper; here [`CountingRng`] already is that wrapper, so
    /// handing its count across the seam is the same fact by a shorter route.
    pub draws: u64,
}

/// The per-pass observation seam — twin of the `onPass` hook in
/// `maze/track-floor.ts`.
///
/// Consumes no rng, allocates nothing into the floor and does not touch the
/// grid: a floor built with a probe is bit-identical to one built without it.
pub type PassProbe<'p> = &'p mut dyn FnMut(PassSnapshot<'_>);

/// One boundary's fingerprint. Field-for-field the TS exporter's `PassRecord`.
#[derive(Clone, Debug, PartialEq)]
pub struct PassRecord {
    pub pass: String,
    /// Cumulative rng draws at this boundary, counted from the floor's first.
    ///
    /// The localiser: two implementations that have drawn the same NUMBER of
    /// values by pass K agree about everything randomness reached before K.
    pub draws: u64,
    pub t: u32,
    pub shapes: u32,
    pub arcs: u32,
    pub arc_idx: Option<u32>,
    pub lane: Option<u32>,
    pub sealed: Option<u32>,
    pub dist: Option<u32>,
    /// The doorway plan, on the one pass that owns it. `None` everywhere else.
    pub plan_sites: Option<u32>,
    /// Exact counts, so a mismatch is legible without dumping a grid.
    pub walkable: u32,
    pub shaped: u32,
    pub arc_tiles: u32,
    pub lane_tiles: u32,
    pub sealed_tiles: u32,
    pub extra: PassExtra,
}

fn count_if<T: Copy>(a: &[T], pred: impl Fn(T) -> bool) -> u32 {
    a.iter().filter(|&&v| pred(v)).count() as u32
}

fn walkable_count(g: &Grid) -> u32 {
    let mut n = 0;
    for j in 0..g.h {
        for i in 0..g.w {
            if is_walkable(g, i, j) {
                n += 1;
            }
        }
    }
    n
}

/// Fingerprint one pass boundary. The twin of the TS exporter's `record`.
pub fn record(snap: &PassSnapshot<'_>) -> PassRecord {
    let g = snap.grid;
    let mask = snap.mask;
    PassRecord {
        pass: snap.pass.to_string(),
        draws: snap.draws,
        t: digest::digest_bytes(&g.t),
        shapes: digest::digest_bytes(&g.shapes),
        arcs: digest::digest_arcs(&g.arcs),
        arc_idx: g.arc_idx.as_deref().map(digest::digest_i16),
        lane: mask.map(|m| digest::digest_bytes(&m.lane)),
        sealed: mask.map(|m| digest::digest_bytes(&m.sealed)),
        dist: mask.map(|m| digest::digest_f32(&m.dist)),
        plan_sites: snap.sites.map(digest::digest_sites),
        walkable: walkable_count(g),
        shaped: count_if(&g.shapes, |v| v != 0),
        arc_tiles: g.arc_idx.as_deref().map_or(0, |a| count_if(a, |v| v >= 0)),
        lane_tiles: mask.map_or(0, |m| count_if(&m.lane, |v| v == 1)),
        sealed_tiles: mask.map_or(0, |m| count_if(&m.sealed, |v| v == 1)),
        extra: snap.extra.clone(),
    }
}

/// The floor's stream with a call counter on it — the twin of the exporter's
/// `countingRng`.
///
/// Same values in the same order, so the floor it produces is bit-identical to
/// one built from a bare [`crate::rng::Mulberry32`]. Every pass draws through
/// this, and the count it carries is what turns "the floor is wrong" into "pass
/// 12 drew 32 values where the oracle drew 34".
#[derive(Clone, Debug)]
pub struct CountingRng {
    inner: crate::rng::Mulberry32,
    draws: u64,
}

impl CountingRng {
    pub fn new(seed: u32) -> Self {
        Self {
            inner: crate::rng::Mulberry32::new(seed),
            draws: 0,
        }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.draws += 1;
        self.inner.next_f64()
    }

    pub fn draws(&self) -> u64 {
        self.draws
    }
}

/// The one deterministic stream per (run, level) — port of `maze/floor-seed.ts`.
///
/// Deliberately not a hash of a string: every co-op peer must derive it from
/// two numbers they already agree on, with no ordering or encoding subtleties.
/// The constant is 2^32/φ, odd — multiplying spreads a small incrementing
/// `level` across the whole word before it is XORed into the run seed, so
/// consecutive floors of one run look unrelated.
pub fn floor_seed(run_seed: u32, level: i32) -> u32 {
    // JS `level * GOLDEN32` is an f64 product truncated to i32 by `^`. Below
    // 2^53 that is exactly a wrapping 32-bit multiply, which is what this is.
    run_seed ^ (level as u32).wrapping_mul(0x9e37_79b9)
}

/// The floor's rng, ready to draw from — prefer this over seeding by hand.
pub fn floor_rng(run_seed: u32, level: i32) -> CountingRng {
    CountingRng::new(floor_seed(run_seed, level))
}

#[cfg(test)]
mod tests {
    use super::*;

    // `floor_seed` is checked against the JS oracle in
    // `tests/maze_pass_digests.rs`, over every corpus floor's pinned
    // `floorSeed`. Deliberately NOT duplicated here as a hand-copied pin: two
    // sources of truth for one constant is how a stale pin certifies a drifted
    // implementation.

    #[test]
    fn counting_rng_is_the_bare_stream_plus_a_counter() {
        let mut bare = crate::rng::Mulberry32::new(12345);
        let mut counted = CountingRng::new(12345);
        for k in 0..64 {
            assert_eq!(counted.next_f64(), bare.next_f64(), "draw {k} diverged");
        }
        assert_eq!(counted.draws(), 64);
    }
}
