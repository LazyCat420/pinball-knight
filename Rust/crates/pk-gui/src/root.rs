//! The UI driver — `legacy/src/game/pinball-knight/gui/root.ts`.
//!
//! One call per painted frame: clear, paint every open screen bottom-up (only
//! the TOP sees input), then resolve navigation AFTER the paint when the
//! widget count is true, then handle cancel. The shell owns when this runs
//! (immediately before the texture upload) and what input it is fed (empty
//! unless the stack pauses — capture follows the pause flag, not openness).
//!
//! PORTS: `gui/root.ts`

use crate::font::Fonts;
use crate::im::{begin_ui, clamp_focus, empty_ui_input, move_focus, UiFrame, UiInput};
use crate::painter::Painter;
use crate::stack::{Design, ScreenEntry, UiStack};

/// Clamped at 4 — a tiny design box on a huge grid must not become six
/// enormous words; and at 1 from below — a screen that does not fit at 1x
/// clips (visible, fixable) rather than mushing the layer with a fraction.
pub const MAX_UI_ZOOM: u32 = 4;

/// The biggest whole-number zoom at which `design` still fits the grid.
pub fn screen_zoom(design: Option<&Design>, grid_w: f64, grid_h: f64) -> u32 {
    let Some(d) = design else { return 1 };
    if d.w <= 0.0 || d.h <= 0.0 {
        return 1;
    }
    let fit = ((grid_w / d.w).floor()).min((grid_h / d.h).floor());
    let fit = if fit.is_finite() && fit > 0.0 {
        fit as u32
    } else {
        0
    };
    let ceiling = d.max.clamp(1, MAX_UI_ZOOM);
    fit.clamp(1, ceiling)
}

/// The pointer in one screen's units — cloned, never mutated in place, because
/// screens at different zooms paint from the same snapshot in one frame.
pub fn scale_input(input: &UiInput, zoom: u32) -> UiInput {
    if zoom == 1 {
        return input.clone();
    }
    let z = zoom as f64;
    let mut out = input.clone();
    out.pointer.x = input.pointer.x / z;
    out.pointer.y = input.pointer.y / z;
    out.scroll = (input.scroll / z).round();
    out
}

/// Driver diagnostics — the two counters that split "driver never ran" from
/// "the composite ate the result" in one query (`__pk.gui`).
#[derive(Default, Clone, Copy, Debug)]
pub struct UiStats {
    pub frames: u64,
    pub painted: u64,
}

pub struct StackResult<Id> {
    /// Whether anything painted this frame (the layer should upload).
    pub painted: bool,
    /// The screen popped by `cancel`, for the shell to sync its own state.
    pub popped: Option<Id>,
}

/// Paint the whole stack for one frame.
///
/// `paint(frame, id, entry)` draws one screen; it may mutate `entry.scroll`.
/// Focus bookkeeping (clamp + move, every frame even at delta 0 — a row can go
/// disabled between frames) and cancel-pops happen here, exactly as in
/// `drawUiFrame`.
///
/// `dt` is seconds since the previous painted frame, supplied by the shell so
/// this crate never reads a clock. Every screen gets the REAL delta, including
/// the ones below the top: their input is empty because they must not act, but
/// an animation under a modal keeps running — one RAF drives the whole stack.
/// The shell is responsible for clamping a backgrounded tab's enormous delta.
pub fn paint_stack<Id: Copy + Eq>(
    p: &mut Painter,
    fonts: &Fonts,
    stack: &mut UiStack<Id>,
    input: &UiInput,
    dt: f64,
    stats: &mut UiStats,
    mut paint: impl FnMut(&mut UiFrame, Id, &mut ScreenEntry<Id>),
) -> StackResult<Id> {
    stats.frames += 1;
    if stack.is_empty() {
        return StackResult {
            painted: false,
            popped: None,
        };
    }

    p.clear();
    let grid_w = p.w as f64;
    let grid_h = p.h as f64;
    let len = stack.len();
    let mut cancel_top = false;

    for i in 0..len {
        let is_top = i == len - 1;
        let entry = &mut stack.screens_mut()[i];
        let zoom = screen_zoom(entry.design.as_ref(), grid_w, grid_h);
        let frame_input = if is_top {
            scale_input(input, zoom)
        } else {
            empty_ui_input()
        };
        let mut f = begin_ui(
            p,
            fonts,
            (grid_w / zoom as f64).floor(),
            (grid_h / zoom as f64).floor(),
            frame_input,
            entry.focus,
            zoom,
        );
        f.dt = dt;
        let id = entry.id;
        paint(&mut f, id, entry);
        debug_assert_eq!(f.clips, 0, "unbalanced begin_scroll/end_scroll");
        if !is_top {
            continue;
        }
        // Navigation resolves AFTER the paint, when `f.count` is the true
        // number of widgets. The COUNT is the delta — three quick Downs move
        // three rows even if all three landed between two painted frames.
        f.focus = clamp_focus(f.focus, f.count);
        let next = move_focus(&f, input.down as i64 - input.up as i64);
        drop(f);
        stack.screens_mut()[i].focus = next;
        cancel_top = input.cancel;
    }

    let mut popped = None;
    if cancel_top {
        popped = stack.pop().map(|e| e.id);
    }
    stats.painted += 1;
    StackResult {
        painted: true,
        popped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_zoom_matches_the_oracle_cases() {
        let sheets = Design {
            w: 600.0,
            h: 338.0,
            max: 2,
        };
        // 1920×1080: fit = min(3, 3) = 3, capped at 2.
        assert_eq!(screen_zoom(Some(&sheets), 1920.0, 1080.0), 2);
        // 1280×720: fit = min(2, 2) = 2.
        assert_eq!(screen_zoom(Some(&sheets), 1280.0, 720.0), 2);
        // 800×600: fit = min(1, 1) = 1.
        assert_eq!(screen_zoom(Some(&sheets), 800.0, 600.0), 1);
        // Too small: floor at 1, clips visibly rather than refusing.
        assert_eq!(screen_zoom(Some(&sheets), 500.0, 300.0), 1);
        // No design → 1 (tavern scene overlays).
        assert_eq!(screen_zoom(None, 1920.0, 1080.0), 1);
        // Loading screens: {480, 270, max 3} hits 3 on 1600×900.
        let loading = Design {
            w: 480.0,
            h: 270.0,
            max: 3,
        };
        assert_eq!(screen_zoom(Some(&loading), 1600.0, 900.0), 3);
        assert_eq!(screen_zoom(Some(&loading), 1920.0, 1080.0), 3);
    }

    /// Every screen sees the SAME delta, top or not.
    ///
    /// The ones below the top get `empty_ui_input()` because they must not
    /// act on a press aimed at the modal above them — but time is not input.
    /// An animation under a modal keeps running, which is what the oracle's
    /// single RAF does; freezing it would stop a wheel mid-spin because a
    /// confirm box opened.
    #[test]
    fn every_screen_sees_the_real_delta_even_below_the_top() {
        let mut p = Painter::new(600, 338);
        let fonts = Fonts::load_embedded();
        let mut stack = UiStack::new();
        stack.push(ScreenEntry::new(1u8, true));
        stack.push(ScreenEntry::new(2u8, true));
        let mut stats = UiStats::default();
        let mut seen: Vec<(u8, f64)> = Vec::new();
        paint_stack(
            &mut p,
            &fonts,
            &mut stack,
            &empty_ui_input(),
            1.0 / 60.0,
            &mut stats,
            |f, id, _| seen.push((id, f.dt)),
        );
        assert_eq!(seen, vec![(1u8, 1.0 / 60.0), (2u8, 1.0 / 60.0)]);
    }

    /// The whole point, end to end: time in, different pixels out.
    ///
    /// Every other test here checks one link — the flag, the parameter, the
    /// skip. This one drives the real driver over ten frames of a screen that
    /// paints from an accumulated clock, and asserts the picture actually
    /// CHANGED. Without it, `dt` could arrive as a correct number that nothing
    /// draws with, and every unit test above would still pass.
    #[test]
    fn a_screen_that_paints_from_dt_draws_a_different_picture_each_frame() {
        use crate::im::{fill_rect, rect};
        use crate::painter::Rgba;
        let mut p = Painter::new(64, 64);
        let fonts = Fonts::load_embedded();
        let mut stack = UiStack::new();
        stack.push(ScreenEntry::new(0u8, true).animating());
        let mut stats = UiStats::default();
        let mut clock = 0.0_f64;
        let mut digests = Vec::new();
        for _ in 0..10 {
            paint_stack(
                &mut p,
                &fonts,
                &mut stack,
                &empty_ui_input(),
                1.0 / 60.0,
                &mut stats,
                |f, _, _| {
                    // A block that marches right at 300 px/s — five whole
                    // pixels per 1/60s frame, so the position is a clean
                    // multiple and accumulated float drift cannot stall it on
                    // a repeated pixel (which would be a flake in the test,
                    // not a freeze in the driver).
                    clock += f.dt;
                    let x = (clock * 300.0).round();
                    fill_rect(f, &rect(x, 8.0, 8.0, 8.0), Rgba::hex(0xff_ffff));
                },
            );
            digests.push(p.digest());
        }
        assert_eq!(stats.painted, 10, "every frame reached the texture");
        let unique = digests.iter().collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            unique.len(),
            10,
            "ten frames of a moving block must be ten different pictures"
        );
    }

    /// A still frame is a zero-length one, and that is the DEFAULT.
    ///
    /// `begin_ui` leaves `dt` at 0.0 so the thirteen screen tests that build a
    /// frame directly keep meaning what they meant: no time passes, nothing
    /// moves. Only the driver fills in a real delta.
    #[test]
    fn a_frame_built_without_the_driver_has_no_time_in_it() {
        let mut p = Painter::new(64, 64);
        let fonts = Fonts::load_embedded();
        let f = crate::im::begin_ui(&mut p, &fonts, 64.0, 64.0, empty_ui_input(), 0, 1);
        assert_eq!(f.dt, 0.0);
    }
}
