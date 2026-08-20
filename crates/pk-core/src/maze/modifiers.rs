//! FLOOR MODIFIERS — the once-in-a-while twist, rolled from the floor's seed.
//!
//! Port of `legacy/src/game/pinball-knight/maze/modifiers.ts`, **roll only**.
//!
//! ## Why the roll ships before the effects
//!
//! A modifier scales content budgets — horde size, torches, part count, the
//! order `decorate` reaches for furniture — and none of that exists in Rust
//! yet. What DOES exist downstream of this function is the whole floor: it is
//! the first thing `authorFloor` draws, so every later draw on the floor sits
//! behind it. Get the roll wrong by one value and `growTrack` seeds a different
//! network, on a floor that is otherwise correctly ported.
//!
//! So the id and the DRAW COUNT are ported here and the multipliers land with
//! `decorate`. [`ModifierId`] carries the full table in order because the
//! second draw indexes it — a shortened pool picks a different modifier and,
//! worse, is invisible until content exists to be scaled.
//!
//! ⚠️ Verified against the fixture's `drawsBeforeTrack`, which is 0, 1, 2 or 3
//! across the corpus precisely because of the two early returns below.
//!
//! PORTS: `maze/modifiers.ts`

use crate::maze::CountingRng;

/// The table, in order. Index 0 is the "no modifier" record and is NOT in the
/// pool the roll indexes — see [`roll_modifier`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModifierId {
    None,
    Flooded,
    Blackout,
    Overcharged,
    Gilded,
    Collapsing,
    Frozen,
    Silted,
}

/// Everything except `None`, in table order — what the second draw indexes.
pub const MODIFIER_POOL: [ModifierId; 7] = [
    ModifierId::Flooded,
    ModifierId::Blackout,
    ModifierId::Overcharged,
    ModifierId::Gilded,
    ModifierId::Collapsing,
    ModifierId::Frozen,
    ModifierId::Silted,
];

/// Levels 1-2 never roll one: the opening floors are where a player is still
/// learning the base rules, and a twist there reads as the rules being unclear.
pub const MODIFIER_FROM_LEVEL: i32 = 3;

/// Chance a qualifying floor draws a modifier at all.
pub const MODIFIER_CHANCE: f64 = 0.45;

/// Roll this floor's modifier.
///
/// Draws ZERO values below [`MODIFIER_FROM_LEVEL`] and one or two otherwise
/// (one when the chance gate fails), so the stream stays predictable for a
/// given (run, level) — and so `drawsBeforeTrack` varies across the corpus in a
/// way the fixture can pin.
pub fn roll_modifier(level: i32, rng: &mut CountingRng) -> ModifierId {
    if level < MODIFIER_FROM_LEVEL {
        return ModifierId::None;
    }
    if rng.next_f64() >= MODIFIER_CHANCE {
        return ModifierId::None;
    }
    // `Math.floor(rng() * n)` — the draw is in [0,1) so the index is in range,
    // but the floor is written out rather than cast blindly: `as usize` on a
    // negative would wrap, and this is the kind of line that gets copied.
    let k = (rng.next_f64() * MODIFIER_POOL.len() as f64).floor() as usize;
    MODIFIER_POOL[k.min(MODIFIER_POOL.len() - 1)]
}

#[derive(Clone, Debug, PartialEq)]
pub struct FloorModifier {
    pub id: ModifierId,
    pub label: &'static str,
    pub flavour: &'static str,
    pub torch_mult: f64,
    pub part_mult: f64,
    pub horde_mult: f64,
    pub hazard_mult: f64,
    pub trapdoor_mult: f64,
    pub bonus_items: i32,
    pub deal_bias: &'static [&'static str],
    pub surface_coverage: f64,
}

impl ModifierId {
    pub fn data(&self) -> FloorModifier {
        match self {
            ModifierId::None => FloorModifier {
                id: ModifierId::None,
                label: "",
                flavour: "",
                torch_mult: 1.0,
                part_mult: 1.0,
                horde_mult: 1.0,
                hazard_mult: 1.0,
                trapdoor_mult: 1.0,
                bonus_items: 0,
                deal_bias: &[],
                surface_coverage: 0.0,
            },
            ModifierId::Flooded => FloorModifier {
                id: ModifierId::Flooded,
                label: "Flooded",
                flavour: "ankle-deep and slick · nothing here stops",
                torch_mult: 1.0,
                part_mult: 1.15,
                horde_mult: 1.0,
                hazard_mult: 1.2,
                trapdoor_mult: 1.0,
                bonus_items: 0,
                deal_bias: &["oil", "oil", "bumper"],
                surface_coverage: 0.3,
            },
            ModifierId::Blackout => FloorModifier {
                id: ModifierId::Blackout,
                label: "Blackout",
                flavour: "the torches are out · something wanted them out",
                torch_mult: 0.45,
                part_mult: 1.0,
                horde_mult: 0.85,
                hazard_mult: 1.0,
                trapdoor_mult: 1.0,
                bonus_items: 2,
                deal_bias: &[],
                surface_coverage: 0.24,
            },
            ModifierId::Overcharged => FloorModifier {
                id: ModifierId::Overcharged,
                label: "Overcharged",
                flavour: "the machinery is running hot · everything hits harder",
                torch_mult: 1.0,
                part_mult: 1.4,
                horde_mult: 1.25,
                hazard_mult: 1.0,
                trapdoor_mult: 1.0,
                bonus_items: 0,
                deal_bias: &["bumper", "slingshot", "glove"],
                surface_coverage: 0.16,
            },
            ModifierId::Gilded => FloorModifier {
                id: ModifierId::Gilded,
                label: "Gilded",
                flavour: "gold in the cracks · and a queue for it",
                torch_mult: 1.0,
                part_mult: 1.0,
                horde_mult: 1.6,
                hazard_mult: 0.8,
                trapdoor_mult: 1.0,
                bonus_items: 3,
                deal_bias: &[],
                surface_coverage: 0.22,
            },
            ModifierId::Collapsing => FloorModifier {
                id: ModifierId::Collapsing,
                label: "Collapsing",
                flavour: "the floor is giving way · keep moving",
                torch_mult: 0.75,
                part_mult: 1.0,
                horde_mult: 1.0,
                hazard_mult: 1.5,
                trapdoor_mult: 2.2,
                bonus_items: 0,
                deal_bias: &["pit", "trapdoor"],
                surface_coverage: 0.4,
            },
            ModifierId::Frozen => FloorModifier {
                id: ModifierId::Frozen,
                label: "Frozen",
                flavour: "black ice wall to wall · pick your line early",
                torch_mult: 1.0,
                part_mult: 0.85,
                horde_mult: 1.0,
                hazard_mult: 0.9,
                trapdoor_mult: 1.0,
                bonus_items: 0,
                deal_bias: &[],
                surface_coverage: 0.62,
            },
            ModifierId::Silted => FloorModifier {
                id: ModifierId::Silted,
                label: "Silted",
                flavour: "silt over everything · the chain dies where it touches",
                torch_mult: 1.0,
                part_mult: 1.0,
                horde_mult: 0.9,
                hazard_mult: 1.0,
                trapdoor_mult: 1.0,
                bonus_items: 2,
                deal_bias: &[],
                surface_coverage: 0.45,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shallow_floors_draw_nothing() {
        for level in [1, 2] {
            let mut rng = CountingRng::new(1);
            assert_eq!(roll_modifier(level, &mut rng), ModifierId::None);
            assert_eq!(rng.draws(), 0, "level {level} must not touch the stream");
        }
    }

    #[test]
    fn a_qualifying_floor_draws_one_or_two() {
        // Seeds chosen only to exercise both branches; the VALUES are pinned by
        // the fixture's drawsBeforeTrack, not here.
        let mut both = (false, false);
        for seed in 0..64u32 {
            let mut rng = CountingRng::new(seed);
            roll_modifier(3, &mut rng);
            match rng.draws() {
                1 => both.0 = true,
                2 => both.1 = true,
                n => panic!("seed {seed}: {n} draws, wanted 1 or 2"),
            }
        }
        assert!(both.0 && both.1, "one seed range hit only one branch");
    }
}
