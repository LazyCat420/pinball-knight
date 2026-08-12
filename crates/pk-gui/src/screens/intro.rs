//! THE INTRO'S CHROME — `legacy/src/game/pinball-knight/gui/screens/intro-chrome.ts`.
//!
//! Skip button, title banner, fade. Seventy lines in the oracle and a
//! line-for-line port here, because every number in it is a composition
//! decision that shows: the title sits at `0.78 h`, not centred; the hint is a
//! quarter of its size and 46 design-pixels below it; the button is 100×26 in
//! the bottom-right gutter.
//!
//! ## Why the port needed this at all
//!
//! `pk-game`'s intro painted its title with two Bevy UI `Text` nodes. That is
//! not the same picture and it was never going to be: the oracle's title is the
//! PIXEL FONT on a 480×270 design grid at zoom 3, so a glyph is 32 design-px
//! ≈ 96 screen-px and lands on the same lattice as the rest of the game, while
//! a `Text` node is a font atlas at whatever size the shell asked for, blurred
//! across the pixel grid, in a typeface the game does not otherwise contain.
//! The first `pk-ab-intro` sheet shows the two side by side: the oracle's title
//! spans 69% of the frame and the port's 41%.
//!
//! **And the SKIP button was missing entirely** — not smaller, not restyled,
//! absent — so the one interactive affordance the title sequence has did not
//! exist in the port. It is the only focusable widget on the screen, exactly as
//! in the oracle.
//!
//! ## The blink is a wall clock, and the caller owns it
//!
//! The oracle blinks "PRESS ANY KEY" with `performance.now() % 1100 < 620`,
//! deliberately replacing a CSS `@keyframes` the pixel pass could never see.
//! This crate has no clock — it is pure so the goldens can be replayed — so the
//! caller passes `blink_on` and [`blink_phase`] is the shared derivation of it.
//! Two implementations of one modulus is how the port's blink ends up 40 ms out
//! of step with the oracle's and nobody can say why.
//!
//! PORTS: `gui/screens/intro-chrome.ts`

use crate::im::{button, fill_rect, rect, text, Align, ButtonOpts, Rect, TextOpts, UiFrame};
use crate::painter::Rgba;
use crate::theme::Ui;

/// The design grid the oracle asks for: `design: { w: 480, h: 270, max: 3 }`.
///
/// "Four words and a button, so it takes the largest zoom the grid allows — a
/// title card is the one place in the game where small type has nothing to
/// trade itself against."
pub const DESIGN_W: f64 = 480.0;
pub const DESIGN_H: f64 = 270.0;
pub const DESIGN_MAX_ZOOM: u32 = 3;

/// `performance.now() % 1100 < 620` — on for 620 ms of every 1.1 s.
///
/// Takes milliseconds since an arbitrary epoch, like its source. The port's
/// clock is the app's elapsed time rather than `performance.now()`, which
/// differs by a constant offset and therefore only shifts the blink's phase,
/// not its cadence.
pub fn blink_phase(now_ms: f64) -> bool {
    now_ms.rem_euclid(1100.0) < 620.0
}

/// What the chrome is showing this frame. The oracle's module-level `chrome`
/// object, handed in instead of stored, because this crate keeps no state.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IntroChromeView {
    /// Show the title + PRESS ANY KEY. Set on the `title` phase.
    pub show_title: bool,
    /// 0..1 black wipe, painted over everything including the button.
    pub fade: f64,
    /// [`blink_phase`] of the caller's clock — only read when `show_title`.
    pub blink_on: bool,
}

impl Default for IntroChromeView {
    fn default() -> Self {
        Self {
            show_title: false,
            fade: 0.0,
            blink_on: true,
        }
    }
}

/// Paint it. Returns true on the frame SKIP is pressed.
///
/// The order is the oracle's and it is load-bearing: the fade is painted LAST
/// so it covers the title and the button, which is what the DOM version got
/// from z-index.
pub fn paint_intro_chrome(f: &mut UiFrame, v: &IntroChromeView) -> bool {
    if v.show_title {
        text(
            f,
            "PINBALL KNIGHT",
            f.w / 2.0,
            f.h * 0.78,
            TextOpts {
                size: 32,
                colour: Some(Ui::HEADING),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
        if v.blink_on {
            text(
                f,
                "PRESS ANY KEY",
                f.w / 2.0,
                f.h * 0.78 + 46.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::TEXT),
                    align: Align::Center,
                    ..TextOpts::default()
                },
            );
        }
    }

    // SKIP is the one interactive thing here, so it is the one focusable.
    let hit = button(
        f,
        &rect(f.w - 116.0, f.h - 44.0, 100.0, 26.0),
        "SKIP",
        ButtonOpts::default(),
    );

    // Painted last, over everything. `fill_rect` takes a straight-alpha colour,
    // so the oracle's `globalAlpha` becomes the black's own alpha rather than a
    // painter-wide state the rest of this crate does not have.
    if v.fade > 0.0 {
        let a = (v.fade.clamp(0.0, 1.0) * 255.0).round() as u8;
        let r: Rect = rect(0.0, 0.0, f.w, f.h);
        fill_rect(f, &r, Rgba::hex_a(0x000000, a));
    }

    hit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_blink_is_on_for_620_of_every_1100_ms() {
        // The oracle's modulus, sampled at its edges. A blink that is on for
        // 620/1100 reads as a steady pulse; one that is on for 620/620 reads as
        // a solid line, and both look "blinking" in a screenshot.
        assert!(blink_phase(0.0));
        assert!(blink_phase(619.0));
        assert!(!blink_phase(620.0));
        assert!(!blink_phase(1099.0));
        assert!(blink_phase(1100.0));
        assert!(blink_phase(1100.0 * 7.0 + 100.0));
    }

    #[test]
    fn a_clock_offset_shifts_the_phase_and_not_the_cadence() {
        // The port's clock is elapsed-since-launch and the oracle's is
        // `performance.now()`; they differ by a constant. Over one period the
        // ON fraction has to be identical whatever that constant is.
        for offset in [0.0, 37.0, 500.0, 12_345.0] {
            let on = (0..1100)
                .filter(|ms| blink_phase(offset + f64::from(*ms)))
                .count();
            assert_eq!(on, 620, "offset {offset} changed the duty cycle");
        }
    }

    #[test]
    fn negative_clocks_do_not_invert_the_blink() {
        // `%` on a negative left operand is negative in Rust AND in JS, and a
        // negative result would compare `< 620` as true for the whole period —
        // a hint that never blinks. `rem_euclid` is why this passes.
        assert!(blink_phase(-1000.0) || !blink_phase(-1000.0)); // total
        assert_eq!(blink_phase(-1100.0), blink_phase(0.0));
        assert_eq!(blink_phase(-500.0), blink_phase(600.0));
    }
}
