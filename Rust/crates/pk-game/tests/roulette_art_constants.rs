//! THE DRIFT GUARD between the roulette art and the roulette physics.
//!
//! `pk-gui` does not depend on `pk-core` — the toolkit answers to the browser's
//! own raster, not to the simulation — so every physical constant the wheel art
//! needs is RESTATED in `pk_gui::gambler::roulette_art` rather than imported.
//! The oracle's own warning about restating the deflector radius says why that
//! is dangerous:
//!
//! > a diamond drawn somewhere the ball never scatters is a picture of a
//! > different wheel, and the two numbers being equal by hand is exactly how
//! > that drifts.
//!
//! `pk-game` is the one crate that can see both, so this is where "equal by
//! hand" stops being by hand. Every constant that exists twice is checked here.
//! A test that checked only the ones that happen to be exported would leave the
//! hole in exactly the place the warning points at, which is why `DEFL_OFFSET`
//! was made `pub` in `pk_core` rather than skipped.

use pk_core::gambler::roulette as core_rules;
use pk_core::gambler::roulette_physics as core_phys;
use pk_gui::gambler::roulette_art as art;

#[test]
fn roulette_art_constants_match_physics() {
    assert_eq!(
        art::POCKETS as i32,
        core_rules::POCKETS,
        "pocket count: the ring would draw a different number of pockets than \
         the wheel decides between"
    );
    assert_eq!(
        art::POCKET_PITCH,
        core_phys::POCKET_PITCH,
        "pocket pitch: the ring's colour boundaries would sit off the frets the \
         physics rattles the ball across"
    );
    assert_eq!(
        art::R_POCKET,
        core_phys::R_POCKET,
        "seated radius: a settled ball would be drawn off its own pocket"
    );
    assert_eq!(
        art::R_DEFLECTOR,
        core_phys::R_DEFLECTOR,
        "deflector ring radius — the oracle's own warning"
    );
    assert_eq!(
        art::DEFLECTORS as u32,
        core_phys::DEFLECTORS,
        "deflector count"
    );
    assert_eq!(
        art::DEFL_OFFSET,
        core_phys::DEFL_OFFSET,
        "deflector phase: every diamond drawn between two real ones"
    );
}

/// The art's `PocketColor` is a second definition of a `pk_core` enum. The
/// cabinet converts between them; this pins that the conversion is total and
/// order-preserving, which a `match` alone cannot promise once a variant moves.
#[test]
fn every_pocket_colour_maps_across_the_crate_boundary() {
    for n in 0..core_rules::POCKETS {
        let want = match core_rules::color_of(n) {
            core_rules::PocketColor::Red => art::PocketColor::Red,
            core_rules::PocketColor::Black => art::PocketColor::Black,
            core_rules::PocketColor::Green => art::PocketColor::Green,
        };
        // Green is the house's zero and must be unique — if the mapping ever
        // collapses two colours this is the pocket that shows it first.
        if n == 0 {
            assert_eq!(want, art::PocketColor::Green, "pocket 0 is not green");
        } else {
            assert_ne!(want, art::PocketColor::Green, "pocket {n} claims to be the zero");
        }
        assert!(!want.ramp().is_empty(), "pocket {n} has no ramp");
    }
}

/// The art's ball-track mapping has to land the ball inside the groove the
/// physics thinks it is riding in — the one place the two coordinate systems
/// genuinely have to agree rather than merely match.
#[test]
fn the_art_track_radius_sits_inside_the_painted_groove() {
    assert_eq!(core_phys::R_BALL_TRACK, 1.0, "physics normalisation moved");
    assert!(
        art::BALL_TRACK_R >= art::APRON_R && art::BALL_TRACK_R <= art::TRACK_R,
        "the ball would be drawn outside the bowl: {} not in {}..{}",
        art::BALL_TRACK_R,
        art::APRON_R,
        art::TRACK_R
    );
}
