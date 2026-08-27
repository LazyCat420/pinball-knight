//! ROULETTE ART — parity checks against the wheel the art claims to draw.
//!
//! Replicates `legacy/src/scenes/tavern/gambler/roulette-art.ts`.
//!
//! ## What this file replaces, and why
//!
//! The first version of this test asserted that
//! `RouletteWheelMetrics::project_isometric` followed by `unproject_isometric`
//! returned its input. That is true of ANY invertible map — it holds for
//! `FLAT = 0.46`, for `FLAT = 7.0`, and for a projection with the axes swapped.
//! It measured the inverse, not the wheel. It stayed green for a module in
//! which `draw_wheel`, `draw_panel` and `clear_table` all had EMPTY BODIES and
//! `build_wheel_layers` returned two integers, while the status doc recorded
//! the gambler as done.
//!
//! So every check here is anchored to something computed a DIFFERENT way from
//! the code under test: the ellipse equation, the pocket count, a rotation the
//! art has to respond to. A test for procedural art has to be able to fail when
//! nothing is drawn.

use pk_gui::gambler::pixmap::Pixmap;
use pk_gui::gambler::roulette_art::{
    build_wheel_layers, draw_wheel, BallView, PocketColor, WheelView, BAKE_H, BAKE_W, CX,
    CONE_R, CY, FLAT, POCKETS, POCKET_PITCH, R, RIM_LIFT, RING_R, R_POCKET,
};

use std::f64::consts::{PI, TAU};

/// Odd red / even black / 0 green — `pk_core::gambler::roulette::color_of`.
///
/// Restated because `pk-gui` cannot depend on `pk-core`; `pk-game`'s
/// `roulette_art_constants_match_physics` is what stops the two drifting.
fn pockets() -> [PocketColor; POCKETS] {
    core::array::from_fn(|n| {
        if n == 0 {
            PocketColor::Green
        } else if n % 2 == 1 {
            PocketColor::Red
        } else {
            PocketColor::Black
        }
    })
}

fn view() -> WheelView {
    WheelView {
        ball: BallView::default(),
        pockets: pockets(),
        highlight: -1,
        flash: 0.0,
        show_ball: false,
    }
}

fn frame(v: &WheelView) -> Pixmap {
    let layers = build_wheel_layers();
    let mut pm = Pixmap::new(BAKE_W, BAKE_H);
    draw_wheel(&mut pm, v, &layers);
    pm
}

/// Painted span on one row of a pixmap, as `(first, last)` inclusive.
fn span(pm: &Pixmap, y: usize) -> Option<(usize, usize)> {
    let mut first = None;
    let mut last = 0;
    for x in 0..pm.w {
        if pm.pixel(x, y).a != 0 {
            first.get_or_insert(x);
            last = x;
        }
    }
    first.map(|f| (f, last))
}

/// THE SILHOUETTE IS AN ELLIPSE.
///
/// The rim's painted width on each row is checked against `2*sqrt(R^2 - dyw^2)`
/// — the ellipse equation, evaluated here rather than borrowed from the
/// rasteriser. A projection with the wrong `FLAT`, a swapped axis, or a
/// scanline loop that walks the wrong bound fails this; the old roundtrip test
/// passed all three.
#[test]
fn the_rim_silhouette_follows_the_ellipse() {
    let layers = build_wheel_layers();
    let base_y = CY - RIM_LIFT;
    let mut checked = 0;

    // Rows ABOVE the rim's equator only.
    //
    // Below it the skirt is in the frame, and the skirt is a COLUMN hanging off
    // each point of the rim's lower edge — so at row 55 the base layer is 188px
    // wide where the rim's own ellipse is 184.3px, and it is the skirt, not a
    // projection error. Measuring the two together is how the first draft of
    // this test failed against correct art. Every skirt pixel lands at or below
    // `base_y`, so the upper half is a clean read of the rim alone.
    //
    // The poles are skipped too: a one-pixel rounding difference is a large
    // fraction of a very short span there.
    for sy in 0..BAKE_H {
        let dyw = (sy as f64 + 0.5 - base_y) / FLAT;
        if dyw >= 0.0 {
            break; // equator — the skirt starts here
        }
        let inside = R * R - dyw * dyw;
        if inside <= 0.0 {
            continue;
        }
        let want = 2.0 * inside.sqrt();
        if want < 24.0 {
            continue; // near the poles
        }
        let Some((lo, hi)) = span(&layers.base, sy) else {
            panic!("row {sy} is inside the rim but nothing was painted");
        };
        let got = (hi - lo + 1) as f64;
        assert!(
            (got - want).abs() <= 3.0,
            "row {sy}: painted {got:.0}px, ellipse says {want:.1}px"
        );
        // And it is centred on CX.
        let mid = (lo + hi) as f64 / 2.0;
        assert!(
            (mid - CX).abs() <= 2.0,
            "row {sy}: silhouette centred at {mid:.1}, not {CX}"
        );
        checked += 1;
    }
    assert!(checked > 20, "only {checked} rows checked — the bake looks empty");
}

/// The skirt hangs BELOW the rim, and only below it. A sign error on `SKIRT` or
/// a lift applied the wrong way puts the bowl's wall above its own rim.
#[test]
fn the_skirt_hangs_below_the_rim() {
    let layers = build_wheel_layers();
    let rim_top = (CY - RIM_LIFT - R * FLAT) as usize;
    let rim_bottom = (CY - RIM_LIFT + R * FLAT) as usize;

    // The widest row of the whole bake is the rim's equator, not the skirt.
    let widest = (0..BAKE_H)
        .filter_map(|y| span(&layers.base, y).map(|(l, h)| (h - l, y)))
        .max()
        .expect("nothing painted");
    assert!(
        widest.1 >= rim_top && widest.1 <= rim_bottom + 1,
        "widest row is {}, expected it inside the rim ({rim_top}..{rim_bottom})",
        widest.1
    );

    // And something IS painted below the rim — that is the skirt.
    let below = ((rim_bottom + 2)..BAKE_H)
        .filter(|&y| span(&layers.base, y).is_some())
        .count();
    assert!(below >= 8, "only {below} skirt rows below the rim");
}

/// POCKET 0 SITS AT ANGLE 0 WHEN THE ROTOR IS 0.
///
/// The rotor's zero and the pocket ring's index zero have to agree, and a
/// symmetric off-by-one in both directions is invisible to any "does it turn?"
/// check. Pinning slot 0 against the GREEN pocket — the only one whose colour is
/// unique — is what makes the wiring falsifiable.
#[test]
fn pocket_zero_is_green_and_sits_on_the_positive_x_axis() {
    let pm = frame(&view());
    // Angle 0 in wheel space is +x at the vertical centre.
    //
    // Sample the VISIBLE pocket band, which is `CONE_R..RING_R` — the ring disc
    // is painted out to `RING_R` but the cone then paints over everything inside
    // `CONE_R`. The first draft sampled `(APRON_R + R_POCKET) / 2` = 0.7575,
    // which is outside `RING_R` = 0.745 and therefore lands on the APRON: it
    // read back `STEEL[1]` and looked like a colour bug in the ring.
    let (px, py) = (
        (CX + R * ((CONE_R + RING_R) / 2.0)).round() as usize,
        CY.round() as usize,
    );
    let green = pockets()[0].ramp();
    let hit = pm.pixel(px, py);
    assert!(
        green.contains(&hit),
        "pocket 0 at ({px},{py}) is {hit:?}, not a shade of green {green:?}"
    );
}

/// Nineteen pockets, and nineteen distinct rotor positions render differently.
/// A ring drawn with the wrong pitch collapses two of them onto each other.
#[test]
fn the_ring_has_exactly_nineteen_distinct_pockets() {
    let layers = build_wheel_layers();
    let mut digests = std::collections::BTreeSet::new();
    for p in 0..POCKETS {
        let mut v = view();
        v.ball.rotor = p as f64 * POCKET_PITCH;
        let mut pm = Pixmap::new(BAKE_W, BAKE_H);
        draw_wheel(&mut pm, &v, &layers);
        digests.insert(pm.digest());
    }
    assert_eq!(digests.len(), POCKETS, "rotor positions collided");

    // A FULL turn is the identity — the ring really is periodic in 19 pockets.
    let mut a = view();
    let mut b = view();
    b.ball.rotor = TAU;
    a.ball.rotor = 0.0;
    assert_eq!(
        frame(&a).digest(),
        frame(&b).digest(),
        "a full revolution did not come back to itself"
    );
}

/// COUNTER-ROTATION: the ball and the rotor are different bodies, and moving one
/// must not move the other. A single-body wheel — the mistake the physics
/// module's header calls out — passes a "does it spin?" test and fails this.
#[test]
fn the_ball_and_the_rotor_move_independently() {
    let base = view();
    let baseline = frame(&base).digest();

    let mut rotor_only = view();
    rotor_only.ball.rotor = POCKET_PITCH * 2.0;
    let rotor_moved = frame(&rotor_only).digest();

    let mut ball_only = view();
    ball_only.show_ball = true;
    ball_only.ball.theta = PI / 2.0;
    let ball_moved = frame(&ball_only).digest();

    assert_ne!(baseline, rotor_moved, "the rotor did not turn the ring");
    assert_ne!(baseline, ball_moved, "the ball was not drawn");
    assert_ne!(rotor_moved, ball_moved, "the two bodies are wired together");
}

/// The deflectors live on the STATOR. They must not move with the rotor — if
/// they do, the art shows diamonds that rotate past a ball they are supposed to
/// scatter, which is a picture of a wheel that cannot exist.
#[test]
fn the_deflectors_do_not_turn_with_the_rotor() {
    let a = build_wheel_layers();
    let b = build_wheel_layers();
    assert_eq!(a.mid, b.mid, "the bake is not deterministic");
    // `mid` carries the deflectors and takes no rotor argument at all — the
    // bake's signature is the guarantee. This pins that it stays that way.
    assert!(a.mid.painted() > 1000, "mid layer is empty");
}

/// The bake is stable across calls. Procedural art that changes between two
/// calls with the same inputs cannot be golden-tested at all.
#[test]
fn the_bake_is_deterministic() {
    let a = build_wheel_layers();
    let b = build_wheel_layers();
    assert_eq!(a.base.digest(), b.base.digest());
    assert_eq!(a.mid.digest(), b.mid.digest());
    assert_eq!(a.far.digest(), b.far.digest());
}
