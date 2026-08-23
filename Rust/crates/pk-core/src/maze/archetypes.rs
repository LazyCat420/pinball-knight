//! FLOOR ARCHETYPES — the macro layout of a depth.
//!
//! Port of `legacy/src/game/pinball-knight/maze/archetypes.ts`, the TRACK half.
//!
//! Themes change a floor's furniture and biomes change its colour, but until
//! this table every floor was the same object underneath. An archetype changes
//! the floor's SHAPE — one great open hall, a highway with branches hanging off
//! it, a cave, a ring keep — which is the thing a player reads as "a different
//! level".
//!
//! ## Only the `track` half is here, and that is not an abbreviation
//!
//! The legacy `FloorArchetype` also carries `seeds()`, `braidMult`,
//! `braidGradient` and `solid`, which shape the grid `generateMaze` grows. That
//! grid is the FALLBACK: `TRACK_FIRST` has been on since the circuit rework and
//! `buildTrackFloor` declined 0 times in 400 measured floors, so on every floor
//! a player sees, `seeds()` is discarded. Porting it now would be porting dead
//! code ahead of live code. `windiness` IS here — it rides into the track
//! pipeline as `density`.
//!
//! The archetype's grip on the live generator was itself once missing: measured,
//! a blind census over 6 seeds × 10 depths could not tell the five archetypes
//! apart on ANY statistic, because `buildTrackFloor` took no archetype argument
//! at all — the descent card named a floor the game was not making. The
//! [`TrackProfile`] is what makes the name true, so it is the part that ships
//! first.
//!
//! ⚠️ Every number here is pinned against the oracle: the parity fixture
//! records the resolved profile VERBATIM for each corpus floor, and
//! `tests/maze_pass_digests.rs` compares this table against it field by field.
//! A typo in a constant is a different floor, silently.
//!
//! PORTS: `maze/archetypes.ts`

use crate::maze::CountingRng;

/// The five shapes, in table order. `archetype_for` cycles through them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArchetypeId {
    Warrens,
    Spine,
    GreatHall,
    Cavern,
    RingKeep,
}

impl ArchetypeId {
    /// The id as the legacy strings, for fixture comparison and debug output.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Warrens => "warrens",
            Self::Spine => "spine",
            Self::GreatHall => "greathall",
            Self::Cavern => "cavern",
            Self::RingKeep => "ringkeep",
        }
    }
}

/// Where the food nodes go — the archetype's real lever (see `track_grow`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum NodeLayout {
    Scatter,
    Spine,
    Ring,
    Hub,
}

impl NodeLayout {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Scatter => "scatter",
            Self::Spine => "spine",
            Self::Ring => "ring",
            Self::Hub => "hub",
        }
    }
}

/// PLACEMENT RULE WEIGHTS — where the spawn goes and how far the exit must be.
///
/// A profile overrides some of these and inherits the rest, which is the point
/// of a global baseline; in the legacy source that is `Partial<FloorRuleWeights>`
/// merged over [`DEFAULT_RULE_WEIGHTS`]. Here each field is an `Option` and
/// [`RuleWeights::resolve`] does the merge, so "unset" and "set to the default
/// value" stay distinguishable — they read identically on a floor but not in a
/// diff against the fixture.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RuleOverrides {
    pub perimeter_bias: Option<f64>,
    pub min_boss_tiles: Option<f64>,
    pub min_boss_euclid: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RuleWeights {
    /// How strongly the spawn is pulled toward the map's edge, 0..1. 1 = "put
    /// me in a corner". The exemption is real and `greathall` is what it is
    /// for: that archetype's whole shape is one great chamber, so spawning on
    /// its rim would put the player outside the thing the floor is about.
    pub perimeter_bias: f64,
    /// Minimum PATH distance in tiles from the spawn to the boss. Absolute
    /// tiles, not a fraction of reach: max reach includes cul-de-sacs nothing
    /// is ever placed in, and tiles are what the player experiences.
    pub min_boss_tiles: f64,
    /// Minimum STRAIGHT-LINE distance in tiles. Path distance was not enough —
    /// the king's ranged attacks ignore walls, so a 30-step walk with a wall in
    /// it is still a boss shooting at your spawn from seven tiles away.
    pub min_boss_euclid: f64,
}

/// Comfortably past the king's bone range (16), with margin for the knight
/// drifting toward him on the launch.
pub const DEFAULT_RULE_WEIGHTS: RuleWeights = RuleWeights {
    perimeter_bias: 0.75,
    min_boss_tiles: 30.0,
    min_boss_euclid: 20.0,
};

impl RuleOverrides {
    pub fn resolve(&self) -> RuleWeights {
        RuleWeights {
            perimeter_bias: self
                .perimeter_bias
                .unwrap_or(DEFAULT_RULE_WEIGHTS.perimeter_bias),
            min_boss_tiles: self
                .min_boss_tiles
                .unwrap_or(DEFAULT_RULE_WEIGHTS.min_boss_tiles),
            min_boss_euclid: self
                .min_boss_euclid
                .unwrap_or(DEFAULT_RULE_WEIGHTS.min_boss_euclid),
        }
    }
}

/// A weighted material mix for one distance band — `(material id, weight)` in
/// the order the picker walks them.
///
/// ⚠️ ASCENDING MATERIAL ID, WHICH IS **NOT** THE ORDER THE LEGACY LITERAL IS
/// WRITTEN IN. The legacy value is a JS object with integer-like keys, and the
/// language iterates those in ascending numeric order regardless of insertion
/// order. So `{[MAT_ICE]: 3, [MAT_RUBBER]: 1}` — ice first on the page — is
/// `{1: 1, 2: 3}` at runtime, rubber first. Transcribing the literal in reading
/// order gives a mix whose weighted pick walks backwards; two of the five
/// archetypes (Cavern's machine band, Ring Keep's drain) hit exactly that.
///
/// Confirmed against the serialized profile in the parity fixture rather than
/// reasoned about: `"machine":{"1":1,"2":3}`.
///
/// An ordered slice rather than a map because the order is load-bearing and a
/// map would hash it away.
pub type SurfaceMix = &'static [(u8, f64)];

/// WHAT THE THREE ZONES ARE MADE OF — the bands `decorate` has zoned rooms by
/// since Slice 9 (distance from the spawn, cut at 0.34 and 0.68), so the
/// material and the furniture describe the same floor instead of two competing
/// ones.
///
/// Carried on the profile though `paint_bands` runs OUTSIDE the track pipeline:
/// the fixture pins the whole profile verbatim, and a field this table omits is
/// a field that silently stops being compared.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BandPaint {
    /// Near the spawn — the launch district, where the player builds speed.
    pub launch: Option<SurfaceMix>,
    /// The middle of the floor — the machine core, where the chain gets racked.
    pub machine: Option<SurfaceMix>,
    /// Out by the stairs — the drain lane, the fight and the reward.
    pub drain: Option<SurfaceMix>,
    /// Roughly what fraction of each band to cover. Drives patch COUNT; it is
    /// not measured back.
    pub coverage: Option<f64>,
}

/// The archetype's grip on the track-first generator.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrackProfile {
    pub layout: NodeLayout,
    /// Food and relay nodes per 1000 tiles of grid. DENSITIES, not counts: the
    /// old absolute clamps bound from floor 1, so a floor three times the area
    /// got the same little circuit and the lane share decayed 0.30 → 0.12 with
    /// depth.
    pub food_per_1k: f64,
    pub relay_per_1k: f64,
    /// Circuit-rank floor. 1 = a single loop is enough; 4 = a proper web.
    pub min_loops: i32,
    /// Multiplier on every lane half-width.
    pub lane_scale: f64,
    /// Fraction of the leftover space the maze fills.
    pub fill: f64,
    /// On-ramp probability — how porous the circuit's edge is.
    pub link_chance: f64,
    /// Open chamber radius at the most central junction, as a fraction of the
    /// floor's short side. 0 = no plaza.
    pub plaza_frac: f64,
    /// Cap on chord length as a fraction of the short side. Long chords pave
    /// everything they cross; short ones keep the network local and planar-ish.
    pub max_len_frac: f64,
    /// Pruner survival threshold relative to the strongest tube — the coarse
    /// "how much track" dial.
    pub survive: f64,
    pub rules: RuleOverrides,
    pub bands: Option<BandPaint>,
}

pub const DEFAULT_TRACK_PROFILE: TrackProfile = TrackProfile {
    layout: NodeLayout::Scatter,
    food_per_1k: 3.8,
    relay_per_1k: 5.5,
    min_loops: 2,
    lane_scale: 1.0,
    fill: 0.72,
    link_chance: 0.28,
    plaza_frac: 0.0,
    max_len_frac: 0.42,
    survive: 0.12,
    rules: RuleOverrides {
        perimeter_bias: None,
        min_boss_tiles: None,
        min_boss_euclid: None,
    },
    bands: None,
};

/// Node counts for a floor of `w × h` tiles under a profile.
///
/// Clamped only at the extremes: the floor stops a tiny map degenerating into
/// two nodes and a line, and the ceiling is a runaway guard on the deepest maps
/// rather than the operative value on every one — which is exactly what the old
/// `min(15, …)` turned out to be, binding from floor 1 while the grid grew
/// 3,975 → 11,125 tiles.
pub fn track_node_counts(p: &TrackProfile, w: i32, h: i32) -> (i32, i32) {
    let k = f64::from(w * h) / 1000.0;
    (
        js_round(p.food_per_1k * k).clamp(6.0, 44.0) as i32,
        js_round(p.relay_per_1k * k).clamp(8.0, 64.0) as i32,
    )
}

/// `Math.round` — half away from ZERO is Rust's `round()`, but JS rounds half
/// UP (toward +∞), so −0.5 goes to −0 in JS and −1 in Rust. Every use here is
/// positive, and the function exists so the next one is not the first to find
/// out.
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// One archetype, track-side.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FloorArchetype {
    pub id: ArchetypeId,
    /// Shown on the descent card next to the biome name.
    pub label: &'static str,
    pub flavour: &'static str,
    /// Growing-tree windiness RANGE, rolled per floor. 1 = long winding
    /// backtracker corridors, 0 = bushy many-junction Prim's. This is the
    /// archetype's TEXTURE knob, and it is what stops floors of the same
    /// archetype reading identically — a depth-keyed cycle gave every Cavern
    /// the same corridor character forever.
    pub windiness: (f64, f64),
    pub track: TrackProfile,
}

// Material ids (engine/surfaces.ts).
const MAT_RUBBER: u8 = 1;
const MAT_ICE: u8 = 2;
const MAT_MUD: u8 = 3;
const MAT_BRASS: u8 = 4;

pub const ARCHETYPES: [FloorArchetype; 5] = [
    FloorArchetype {
        id: ArchetypeId::Warrens,
        label: "Warrens",
        flavour: "close corridors · nowhere to build speed",
        // Mixed: junction-y passages AND long halls — the classic maze read.
        windiness: (0.5, 0.9),
        // Tight lanes, a dense web of short tubes, and the maze pressed right
        // up against them: the floor whose flavour promises "nowhere to build
        // speed" should be the one where the circuit is narrowest and busiest.
        // Censused lane share 0.25 → 0.15 from floor 1 to 16 — it thins with
        // depth on purpose, because a Warrens is a maze that happens to have
        // roads.
        track: TrackProfile {
            layout: NodeLayout::Scatter,
            food_per_1k: 4.6,
            relay_per_1k: 6.4,
            min_loops: 3,
            lane_scale: 0.85,
            fill: 0.86,
            link_chance: 0.34,
            plaza_frac: 0.0,
            max_len_frac: 0.34,
            survive: 0.1,
            // A warren is a tight tangle with no centre worth starting in —
            // push the opening hard to an edge so the run reads as burrowing
            // INWARD.
            rules: RuleOverrides {
                perimeter_bias: Some(0.9),
                ..NO_RULES
            },
            // "nowhere to build speed" said underfoot rather than only on the
            // card. The launch district is the one band every other archetype
            // makes fast; a Warrens makes it MUD, so the floor refuses you a
            // run-up from the first tile.
            bands: Some(BandPaint {
                launch: Some(&[(MAT_MUD, 1.0)]),
                machine: Some(&[(MAT_RUBBER, 1.0)]),
                drain: Some(&[(MAT_BRASS, 1.0)]),
                coverage: Some(0.26),
            }),
        },
    },
    FloorArchetype {
        id: ArchetypeId::Spine,
        label: "The Spine",
        flavour: "one long road · everything else is a pocket",
        windiness: (0.85, 1.0),
        // Food strung around ONE long thin stadium, so the flow solver has no
        // competing route to reinforce and pours everything into a single
        // boulevard with a return run. The lowest loop floor in the game for
        // the same reason: a spine with a web around it is just a Warrens with
        // a wide bit.
        track: TrackProfile {
            layout: NodeLayout::Spine,
            food_per_1k: 3.2,
            relay_per_1k: 5.0,
            min_loops: 1,
            lane_scale: 1.25,
            fill: 0.7,
            link_chance: 0.22,
            plaza_frac: 0.0,
            max_len_frac: 0.55,
            survive: 0.14,
            // Starting at an END of the stadium means the boulevard is ahead of
            // you; starting halfway along wastes half the floor's only straight.
            rules: RuleOverrides {
                perimeter_bias: Some(0.8),
                ..NO_RULES
            },
            bands: Some(BandPaint {
                launch: Some(&[(MAT_BRASS, 1.0)]),
                machine: Some(&[(MAT_RUBBER, 1.0)]),
                drain: Some(&[(MAT_BRASS, 1.0)]),
                coverage: Some(0.3),
            }),
        },
    },
    FloorArchetype {
        id: ArchetypeId::GreatHall,
        label: "The Great Hall",
        flavour: "one vast chamber · room to really move",
        windiness: (0.2, 0.5),
        // The hub layout puts a food node dead centre with spokes radiating
        // out; `plaza_frac` then opens that node into the chamber the name
        // promises. The maze fills less of the rind so the hall dominates, and
        // the lanes are the widest of any archetype — this is the TABLE floor.
        track: TrackProfile {
            layout: NodeLayout::Hub,
            food_per_1k: 3.9,
            relay_per_1k: 4.4,
            min_loops: 2,
            lane_scale: 1.35,
            fill: 0.62,
            link_chance: 0.3,
            // 0.16 was not enough to make the name true: censused over 36
            // floors, the Great Hall's largest fully-open blob covered 0.153 of
            // its walkable area — BEHIND the Warrens' 0.185, which has no plaza
            // and gets there by accident where a dense web's lanes merge. Area
            // goes as the square, so 0.16 → 0.24 is a 2.25× hall; 0.29 is where
            // it landed.
            plaza_frac: 0.29,
            max_len_frac: 0.45,
            survive: 0.1,
            // THE EXEMPTION, and the reason `perimeter_bias` is a weight rather
            // than a global boolean.
            rules: RuleOverrides {
                perimeter_bias: Some(0.15),
                ..NO_RULES
            },
            // The hall IS the machine core, and the machine core is where the
            // heaviest rubber goes: a chamber ringed in walls that throw you
            // back is the only place on any floor where a carom can chain more
            // than twice.
            bands: Some(BandPaint {
                launch: Some(&[(MAT_BRASS, 1.0)]),
                machine: Some(&[(MAT_RUBBER, 3.0), (MAT_BRASS, 1.0)]),
                drain: Some(&[(MAT_BRASS, 1.0)]),
                coverage: Some(0.34),
            }),
        },
    },
    FloorArchetype {
        id: ArchetypeId::Cavern,
        label: "The Cavern",
        flavour: "no straight lines · the rock decides",
        windiness: (0.1, 0.4),
        // The loopiest floor in the game: dense food, the highest loop floor, a
        // permissive pruner and short chords so nothing runs straight for long.
        // "No straight lines" is a claim about TOPOLOGY, and this is where it
        // gets paid for — high circuit rank with short legs is a floor with no
        // through-route, only choices.
        track: TrackProfile {
            layout: NodeLayout::Scatter,
            food_per_1k: 5.0,
            relay_per_1k: 7.0,
            min_loops: 4,
            lane_scale: 0.95,
            fill: 0.68,
            link_chance: 0.4,
            plaza_frac: 0.0,
            max_len_frac: 0.3,
            survive: 0.07,
            // A cave has no architecture to respect, so the edge is as good a
            // mouth as any — but less insistently than a warren.
            rules: RuleOverrides {
                perimeter_bias: Some(0.7),
                ..NO_RULES
            },
            // "the rock decides" is a claim about who is steering, and ICE is
            // the only surface that literally takes the wheel: it keeps your
            // heading as well as your speed, so on a floor with no straight
            // lines the bend you are already in decides where you come out.
            bands: Some(BandPaint {
                launch: None,
                // Ascending id, not the literal's ice-first reading order —
                // see SurfaceMix. `{1:1, 2:3}` in the oracle's own JSON.
                machine: Some(&[(MAT_RUBBER, 1.0), (MAT_ICE, 3.0)]),
                drain: Some(&[(MAT_MUD, 2.0), (MAT_BRASS, 1.0)]),
                coverage: Some(0.3),
            }),
        },
    },
    FloorArchetype {
        id: ArchetypeId::RingKeep,
        label: "The Ring Keep",
        flavour: "gallery within gallery · the way in is inward",
        windiness: (0.6, 0.8),
        // Food on concentric rectangles, so the surviving tubes are galleries
        // and the connections between them are gates. A low link chance keeps
        // the galleries reading as separate roads rather than leaking into one
        // another — "the way in is inward" only means anything if getting
        // inward is a decision.
        track: TrackProfile {
            layout: NodeLayout::Ring,
            food_per_1k: 3.6,
            relay_per_1k: 5.2,
            // Every gallery is a closed loop and every gate between two of them
            // adds another, so a Ring Keep measuring 2 independent cycles is a
            // Ring Keep with one ring. Raised 3 → 4 once the relay keep-out
            // stopped the mesh short-circuiting the galleries: without a loop
            // floor to hold it, a blind census read a third of Ring Keeps as
            // Spines.
            min_loops: 4,
            lane_scale: 1.05,
            fill: 0.74,
            link_chance: 0.2,
            plaza_frac: 0.0,
            max_len_frac: 0.4,
            survive: 0.14,
            // The whole progression is working INWARD ring by ring, which only
            // reads if you start on the outermost one.
            rules: RuleOverrides {
                perimeter_bias: Some(0.85),
                ..NO_RULES
            },
            // "the way in is inward" as a gradient you can feel: plain stone on
            // the outer gallery, brass once you are through the first gate,
            // brass and rubber together in the keep.
            bands: Some(BandPaint {
                launch: None,
                machine: Some(&[(MAT_BRASS, 1.0)]),
                // Ascending id: `{1:1, 4:2}`, not the literal's brass-first.
                drain: Some(&[(MAT_RUBBER, 1.0), (MAT_BRASS, 2.0)]),
                coverage: Some(0.28),
            }),
        },
    },
];

/// `..NO_RULES` in a const initialiser — `RuleOverrides::default()` is not
/// const-callable, and spelling three `None`s at five sites invites a typo that
/// silently moves a spawn.
const NO_RULES: RuleOverrides = RuleOverrides {
    perimeter_bias: None,
    min_boss_tiles: None,
    min_boss_euclid: None,
};

/// The archetype for a depth.
///
/// Cycles every 5 while the biome cycles every 4, so the pair takes 20 floors
/// to repeat instead of 4. Level 1 stays Warrens — the floor players already
/// know — for the same reason the windiness cycle opens at 1.0.
pub fn archetype_for(level: i32) -> &'static FloorArchetype {
    &ARCHETYPES[((level.max(1) - 1) % ARCHETYPES.len() as i32) as usize]
}

/// This floor's growing-tree windiness: a roll inside the archetype's range.
///
/// ⚠️ DRAWS. Level 1 returns early and draws NOTHING, so the floor's stream is
/// one value further along at level 2 than at level 1 — which is why the
/// fixture pins `drawsBeforeTrack` per floor instead of assuming a constant.
pub fn windiness_for(level: i32, arch: &FloorArchetype, rng: &mut CountingRng) -> f64 {
    if level <= 1 {
        return 1.0;
    }
    let (lo, hi) = arch.windiness;
    lo + rng.next_f64() * (hi - lo)
}

/// The grid the level asks for, in maze CELLS — the tile grid is `2c+1` a side.
///
/// Port of `constants/level.ts levelConfig`'s two size fields, and only those:
/// the rest of that config is budgets for content the track pipeline never
/// sees. The caps move the depth at which growth STOPS, not the ramp rate, so
/// every floor shallower than L23 is bit-identical to the pre-cap game.
pub fn level_cells(level: i32) -> (i32, i32) {
    let l = level.max(1) as f64;
    let cells_w = (34.0 + (l * 2.8).ceil()).min(96.0) as i32;
    let cells_h = (24.0 + 2.0 * l).min(72.0) as i32;
    (cells_w, cells_h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archetypes_cycle_every_five_from_warrens() {
        assert_eq!(archetype_for(1).id, ArchetypeId::Warrens);
        assert_eq!(archetype_for(5).id, ArchetypeId::RingKeep);
        assert_eq!(archetype_for(6).id, ArchetypeId::Warrens);
        // Level 0 and negatives are clamped rather than wrapping to the end of
        // the table — a floor below 1 should not be a Ring Keep.
        assert_eq!(archetype_for(0).id, ArchetypeId::Warrens);
    }

    #[test]
    fn level_one_windiness_draws_nothing() {
        let mut rng = CountingRng::new(7);
        assert_eq!(windiness_for(1, archetype_for(1), &mut rng), 1.0);
        assert_eq!(rng.draws(), 0, "level 1 must not touch the stream");
        let _ = windiness_for(2, archetype_for(2), &mut rng);
        assert_eq!(rng.draws(), 1);
    }

    #[test]
    fn a_profile_override_wins_and_the_rest_inherit() {
        let w = archetype_for(1).track.rules.resolve();
        assert_eq!(w.perimeter_bias, 0.9);
        assert_eq!(w.min_boss_tiles, DEFAULT_RULE_WEIGHTS.min_boss_tiles);
        assert_eq!(w.min_boss_euclid, DEFAULT_RULE_WEIGHTS.min_boss_euclid);
    }
}
