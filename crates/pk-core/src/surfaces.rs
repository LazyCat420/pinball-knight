//! SURFACES — what a tile is MADE OF, as opposed to what shape it is.
//! Port of `legacy/.../engine/surfaces.ts`.
//!
//! One byte per tile: `Grid.surfaces` holds a WallSurface on solid tiles and a
//! FloorSurface on walkable ones; `is_walkable` picks which table to read.
//!
//! THE IDENTITY RULE: index 0 of BOTH tables is the historical behaviour —
//! every multiplier exactly 1, every additive exactly 0 — so a grid that never
//! assigns a surface plays bit-identically to the pre-surface build. The tests
//! assert that neutrality field by field.

// ── WALLS ────────────────────────────────────────────────────────────────────

pub const WALL_STONE: u8 = 0;
/// Kicker rubber: every bounce GAINS. The wall you deliberately aim at.
pub const WALL_RUBBER: u8 = 1;
/// Polished ice: keeps nearly all speed, too clean to bite — never builds combo.
pub const WALL_ICE: u8 = 2;
/// Packed mud: eats most of the impact and BREAKS the chain.
pub const WALL_MUD: u8 = 3;
/// Brass bell-plate: ordinary restitution, DOUBLE combo. The scoring wall.
pub const WALL_BRASS: u8 = 4;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WallSurfaceDef {
    pub id: u8,
    pub label: &'static str,
    /// Multiplier on the already-resolved flat-bounce restitution — composes
    /// with marble materials instead of overriding them.
    pub flat_rest_mult: f64,
    /// Speed ADDED after a flat bounce, u/s. Rubber's identity: a multiplier
    /// alone can never turn a slow ball into a fast one.
    pub bounce_add: f64,
    /// Multiplier on the CORNER gain. ≥1 keeps the "a corner never slows you"
    /// guarantee; <1 is explicitly allowed to damp (mud's whole job).
    pub corner_mult: f64,
    /// Combo steps a bounce here is worth. 0 = chain neither grows nor lapses.
    pub combo_ticks: u32,
    /// True = a bounce here RESETS the chain. Only mud.
    pub breaks_combo: bool,
    /// Wall tint over the stone texture — an unreadable wall that eats your
    /// run reads as broken physics.
    pub hex: u32,
    /// Contact-spark tint.
    pub spark_hex: u32,
}

pub const WALL_SURFACES: [WallSurfaceDef; 5] = [
    WallSurfaceDef {
        id: WALL_STONE,
        label: "Stone",
        flat_rest_mult: 1.0,
        bounce_add: 0.0,
        corner_mult: 1.0,
        combo_ticks: 1,
        breaks_combo: false,
        hex: 0xffffff, // identity tint
        spark_hex: 0xc8ccd4,
    },
    WallSurfaceDef {
        id: WALL_RUBBER,
        // 1.06 × the 0.94 base lands just under 1.0 — the gain lives in the
        // ADD, which is self-limiting against PINBALL_MAX_SPEED.
        label: "Rubber",
        flat_rest_mult: 1.06,
        bounce_add: 1.6,
        corner_mult: 1.12,
        combo_ticks: 1,
        breaks_combo: false,
        hex: 0xd9584f,
        spark_hex: 0xf0a63c,
    },
    WallSurfaceDef {
        id: WALL_ICE,
        label: "Ice",
        flat_rest_mult: 1.05, // ≈ lossless over the 0.94 base
        bounce_add: 0.0,
        corner_mult: 1.0,
        combo_ticks: 0, // too clean a glance to bite
        breaks_combo: false,
        hex: 0x9fd8ef,
        spark_hex: 0xbfe8ff,
    },
    WallSurfaceDef {
        id: WALL_MUD,
        label: "Mud",
        flat_rest_mult: 0.55,
        bounce_add: 0.0,
        corner_mult: 0.45,
        combo_ticks: 0,
        breaks_combo: true,
        hex: 0x6b5a3e,
        spark_hex: 0x8a7550,
    },
    WallSurfaceDef {
        id: WALL_BRASS,
        label: "Brass",
        flat_rest_mult: 1.0,
        bounce_add: 0.0,
        corner_mult: 1.0,
        combo_ticks: 2,
        breaks_combo: false,
        hex: 0xd8a63c,
        spark_hex: 0xffd98a,
    },
];

/// Wall response for a surface id. Unknown → stone, never absent: the physics
/// runs every frame and must not branch on a missing table row.
pub fn wall_surface(id: u8) -> &'static WallSurfaceDef {
    WALL_SURFACES
        .get(id as usize)
        .unwrap_or(&WALL_SURFACES[WALL_STONE as usize])
}

// ── FLOORS ───────────────────────────────────────────────────────────────────

pub const FLOOR_STONE: u8 = 0;
/// Sheet ice: keep the speed and the heading you brought.
pub const FLOOR_ICE: u8 = 1;
/// Sand: drags hard and slows the walk.
pub const FLOOR_SAND: u8 = 2;
/// Steel decking: the speedway surface.
pub const FLOOR_STEEL: u8 = 3;
/// Cracked flowstone: full steering authority even at speed.
pub const FLOOR_GRIP: u8 = 4;

/// NB: deliberately NO `hex` field — the legacy one was dead code deleted
/// 2026-07-30 (off-palette colours with zero readers); do not re-add.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FloorSurfaceDef {
    pub id: u8,
    pub label: &'static str,
    /// Multiplier on momentum bleed — composes with the open-neighbour pick.
    pub friction_mult: f64,
    /// Multiplier on bending a live momentum heading.
    pub steer_mult: f64,
    /// Multiplier on ordinary walking speed.
    pub walk_mult: f64,
}

pub const FLOOR_SURFACES: [FloorSurfaceDef; 5] = [
    FloorSurfaceDef {
        id: FLOOR_STONE,
        label: "Stone",
        friction_mult: 1.0,
        steer_mult: 1.0,
        walk_mult: 1.0,
    },
    FloorSurfaceDef {
        id: FLOOR_ICE,
        label: "Ice",
        friction_mult: 0.12,
        steer_mult: 0.25,
        walk_mult: 1.05,
    },
    FloorSurfaceDef {
        id: FLOOR_SAND,
        label: "Sand",
        friction_mult: 2.4,
        steer_mult: 1.15,
        walk_mult: 0.82,
    },
    FloorSurfaceDef {
        id: FLOOR_STEEL,
        label: "Steel",
        friction_mult: 0.62,
        steer_mult: 0.9,
        walk_mult: 1.08,
    },
    FloorSurfaceDef {
        id: FLOOR_GRIP,
        label: "Flowstone",
        friction_mult: 1.1,
        steer_mult: 1.6,
        walk_mult: 1.0,
    },
];

/// Floor response for a surface id. Unknown → stone.
pub fn floor_surface(id: u8) -> &'static FloorSurfaceDef {
    FLOOR_SURFACES
        .get(id as usize)
        .unwrap_or(&FLOOR_SURFACES[FLOOR_STONE as usize])
}

// ── MATERIALS — the authoring vocabulary ─────────────────────────────────────

pub const MAT_STONE: u8 = 0;
pub const MAT_RUBBER: u8 = 1;
pub const MAT_ICE: u8 = 2;
pub const MAT_MUD: u8 = 3;
pub const MAT_BRASS: u8 = 4;

/// A coherent (wall, floor) PAIR — what level authoring actually speaks in.
/// Note rubber pairs bouncy walls with GRIP floor: a room whose walls throw
/// you needs a floor you can still aim on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SurfaceMaterial {
    pub id: u8,
    pub label: &'static str,
    /// Shown on the descent card when a modifier makes this material common.
    pub flavour: &'static str,
    pub wall: u8,
    pub floor: u8,
}

pub const MATERIALS: [SurfaceMaterial; 5] = [
    SurfaceMaterial {
        id: MAT_STONE,
        label: "Stone",
        flavour: "",
        wall: WALL_STONE,
        floor: FLOOR_STONE,
    },
    SurfaceMaterial {
        id: MAT_RUBBER,
        label: "Rubber",
        flavour: "the walls throw you back",
        wall: WALL_RUBBER,
        floor: FLOOR_GRIP,
    },
    SurfaceMaterial {
        id: MAT_ICE,
        label: "Ice",
        flavour: "nothing here holds a line",
        wall: WALL_ICE,
        floor: FLOOR_ICE,
    },
    SurfaceMaterial {
        id: MAT_MUD,
        label: "Mud",
        flavour: "the chain dies where it touches",
        wall: WALL_MUD,
        floor: FLOOR_SAND,
    },
    SurfaceMaterial {
        id: MAT_BRASS,
        label: "Brass",
        flavour: "every strike rings twice",
        wall: WALL_BRASS,
        floor: FLOOR_STEEL,
    },
];

pub fn material(id: u8) -> &'static SurfaceMaterial {
    MATERIALS
        .get(id as usize)
        .unwrap_or(&MATERIALS[MAT_STONE as usize])
}

// ── Mixes — how a floor decides what to paint ────────────────────────────────

use std::collections::BTreeMap;

/// Sparse weight table `{surfaceId: weight}`. Empty = all baseline. BTreeMap
/// so iteration is ascending-by-id — the SAME order as JS integer-key objects,
/// which `pick_surface`'s single-rng-draw reproducibility depends on.
pub type SurfaceMix = BTreeMap<u32, f64>;

/// Merge mixes left-to-right, summing weights (a modifier leans a theme
/// without erasing it).
pub fn merge_mix(mixes: &[&SurfaceMix]) -> SurfaceMix {
    let mut out = SurfaceMix::new();
    for m in mixes {
        for (&id, &w) in m.iter() {
            if w > 0.0 {
                *out.entry(id).or_insert(0.0) += w;
            }
        }
    }
    out
}

/// Draw one surface id from a mix, or `fallback` when empty. Consumes exactly
/// ONE rng call whatever the table size — the painter runs per tile over a
/// whole floor, and a draw whose rng cost depended on the weights would make
/// the stream un-reproducible the moment a theme gained an entry.
pub fn pick_surface(mix: &SurfaceMix, rand: &mut dyn FnMut() -> f64, fallback: u32) -> u32 {
    let total: f64 = mix.values().sum();
    if total <= 0.0 {
        return fallback;
    }
    let mut r = rand() * total;
    for (&id, &w) in mix.iter() {
        r -= w;
        if r <= 0.0 {
            return id;
        }
    }
    fallback
}

#[cfg(test)]
mod tests {
    //! Ported from legacy `surfaces.test.ts`'s core assertions: the identity
    //! rule and the one-draw mix contract.
    use super::*;
    use crate::rng::Mulberry32;

    #[test]
    fn index_zero_is_the_identity_in_both_tables() {
        let w = wall_surface(WALL_STONE);
        assert_eq!(
            (w.flat_rest_mult, w.bounce_add, w.corner_mult),
            (1.0, 0.0, 1.0)
        );
        assert!(!w.breaks_combo);
        let f = floor_surface(FLOOR_STONE);
        assert_eq!(
            (f.friction_mult, f.steer_mult, f.walk_mult),
            (1.0, 1.0, 1.0)
        );
    }

    #[test]
    fn unknown_ids_fall_back_to_stone_never_panic() {
        assert_eq!(wall_surface(200).id, WALL_STONE);
        assert_eq!(floor_surface(200).id, FLOOR_STONE);
        assert_eq!(material(200).id, MAT_STONE);
    }

    #[test]
    fn only_mud_breaks_the_combo() {
        for def in &WALL_SURFACES {
            assert_eq!(def.breaks_combo, def.id == WALL_MUD, "{}", def.label);
        }
    }

    #[test]
    fn pick_surface_consumes_exactly_one_draw_and_respects_weights() {
        let mut mix = SurfaceMix::new();
        mix.insert(1, 1.0);
        mix.insert(3, 3.0);
        let mut rng = Mulberry32::new(7);
        let mut draws = 0;
        let pick = |rng: &mut Mulberry32, draws: &mut u32| {
            let mut f = || {
                *draws += 1;
                rng.next_f64()
            };
            pick_surface(&mix, &mut f, 0)
        };
        let mut counts = [0u32; 4];
        for _ in 0..1000 {
            let id = pick(&mut rng, &mut draws);
            counts[id as usize] += 1;
        }
        assert_eq!(draws, 1000, "one rng draw per pick, always");
        assert_eq!(counts[0] + counts[2], 0, "only weighted ids drawn");
        assert!(counts[3] > counts[1], "3× weight draws more often");
        // Empty mix: fallback, zero draws.
        let empty = SurfaceMix::new();
        let mut f = || panic!("empty mix must not draw");
        assert_eq!(pick_surface(&empty, &mut f, 9), 9);
    }

    #[test]
    fn merge_sums_weights() {
        let mut a = SurfaceMix::new();
        a.insert(1, 1.0);
        let mut b = SurfaceMix::new();
        b.insert(1, 2.0);
        b.insert(2, 5.0);
        let m = merge_mix(&[&a, &b]);
        assert_eq!(m.get(&1), Some(&3.0));
        assert_eq!(m.get(&2), Some(&5.0));
    }
}
