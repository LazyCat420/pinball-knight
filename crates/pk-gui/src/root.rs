//! The UI driver — `legacy/src/game/pinball-knight/gui/root.ts`.
//!
//! One call per painted frame: clear, paint every open screen bottom-up (only
//! the TOP sees input), then resolve navigation AFTER the paint when the
//! widget count is true, then handle cancel. The shell owns when this runs
//! (immediately before the texture upload) and what input it is fed (empty
//! unless the stack pauses — capture follows the pause flag, not openness).

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
pub fn paint_stack<Id: Copy + Eq>(
    p: &mut Painter,
    fonts: &Fonts,
    stack: &mut UiStack<Id>,
    input: &UiInput,
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
}
