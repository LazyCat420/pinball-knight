//! AUTHORED FLOORS — the oracle's finished floors, loaded as data.
//!
//! The other half of `legacy/src/game/pinball-knight/port-floor-export.test.ts`.
//! That test calls `authorFloor(level)` — the function the running TS game calls
//! — and writes the finished grid AND `LevelPlan` to `assets/floors/L{n}-s{s}.json`.
//! This module reads them back.
//!
//! ## Why this exists at all
//!
//! `buildTrackFloor` authors a floor's SHAPE; everything a player looks at is
//! authored afterwards by `decorateMaze` (3,169 lines) — torches, parts, props,
//! items, secrets. Nine of the twenty-three shape passes are ported and none of
//! the content is, so the port's dungeon is a grey skeleton and no amount of
//! further generator work changes that. The decision taken on 2026-08-11 (see
//! `docs/src/status/handoff.md`) was that the TS game is a DATA SOURCE and not
//! only an oracle: render its floors now, port the generator behind them.
//!
//! ## What this module refuses to do
//!
//! **It does not fabricate a [`TrackFloor`].** An authored floor has a grid and
//! two endpoints; it has no circuit graph, no track path, no carve mask and no
//! doorway plan, because no Rust pass produced them. Wrapping the grid in an
//! empty `TrackFloor` would have reached `validate_runtime_floor` in one line
//! and left four fields that read as "this floor has no arcs / no doorways /
//! no circuit" rather than "nobody asked". `pk_core::maze::floor_spec::
//! validate_runtime_grid` was extracted instead, so both floor sources get the
//! same standability check from the same code.
//!
//! **It does not silently substitute.** A payload that fails to parse, carries
//! an unknown schema, or produces a floor the player cannot stand on is an
//! `Err`, and the shell paints the same red card a refused generated floor does.
//! A fallback here would make every "the authored floor looks like the generated
//! one" report unfalsifiable.
//!
//! ## The payload, measured (not assumed) from `assets/floors/*.json`
//!
//! - `grid.t`: `0` wall, `1` floor, `2` stairs, `3` cracked — the same constants
//!   as [`pk_core::grid`]. Every floor carries exactly one `T_STAIRS` tile, so
//!   an authored floor has REAL stairs where a generated one at P9 still has a
//!   provisional pass-7 pick.
//! - `grid.shapes`: mostly 0 (`SHAPE_FULL`) with 100-350 shaped tiles per floor.
//! - `grid.arcs`: 40-69 features, `solidOut` → `solid_out`. **Both `kicks` AND
//!   `lanes` are carried** — 5-6 kick bands and 4-8 lane bands per floor, with
//!   `cooldownT`/`hitT`/`cw` fully populated. The handoff's note that the export
//!   does not carry them is wrong; dropping them would have cost the rubber and
//!   the booster lanes on every curved wall with nothing on screen to say so.
//! - ⚠️ **`solidOut` is ABSENT on three quarters of the arcs**, and that is not
//!   a truncated export. `tile-shape.ts:226` declares it `solidOut?: boolean`
//!   and `:398` reads it as `if (f.solidOut)`, so the oracle's own default is
//!   falsy — and `JSON.stringify` drops an `undefined` key rather than writing
//!   `null`. Measured: present on 11/40, 10/40 and 17/69. A required field here
//!   refuses every floor (it did), and a field defaulted the OTHER way silently
//!   turns 29 convex guides into concave bowls. `owner` is present on every arc
//!   in all three exports, so it stays required-shaped (`Option`, but never
//!   absent in practice).
//! - `grid.surfaces`: one byte per tile, and **two vocabularies share it** — a
//!   walkable tile carries a `FLOOR_*` id, a solid one a `WALL_*` id
//!   (`surface-paint.ts:112-116`). Measured on L3-s1: 624 SAND, 440 STEEL and
//!   462 FLOWSTONE floor tiles, plus 455 MUD, 89 BRASS and 74 RUBBER walls —
//!   and **no ice on any of the three floors**, because ice is a modifier's
//!   material and none of them rolled it. Anything reading
//!   the byte must branch on walkability first; `dungeon_render::wash_buckets`
//!   does, and getting it backwards gives every icy floor mud physics silently.
//! - `plan.rooms` is `[]` on every floor, and that is CORRECT rather than a
//!   dropped field: `spawn/floor-authoring.ts:162-171` authors room rects only
//!   on the legacy growing-tree branch (half-scale cell coords, scaled ×2). A
//!   track floor "ships neither; decorateMaze's own sparse-region fill covers
//!   it", and `buildTrackFloor` declined 0 times in 400 floors. Its only reader
//!   is the minimap's room outline, which therefore draws none in the oracle
//!   either. The field is parsed and kept so the day a fallback floor is
//! PORTS: `spawn/floor-authoring.ts`, `spawn/floor-populate.ts`

use bevy::prelude::Resource;
use pk_core::grid::{world_to_tile, Grid};
use pk_core::maze::floor_spec::{validate_runtime_grid, RuntimeFloorInfo};
use pk_core::maze::track_launch::TilePos;
use pk_core::tile_shape::{ArcFeature, KickBand, LaneBand};
use serde::Deserialize;

/// The schema version this loader understands.
///
/// Refused rather than best-efforted: the exporter versions its output for
/// exactly this reason, and a loader that reads unknown fields blind is how a
/// renamed field becomes a floor with no torches on it.
const SCHEMA: u32 = 1;

/// The floors compiled into the binary.
///
/// `include_str!` and not a runtime read, for the reason `tavern_art.rs` embeds
/// its art: wasm and native then load identically, and a missing bake is a BUILD
/// error rather than a red card in front of the user. Measured cost: three files,
/// 181 KB of JSON.
const EMBEDDED: &[(i32, u32, &str)] = &[
    (1, 1, include_str!("../../../assets/floors/L1-s1.json")),
    (3, 1, include_str!("../../../assets/floors/L3-s1.json")),
    (5, 1, include_str!("../../../assets/floors/L5-s1.json")),
];

/// Which levels ship an authored floor, shallowest first.
pub fn available_levels() -> Vec<i32> {
    let mut v: Vec<i32> = EMBEDDED.iter().map(|(l, _, _)| *l).collect();
    v.sort_unstable();
    v
}

/// The authored floor a request lands on.
///
/// Only three floors are exported, so a run that descends past L5 has to land
/// somewhere. It lands on the DEEPEST floor at or below the level asked for —
/// never a shallower one for a deeper request, and never nothing. The chosen
/// level is carried in [`AuthoredFloor::level`] and printed in the banner, so a
/// screenshot of L7 says which floor it is actually showing.
fn pick(level: i32, run_seed: u32) -> Option<&'static (i32, u32, &'static str)> {
    EMBEDDED
        .iter()
        .filter(|(l, s, _)| *s == run_seed && *l <= level)
        .max_by_key(|(l, _, _)| *l)
        .or_else(|| EMBEDDED.iter().find(|(_, s, _)| *s == run_seed))
}

/// A floor exported from the oracle, parsed and validated.
///
/// A `Resource` for the same reason `ActiveFloor` is: the scene standing on the
/// floor needs to ask it questions — where the stairs are, what to put in the
/// banner — and it is torn down WITH that scene so the next descend cannot ask
/// the previous floor.
#[derive(Resource)]
pub struct AuthoredFloor {
    /// The level ASKED for.
    pub requested_level: i32,
    /// The level actually loaded — see [`pick`].
    pub level: i32,
    pub run_seed: u32,
    pub biome: Biome,
    pub archetype: String,
    pub modifier: Option<String>,
    pub grid: Grid,
    pub plan: LevelPlan,
    pub info: RuntimeFloorInfo,
}

impl AuthoredFloor {
    /// Is the player standing on the stairs?
    ///
    /// The twin of [`crate::real_floor::ActiveFloor::stands_on_exit`], and the
    /// reason it exists rather than being folded into that one: the two floor
    /// sources have different exits. A generated floor's is the PROVISIONAL
    /// pass-7 pick with a marker entity over it; an authored floor's is a real
    /// `T_STAIRS` tile. Tile equality, not a radius — the legacy descend rule is
    /// "stand on the tile", and a radius would fire early on the diagonal.
    pub fn stands_on_exit(&self, x: f64, z: f64) -> bool {
        let s = self.plan.stairs;
        world_to_tile(&self.grid, x, z) == (s.i, s.j)
    }

    /// The on-screen line. Same job as [`crate::real_floor::ActiveFloor::banner`]
    /// and deliberately the same shape, with the SOURCE first: the two floor
    /// sources now produce visually similar dungeons, and a screenshot that does
    /// not say which one it is proves nothing about either.
    pub fn banner(&self) -> String {
        let (sx, sz) = self.info.start_world;
        let (ex, ez) = self.info.provisional_exit_world;
        let asked = if self.level == self.requested_level {
            String::new()
        } else {
            format!(" (asked L{})", self.requested_level)
        };
        format!(
            // `x` and not `×` — Bevy's `default_font` renders U+00D7 as a tofu
            // box, which only a screenshot caught the last time.
            "AUTHORED FLOOR  L{} seed={}{asked}  {}  {}{}  {}x{}  \
             start=({sx:.0},{sz:.0})  stairs=({ex:.0},{ez:.0})  \
             torches={}  parts={}  props={}",
            self.level,
            self.run_seed,
            self.archetype,
            // The biome and the modifier are what make two floors at the same
            // level look different, so a screenshot that does not name them
            // cannot be told apart from one of the other three.
            self.biome.name,
            match &self.modifier {
                Some(m) => format!("  [{m}]"),
                None => String::new(),
            },
            self.grid.w,
            self.grid.h,
            self.plan.torches.len(),
            self.plan.parts.len(),
            self.plan.props.len(),
        )
    }
}

/// Why an authored floor could not be produced.
#[derive(Debug)]
pub enum AuthoredFloorError {
    /// No export ships for this seed.
    NoFloorFor {
        level: i32,
        run_seed: u32,
    },
    /// The file parsed as JSON but not as this schema.
    Parse(String),
    UnknownSchema {
        found: u32,
    },
    /// `w * h` disagrees with an array length — a truncated or edited export.
    GridSizeMismatch {
        field: &'static str,
        expected: usize,
        found: usize,
    },
    /// An arc names an owner this build has no `&'static str` for.
    UnknownArcOwner(String),
    /// More arcs than `arc_idx`'s `i16` can address.
    TooManyArcs(usize),
    /// The floor parsed and is not standable — the same verdict a generated
    /// floor gets, from the same function.
    NotStandable(pk_core::maze::floor_spec::FloorBuildError),
}

impl std::fmt::Display for AuthoredFloorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoFloorFor { level, run_seed } => write!(
                f,
                "no authored floor ships for seed {run_seed} (asked L{level}); \
                 available levels: {:?}",
                available_levels()
            ),
            Self::Parse(e) => write!(f, "authored floor did not parse: {e}"),
            Self::UnknownSchema { found } => write!(
                f,
                "authored floor schema {found}, this build reads {SCHEMA} — \
                 re-run RUN_EXPORT=1 in legacy/ or update the loader"
            ),
            Self::GridSizeMismatch {
                field,
                expected,
                found,
            } => write!(
                f,
                "authored floor grid.{field} has {found} entries, w*h is {expected}"
            ),
            Self::UnknownArcOwner(o) => write!(f, "authored floor arc owner {o:?} is not known"),
            Self::TooManyArcs(n) => write!(f, "authored floor has {n} arcs, arc_idx holds i16"),
            Self::NotStandable(e) => write!(f, "authored floor is not standable: {e}"),
        }
    }
}

/// Load, convert and validate the authored floor for this request.
pub fn load(level: i32, run_seed: u32) -> Result<AuthoredFloor, AuthoredFloorError> {
    let (found_level, _, raw) =
        pick(level, run_seed).ok_or(AuthoredFloorError::NoFloorFor { level, run_seed })?;
    let export: FloorExport =
        serde_json::from_str(raw).map_err(|e| AuthoredFloorError::Parse(e.to_string()))?;
    if export.schema != SCHEMA {
        return Err(AuthoredFloorError::UnknownSchema {
            found: export.schema,
        });
    }
    let grid = export.grid.into_grid()?;
    let info = validate_runtime_grid(&grid, export.plan.start.into(), export.plan.stairs.into())
        .map_err(AuthoredFloorError::NotStandable)?;
    Ok(AuthoredFloor {
        requested_level: level,
        level: *found_level,
        run_seed,
        biome: export.biome,
        archetype: export.archetype,
        modifier: export.modifier,
        grid,
        plan: export.plan,
        info,
    })
}

// ── The payload ────────────────────────────────────────────────────────────
//
// Field-for-field with the exporter's object literal. `deny_unknown_fields` is
// deliberately NOT set: the exporter adds sections as `decorateMaze` is
// understood, and a loader that refused a floor for carrying MORE than it needs
// would turn every export improvement into a build break. A field this loader
// does not know is a field nothing renders — which is visible on screen.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FloorExport {
    schema: u32,
    #[allow(dead_code)]
    producer: String,
    #[allow(dead_code)]
    level: i32,
    #[allow(dead_code)]
    run_seed: u32,
    biome: Biome,
    archetype: String,
    modifier: Option<String>,
    grid: GridExport,
    plan: LevelPlan,
}

/// The floor's colour identity. Three packed `0xRRGGBB` integers — the lighting
/// rig reads them, so they arrive as numbers and not CSS strings.
#[derive(Deserialize, Clone, Debug)]
pub struct Biome {
    pub name: String,
    #[allow(dead_code)]
    pub flavour: String,
    /// Ambient light colour.
    pub amb: u32,
    /// Sky / fog colour.
    pub sky: u32,
    /// Ground colour.
    pub ground: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GridExport {
    w: i32,
    h: i32,
    t: Vec<u8>,
    shapes: Vec<u8>,
    /// What each tile is MADE OF. Added to the exporter 2026-08-11 — before
    /// that the port's ice was stone to `pk_core::pinball`'s friction and
    /// steering as well as to the eye.
    #[serde(default)]
    surfaces: Option<Vec<u8>>,
    arcs: Option<Vec<ArcExport>>,
    arc_idx: Option<Vec<i32>>,
}

impl GridExport {
    fn into_grid(self) -> Result<Grid, AuthoredFloorError> {
        let n = (self.w as usize) * (self.h as usize);
        let check = |field: &'static str, len: usize| {
            if len == n {
                Ok(())
            } else {
                Err(AuthoredFloorError::GridSizeMismatch {
                    field,
                    expected: n,
                    found: len,
                })
            }
        };
        check("t", self.t.len())?;
        check("shapes", self.shapes.len())?;
        let surfaces = match self.surfaces {
            None => None,
            Some(v) => {
                check("surfaces", v.len())?;
                Some(v)
            }
        };

        let arcs: Vec<ArcFeature> = self
            .arcs
            .unwrap_or_default()
            .into_iter()
            .map(ArcExport::into_feature)
            .collect::<Result<_, _>>()?;
        if arcs.len() > i16::MAX as usize {
            return Err(AuthoredFloorError::TooManyArcs(arcs.len()));
        }
        let arc_idx = match self.arc_idx {
            None => None,
            Some(v) => {
                check("arcIdx", v.len())?;
                // The export's -1 is "no arc"; every other value indexes `arcs`,
                // which the length check above bounds to i16.
                Some(v.into_iter().map(|x| x as i16).collect())
            }
        };
        Ok(Grid {
            w: self.w,
            h: self.h,
            t: self.t,
            shapes: self.shapes,
            surfaces,
            arcs,
            arc_idx,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArcExport {
    cx: f64,
    cz: f64,
    r: f64,
    a0: f64,
    span: f64,
    /// Absent on ~3 of every 4 arcs — see the module header. The legacy type is
    /// `solidOut?: boolean` read as `if (f.solidOut)`, so absent IS false, and
    /// `false` is the majority case the exporter therefore never writes.
    #[serde(default)]
    solid_out: bool,
    owner: Option<String>,
    #[serde(default)]
    kicks: Option<Vec<KickExport>>,
    #[serde(default)]
    lanes: Option<Vec<LaneExport>>,
}

impl ArcExport {
    fn into_feature(self) -> Result<ArcFeature, AuthoredFloorError> {
        // `owner` is `Option<&'static str>` in the sim because it is compared by
        // identity in the arc contract and never built at runtime. Mapping the
        // owned string through a known set keeps that, and refuses an owner this
        // build does not know rather than defaulting it — the default ("sweep")
        // is the one that YIELDS, so a silently-defaulted owner would change
        // which of two arcs wins a contested tile.
        let owner = match self.owner.as_deref() {
            None => None,
            Some("track") => Some("track"),
            Some("island") => Some("island"),
            Some("funnel") => Some("funnel"),
            Some("sweep") => Some("sweep"),
            Some(other) => return Err(AuthoredFloorError::UnknownArcOwner(other.to_string())),
        };
        Ok(ArcFeature {
            cx: self.cx,
            cz: self.cz,
            r: self.r,
            a0: self.a0,
            span: self.span,
            solid_out: self.solid_out,
            owner,
            kicks: self
                .kicks
                .unwrap_or_default()
                .into_iter()
                .map(|k| KickBand {
                    a0: k.a0,
                    span: k.span,
                    cooldown_t: k.cooldown_t,
                    hit_t: k.hit_t,
                })
                .collect(),
            lanes: self
                .lanes
                .unwrap_or_default()
                .into_iter()
                .map(|l| LaneBand {
                    a0: l.a0,
                    span: l.span,
                    cw: l.cw,
                    cooldown_t: l.cooldown_t,
                    hit_t: l.hit_t,
                })
                .collect(),
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KickExport {
    a0: f64,
    span: f64,
    cooldown_t: f64,
    hit_t: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaneExport {
    a0: f64,
    span: f64,
    cw: bool,
    cooldown_t: f64,
    hit_t: f64,
}

/// A tile position as it arrives on the wire.
///
/// NOT `pk_core::maze::track_launch::TilePos`, and that is deliberate: pk-core
/// carries **zero** serde derives (`grep -rn "derive(.*Deserialize" crates/pk-core/src`
/// → 0 files) because the sim's types are compared bit-for-bit against a JS
/// oracle and nothing in them exists to serve a file format. Deriving
/// `Deserialize` on `TilePos` to save this eight-line struct would put a wire
/// format's requirements inside the sim. Converts with [`From`] at the one place
/// the sim needs it.
///
/// `deny_unknown_fields` here and nowhere else in this module, and it is load-
/// bearing rather than tidy: a `PinballPart` also has `i` and `j`, so a section
/// mis-typed as tiles would parse CLEANLY and drop the kind and the facing.
/// That is not hypothetical — `circuits[].links` is parts, and the first draft
/// of this file had it as tiles. Everywhere else the payload is allowed to grow
/// new fields; a tile is the one shape that must stay exactly two numbers.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Tile {
    pub i: i32,
    pub j: i32,
}

impl From<Tile> for TilePos {
    fn from(t: Tile) -> Self {
        TilePos { i: t.i, j: t.j }
    }
}

/// `decorateMaze`'s output — what stands on the floor.
/// ⚠️ `#[allow(dead_code)]` ON THE PAYLOAD TYPES, and it is a decision.
///
/// The loader parses the WHOLE contract; the renderers land one at a time.
/// `spawns` waits for P4's monsters, `secrets` for the cracked-band meshes,
/// `circuits` for the booster route, an item's `rarity` for its glow. Deleting a
/// field until something reads it would mean the export could quietly stop
/// carrying it and nothing would fail — the payload is the interface, and an
/// interface is worth parsing in full before it is worth rendering in full.
#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelPlan {
    pub start: Tile,
    pub stairs: Tile,
    pub spawns: Vec<Tile>,
    pub torches: Vec<Torch>,
    pub items: Vec<ItemDrop>,
    pub props: Vec<Prop>,
    pub parts: Vec<PinballPart>,
    /// Always empty on a track floor — see the module header.
    #[serde(default)]
    pub rooms: Vec<Room>,
    pub secrets: Vec<Tile>,
    #[serde(default)]
    pub plazas: Vec<Tile>,
    /// The croaker's pond, when the floor has one.
    #[serde(default)]
    pub frog: Option<Tile>,
    #[serde(default)]
    pub circuits: Vec<Circuit>,
}

/// A wall-mounted torch. `(di, dj)` points FROM the floor tile TO the wall it
/// mounts on, which is what puts the sconce on the wall and not in the air.
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Torch {
    pub i: i32,
    pub j: i32,
    pub di: i32,
    pub dj: i32,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
pub struct ItemDrop {
    /// `weapon` | `gear` | `potion`.
    pub kind: String,
    pub id: String,
    pub i: i32,
    pub j: i32,
    /// Present on 18 of 30 exported drops — potions carry no rarity.
    #[serde(default)]
    pub rarity: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Prop {
    /// `bones` | `rubble` | `skull` — keys into the legacy `PROP_PAINTS`.
    pub kind: String,
    pub i: i32,
    pub j: i32,
}

/// One pinball part, as `decorateMaze` planned it.
///
/// ⚠️ **`dir` is a UNIT VECTOR, not a cardinal.** Measured across all three
/// exports: `dirI`/`dirJ` are integers on most kinds and FLOATS on the curved
/// ones — a `boostcurve` carries `dirI: 0.4472135954999579, dirJ: -0.894…`,
/// which is `(1,-2)/√5`. Typing these as `i32` refuses every floor that has a
/// curve on it, and rounding them would point the booster somewhere the ball is
/// not thrown. `dir2` is the face the part sits on and is `0,0` on the
/// omnidirectional kinds (a bumper has no facing).
///
/// The flag fields are absent-means-false, the same shape as `solidOut`: the
/// exporter writes them only where the planner set them, so 52 of 303 parts are
/// on the booster spine and the other 251 simply have no key.
#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PinballPart {
    pub kind: String,
    pub i: i32,
    pub j: i32,
    #[serde(default)]
    pub dir_i: f64,
    #[serde(default)]
    pub dir_j: f64,
    #[serde(default)]
    pub dir2_i: f64,
    #[serde(default)]
    pub dir2_j: f64,
    /// Drop-target bank membership.
    #[serde(default)]
    pub bank: Option<i32>,
    /// Position within a bank or lane array.
    #[serde(default)]
    pub seq: Option<i32>,
    /// Rollover lane array membership, and position within it.
    #[serde(default)]
    pub lane: Option<i32>,
    #[serde(default)]
    pub lane_seq: Option<i32>,
    /// Which highway loop this part belongs to.
    #[serde(default)]
    pub circuit: Option<i32>,
    /// On the connected booster route — the station spine.
    #[serde(default)]
    pub spine: bool,
    /// In the plunger chute.
    #[serde(default)]
    pub chute: bool,
    /// A vault ramp's pad.
    #[serde(default)]
    pub vault: bool,
    /// Part of a booster tributary chain.
    #[serde(default)]
    pub chain: bool,
}

/// The plan's part kinds the SIM can honour today, as [`PartKind`] variants.
///
/// `None` is a normal answer and it is not a defect: ten of the seventeen kinds
/// the exporter emits are the P1 verbs that have not been ported yet — `target`,
/// `rollover`, `jumppad`, `trapdoor`, `pit`, `firevent`, `electric`, `lamp`,
/// `ramp`, `glove`. They are DRAWN by `authored_render` and they do nothing when
/// you touch them, which is the honest state of the port rather than a bug to
/// paper over.
///
/// ⚠️ **The catch-all arm is deliberately separate from the inert list.** Both
/// answer `None`, so the split buys nothing at runtime — it buys the test:
/// `every_exported_part_kind_is_accounted_for` walks the real payloads and fails
/// on a kind that reaches `_`, so an eighteenth kind from the oracle surfaces as
/// a red test rather than being filed under "not ported yet" forever.
pub fn sim_part_kind(kind: &str) -> Option<pk_core::pinball::PartKind> {
    use pk_core::pinball::PartKind as K;
    match kind {
        "bumper" => Some(K::Bumper),
        "spring" => Some(K::Spring),
        "booster" => Some(K::Booster),
        "boostcorner" => Some(K::BoostCorner),
        "boostcurve" => Some(K::BoostCurve),
        "deflector" => Some(K::Deflector),
        "oil" => Some(K::Oil),
        "spinpad" => Some(K::SpinPad),
        "slingshot" => Some(K::Slingshot),
        "flipper" => Some(K::Flipper),
        "mirror" => Some(K::Mirror),
        "magstrip" => Some(K::MagStrip),
        // ── Planned, drawn, and INERT until P1's remaining verbs land ──
        "target" | "rollover" | "jumppad" | "trapdoor" | "pit" | "firevent" | "electric"
        | "lamp" | "ramp" | "glove" => None,
        _ => None,
    }
}

/// The kinds the exporter emits that the sim cannot honour yet — the inert list
/// above, and the only place it is written down as data.
///
/// Read only by the tests today, and `pub` on purpose: it is the list a reader
/// checks against when a part "does nothing", and the thing
/// `every_exported_part_kind_is_accounted_for` measures the `_` arm against.
#[allow(dead_code)]
pub const INERT_PART_KINDS: [&str; 10] = [
    "target", "rollover", "jumppad", "trapdoor", "pit", "firevent", "electric", "lamp", "ramp",
    "glove",
];

/// Every part in the plan the sim cannot honour yet, counted by kind.
///
/// A `BTreeMap` and not a `HashMap`: this feeds the install log, and a map whose
/// iteration order flaps would make two runs of the same floor print two
/// different banners.
pub fn unhonoured_part_kinds(plan: &LevelPlan) -> Vec<(String, usize)> {
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for p in &plan.parts {
        if sim_part_kind(&p.kind).is_none() {
            *counts.entry(p.kind.clone()).or_default() += 1;
        }
    }
    counts.into_iter().collect()
}

/// The plan's parts, as the parts the ball actually hits.
///
/// The oracle's own conversion is `createPinballParts`
/// (`render/pinball-parts.ts:892-955`): `tileCenter(g, i, j)` gives `x`/`z`, and
/// `dirX`/`dirZ` are `dirI`/`dirJ` **verbatim** — no rounding, no cardinal
/// snapping. This is that function's sim half, minus the three.js meshes.
///
/// ⚠️ `part.i` is the TILE `i`, and it is not decoration: it seeds
/// `spin_pad_phase(elapsed, i)`, which BOTH the deflection in
/// `touch_pinball_parts` and the rotor's rotation in `pinball-parts.ts:1260`
/// read. Hand it an array index instead and every spinpad deflects along an axis
/// its own art is not pointing down.
pub fn sim_parts(grid: &Grid, plan: &LevelPlan) -> Vec<pk_core::pinball::PinballPart> {
    plan.parts
        .iter()
        .filter_map(|p| {
            let kind = sim_part_kind(&p.kind)?;
            let (x, z) = pk_core::grid::tile_center(grid, p.i, p.j);
            Some(pk_core::pinball::PinballPart::new(
                kind, p.i, x, z, p.dir_i, p.dir_j,
            ))
        })
        .collect()
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
pub struct Room {
    pub i0: i32,
    pub j0: i32,
    pub w: i32,
    pub h: i32,
    #[serde(default)]
    pub kind: Option<String>,
}

/// A highway loop — the floor's booster route.
///
/// ⚠️ Only `ring` is a path of tiles. `links`, `offRamps` and `interchanges` are
/// arrays of **parts**, not positions: measured, `links[0]` on L5 is
/// `{kind: "deflector", dirI: 1, …}`. Typing them as tiles parses (both have
/// `i`/`j`) and silently discards the kind and the facing — a shape error that
/// a permissive deserialiser would never report.
#[allow(dead_code)]
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Circuit {
    pub id: i32,
    /// The loop itself, tile by tile.
    pub ring: Vec<Tile>,
    /// Parts that carry the ball onto or along the loop.
    #[serde(default)]
    pub links: Vec<PinballPart>,
    #[serde(default)]
    pub off_ramps: Vec<PinballPart>,
    #[serde(default)]
    pub interchanges: Vec<PinballPart>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use pk_core::grid::{at, is_walkable, SHAPE_FULL, T_CRACKED, T_FLOOR, T_STAIRS};

    /// Every shipped floor loads, converts and is STANDABLE — the same gate a
    /// generated floor passes, through the same pk-core function.
    #[test]
    fn every_embedded_floor_loads_and_is_standable() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed)
                .unwrap_or_else(|e| panic!("L{level} s{seed} failed to load: {e}"));
            assert_eq!(f.level, *level);
            assert!(f.grid.w > 10 && f.grid.h > 10, "L{level} grid too small");
            assert_eq!(
                f.grid.t.len(),
                (f.grid.w * f.grid.h) as usize,
                "L{level} tile count"
            );
            assert!(
                is_walkable(&f.grid, f.info.start_tile.i, f.info.start_tile.j),
                "L{level} start not walkable"
            );
            assert!(
                f.info.path_distance > 0,
                "L{level} start and exit are the same tile"
            );
            assert_eq!(
                f.info.route_to_exit.len() as i32,
                f.info.path_distance,
                "L{level} route length must equal the BFS distance"
            );
        }
    }

    /// The payload's content sections are POPULATED. A floor that parsed to
    /// empty vectors would load, validate and render as the grey skeleton this
    /// whole exercise exists to replace — the failure mode is silence, so the
    /// assertion has to be about presence.
    #[test]
    fn every_embedded_floor_carries_its_content() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            assert!(!f.plan.torches.is_empty(), "L{level} has no torches");
            assert!(!f.plan.parts.is_empty(), "L{level} has no parts");
            assert!(!f.plan.props.is_empty(), "L{level} has no props");
            assert!(!f.plan.spawns.is_empty(), "L{level} has no spawns");
            assert!(!f.plan.items.is_empty(), "L{level} has no items");
            assert!(!f.plan.circuits.is_empty(), "L{level} has no circuit");
            // Rooms are empty ON PURPOSE on a track floor (module header). This
            // pins the reason rather than the absence: if an export ever carries
            // rooms, this test says so instead of the minimap quietly gaining
            // outlines nobody asked for.
            assert!(
                f.plan.rooms.is_empty(),
                "L{level} carries rooms — a track floor authors none; \
                 has the fallback generator started shipping?"
            );
        }
    }

    /// Every kind the exporter emits is either honoured by the sim or on the
    /// inert list BY NAME.
    ///
    /// This is the test the `_ => None` arm exists for. Both arms answer `None`,
    /// so nothing at runtime distinguishes "we know this one does nothing yet"
    /// from "we have never seen this string" — the difference is here, and it is
    /// the difference between a documented gap and a silently dropped part.
    #[test]
    fn every_exported_part_kind_is_accounted_for() {
        let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            for p in &f.plan.parts {
                seen.insert(p.kind.clone());
            }
        }
        for kind in &seen {
            let honoured = sim_part_kind(kind).is_some();
            let inert = INERT_PART_KINDS.contains(&kind.as_str());
            assert!(
                honoured || inert,
                "part kind {kind:?} is in the payload but is neither honoured by \
                 the sim nor on INERT_PART_KINDS — add it to `sim_part_kind`, or \
                 name it inert and say which verb it waits on"
            );
            assert!(
                !(honoured && inert),
                "part kind {kind:?} is both honoured and listed inert"
            );
        }
        // The floors really do exercise both sides, or the loop above is vacuous.
        assert!(
            seen.iter().any(|k| sim_part_kind(k).is_some()),
            "no honoured kind in any payload"
        );
        assert!(
            seen.iter().any(|k| INERT_PART_KINDS.contains(&k.as_str())),
            "no inert kind in any payload"
        );
    }

    /// The parts handed to the sim are the parts the plan authored, at the tile
    /// centres the oracle put them on.
    ///
    /// Counts are the measured ones: 80/102/121 planned, of which the honoured
    /// subset is what the ball can hit. Both halves are asserted — a mapping that
    /// silently dropped everything would still satisfy "every part stands on a
    /// floor tile".
    #[test]
    fn the_sim_gets_the_parts_the_floor_drew() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            let parts = sim_parts(&f.grid, &f.plan);
            let honoured = f
                .plan
                .parts
                .iter()
                .filter(|p| sim_part_kind(&p.kind).is_some())
                .count();
            assert_eq!(
                parts.len(),
                honoured,
                "L{level} handed the sim {} parts for {honoured} honoured of {} planned",
                parts.len(),
                f.plan.parts.len()
            );
            assert!(
                !parts.is_empty(),
                "L{level} handed the sim no parts at all — the ball would hit nothing"
            );
            // Every part sits at its tile's centre, which is what makes the
            // sim's `dx/dz` agree with the mesh the renderer places.
            for (p, src) in parts.iter().zip(
                f.plan
                    .parts
                    .iter()
                    .filter(|p| sim_part_kind(&p.kind).is_some()),
            ) {
                let (x, z) = pk_core::grid::tile_center(&f.grid, src.i, src.j);
                assert_eq!((p.x, p.z), (x, z), "L{level} part at ({},{})", src.i, src.j);
                assert_eq!(
                    p.i, src.i,
                    "part.i must be the TILE i — it seeds the spinpad phase"
                );
            }
        }
    }

    /// A curved booster reaches the SIM with its unit vector intact.
    ///
    /// `a_curved_boosters_direction_is_not_a_cardinal` pins the float through the
    /// parser; this pins it through the mapping, which is the half that would
    /// round it. L5 carries two `boostcurve`s.
    #[test]
    fn a_curved_boosters_direction_survives_into_the_sim() {
        let f = load(5, 1).unwrap();
        let parts = sim_parts(&f.grid, &f.plan);
        let curved: Vec<_> = parts
            .iter()
            .filter(|p| p.dir_x.fract() != 0.0 || p.dir_z.fract() != 0.0)
            .collect();
        assert!(
            !curved.is_empty(),
            "L5's curved boosters lost their direction between the plan and the sim"
        );
        for p in curved {
            let len = (p.dir_x * p.dir_x + p.dir_z * p.dir_z).sqrt();
            assert!(
                (len - 1.0).abs() < 1e-9,
                "sim part at ({},{}) has direction ({},{}), length {len}",
                p.x,
                p.z,
                p.dir_x,
                p.dir_z
            );
        }
    }

    /// The jackpot's denominator is the floor's real bumper count.
    ///
    /// `pinball-collide.ts:373` reads `bumperTotal || JACKPOT_BUMPERS`, so a
    /// total left at zero does not disable the jackpot — it retargets it at the
    /// constant, and the floor's jackpot then needs a number of bumpers the floor
    /// may not have. Measured: 23/40/41.
    #[test]
    fn the_jackpot_counts_this_floors_bumpers() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            let parts = sim_parts(&f.grid, &f.plan);
            let bumpers = parts
                .iter()
                .filter(|p| p.kind == pk_core::pinball::PartKind::Bumper)
                .count();
            let planned = f.plan.parts.iter().filter(|p| p.kind == "bumper").count();
            assert_eq!(bumpers, planned, "L{level} lost bumpers in the mapping");
            assert!(bumpers > 0, "L{level} has no bumpers to light");
        }
    }

    /// The inert kinds are counted and named, not silently dropped.
    #[test]
    fn the_unhonoured_parts_are_reported() {
        let f = load(3, 1).unwrap();
        let inert = unhonoured_part_kinds(&f.plan);
        assert!(
            !inert.is_empty(),
            "L3 carries P1 verbs that have not landed"
        );
        let counted: usize = inert.iter().map(|(_, n)| n).sum();
        let honoured = sim_parts(&f.grid, &f.plan).len();
        assert_eq!(
            counted + honoured,
            f.plan.parts.len(),
            "every planned part is either honoured or reported inert — no part \
             may fall between the two"
        );
        for (kind, _) in &inert {
            assert!(
                INERT_PART_KINDS.contains(&kind.as_str()),
                "{kind} was reported inert but is not on the list"
            );
        }
    }

    /// THE ACCEPTANCE TEST: the ball hits a bumper and the bumper answers.
    ///
    /// Every other test here proves the mapping is faithful. This one proves the
    /// RIDE fires — that `touch_pinball_parts` reaches a part, deflects the
    /// player and books the hit. Before the wiring it could not: `sim.parts` was
    /// empty, so the loop returned at its first line on every frame of every
    /// floor, and all of that was invisible to a green suite.
    #[test]
    fn a_bumper_kicks_the_ball_that_touches_it() {
        let f = load(3, 1).unwrap();
        let parts = sim_parts(&f.grid, &f.plan);
        let bumper = parts
            .iter()
            .find(|p| p.kind == pk_core::pinball::PartKind::Bumper)
            .expect("L3 has bumpers");
        let (bx, bz) = (bumper.x, bumper.z);

        let mut sim = pk_core::state::SimState::new(f.grid.clone(), (bx, bz), 7);
        sim.parts = parts;
        sim.bumper_total = 1;
        // Stand ON the bumper with momentum, which is what a ball arriving does.
        sim.player.mom_speed = 6.0;
        sim.player.mom_x = 1.0;
        sim.player.mom_z = 0.0;

        let hits_before = sim.parts.iter().map(|p| p.hits).sum::<i32>();
        pk_core::pinball::touch_pinball_parts(&mut sim, true, 6.0, (0.0, 0.0));
        let hits_after = sim.parts.iter().map(|p| p.hits).sum::<i32>();

        assert!(
            hits_after > hits_before,
            "the ball stood on a bumper at ({bx},{bz}) and nothing fired — \
             the parts are drawn but not simulated"
        );
        assert!(
            sim.player.bounce_combo > 0.0,
            "a part fired but `on_part_trigger` never ran: combo is still 0"
        );
    }

    /// The same touch against an EMPTY parts list does nothing — the state this
    /// wiring replaced. Without this, the test above could pass for a reason
    /// that has nothing to do with the parts being installed.
    #[test]
    fn an_unwired_sim_is_the_diorama_this_replaced() {
        let f = load(3, 1).unwrap();
        let parts = sim_parts(&f.grid, &f.plan);
        let bumper = parts
            .iter()
            .find(|p| p.kind == pk_core::pinball::PartKind::Bumper)
            .unwrap();
        let mut sim = pk_core::state::SimState::new(f.grid.clone(), (bumper.x, bumper.z), 7);
        // parts deliberately LEFT EMPTY — main.rs before this change.
        sim.player.mom_speed = 6.0;
        sim.player.mom_x = 1.0;
        pk_core::pinball::touch_pinball_parts(&mut sim, true, 6.0, (0.0, 0.0));
        assert_eq!(
            sim.player.bounce_combo, 0.0,
            "an empty parts list must be inert — if this fires, the test above \
             proves nothing about the wiring"
        );
    }

    /// Every torch mounts on a real wall, and stands on a real floor tile.
    /// The sconce is placed by `(di, dj)`; a torch whose neighbour is not solid
    /// would hang in mid-air, which is a bug the renderer cannot detect.
    #[test]
    fn every_torch_has_a_wall_to_mount_on() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            for t in &f.plan.torches {
                assert!(
                    is_walkable(&f.grid, t.i, t.j),
                    "L{level} torch at ({},{}) is not on a floor tile",
                    t.i,
                    t.j
                );
                assert!(
                    !is_walkable(&f.grid, t.i + t.di, t.j + t.dj),
                    "L{level} torch at ({},{}) points at ({},{}), which is not solid",
                    t.i,
                    t.j,
                    t.i + t.di,
                    t.j + t.dj
                );
            }
        }
    }

    /// The authored floor has REAL stairs — exactly one `T_STAIRS` tile, and it
    /// is where the plan says. A generated floor at P9 cannot say this: its exit
    /// is the provisional pass-7 pick and pass 21 has not landed.
    #[test]
    fn the_authored_floor_has_real_stairs() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            let n = f.grid.t.iter().filter(|&&t| t == T_STAIRS).count();
            assert_eq!(n, 1, "L{level} should carry exactly one stairs tile");
            let s = f.plan.stairs;
            assert_eq!(
                at(&f.grid, s.i, s.j),
                T_STAIRS,
                "L{level} plan.stairs is not the stairs tile"
            );
        }
    }

    /// Arc features survive the conversion with BOTH band families.
    ///
    /// This is the one the handoff got wrong in the useful direction — it says
    /// the export does not carry `kicks`/`lanes`. It carries both, and dropping
    /// them would have cost the rubber and the booster lanes on every curved
    /// wall with nothing on screen to say so.
    #[test]
    fn arcs_carry_their_kick_and_lane_bands() {
        let f = load(3, 1).unwrap();
        assert!(!f.grid.arcs.is_empty(), "L3 should carry arc features");
        assert!(
            f.grid.arc_idx.is_some(),
            "L3 should carry the per-tile arc index"
        );
        let kicks: usize = f.grid.arcs.iter().map(|a| a.kicks.len()).sum();
        let lanes: usize = f.grid.arcs.iter().map(|a| a.lanes.len()).sum();
        assert_eq!(kicks, 6, "L3 kick bands");
        assert_eq!(lanes, 4, "L3 lane bands");
        // Every owner mapped to a known static, or `load` would have refused.
        for a in &f.grid.arcs {
            assert!(a.span > 0.0, "an arc with no span is not a face");
            assert!(a.r > 0.0, "an arc with no radius is not a face");
        }
    }

    /// `solid_out` is absent from most arcs and MUST read as false.
    ///
    /// The count is asserted, not just the parse: a `#[serde(default)]` that
    /// defaulted the other way would still load every floor and would silently
    /// turn twenty-nine convex guides into concave bowls — a difference the ball
    /// feels and no gate here would see.
    #[test]
    fn an_absent_solid_out_reads_as_solid_inside() {
        let f = load(3, 1).unwrap();
        let out = f.grid.arcs.iter().filter(|a| a.solid_out).count();
        // 9, not 10. L3 carries the KEY on ten arcs and one of them is an
        // explicit `false` — `JSON.stringify` drops `undefined` but keeps
        // `false`, so "has the key" and "is solid outside" are two different
        // counts and only the second one is about the floor. The first draft of
        // this assertion counted keys in a scratch script and asserted the
        // number here, which is how a measurement of the wrong set gets a test
        // to certify it.
        assert_eq!(
            out, 9,
            "L3 has 9 solid-outside arcs; 30 of the other 31 omit the key \
             entirely and the oracle reads absent as false (tile-shape.ts:398)"
        );
    }

    /// Cracked walls arrive as `T_CRACKED` and are SOLID, not floor. They are
    /// what `secrets` points at, and a cracked tile read as floor is a hole.
    #[test]
    fn cracked_walls_are_solid_and_are_where_the_secrets_are() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            let cracked = f.grid.t.iter().filter(|&&t| t == T_CRACKED).count();
            assert!(cracked > 0, "L{level} should carry cracked walls");
            for s in &f.plan.secrets {
                assert!(
                    !is_walkable(&f.grid, s.i, s.j),
                    "L{level} secret at ({},{}) is walkable — it should be a wall",
                    s.i,
                    s.j
                );
            }
        }
    }

    /// Every planned part and prop stands on a floor tile. A part inside a wall
    /// renders half-buried and can never be hit.
    #[test]
    fn parts_and_props_stand_on_floor() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            for p in &f.plan.parts {
                let t = at(&f.grid, p.i, p.j);
                assert!(
                    t == T_FLOOR || t == T_STAIRS,
                    "L{level} part {} at ({},{}) sits on tile {t}",
                    p.kind,
                    p.i,
                    p.j
                );
            }
            for p in &f.plan.props {
                assert!(
                    is_walkable(&f.grid, p.i, p.j),
                    "L{level} prop {} at ({},{}) is not on floor",
                    p.kind,
                    p.i,
                    p.j
                );
            }
        }
    }

    /// A curved booster's direction is a UNIT VECTOR and survives as one.
    ///
    /// The whole payload refused to parse while `dir_i` was an `i32`, and the
    /// repair that suggests itself — round it — points a `boostcurve` at a
    /// cardinal the ball is not thrown along. This pins the float.
    #[test]
    fn a_curved_boosters_direction_is_not_a_cardinal() {
        let f = load(5, 1).unwrap();
        let curved: Vec<_> = f
            .plan
            .parts
            .iter()
            .filter(|p| p.dir_i.fract() != 0.0 || p.dir_j.fract() != 0.0)
            .collect();
        assert!(
            !curved.is_empty(),
            "L5 should carry at least one part with a non-cardinal direction"
        );
        for p in &curved {
            let len = (p.dir_i * p.dir_i + p.dir_j * p.dir_j).sqrt();
            assert!(
                (len - 1.0).abs() < 1e-9,
                "{} at ({},{}) has direction ({},{}), length {len}",
                p.kind,
                p.i,
                p.j,
                p.dir_i,
                p.dir_j
            );
        }
    }

    /// A circuit's links are PARTS, and they keep their kind.
    ///
    /// `Tile` denies unknown fields precisely so this cannot regress into
    /// silently parsing parts as positions.
    #[test]
    fn circuit_links_are_parts_and_keep_their_kind() {
        let f = load(5, 1).unwrap();
        let c = &f.plan.circuits[0];
        assert!(!c.ring.is_empty(), "a circuit is a ring of tiles");
        assert!(!c.links.is_empty(), "L5's circuit has links");
        for p in c.links.iter().chain(&c.off_ramps) {
            assert!(!p.kind.is_empty(), "a circuit part must carry its kind");
        }
    }

    /// A tile-shaped field refuses a part-shaped object.
    #[test]
    fn a_tile_refuses_a_part() {
        let part = r#"{"i":1,"j":2,"kind":"bumper"}"#;
        assert!(
            serde_json::from_str::<Tile>(part).is_err(),
            "Tile must deny unknown fields, or a mis-typed section parses clean"
        );
        assert!(serde_json::from_str::<Tile>(r#"{"i":1,"j":2}"#).is_ok());
    }

    /// The floor's MATERIAL byte arrives, and it is not all stone.
    ///
    /// This is the field the export did not carry until 2026-08-11. Without it
    /// `pk_core::pinball` reads `surface_at` as 0 everywhere and an ice patch
    /// has stone friction — a parity gap with no visual symptom beyond the
    /// missing wash, which is exactly the kind that survives a screenshot
    /// review.
    #[test]
    fn the_floor_carries_what_it_is_made_of() {
        for (level, seed, _) in EMBEDDED {
            let f = load(*level, *seed).unwrap();
            let surfaces = f
                .grid
                .surfaces
                .as_ref()
                .unwrap_or_else(|| panic!("L{level} carries no surface byte"));
            assert_eq!(surfaces.len(), f.grid.t.len(), "L{level} surface length");
            let painted = surfaces.iter().filter(|&&s| s != 0).count();
            assert!(
                painted > 100,
                "L{level} has only {painted} painted tiles — paintSurfaces covers ~1,900"
            );
        }
    }

    /// **The two vocabularies are real, and this measures them.**
    ///
    /// A walkable tile's byte is a `FLOOR_*` id and a solid tile's is a `WALL_*`
    /// id (`surface-paint.ts:112-116`). They overlap numerically — 1 is
    /// `FLOOR_ICE` on one side of the branch and `WALL_RUBBER` on the other — so
    /// no assertion about the byte alone can catch a reader that forgets to
    /// branch. What CAN be asserted is that both populations are non-empty and
    /// that they carry different mixes, which is what makes the confusion
    /// possible in the first place.
    #[test]
    fn the_surface_byte_carries_two_vocabularies() {
        let f = load(3, 1).unwrap();
        let surfaces = f.grid.surfaces.as_ref().unwrap();
        let (mut on_floor, mut on_wall) = (0usize, 0usize);
        for j in 0..f.grid.h {
            for i in 0..f.grid.w {
                let s = surfaces[(j * f.grid.w + i) as usize];
                if s == 0 {
                    continue;
                }
                if is_walkable(&f.grid, i, j) {
                    on_floor += 1;
                } else {
                    on_wall += 1;
                }
            }
        }
        // Measured on L3-s1: 1,526 painted floor tiles and 618 painted walls.
        assert_eq!(on_floor, 1526, "painted FLOOR tiles on L3-s1");
        assert_eq!(on_wall, 618, "painted WALL tiles on L3-s1");
    }

    /// **The export closed a PHYSICS gap, not only a visual one.**
    ///
    /// `pk_core::pinball` reads `surface_at` for its steer and friction
    /// multipliers. Before the byte was exported every tile answered 0 —
    /// stone — so a ball crossing the oracle's sand kept stone friction and the
    /// ride was wrong in a way the eye could not see.
    ///
    /// ⚠️ The counts below were WRONG in this file's first draft, and the test
    /// is what said so. A scratch histogram printed `{2: 624, 3: 440, 4: 462}`
    /// and I read the ids off in the order I happened to have the names in —
    /// calling 2 "ice" when `FLOOR_ICE` is 1 and 2 is `FLOOR_SAND`. **Print the
    /// LABEL, not the id.** There is no ice on any of the three floors: it is a
    /// modifier's material and none of them rolled it.
    #[test]
    fn the_sim_gets_real_friction_off_an_authored_floor() {
        use pk_core::surfaces::{floor_surface, FLOOR_GRIP, FLOOR_ICE, FLOOR_SAND, FLOOR_STEEL};
        let f = load(3, 1).unwrap();
        let mut counts = std::collections::BTreeMap::<u8, usize>::new();
        for j in 0..f.grid.h {
            for i in 0..f.grid.w {
                if is_walkable(&f.grid, i, j) {
                    *counts
                        .entry(pk_core::grid::surface_at(&f.grid, i, j))
                        .or_default() += 1;
                }
            }
        }
        assert_eq!(counts.get(&FLOOR_SAND), Some(&624), "L3-s1 sand tiles");
        assert_eq!(counts.get(&FLOOR_STEEL), Some(&440), "L3-s1 steel tiles");
        assert_eq!(counts.get(&FLOOR_GRIP), Some(&462), "L3-s1 flowstone tiles");
        assert_eq!(counts.get(&FLOOR_ICE), None, "no floor here rolled ice");

        // The multipliers those tiles hand the sim — the whole point of
        // carrying the byte. Sand is the loud one: 2.4x the friction.
        assert!((floor_surface(FLOOR_SAND).friction_mult - 2.4).abs() < 1e-9);
        assert!((floor_surface(FLOOR_STEEL).friction_mult - 0.62).abs() < 1e-9);
        assert!((floor_surface(FLOOR_GRIP).steer_mult - 1.6).abs() < 1e-9);
        // …and what it was before the export carried it: everything stone.
        assert!((floor_surface(pk_core::surfaces::FLOOR_STONE).friction_mult - 1.0).abs() < 1e-9);
    }

    /// A request deeper than the deepest export lands on the deepest one, says
    /// so, and never lands on nothing.
    #[test]
    fn a_deeper_request_lands_on_the_deepest_export() {
        let f = load(9, 1).unwrap();
        assert_eq!(f.level, 5);
        assert_eq!(f.requested_level, 9);
        assert!(
            f.banner().contains("asked L9"),
            "the banner must say the floor is not the one asked for: {}",
            f.banner()
        );
    }

    /// A request shallower than every export still gets a floor.
    #[test]
    fn a_shallow_request_still_gets_a_floor() {
        let f = load(1, 1).unwrap();
        assert_eq!(f.level, 1);
        assert!(!f.banner().contains("asked"), "L1 is the floor asked for");
    }

    /// An unknown seed is refused by name, not substituted.
    #[test]
    fn an_unknown_seed_is_refused() {
        match load(3, 42) {
            Err(AuthoredFloorError::NoFloorFor { run_seed: 42, .. }) => {}
            other => panic!(
                "expected NoFloorFor, got {other:?}",
                other = other.map(|_| ())
            ),
        }
    }

    /// The banner identifies the floor AND its source. Two floor sources that
    /// look alike make an unlabelled screenshot worthless.
    #[test]
    fn the_banner_names_the_source_and_the_content() {
        let f = load(3, 1).unwrap();
        let b = f.banner();
        assert!(b.starts_with("AUTHORED FLOOR"), "{b}");
        assert!(b.contains("L3 seed=1"), "{b}");
        assert!(b.contains("torches=41"), "{b}");
        assert!(
            !b.contains('\u{00D7}'),
            "no U+00D7 — default_font has no glyph"
        );
    }

    /// A truncated grid is refused rather than rendered short.
    #[test]
    fn a_truncated_grid_is_refused() {
        let g = GridExport {
            w: 4,
            h: 4,
            t: vec![1; 15],
            shapes: vec![SHAPE_FULL; 16],
            surfaces: None,
            arcs: None,
            arc_idx: None,
        };
        match g.into_grid() {
            Err(AuthoredFloorError::GridSizeMismatch {
                field: "t",
                expected: 16,
                found: 15,
            }) => {}
            _ => panic!("expected a GridSizeMismatch on t"),
        }
    }

    /// An arc owner this build does not know is refused, because the default is
    /// the one that yields.
    #[test]
    fn an_unknown_arc_owner_is_refused() {
        let a = ArcExport {
            cx: 1.0,
            cz: 1.0,
            r: 2.0,
            a0: 0.0,
            span: 1.0,
            solid_out: false,
            owner: Some("bulldozer".into()),
            kicks: None,
            lanes: None,
        };
        match a.into_feature() {
            Err(AuthoredFloorError::UnknownArcOwner(o)) => assert_eq!(o, "bulldozer"),
            _ => panic!("expected UnknownArcOwner"),
        }
    }
}
