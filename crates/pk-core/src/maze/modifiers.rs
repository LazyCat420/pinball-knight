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
