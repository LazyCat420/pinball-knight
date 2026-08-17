//! The immediate-mode toolkit — `legacy/src/game/pinball-knight/gui/im.ts`,
//! ported function-for-function IN FILE ORDER. Widget identity is call order;
//! a widget that registers only when visible renumbers everything after it.
//!
//! Every doc-comment war story lives in the oracle; here only the load-bearing
//! invariants are restated at the site that carries them.
//! PORTS: `gui/im.ts`

use std::collections::BTreeSet;

use crate::font::Fonts;
use crate::painter::{DeviceClip, Painter, Rgba};
use crate::theme::{px, snap, Ui, GRID};

// ── Geometry ──────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect { x, y, w, h }
}

pub fn hit(r: &Rect, x: f64, y: f64) -> bool {
    x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
}

/// Shrink a rect on all sides. Negative grows it.
pub fn inset(r: &Rect, by: f64) -> Rect {
    Rect {
        x: r.x + by,
        y: r.y + by,
        w: r.w - by * 2.0,
        h: r.h - by * 2.0,
    }
}

/// Take `h` pixels off the top of `r`, mutating `r` to the remainder.
pub fn cut_top(r: &mut Rect, h: f64) -> Rect {
    let out = Rect {
        x: r.x,
        y: r.y,
        w: r.w,
        h,
    };
    r.y += h;
    r.h -= h;
    out
}

/// Take `w` pixels off the left of `r`, mutating `r` to the remainder.
pub fn cut_left(r: &mut Rect, w: f64) -> Rect {
    let out = Rect {
        x: r.x,
        y: r.y,
        w,
        h: r.h,
    };
    r.x += w;
    r.w -= w;
    out
}

/// Take `w` pixels off the RIGHT of `r`. For trailing controls on a row.
pub fn cut_right(r: &mut Rect, w: f64) -> Rect {
    let out = Rect {
        x: r.x + r.w - w,
        y: r.y,
        w,
        h: r.h,
    };
    r.w -= w;
    out
}

// ── Input ─────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug)]
pub struct Pointer {
    pub x: f64,
    pub y: f64,
    pub inside: bool,
    pub down: bool,
    pub pressed: bool,
    pub released: bool,
}

/// One frame's input, already normalised. Directions are PRESS COUNTS —
/// booleans collapse repeats when a paused screen paints at 2 fps under load.
/// `accept` stays boolean, deliberately: double-applying an action is worse
/// than losing a repeat.
#[derive(Clone, Debug)]
pub struct UiInput {
    pub pointer: Pointer,
    pub pointer_moved: bool,
    pub up: u32,
    pub down: u32,
    pub left: u32,
    pub right: u32,
    pub next_tab: u32,
    pub prev_tab: u32,
    pub accept: bool,
    pub cancel: bool,
    /// Wheel/stick scroll in UI pixels for this frame.
    pub scroll: f64,
    /// Digits 1-9 pressed this frame, or 0.
    pub digit: u32,
    /// Printable characters typed this frame, plus '\u{8}' for backspace.
    pub typed: String,
}

pub fn empty_ui_input() -> UiInput {
    UiInput {
        pointer: Pointer {
            x: -1.0,
            y: -1.0,
            inside: false,
            down: false,
            pressed: false,
            released: false,
        },
        pointer_moved: false,
        up: 0,
        down: 0,
        left: 0,
        right: 0,
        next_tab: 0,
        prev_tab: 0,
        accept: false,
        cancel: false,
        scroll: 0.0,
        digit: 0,
        typed: String::new(),
    }
}

// ── The frame ─────────────────────────────────────────────────────────────────

pub struct UiFrame<'a> {
    pub p: &'a mut Painter,
    pub fonts: &'a Fonts,
    /// Grid size in this screen's OWN units (already divided by zoom).
    pub w: f64,
    pub h: f64,
    pub input: UiInput,
    /// Device texels per UI pixel — the context transform of the legacy layer.
    pub zoom: u32,
    /// Y translation currently applied, in UI pixels. Hit testing adds it back
    /// so pointer (screen space) and rects (content space) agree — see the
    /// scrolled-list war story in im.ts.
    pub origin_y: f64,
    /// The active clip, in CONTENT space, or None for the whole frame.
    pub clip: Option<Rect>,
    /// The draw clip in device pixels — canvas clips before translating.
    device_clip: Option<DeviceClip>,
    /// Integer scroll shift currently applied to draws (UI units).
    shift: i64,
    pub global_alpha: f64,
    pub focus: i64,
    pub count: i64,
    pub consumed: bool,
    pub focus_rect: Option<Rect>,
    pub focus_clipped: bool,
    pub disabled_idx: BTreeSet<i64>,
    /// Legacy tracked webfont readiness; the atlases are embedded, so true.
    pub fonts_ready: bool,
    pub clips: i32,
    /// Seconds since the previous painted frame, for screens that animate.
    ///
    /// A PARAMETER and not a clock: `pk-gui` has no Bevy and must stay
    /// headless-deterministic, so the shell owns the time and a test advances
    /// it in exact steps. `begin_ui` leaves it at 0.0 — a still frame really
    /// is a zero-length one — and `paint_stack` fills in the real delta.
    pub dt: f64,
}

/// Start a frame for one screen. `zoom` is the screen's integer magnification,
/// applied at draw time exactly like the legacy context transform.
pub fn begin_ui<'a>(
    p: &'a mut Painter,
    fonts: &'a Fonts,
    w: f64,
    h: f64,
    input: UiInput,
    focus: i64,
    zoom: u32,
) -> UiFrame<'a> {
    UiFrame {
        p,
        fonts,
        w,
        h,
        input,
        zoom,
        origin_y: 0.0,
        clip: None,
        device_clip: None,
        shift: 0,
        global_alpha: 1.0,
        focus,
        count: 0,
        consumed: false,
        focus_rect: None,
        focus_clipped: false,
        disabled_idx: BTreeSet::new(),
        fonts_ready: true,
        clips: 0,
        dt: 0.0,
    }
}

impl UiFrame<'_> {
    /// canvas `fillRect(px(x), px(y), px(w), px(h))` under scale∘translate.
    fn dev_fill(&mut self, x: f64, y: f64, w: f64, h: f64, c: Rgba) {
        let z = self.zoom as i64;
        self.p.fill_device(
            px(x) * z,
            (px(y) - self.shift) * z,
            px(w) * z,
            px(h) * z,
            c,
            self.global_alpha,
            self.device_clip,
        );
    }
}

// ── Focus ─────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug)]
pub struct WidgetState {
    pub index: i64,
    pub focused: bool,
    pub hovered: bool,
    /// Pad `accept` while focused, or a click landing on it.
    pub activated: bool,
}

pub fn focusable(f: &mut UiFrame, r: &Rect, disabled: bool) -> WidgetState {
    let index = f.count;
    f.count += 1;
    if disabled {
        // A disabled widget STILL TAKES ITS INDEX — renumbering when a row
        // greys out makes the cursor jump. `move_focus` steps over it.
        f.disabled_idx.insert(index);
        return WidgetState {
            index,
            focused: false,
            hovered: false,
            activated: false,
        };
    }

    let p = f.input.pointer;
    // Into CONTENT space, and only inside the region that is drawing right now.
    let py = p.y + f.origin_y;
    let hovered =
        p.inside && (f.clip.is_none() || hit(f.clip.as_ref().unwrap(), p.x, py)) && hit(r, p.x, py);

    // The mouse MOVES focus, it does not bypass it — guarded on actual movement
    // so a resting mouse does not fight the D-pad.
    if hovered && f.input.pointer_moved {
        f.focus = index;
    }

    let focused = f.focus == index;
    if focused {
        f.focus_rect = Some(*r);
        f.focus_clipped = f.clip.is_some();
    }
    let activated = (!f.consumed && focused && f.input.accept) || (hovered && p.pressed);
    if activated {
        f.consumed = true;
    }
    WidgetState {
        index,
        focused,
        hovered,
        activated,
    }
}

/// Move the focus cursor, wrapping, skipping disabled holes. Called every frame
/// even at delta 0 — a row can go disabled BETWEEN frames.
pub fn move_focus(f: &UiFrame, delta: i64) -> i64 {
    if f.count == 0 {
        return 0;
    }
    let wrap = |i: i64| -> i64 { (i + f.count * 2).rem_euclid(f.count) };
    let step = if delta == 0 { 1 } else { delta.signum() };
    let mut at = wrap(f.focus + delta);
    for _ in 0..f.count {
        if !f.disabled_idx.contains(&at) {
            return at;
        }
        at = wrap(at + step);
    }
    wrap(f.focus + delta) // every widget is disabled — nothing to pick
}

/// Keep a persisted cursor valid when a screen's widget count changes.
pub fn clamp_focus(focus: i64, count: i64) -> i64 {
    if count <= 0 {
        return 0;
    }
    focus.clamp(0, count - 1)
}

// ── Painting primitives ───────────────────────────────────────────────────────

pub fn fill_rect(f: &mut UiFrame, r: &Rect, c: Rgba) {
    f.dev_fill(r.x, r.y, r.w, r.h, c);
}

/// A 1px frame drawn INSIDE the rect — four fills, never a stroked path (a
/// stroke straddles the boundary and antialiases into a double line).
pub fn stroke_rect(f: &mut UiFrame, r: &Rect, c: Rgba, weight: f64) {
    let x = px(r.x) as f64;
    let y = px(r.y) as f64;
    let w = px(r.w) as f64;
    let h = px(r.h) as f64;
    f.dev_fill(x, y, w, weight, c);
    f.dev_fill(x, y + h - weight, w, weight, c);
    f.dev_fill(x, y + weight, weight, h - weight * 2.0, c);
    f.dev_fill(x + w - weight, y + weight, weight, h - weight * 2.0, c);
}

/// THE CHISEL — lit top+left for raised, swapped when sunken. Draw order gives
/// corner ownership: top-right and bottom-left land on the SHADE edges.
pub fn bevel(f: &mut UiFrame, r: &Rect, sunken: bool, weight: f64) {
    let (lit, shade) = if sunken {
        (Ui::BEVEL_SHADE, Ui::BEVEL_LIT)
    } else {
        (Ui::BEVEL_LIT, Ui::BEVEL_SHADE)
    };
    let x = px(r.x) as f64;
    let y = px(r.y) as f64;
    let rw = px(r.w) as f64;
    let rh = px(r.h) as f64;
    let w = weight;
    f.dev_fill(x, y, rw, w, lit); // top
    f.dev_fill(x, y, w, rh, lit); // left
    f.dev_fill(x, y + rh - w, rw, w, shade); // bottom
    f.dev_fill(x + rw - w, y, w, rh, shade); // right
}

/// A raised key: face, keyline, chiselled edge.
///
/// ⚠️ ORDER IS LOAD-BEARING (im.ts:480): the keyline goes on the OUTER ring and
/// the chisel one pixel in. Drawn the other way, a 1px stroke overwrites a 1px
/// bevel completely and every button renders flat.
pub fn key(f: &mut UiFrame, r: &Rect, face: Option<Rgba>, edge: Option<Rgba>, sunken: bool) {
    fill_rect(f, r, face.unwrap_or(Ui::RAISED));
    if let Some(e) = edge {
        stroke_rect(f, r, e, 1.0);
    }
    let br = if edge.is_some() { inset(r, 1.0) } else { *r };
    bevel(f, &br, sunken, 1.0);
}

/// A sunken well: dark fill, chiselled INWARD.
pub fn well(f: &mut UiFrame, r: &Rect, edge: Option<Rgba>) {
    key(f, r, Some(Ui::WELL), edge, true);
}

/// THE SELECTOR — a blocky arrowhead of whole-pixel columns. No path, no fill
/// rule, nothing that could antialias.
pub fn cursor_mark(f: &mut UiFrame, x: f64, cy: f64, size: f64) {
    let half = (size / 2.0).floor() as i64;
    for i in 0..half {
        let h = (i + 1) as f64 * 2.0;
        f.dev_fill(x + i as f64, cy - h / 2.0, 1.0, h, Ui::CURSOR);
    }
}

/// The focus ring — 1px, drawn 2px OUTSIDE the widget.
pub fn focus_ring(f: &mut UiFrame, r: &Rect) {
    stroke_rect(f, &inset(r, -2.0), Ui::FOCUS, 1.0);
}

// ── Text ──────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy)]
pub struct TextOpts {
    pub size: u32,
    pub colour: Option<Rgba>,
    pub align: Align,
    pub max: Option<f64>,
}

impl Default for TextOpts {
    fn default() -> Self {
        TextOpts {
            size: 8,
            colour: None,
            align: Align::Left,
            max: None,
        }
    }
}

/// Draw text on the grid. Returns the measured width in UI pixels.
pub fn text(f: &mut UiFrame, s: &str, x: f64, y: f64, opts: TextOpts) -> f64 {
    let size = opts.size;
    let colour = opts.colour.unwrap_or(Ui::TEXT);
    let ellipsized = opts.max.map(|max| ellipsize(f, s, max, size));
    let str_ = ellipsized.as_deref().unwrap_or(s);
    let w = f.fonts.measure(str_, size);
    let dx = match opts.align {
        Align::Left => x,
        Align::Center => x - w / 2.0,
        Align::Right => x - w,
    };
    let z = f.zoom as i64;
    f.fonts.draw(
        f.p,
        str_,
        size * f.zoom,
        px(dx) * z,
        (px(y) - f.shift) * z,
        colour,
        f.global_alpha,
        f.device_clip,
    );
    w
}

/// Trim with a trailing "…" to fit `max` UI pixels.
pub fn ellipsize(f: &UiFrame, s: &str, max: f64, size: u32) -> String {
    if f.fonts.measure(s, size) <= max {
        return s.to_string();
    }
    let chars: Vec<char> = s.chars().collect();
    let mut lo = 0usize;
    let mut hi = chars.len();
    while lo < hi {
        let mid = (lo + hi + 1) >> 1;
        let candidate: String = chars[..mid].iter().collect::<String>() + "…";
        if f.fonts.measure(&candidate, size) <= max {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    chars[..lo].iter().collect::<String>() + "…"
}

/// Word-wrap into lines that fit `max` pixels.
pub fn wrap(f: &UiFrame, s: &str, max: f64, size: u32) -> Vec<String> {
    let words: Vec<&str> = s.split_whitespace().collect();
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in words {
        let next = if line.is_empty() {
            word.to_string()
        } else {
            format!("{line} {word}")
        };
        if f.fonts.measure(&next, size) <= max || line.is_empty() {
            line = next;
        } else {
            lines.push(line);
            line = word.to_string();
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

// ── Icons ─────────────────────────────────────────────────────────────────────

/// Draw an icon centred in a square box, at an exact integer ratio —
/// `im.ts drawIcon`.
///
/// ⚠️ **THE RATIO IS CHOSEN IN DEVICE SPACE, NOT UI SPACE.** The oracle picks
/// `exactIconSize(icon.width, size)` and lets the canvas transform scale the
/// result, because a canvas transform is continuous. Ours is not: a UI pixel is
/// `zoom` device pixels, and `exact_icon_size(72, 8) = 8` at zoom 2 would ask
/// for 16 device pixels off a 72px source — 72/16 = 4.5, so nearest sampling
/// would delete every other row unevenly, which is precisely the artefact
/// `exact_icon_size` exists to prevent. Snapping `size * zoom` instead keeps
/// the ratio exact where the pixels actually land, and costs at most a slightly
/// smaller chip.
///
/// The centring rounds the same way at both scales, so an icon does not shift
/// inside its box when the window changes zoom.
pub fn draw_icon(f: &mut UiFrame, icon: &crate::icons::Icon, x: f64, y: f64, size: f64) {
    draw_icon_inner(f, icon, x, y, size, None)
}

/// Blit a CARD face at `(x, y)`, `w` UI px wide, at the face's own aspect.
///
/// ── WHY THIS IS NOT `draw_icon` ──
/// `draw_icon` is square by construction: it derives ONE exact side `d` from
/// `icon.w` and blits `d × d` into a square box. A card is 56×78. Forcing one
/// through that path would square it — and squaring a card is not a small
/// error, it is losing the aspect that makes it read as a card at all.
///
/// ── WHY THERE IS NO `exact_icon_size` HERE ──
/// That function finds the largest size at which a native dimension divides
/// exactly, because a fractional nearest resample deletes whole rows. Cards
/// dodge the problem instead of solving it: each display width is a SEPARATE
/// filtered downscale from the 512px master (`crate::cards::WIDTHS`), so the
/// caller picks a tier with `cards::baked_width` and this blits it 1:1. When
/// `w * zoom` equals the face's own width — the case the dealer's layout is
/// built to produce — the blit is a straight copy and nothing resamples.
pub fn draw_card(f: &mut UiFrame, face: &crate::cards::CardFace, x: f64, y: f64, w: f64) {
    let z = f.zoom as i64;
    let want = (px(w) * z).max(0);
    if want <= 0 || face.w == 0 {
        return;
    }
    // Height from the FACE's own aspect: the pixels that exist are the
    // authority on their own shape, and rounding here rather than re-deriving
    // from CARD_H/CARD_W keeps the blit square-pixelled at every tier.
    let h = (want * i64::from(face.h) + i64::from(face.w) / 2) / i64::from(face.w);
    f.p.blit_rgba(
        &face.rgba,
        face.w,
        face.h,
        px(x) * z,
        (px(y) - f.shift) * z,
        want,
        h,
        f.global_alpha,
        None,
        f.device_clip,
    );
}

/// The same blit, in ONE colour — the icon's alpha as a stencil.
///
/// For a row whose subject is the ART IN A DIFFERENT MATERIAL. The armorer's
/// elemental sets are the same plate in hoarfrost steel, jade tempest steel,
/// forge-red and storm-slate; there is one `ARMOR_ITEM` painter and the sets
/// live in the knight's own palette, not in a per-set sprite. A silhouette in
/// the set's swatch says "this shape, in this steel" without inventing four
/// pieces of art or — worse — multiplying the real one by a colour, which walks
/// an indexed palette off its own ramp and comes out muddy.
pub fn draw_icon_silhouette(
    f: &mut UiFrame,
    icon: &crate::icons::Icon,
    x: f64,
    y: f64,
    size: f64,
    colour: Rgba,
) {
    draw_icon_inner(f, icon, x, y, size, Some(colour))
}

fn draw_icon_inner(
    f: &mut UiFrame,
    icon: &crate::icons::Icon,
    x: f64,
    y: f64,
    size: f64,
    tint: Option<Rgba>,
) {
    let z = f.zoom as i64;
    let d = exact_icon_size(icon.w as i64, (px(size) * z).max(0));
    if d <= 0 {
        return;
    }
    let box_x = px(x) * z;
    let box_y = (px(y) - f.shift) * z;
    let slack = px(size) * z - d;
    f.p.blit_rgba(
        &icon.rgba,
        icon.w,
        icon.h,
        box_x + slack / 2,
        box_y + slack / 2,
        d,
        d,
        f.global_alpha,
        tint,
        f.device_clip,
    );
}

/// The largest size ≤ `want` at which `native` divides EXACTLY — a fractional
/// nearest-neighbour resample DELETES whole rows and columns.
pub fn exact_icon_size(native: i64, want: i64) -> i64 {
    if native <= 0 || want <= 0 {
        return 0;
    }
    if want >= native {
        return native * 1.max(want / native);
    }
    let mut n = (native + want - 1) / want; // ceil(native / want)
    while n <= native {
        if native % n == 0 {
            return native / n;
        }
        n += 1;
    }
    1
}

// ── Widgets ───────────────────────────────────────────────────────────────────

/// The full-screen dim behind a modal sheet.
pub fn scrim(f: &mut UiFrame) {
    let r = rect(0.0, 0.0, f.w, f.h);
    fill_rect(f, &r, Ui::SCRIM);
}

/// A modal sheet, centred, on the grid. Returns the CONTENT rect. Square
/// corners, no shadow, no 9-slice: plate + 2px chisel + keyline + four rivets.
pub fn sheet(f: &mut UiFrame, w: f64, h: f64) -> Rect {
    let sw = snap(w.min(f.w - GRID * 2.0));
    let sh = snap(h.min(f.h - GRID * 2.0));
    let r = rect(snap((f.w - sw) / 2.0), snap((f.h - sh) / 2.0), sw, sh);
    fill_rect(f, &r, Ui::SHEET);
    bevel(f, &inset(&r, 1.0), false, 2.0);
    stroke_rect(f, &r, Ui::SHEET_EDGE, 1.0);
    let studs = [
        (r.x + 4.0, r.y + 4.0),
        (r.x + r.w - 6.0, r.y + 4.0),
        (r.x + 4.0, r.y + r.h - 6.0),
        (r.x + r.w - 6.0, r.y + r.h - 6.0),
    ];
    for (sx, sy) in studs {
        f.dev_fill(sx, sy, 2.0, 2.0, Ui::RIVET);
    }
    inset(&r, GRID * 2.0)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ButtonOpts {
    pub disabled: bool,
    pub danger: bool,
    pub good: bool,
}

/// A button. Disabled = sunken well; live = raised key with accent keyline;
/// focused = blood face + flame-core text + arrowhead + ring. Nothing shifts.
pub fn button(f: &mut UiFrame, r: &Rect, label: &str, opts: ButtonOpts) -> bool {
    let st = focusable(f, r, opts.disabled);
    let accent = if opts.danger {
        Ui::DANGER
    } else if opts.good {
        Ui::GOOD
    } else {
        Ui::GOLD
    };
    let fg = if opts.disabled {
        Ui::TEXT_FAINT
    } else if st.focused {
        Ui::FOCUS
    } else {
        accent
    };
    if opts.disabled {
        well(f, r, Some(Ui::WELL_EDGE));
    } else {
        let face = if st.focused {
            Ui::SELECT_FACE
        } else {
            Ui::RAISED
        };
        let edge = if st.focused { Ui::SELECT_EDGE } else { accent };
        key(f, r, Some(face), Some(edge), false);
    }
    if st.focused && !opts.disabled {
        cursor_mark(f, r.x + 2.0, r.y + r.h / 2.0, 8.0);
    }
    text(
        f,
        label,
        r.x + r.w / 2.0,
        r.y + (r.h - 8.0) / 2.0,
        TextOpts {
            size: 8,
            colour: Some(fg),
            align: Align::Center,
            max: Some(r.w - GRID * 2.0),
        },
    );
    if st.focused {
        focus_ring(f, r);
    }
    st.activated
}

/// ON/OFF pill — ON is a key pushed IN, OFF is one standing proud.
pub fn toggle(f: &mut UiFrame, r: &Rect, on: bool, labels: (&str, &str)) -> bool {
    let st = focusable(f, r, false);
    let fg = if on { Ui::GOOD } else { Ui::TEXT_DIM };
    let edge = if st.focused { Ui::FOCUS } else { fg };
    if on {
        well(f, r, Some(edge));
    } else {
        key(f, r, None, Some(edge), false);
    }
    text(
        f,
        if on { labels.0 } else { labels.1 },
        r.x + r.w / 2.0,
        r.y + (r.h - 8.0) / 2.0,
        TextOpts {
            size: 8,
            colour: Some(if st.focused { Ui::FOCUS } else { fg }),
            align: Align::Center,
            max: None,
        },
    );
    if st.focused {
        focus_ring(f, r);
    }
    st.activated
}

/// A stepped slider on `bar()`. Returns the new value 0..1.
pub fn slider(f: &mut UiFrame, r: &Rect, value: f64, steps: u32) -> f64 {
    let steps = steps.max(1) as f64;
    let st = focusable(f, r, false);
    let snap_v = |v: f64| -> f64 { ((v * steps).round() / steps).clamp(0.0, 1.0) };
    let mut out = snap_v(value);

    if st.focused {
        for _ in 0..f.input.left {
            out = snap_v(out - 1.0 / steps);
        }
        for _ in 0..f.input.right {
            out = snap_v(out + 1.0 / steps);
        }
        if st.activated {
            out = if out >= 1.0 {
                0.0
            } else {
                snap_v(out + 1.0 / steps)
            };
        }
    }
    if st.hovered && f.input.pointer.down && r.w > 4.0 {
        out = snap_v((f.input.pointer.x - r.x) / r.w);
    }

    let mut row = *r;
    let track = cut_left(&mut row, r.w - 34.0);
    bar(
        f,
        &track,
        out,
        if st.focused { Ui::FOCUS } else { Ui::GOLD },
    );
    if st.focused {
        focus_ring(f, &track);
    }
    text(
        f,
        &format!("{}%", (out * 100.0).round() as i64),
        r.x + r.w,
        r.y + (r.h - 8.0) / 2.0,
        TextOpts {
            size: 8,
            colour: Some(if st.focused { Ui::FOCUS } else { Ui::TEXT_DIM }),
            align: Align::Right,
            max: None,
        },
    );
    out
}

/// A rank meter: `filled` of `total` small squares.
pub fn pips(f: &mut UiFrame, r: &Rect, filled: i64, total: i64) {
    let size = 6.0;
    let gap = 2.0;
    for i in 0..total {
        let pr = rect(
            r.x + i as f64 * (size + gap),
            r.y + (r.h - size) / 2.0,
            size,
            size,
        );
        let on = i < filled;
        fill_rect(f, &pr, if on { Ui::GOLD } else { Ui::WELL });
        stroke_rect(f, &pr, if on { Ui::HEADING } else { Ui::WELL_EDGE }, 1.0);
    }
}

/// A progress bar filled in whole BLOCKS — a fractional edge on this surface
/// is a half-lit column that shimmers as the value creeps.
pub fn bar(f: &mut UiFrame, r: &Rect, t: f64, colour: Rgba) {
    well(f, r, None);
    let inner = inset(r, 2.0);
    if inner.w <= 0.0 || inner.h <= 0.0 {
        return;
    }
    let frac = t.clamp(0.0, 1.0);
    let cells = 1.0_f64.max((inner.w / 6.0).round());
    let cw = inner.w / cells;
    let lit = (frac * cells).round() as i64;
    for i in 0..lit {
        let x = (inner.x + i as f64 * cw).round();
        let w = (inner.x + (i + 1) as f64 * cw).round() - x - 1.0;
        if w > 0.0 {
            let cr = rect(x, inner.y, w, inner.h);
            fill_rect(f, &cr, colour);
        }
    }
}

/// A section heading with a rule above it.
pub fn heading(f: &mut UiFrame, r: &Rect, s: &str, colour: Rgba) {
    let rule = rect(r.x, r.y, r.w, 1.0);
    fill_rect(f, &rule, Ui::SHEET_EDGE);
    text(
        f,
        &s.to_uppercase(),
        r.x,
        r.y + 8.0,
        TextOpts {
            size: 8,
            colour: Some(colour),
            align: Align::Left,
            max: None,
        },
    );
}

/// A horizontal tab strip. The ACTIVE tab is pressed IN. Returns the selection.
pub fn tabs(f: &mut UiFrame, r: &Rect, labels: &[&str], active: i64) -> i64 {
    let n = labels.len() as i64;
    if n == 0 {
        return active;
    }
    let mut next = active;
    let tw = (r.w / n as f64).floor();
    for (i, label) in labels.iter().enumerate() {
        let tr = rect(r.x + i as f64 * tw, r.y, tw - 2.0, r.h);
        let st = focusable(f, &tr, false);
        let on = i as i64 == active;
        if on {
            key(f, &tr, Some(Ui::SELECT_FACE), Some(Ui::GOLD), true);
        } else {
            key(f, &tr, None, Some(Ui::WELL_EDGE), false);
        }
        text(
            f,
            label,
            tr.x + tr.w / 2.0,
            tr.y + (tr.h - 8.0) / 2.0,
            TextOpts {
                size: 8,
                colour: Some(if on { Ui::FOCUS } else { Ui::TEXT_DIM }),
                align: Align::Center,
                max: Some(tr.w - 4.0),
            },
        );
        if st.focused {
            focus_ring(f, &tr);
        }
        if st.activated {
            next = i as i64;
        }
    }
    // Counted — holding a shoulder button through a slow frame drops no steps.
    let nt = f.input.next_tab as i64;
    let pt = f.input.prev_tab as i64;
    if nt != 0 {
        next = (next + nt) % n;
    }
    if pt != 0 {
        next = (next - pt + n * (pt + 1)) % n;
    }
    let d = f.input.digit as i64;
    if d >= 1 && d <= n {
        next = d - 1;
    }
    next
}

// ── Scrolling ─────────────────────────────────────────────────────────────────

pub struct ScrollHandle {
    pub inner: Rect,
    pub offset: f64,
}

/// A clipped, scrollable region. The inner rect starts at `r.y`, NOT
/// `r.y + shift` — offsetting the layout while the context is translated is an
/// exact cancellation and the region never scrolls (im.ts's own war story).
pub fn begin_scroll(f: &mut UiFrame, r: &Rect, content_h: f64, offset: f64) -> ScrollHandle {
    let max = (content_h - r.h).max(0.0);
    let mut next = offset.clamp(0.0, max);
    let p = f.input.pointer;
    if p.inside && hit(r, p.x, p.y) {
        next = (next + f.input.scroll).clamp(0.0, max);
    }

    f.clips += 1;
    let z = f.zoom as i64;
    let (cx, cy, cw, ch) = (px(r.x), px(r.y), px(r.w), px(r.h));
    f.device_clip = Some((cx * z, cy * z, (cx + cw) * z, (cy + ch) * z));
    let shift = px(next);
    f.shift = shift;
    f.origin_y = shift as f64;
    f.clip = Some(rect(r.x, r.y + shift as f64, r.w, r.h));

    ScrollHandle {
        inner: rect(r.x, r.y, r.w, content_h),
        offset: next,
    }
}

pub fn end_scroll(f: &mut UiFrame, r: &Rect, content_h: f64, offset: f64) {
    f.clips -= 1;
    f.device_clip = None;
    f.shift = 0;
    f.origin_y = 0.0;
    f.clip = None;
    // The scrollbar is a bare 2px track — it exists only to say "there is more".
    if content_h <= r.h {
        return;
    }
    let track_x = r.x + r.w - 2.0;
    let tr = rect(track_x, r.y, 2.0, r.h);
    fill_rect(f, &tr, Ui::WELL);
    let thumb_h = GRID.max((r.h / content_h) * r.h);
    let thumb_y = r.y + (offset / (content_h - r.h)) * (r.h - thumb_h);
    let th = rect(track_x, thumb_y.round(), 2.0, thumb_h.round());
    fill_rect(f, &th, Ui::TEXT_DIM);
}

/// Keep the focused widget visible.
pub fn scroll_to_show(view: &Rect, widget: &Rect, offset: f64) -> f64 {
    let top = widget.y - view.y;
    let bottom = top + widget.h;
    if top < offset {
        return (top - crate::theme::ROW_H).max(0.0);
    }
    if bottom > offset + view.h {
        return bottom - view.h + crate::theme::ROW_H;
    }
    offset
}

/// The one line a scrolling screen needs after its body has painted.
pub fn follow_focus(f: &UiFrame, view: &Rect, offset: f64) -> f64 {
    match (&f.focus_rect, f.focus_clipped) {
        (Some(fr), true) => scroll_to_show(view, fr, offset),
        _ => offset,
    }
}

/// A single-line text field. Typing appends, backspace removes; input only
/// while focused so keys stay inert everywhere else.
pub fn text_field(f: &mut UiFrame, r: &Rect, value: &str, max: usize, upper: bool) -> String {
    let st = focusable(f, r, false);
    well(f, r, None);
    stroke_rect(
        f,
        r,
        if st.focused { Ui::FOCUS } else { Ui::WELL_EDGE },
        1.0,
    );

    let mut next = value.to_string();
    if st.focused && !f.input.typed.is_empty() {
        let typed = f.input.typed.clone();
        for ch in typed.chars() {
            if ch == '\u{8}' {
                next.pop();
            } else if next.chars().count() < max {
                next.push(ch);
            }
        }
        if upper {
            next = next.to_uppercase();
        }
    }

    let shown = if upper {
        next.to_uppercase()
    } else {
        next.clone()
    };
    text(
        f,
        &shown,
        r.x + 6.0,
        r.y + (r.h - 8.0) / 2.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT),
            align: Align::Left,
            max: Some(r.w - 20.0),
        },
    );
    if st.focused {
        let w = f.fonts.measure(&shown, 8);
        let caret = rect(r.x + 6.0 + w + 2.0, r.y + (r.h - 10.0) / 2.0, 1.0, 10.0);
        fill_rect(f, &caret, Ui::FOCUS);
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::Ui;

    fn frame_on<'a>(p: &'a mut Painter, fonts: &'a Fonts, w: f64, h: f64) -> UiFrame<'a> {
        begin_ui(p, fonts, w, h, empty_ui_input(), 0, 1)
    }

    #[test]
    fn bevel_corner_ownership_matches_the_draw_order() {
        // lit top, lit left, shade bottom, shade right — so the top-right and
        // bottom-left corners belong to the SHADE edges (drawn last).
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(8, 8);
        let mut f = frame_on(&mut p, &fonts, 8.0, 8.0);
        let r = rect(0.0, 0.0, 4.0, 4.0);
        bevel(&mut f, &r, false, 1.0);
        drop(f);
        assert_eq!(p.pixel(0, 0), Ui::BEVEL_LIT); // top-left: lit
        assert_eq!(p.pixel(3, 0), Ui::BEVEL_SHADE); // top-right: right edge wins
        assert_eq!(p.pixel(0, 3), Ui::BEVEL_SHADE); // bottom-left: bottom edge wins
        assert_eq!(p.pixel(3, 3), Ui::BEVEL_SHADE);
    }

    #[test]
    fn key_keeps_its_keyline_on_the_outer_ring_and_the_chisel_inside() {
        // The im.ts:480 war story: a 1px stroke on the same ring as a 1px bevel
        // overwrites it completely and every button renders flat.
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(12, 12);
        let mut f = frame_on(&mut p, &fonts, 12.0, 12.0);
        let r = rect(0.0, 0.0, 10.0, 10.0);
        key(&mut f, &r, None, Some(Ui::GOLD), false);
        drop(f);
        assert_eq!(p.pixel(0, 0), Ui::GOLD); // keyline on the outer ring
        assert_eq!(p.pixel(5, 0), Ui::GOLD);
        assert_eq!(p.pixel(1, 1), Ui::BEVEL_LIT); // chisel one pixel in
        assert_eq!(p.pixel(8, 8), Ui::BEVEL_SHADE);
        assert_eq!(p.pixel(5, 5), Ui::RAISED); // face
    }

    #[test]
    fn stroke_rect_stays_inside_the_rect() {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(6, 6);
        let mut f = frame_on(&mut p, &fonts, 6.0, 6.0);
        stroke_rect(&mut f, &rect(0.0, 0.0, 4.0, 4.0), Ui::FOCUS, 1.0);
        drop(f);
        assert_eq!(p.pixel(0, 0), Ui::FOCUS);
        assert_eq!(p.pixel(3, 3), Ui::FOCUS);
        assert_eq!(p.pixel(1, 1), Rgba::TRANSPARENT); // interior untouched
        assert_eq!(p.pixel(4, 4), Rgba::TRANSPARENT); // outside untouched
    }

    #[test]
    fn scrolled_hit_testing_lives_in_content_space() {
        // The debug-console war story: at offset 30, a click at screen y=35
        // must land on the row at CONTENT y=65.
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(100, 50);
        let mut input = empty_ui_input();
        input.pointer = Pointer {
            x: 10.0,
            y: 35.0,
            inside: true,
            down: false,
            pressed: true,
            released: false,
        };
        let mut f = begin_ui(&mut p, &fonts, 100.0, 50.0, input, 0, 1);
        let view = rect(0.0, 0.0, 100.0, 50.0);
        let sc = begin_scroll(&mut f, &view, 200.0, 30.0);
        assert_eq!(sc.offset, 30.0);
        let row = rect(0.0, 60.0, 100.0, 20.0);
        let st = focusable(&mut f, &row, false);
        assert!(st.hovered, "content-space row under the pointer must hover");
        assert!(st.activated, "a press on it must activate");
        // A row scrolled above the viewport must NOT answer.
        let above = rect(0.0, 10.0, 100.0, 20.0);
        let st2 = focusable(&mut f, &above, false);
        assert!(!st2.hovered);
        end_scroll(&mut f, &view, 200.0, sc.offset);
    }

    #[test]
    fn moving_focus_steps_over_disabled_holes_and_settles_at_delta_zero() {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(10, 10);
        let mut f = frame_on(&mut p, &fonts, 10.0, 10.0);
        let r = rect(0.0, 0.0, 4.0, 4.0);
        focusable(&mut f, &r, false); // 0
        focusable(&mut f, &r, true); // 1 disabled
        focusable(&mut f, &r, true); // 2 disabled
        focusable(&mut f, &r, false); // 3
        f.focus = 0;
        assert_eq!(move_focus(&f, 1), 3, "two disabled rows are one step");
        f.focus = 1; // parked in a hole (went disabled between frames)
        assert_eq!(move_focus(&f, 0), 3, "delta 0 still settles off a hole");
        f.focus = 3;
        assert_eq!(move_focus(&f, 1), 0, "wraps");
    }

    #[test]
    fn exact_icon_size_ports_the_table() {
        assert_eq!(exact_icon_size(72, 24), 24); // 72/3
        assert_eq!(exact_icon_size(72, 28), 24); // snap DOWN to a divisor
        assert_eq!(exact_icon_size(120, 45), 40); // the HUD mugshot case
        assert_eq!(exact_icon_size(72, 200), 144); // upscale: whole multiples
        assert_eq!(exact_icon_size(0, 24), 0);
    }

    #[test]
    fn zoom_two_fills_scale_exactly() {
        let fonts = Fonts::load_embedded();
        let mut p = Painter::new(8, 8);
        let mut f = begin_ui(&mut p, &fonts, 4.0, 4.0, empty_ui_input(), 0, 2);
        fill_rect(&mut f, &rect(1.0, 1.0, 2.0, 1.0), Ui::GOLD);
        drop(f);
        assert_eq!(p.pixel(1, 1), Rgba::TRANSPARENT);
        assert_eq!(p.pixel(2, 2), Ui::GOLD);
        assert_eq!(p.pixel(5, 3), Ui::GOLD); // 2..6 × 2..4
        assert_eq!(p.pixel(6, 2), Rgba::TRANSPARENT);
    }

    #[test]
    fn the_painted_prompt_is_deterministic() {
        use crate::screens::tavern::{paint_station_prompt, StationView};
        let fonts = Fonts::load_embedded();
        let s = StationView {
            label: "Forge / Repair".into(),
            blurb: "repair, add a socket, forge and reroll cards".into(),
            accent: 0xf0a63c,
        };
        let d1 = {
            let mut p = Painter::new(1920, 1080);
            let mut f = frame_on(&mut p, &fonts, 1920.0, 1080.0);
            paint_station_prompt(&mut f, &s);
            drop(f);
            p.digest()
        };
        let d2 = {
            let mut p = Painter::new(1920, 1080);
            let mut f = frame_on(&mut p, &fonts, 1920.0, 1080.0);
            paint_station_prompt(&mut f, &s);
            drop(f);
            p.digest()
        };
        assert_eq!(d1, d2);
        assert_ne!(
            d1,
            Painter::new(1920, 1080).digest(),
            "prompt painted nothing"
        );
    }
}
