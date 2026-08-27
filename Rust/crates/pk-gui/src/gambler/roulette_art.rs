//! ROULETTE ART — an isometric wheel rasterised by hand.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/roulette-art.ts`
//!
//! ── Why none of this uses an arc primitive ──────────────────────────────────
//! The oracle's reason survives the port intact. Canvas 2D anti-aliases every
//! path it draws and offers no way to switch that off, so `arc`, `ellipse`,
//! gradients and alpha shading all produce soft fringed edges that read as a
//! blurry PNG pasted into pixel art. There is no path rasteriser here at all,
//! which turns that constraint into the only available design: integer spans
//! on an integer grid.
//!
//! A roulette wheel is nothing BUT circles, so they are rasterised here.
//! [`paint_disc`] walks the scanlines of an ellipse, and for each scanline
//! walks x, asks a `pick` callback for the colour of that pixel, and emits ONE
//! span per run of identical colour. A wheel scanline crosses at most a few
//! dozen pocket boundaries, so a full wheel is a few thousand spans rather than
//! the ~19,000 single-pixel writes a naive loop would emit.
//!
//! ── The isometric projection ────────────────────────────────────────────────
//! Straight axonometric squash. A point at wheel-space angle `a` and normalised
//! radius `r` lands at
//!
//!     x = CX + R*r*cos(a)
//!     y = CY + R*r*sin(a)*FLAT - lift
//!
//! with `FLAT` the vertical foreshortening and `lift` the height of that part of
//! the wheel above the pocket floor in screen pixels. Inverting it
//! (`dyw = (sy - (CY - lift)) / FLAT`) is what lets the rasteriser go the other
//! way and ask "which part of the wheel is this pixel?".
//!
//! ── Depth ───────────────────────────────────────────────────────────────────
//! Painter's algorithm, outside in. The wheel is drawn as NESTED FILLED DISCS
//! from the rim inward, each with a smaller radius and a lower lift, so each one
//! paints over the interior of the last exactly the way a bowl's terraces
//! occlude each other. Then the ball is drawn, and THEN the far half of the rim
//! and lip are repainted as annuli on top, so the far terraces own their pixels
//! against anything drawn after them (see the measured note below — the oracle
//! over-states what this buys, and the correction is worth reading before
//! trusting either header).
//!
//! ── Colour ──────────────────────────────────────────────────────────────────
//! Every ramp is hue-rotated, not lightness-ramped: shadows shift toward blue,
//! highlights toward yellow. A ramp built by dragging a lightness slider makes
//! every material read as grey wearing a colour.
//!
//! ── Why the wheel is BAKED ──────────────────────────────────────────────────
//! Exactly ONE disc depends on the rotor: the pocket ring. The rim, lip, track,
//! apron, cone, turret disc, deflectors and the whole skirt never move, so they
//! are baked ONCE by [`build_wheel_layers`] and composited with [`Pixmap::over`].
//! Three layers rather than one, because the painter's order interleaves them
//! with things that DO move:
//!
//!   base  →  pocket ring  →  numbers  →  mid  →  turret arms  →  ball  →  far
//!
//! `base` is everything under the ring, `mid` everything over the ring but under
//! the ball, and `far` the far-half rim/lip annuli that put the rim back on top
//! of the ball.
//!
//! ⚠ The oracle's header says this is "what makes the ball genuinely disappear
//! behind the far rim as it comes round". MEASURED here, that is not what it
//! does, and the numbers are the same in the oracle: the far annuli cover art
//! radius 0.925..1.0, the ball never exceeds `BALL_TRACK_R` = 0.9, and on screen
//! the rim band sits 7-10px ABOVE the ball at every far angle (at theta =
//! -PI/2, ball y = 13.1, rim band y = 3.8..6.1). A track-radius ball is never
//! occluded. What the split genuinely buys is the ORDERING — the rim's own
//! pixels are never overpainted by the ball's ink halo or its smear, which do
//! reach into the rim band, and the far terraces keep their silhouette against
//! anything drawn between the composites. `the_far_layer_is_never_overpainted`
//! pins that; it is the claim the code can actually keep.
//!
//! ── What this port CANNOT import, and how the numbers stay pinned ───────────
//! `pk-gui` does not depend on `pk-core`, deliberately: the toolkit answers to
//! the browser's own raster, not to the simulation. So the physical constants
//! this art must agree with — the pocket count, `R_POCKET`, the deflector ring —
//! are restated here rather than imported, and the oracle's own warning about
//! restating `DEFL_R` applies with more force:
//!
//!   > a diamond drawn somewhere the ball never scatters is a picture of a
//!   > different wheel, and the two numbers being equal by hand is exactly how
//!   > that drifts.
//!
//! Equal by hand is not good enough, so they are not left to hand: `pk-game`
//! depends on BOTH crates and carries `roulette_art_constants_match_physics`,
//! which fails the moment either side moves. That test is the reason these
//! consts are allowed to exist twice.

use super::pixmap::Pixmap;
use crate::painter::Rgba;

use core::f64::consts::{PI, TAU};

// ── Geometry ──────────────────────────────────────────────────────────────────

/// Wheel centre and size, in UI pixels within the baked box.
pub const CX: f64 = 124.0;
/// Vertical centre.
///
/// THE ONE NUMBER THIS PORT MOVES — the oracle has 102, for a 520x200 cabinet
/// canvas with its own `requestAnimationFrame`. This port's game area is 130px
/// tall (`screens::gambler` explains why: the vendor box gives 322px of sheet
/// and the cabinet also needs a picker, a stake row and a control row, so 200
/// overflows by 38).
///
/// The wheel itself was never 200 tall. Its actual vertical extent is
///
///     2*R*FLAT + RIM_LIFT + SKIRT + 2  =  86.5 + 11 + 13 + 2  =  112.5
///
/// so it fits 130 with room to spare; what did not fit was the EMPTY SPACE the
/// oracle's `CY = 102` puts above the rim. Re-origining is therefore the whole
/// adaptation — every terrace radius, lift and ramp is the oracle's, untouched,
/// and the art is the same art rather than a shrunken copy of it. Scaling `R`
/// instead would have moved every pocket boundary off the integer grid the
/// hand-rasterisation exists to hit.
///
/// Floor: `RIM_LIFT + R*FLAT + 2` = 56.3. At 58 the rim's top row lands at y=4.
pub const CY: f64 = 58.0;
pub const R: f64 = 94.0;
/// Vertical foreshortening. Lower = more of a "looking along the table" view.
pub const FLAT: f64 = 0.46;

/// Radius and screen lift of each terrace, outside in. Painted in this order.
pub const RIM_R: f64 = 1.0;
pub const RIM_LIFT: f64 = 11.0;
pub const LIP_R: f64 = 0.945;
pub const LIP_LIFT: f64 = 8.0;
pub const TRACK_R: f64 = 0.925;
pub const TRACK_LIFT: f64 = 5.0;
pub const APRON_R: f64 = 0.855;
pub const APRON_LIFT: f64 = 2.0;
pub const RING_R: f64 = 0.745;
pub const RING_LIFT: f64 = 0.0;
pub const CONE_R: f64 = 0.5;
pub const CONE_LIFT: f64 = 4.0;
pub const CONE2_R: f64 = 0.37;
pub const CONE2_LIFT: f64 = 9.0;
pub const TURRET_R: f64 = 0.21;
pub const TURRET_LIFT: f64 = 15.0;

/// Where the ball rides when it is up on the track, in ART radius.
///
/// DELIBERATELY NOT the physics model's `R_BALL_TRACK` (which is 1). The two are
/// different quantities and both are correct:
///
///   · `R_BALL_TRACK = 1` is the physics model's NORMALISATION. The simulator
///     works in units where the track is the unit circle, because that is what
///     makes the centripetal-support term read as `omega^2 * r` with no scale
///     factor smeared through it.
///   · `BALL_TRACK_R = 0.9` is where that maps to on screen. Art radius 1.0 is
///     the outer edge of the RIM, and the groove the ball actually runs in is
///     the band `APRON_R..TRACK_R` (0.855..0.925). A ball drawn at art radius
///     1.0 would be riding the mahogany rim, outside the bowl.
///
/// [`draw_wheel`] is where they meet: it remaps physics `[R_POCKET, 1]` onto art
/// `[R_POCKET, BALL_TRACK_R]`. So this is one source of truth for the physical
/// track and one for its projection, not two guesses at the same number — but
/// `BALL_TRACK_R` must stay inside `[APRON_R, TRACK_R]` or the ball leaves the
/// groove.
pub const BALL_TRACK_R: f64 = 0.9;

/// Depth of the bowl's outer wall below the rim, in pixels.
pub const SKIRT: i64 = 13;

// ── Restated physics constants — see the module header, and the pk-game test ──

/// Pockets on this wheel: 0 plus 1..18. Mirrors `pk_core::gambler::roulette`.
pub const POCKETS: usize = 19;
/// Angular width of one pocket, radians.
pub const POCKET_PITCH: f64 = TAU / POCKETS as f64;
/// Normalised radius of a seated ball. Mirrors `roulette_physics::R_POCKET`.
pub const R_POCKET: f64 = 0.66;
/// Deflector ring radius. Mirrors `roulette_physics::R_DEFLECTOR`.
pub const R_DEFLECTOR: f64 = 0.8;
/// Deflectors on the stationary bowl. Mirrors `roulette_physics::DEFLECTORS`.
pub const DEFLECTORS: usize = 8;
/// Angular offset of the first deflector. Mirrors the physics module's own.
pub const DEFL_OFFSET: f64 = 0.21;

// ── The bake box ──────────────────────────────────────────────────────────────

/// Size of the baked layers.
///
/// Cropped to a box that contains the wheel rather than being cabinet-sized, and
/// composited at (0,0) so every coordinate in this file stays ABSOLUTE — which
/// means the bake shares the same [`project`] and [`paint_disc`] as everything
/// drawn live on top of it. A separate local coordinate space is exactly how a
/// baked layer drifts a pixel away from the live art it has to line up with.
///
/// Derived, not chosen — `bake_box_matches_its_derivation` re-computes both:
///
///     BAKE_W = ceil(CX + R) + 4                      = 222
///     BAKE_H = ceil(CY - RIM_LIFT + R*FLAT) + SKIRT + 6 = 110
pub const BAKE_W: usize = 222;
pub const BAKE_H: usize = 110;

// ── Colour ────────────────────────────────────────────────────────────────────

/// Light direction, as a unit vector in wheel space. Upper-left, which is where
/// every other light in the tavern comes from.
pub const LX: f64 = -0.66;
pub const LY: f64 = -0.75;

/// ── Ramps ── ink, shade, base, lite, hi. Cool shadows, warm highlights.
pub const MAHOGANY: [Rgba; 5] = [
    Rgba::hex(0x2a1218),
    Rgba::hex(0x46201c),
    Rgba::hex(0x6b3624),
    Rgba::hex(0x94552f),
    Rgba::hex(0xc08a4e),
];
/// The bowl's outer wall. Deliberately a TIGHT ramp — see [`paint_skirt`].
pub const WALL: [Rgba; 4] = [
    Rgba::hex(0x25121a),
    Rgba::hex(0x331821),
    Rgba::hex(0x442026),
    Rgba::hex(0x572b2c),
];
pub const BRASS: [Rgba; 5] = [
    Rgba::hex(0x3d2f12),
    Rgba::hex(0x6e551d),
    Rgba::hex(0xa8842c),
    Rgba::hex(0xd9b551),
    Rgba::hex(0xffe9a0),
];
pub const STEEL: [Rgba; 5] = [
    Rgba::hex(0x191d2a),
    Rgba::hex(0x2c3242),
    Rgba::hex(0x4a5266),
    Rgba::hex(0x78829a),
    Rgba::hex(0xb6c0d4),
];
pub const GROOVE: [Rgba; 5] = [
    Rgba::hex(0x080a10),
    Rgba::hex(0x0e121c),
    Rgba::hex(0x151a26),
    Rgba::hex(0x1f2634),
    Rgba::hex(0x2c3446),
];
pub const FELT: [Rgba; 5] = [
    Rgba::hex(0x0b1a16),
    Rgba::hex(0x123027),
    Rgba::hex(0x1b4736),
    Rgba::hex(0x286047),
    Rgba::hex(0x3a7d5c),
];

pub const RED: [Rgba; 5] = [
    Rgba::hex(0x3a0c14),
    Rgba::hex(0x66161f),
    Rgba::hex(0xa8323c),
    Rgba::hex(0xc4535c),
    Rgba::hex(0xdc7a80),
];
pub const BLACK: [Rgba; 5] = [
    Rgba::hex(0x06080d),
    Rgba::hex(0x0e1118),
    Rgba::hex(0x1e222c),
    Rgba::hex(0x333a4a),
    Rgba::hex(0x4c5568),
];
pub const GREEN: [Rgba; 5] = [
    Rgba::hex(0x08211a),
    Rgba::hex(0x0f3a28),
    Rgba::hex(0x2e7d4f),
    Rgba::hex(0x46a166),
    Rgba::hex(0x67c184),
];

pub const C_BG: Rgba = Rgba::hex(0x05070b);
pub const C_BALL: Rgba = Rgba::hex(0xdbe3f0);
pub const C_BALL_HI: Rgba = Rgba::hex(0xffffff);
pub const C_BALL_LO: Rgba = Rgba::hex(0x7c8699);
pub const C_BALL_TRAIL: Rgba = Rgba::hex(0x5c6479);
pub const C_WIN: Rgba = Rgba::hex(0xf0c040);
pub const C_WIN_HI: Rgba = Rgba::hex(0xfff0b0);
pub const C_TEXT: Rgba = Rgba::hex(0xc9c1ad);
pub const C_DIM: Rgba = Rgba::hex(0x6f6a5c);
pub const C_PANEL: Rgba = Rgba::hex(0x141824);
pub const C_PANEL_HI: Rgba = Rgba::hex(0x2a3142);

/// Colour of a pocket. Mirrors `pk_core::gambler::roulette::PocketColor`; the
/// caller converts at the crate boundary rather than this crate re-deriving the
/// odd-red/even-black rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PocketColor {
    Red,
    Black,
    Green,
}

impl PocketColor {
    pub fn ramp(self) -> &'static [Rgba; 5] {
        match self {
            PocketColor::Red => &RED,
            PocketColor::Black => &BLACK,
            PocketColor::Green => &GREEN,
        }
    }
}

/// 3x5 digits, one bit per pixel, MSB left. Only 0-9 — that is all a wheel needs.
pub const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b010, 0b010, 0b010],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];

// ── Shading ───────────────────────────────────────────────────────────────────

/// Pick a ramp entry for a pixel.
///
/// Two inputs are combined: how far across its band the pixel sits (`edge`, 0 at
/// the inner edge and 1 at the outer), and how much the surface faces the light.
/// On a wheel the second term is what makes the rim read as round rather than as
/// a flat washer, because it varies with angle all the way around.
pub fn tone(ramp: &[Rgba], nx: f64, ny: f64, edge: f64, bias: f64) -> Rgba {
    let lit = nx * LX + ny * LY;
    let i = (1.6 + lit * 1.5 + edge * 0.9 + bias).round() as i64;
    ramp[i.clamp(0, ramp.len() as i64 - 1) as usize]
}

/// Normalised-band position, 0 at `lo` and 1 at `hi`, clamped.
pub fn edge_of(rr: f64, lo: f64, hi: f64) -> f64 {
    ((rr - lo) / (hi - lo)).clamp(0.0, 1.0)
}

/// The cone's radial terracing. Steps, not a lit sphere.
///
/// These get RADIAL banding with only a weak light term, unlike every other
/// surface. The oracle's first pass shaded them the same way as the rim and the
/// result was a smeared gold blob across the middle of the wheel — a lit sphere,
/// not a turned cone. Concentric steps are what say "machined metal", and the
/// light is left in only strongly enough to keep the near side warmer: blending
/// it smoothly into the step index put a dead straight quantisation edge down
/// the middle of the cone, which read as a seam in the metal. A hard specular
/// patch is a highlight; a soft ramp across the whole cone is a smudge.
pub fn cone_tone(ramp: &[Rgba; 5], rr: f64, lo: f64, hi: f64, nx: f64, ny: f64) -> Rgba {
    let step = (edge_of(rr, lo, hi) * 3.99).floor() as i64;
    let lit = nx * LX + ny * LY;
    let i = step + if lit > 0.5 {
        2
    } else if lit > 0.05 {
        1
    } else {
        0
    };
    ramp[i.clamp(0, 4) as usize]
}

/// Project a wheel-space polar point to screen.
pub fn project(ang: f64, rr: f64, lift: f64) -> (i64, i64) {
    (
        (CX + R * rr * ang.cos()).round() as i64,
        (CY + R * rr * FLAT * ang.sin() - lift).round() as i64,
    )
}

// ── The rasteriser ────────────────────────────────────────────────────────────

/// Colour for a pixel, or `None` to leave it alone.
///
/// Arguments are `(rr, ang, nx, ny)`: normalised radius, wheel-space angle, and
/// the outward unit normal's x/y — the last two are what `tone` lights by.
pub type Pick<'a> = &'a dyn Fn(f64, f64, f64, f64) -> Option<Rgba>;

/// Rasterise an ellipse (or annulus) of the wheel, run-length encoded.
///
/// `outer`/`inner` are normalised wheel radii; `lift` raises the whole terrace up
/// the screen. `far_only` restricts painting to the half of the wheel behind the
/// centre, which is how the rim is put back on top of the ball.
pub fn paint_disc(
    pm: &mut Pixmap,
    outer: f64,
    inner: f64,
    lift: f64,
    pick: Pick,
    far_only: bool,
) {
    let ry = R * outer * FLAT;
    let base_y = CY - lift;
    let y0 = (base_y - ry).floor() as i64;
    let y1 = (base_y + ry).ceil() as i64;
    let outer_r = R * outer;

    for sy in y0..=y1 {
        // Un-project this scanline back into (squash-free) wheel space.
        let dyw = (sy as f64 + 0.5 - base_y) / FLAT;
        if far_only && dyw >= 0.0 {
            break;
        }
        let inside = outer_r * outer_r - dyw * dyw;
        if inside <= 0.0 {
            continue;
        }
        let half_w = inside.sqrt();
        let x0 = (CX - half_w).floor() as i64;
        let x1 = (CX + half_w).ceil() as i64;

        let mut run_colour: Option<Rgba> = None;
        let mut run_start = x0;
        for sx in x0..=x1 {
            let dxw = sx as f64 + 0.5 - CX;
            let d = (dxw * dxw + dyw * dyw).sqrt();
            let rr = d / R;
            let col = if rr <= outer && rr >= inner {
                let inv = if d > 0.0001 { 1.0 / d } else { 0.0 };
                pick(rr, dyw.atan2(dxw), dxw * inv, dyw * inv)
            } else {
                None
            };
            if col != run_colour {
                if let Some(c) = run_colour {
                    pm.span(run_start, sx, sy, c);
                }
                run_colour = col;
                run_start = sx;
            }
        }
        if let Some(c) = run_colour {
            pm.span(run_start, x1 + 1, sy, c);
        }
    }
}

/// The bowl's outer wall. One column at a time, so it shares the rim's silhouette.
fn paint_skirt(pm: &mut Pixmap) {
    let ry_rim = R * FLAT;
    let lo = (CX - R).floor() as i64;
    let hi = (CX + R).ceil() as i64;
    for sx in lo..=hi {
        let dxw = sx as f64 + 0.5 - CX;
        let inside = R * R - dxw * dxw;
        if inside <= 0.0 {
            continue;
        }
        let yb = (CY - RIM_LIFT + (ry_rim * inside.sqrt()) / R).round() as i64;
        // Shade the wall by how far round the cylinder this column is, on its OWN
        // narrow ramp. Two earlier attempts (a left/right split, then the mahogany
        // ramp) both put a hard vertical seam down the middle of the bowl that read
        // as a rendering fault — the tones were simply too far apart to quantise.
        // The row-by-row darkening toward the table is what finally broke the
        // remaining edge up, as well as seating the wheel on the felt.
        let t = dxw / R;
        let lit = (1.5 + t * LX * 2.0 - t.abs() * 1.2).round() as i64;
        let base = lit.clamp(0, 3) as usize;
        // One rect per RUN of identical wall tone rather than one per pixel. The
        // ramp only ever steps once down the column (the last 3 rows darken), so
        // this is 2 rects where a naive loop emitted 13.
        let split = SKIRT - 3;
        pm.fill_rect(sx, yb, 1, split, WALL[base]);
        pm.fill_rect(sx, yb + split, 1, SKIRT - split, WALL[base.saturating_sub(1)]);
        pm.fill_rect(sx, yb + SKIRT, 1, 2, Rgba::hex(0x0c1a15));
    }
}

/// Draw a small integer in the 3x5 font, centred on `x`.
pub fn tiny_number(pm: &mut Pixmap, n: i64, x: i64, y: i64, colour: Rgba) {
    let s = n.to_string();
    let w = s.len() as i64 * 4 - 1;
    let mut px = x - w / 2;
    for ch in s.chars() {
        let Some(d) = ch.to_digit(10) else { continue };
        let glyph = &DIGITS[d as usize];
        for (row, bits) in glyph.iter().enumerate() {
            for c in 0..3u8 {
                if bits & (1 << (2 - c)) != 0 {
                    pm.fill_rect(px + c as i64, y + row as i64, 1, 1, colour);
                }
            }
        }
        px += 4;
    }
}

/// A 5x5 pixel ball: round-ish mask, one highlight pixel, one shadow row.
fn draw_ball(pm: &mut Pixmap, x: i64, y: i64, big: bool) {
    if big {
        // Ink halo first. The ball crosses brass, steel, dark groove and red/black
        // pockets in one orbit, and without an outline it vanishes against at least
        // two of them — it was genuinely hard to find on the brass cone.
        let ink = Rgba::hex(0x07090e);
        pm.fill_rect(x - 3, y - 2, 7, 4, ink);
        pm.fill_rect(x - 2, y - 3, 5, 6, ink);
        pm.fill_rect(x - 2, y - 1, 5, 3, C_BALL_LO);
        pm.fill_rect(x - 1, y - 2, 3, 5, C_BALL_LO);
        pm.fill_rect(x - 1, y - 1, 3, 3, C_BALL);
        pm.fill_rect(x - 2, y, 4, 1, C_BALL);
        pm.fill_rect(x - 1, y - 1, 1, 1, C_BALL_HI);
    } else {
        pm.fill_rect(x - 1, y - 1, 3, 3, C_BALL_LO);
        pm.fill_rect(x - 1, y - 1, 2, 2, C_BALL);
        pm.fill_rect(x - 1, y - 1, 1, 1, C_BALL_HI);
    }
}

/// Screen lift of the ball.
///
/// It has to follow the TERRACE the ball is currently over, not just its own
/// hop height: the track sits 5px above the pocket ring, so a fixed lift left a
/// seated ball floating four pixels clear of its pocket and reading as if it had
/// come to rest on the apron. Interpolating the terrace lift by radius, then
/// adding the hop, seats it properly and still arcs it correctly on the way down.
fn ball_lift(b: &BallView) -> f64 {
    let on_track = (b.radius - R_POCKET) / (1.0 - R_POCKET);
    RING_LIFT + 1.0 + on_track * (TRACK_LIFT - RING_LIFT) + b.height * 7.0
}

// ── The bake ──────────────────────────────────────────────────────────────────

/// The three static layers of the wheel, in painter's order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WheelLayers {
    /// Skirt, rim, lip, track, apron — everything UNDER the pocket ring.
    pub base: Pixmap,
    /// Cone, turret disc, deflectors — over the ring, under the ball.
    pub mid: Pixmap,
    /// Far-half rim and lip annuli — drawn back on top of the ball.
    pub far: Pixmap,
}

/// Bake every part of the wheel that does not move. Call once per cabinet.
pub fn build_wheel_layers() -> WheelLayers {
    // ── base ── skirt first, then the terraces outside in. Each disc paints over
    // the interior of the last, which is the bowl's occlusion.
    let mut base = Pixmap::new(BAKE_W, BAKE_H);
    paint_skirt(&mut base);
    // Rim — mahogany, lit from the upper left.
    paint_disc(&mut base, RIM_R, 0.0, RIM_LIFT, &|rr, _a, nx, ny| {
        Some(tone(&MAHOGANY, nx, ny, edge_of(rr, LIP_R, RIM_R), 0.4))
    }, false);
    // Brass lip — the bright ring that catches the light at the track's edge.
    paint_disc(&mut base, LIP_R, 0.0, LIP_LIFT, &|rr, _a, nx, ny| {
        Some(tone(&BRASS, nx, ny, edge_of(rr, TRACK_R, LIP_R), 0.6))
    }, false);
    // Ball track — a dark polished groove. Darker at its inner edge, which is
    // what makes it read as a channel rather than a flat band.
    paint_disc(&mut base, TRACK_R, 0.0, TRACK_LIFT, &|rr, _a, nx, ny| {
        Some(tone(&GROOVE, nx, ny, edge_of(rr, APRON_R, TRACK_R), 1.1))
    }, false);
    // Apron — the stator's slope, where the deflectors live.
    paint_disc(&mut base, APRON_R, 0.0, APRON_LIFT, &|rr, _a, nx, ny| {
        Some(tone(&STEEL, nx, ny, edge_of(rr, RING_R, APRON_R), 0.0))
    }, false);

    // ── mid ── the brass terraces climbing to the turret, plus the deflectors.
    let mut mid = Pixmap::new(BAKE_W, BAKE_H);
    paint_disc(&mut mid, CONE_R, 0.0, CONE_LIFT, &|rr, _a, nx, ny| {
        Some(cone_tone(&BRASS, rr, CONE2_R, CONE_R, nx, ny))
    }, false);
    paint_disc(&mut mid, CONE2_R, 0.0, CONE2_LIFT, &|rr, _a, nx, ny| {
        Some(cone_tone(&BRASS, rr, TURRET_R, CONE2_R, nx, ny))
    }, false);
    paint_disc(&mut mid, TURRET_R, 0.0, TURRET_LIFT, &|rr, _a, nx, ny| {
        Some(cone_tone(&MAHOGANY, rr, 0.0, TURRET_R, nx, ny))
    }, false);

    // Deflectors — diamonds on the STATIONARY bowl, so no rotor term here. Four
    // of the eight sit lower on screen than the ball's track, and the raised
    // pixel above each one is what sells them as metal standing proud.
    for i in 0..DEFLECTORS {
        let a = (i as f64 / DEFLECTORS as f64) * TAU + DEFL_OFFSET;
        let (px, py) = project(a, R_DEFLECTOR, APRON_LIFT + 2.0);
        let lit = a.cos() * LX + a.sin() * LY > 0.0;
        mid.fill_rect(px - 3, py, 7, 1, BRASS[1]);
        mid.fill_rect(px - 2, py - 1, 5, 1, BRASS[1]);
        mid.fill_rect(px - 2, py + 1, 5, 1, BRASS[1]);
        mid.fill_rect(px - 1, py - 1, 3, 2, if lit { BRASS[4] } else { BRASS[2] });
        mid.fill_rect(px - 1, py + 2, 3, 1, BRASS[0]);
    }

    // ── far ── the depth sort's payoff. Repainting these two annuli over the far
    // half is what makes the ball vanish behind the rim on the far side of the
    // orbit instead of sliding across it.
    let mut far = Pixmap::new(BAKE_W, BAKE_H);
    paint_disc(&mut far, RIM_R, LIP_R, RIM_LIFT, &|rr, _a, nx, ny| {
        Some(tone(&MAHOGANY, nx, ny, edge_of(rr, LIP_R, RIM_R), 0.4))
    }, true);
    paint_disc(&mut far, LIP_R, TRACK_R, LIP_LIFT, &|rr, _a, nx, ny| {
        Some(tone(&BRASS, nx, ny, edge_of(rr, TRACK_R, LIP_R), 0.6))
    }, true);

    WheelLayers { base, mid, far }
}

// ── The live frame ────────────────────────────────────────────────────────────

/// The ball and rotor state this frame.
///
/// A flattening of `pk_core::gambler::roulette_physics::BallFrame`, filled in by
/// `pk-game` at the crate boundary — see the module header on why this crate
/// cannot name that type. `on_track` stands in for `phase == Phase::Track`,
/// because the drop shadow is the only thing that asks and a whole phase enum
/// would be a second definition to keep in step.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BallView {
    /// Ball angle in the world frame, radians.
    pub theta: f64,
    /// Rotor angle in the world frame. The pockets are indexed off this.
    pub rotor: f64,
    /// Normalised radius: 1 = ball track, `R_POCKET` = seated.
    pub radius: f64,
    /// Height above the pocket floor, 0..1.
    pub height: f64,
    /// Ball speed, rad/s. Drives the smear length.
    pub omega: f64,
    /// True while the ball is still up on the banked track.
    pub on_track: bool,
}

impl Default for BallView {
    fn default() -> Self {
        Self {
            theta: 0.0,
            rotor: 0.0,
            radius: 1.0,
            height: 0.0,
            omega: 0.0,
            on_track: true,
        }
    }
}

/// Everything [`draw_wheel`] needs for one frame.
#[derive(Clone, Debug, PartialEq)]
pub struct WheelView {
    pub ball: BallView,
    /// Pocket colours by index, resolved by the caller from `pk_core`.
    pub pockets: [PocketColor; POCKETS],
    /// Pocket to flash gold, or -1.
    pub highlight: i64,
    /// 0..1 flash phase for the highlight, so it can pulse.
    pub flash: f64,
    /// Draw the ball at all — false while idle.
    pub show_ball: bool,
}

/// Map the physics radius onto the art's groove. See [`BALL_TRACK_R`].
fn art_radius(radius: f64) -> f64 {
    let span = (BALL_TRACK_R - R_POCKET) / (1.0 - R_POCKET);
    R_POCKET + (radius - R_POCKET) * span
}

/// Draw the whole wheel into `pm`.
///
/// The order below IS the depth sort; changing it changes what occludes what.
/// Read it top to bottom as "the baked bowl, then the ring that turns, then the
/// baked cone, then the ball, then the baked far rim back on top".
///
/// `layers` comes from [`build_wheel_layers`] and is built once per cabinet.
pub fn draw_wheel(pm: &mut Pixmap, v: &WheelView, layers: &WheelLayers) {
    let b = &v.ball;
    let rotor = b.rotor;

    // ── Bowl ── skirt, rim, lip, track and apron, baked. One composite, no scan.
    pm.over(&layers.base);

    // ── Pocket ring ── the only band whose colour depends on ANGLE, and the only
    // one indexed in the rotor's frame. This is where counter-rotation becomes
    // visible: these colours turn one way, the ball goes the other.
    let fret_half = POCKET_PITCH * 0.11;
    let pockets = &v.pockets;
    let highlight = v.highlight;
    let flash = v.flash;
    paint_disc(pm, RING_R, 0.0, RING_LIFT, &move |rr, ang, nx, ny| {
        let rel = ang - rotor;
        let k = rel / POCKET_PITCH;
        let idx = (k.round() as i64).rem_euclid(POCKETS as i64);
        // Distance to the nearest fret, in radians.
        let off = ((k - k.round()) * POCKET_PITCH).abs();
        let edge = edge_of(rr, CONE_R, RING_R);
        if (off - POCKET_PITCH / 2.0).abs() < fret_half {
            return Some(tone(&BRASS, nx, ny, edge, 0.5));
        }
        if idx == highlight && flash > 0.0 {
            return Some(if flash > 0.5 { C_WIN_HI } else { C_WIN });
        }
        Some(tone(pockets[idx as usize].ramp(), nx, ny, edge, -0.2))
    }, false);

    // ── Pocket numbers ── near half only. On the far half the terraces above
    // them are in the way and the foreshortening leaves under two pixels of
    // height, so they are simply not drawn — the same reason a real wheel's far
    // numbers are unreadable from a seat at the table.
    //
    // Drawn BEFORE the cone composite. Safe because the number ring sits at
    // radius 0.62 and the cone's outer edge is 0.5, so the two can never touch —
    // and it lets the cone and the deflectors share one layer.
    for n in 0..POCKETS as i64 {
        let a = rotor + n as f64 * POCKET_PITCH;
        if a.sin() < 0.22 {
            continue;
        }
        let (px, py) = project(a, (RING_R + CONE_R) / 2.0, RING_LIFT - 1.0);
        let col = if n == v.highlight && v.flash > 0.0 {
            Rgba::hex(0x3a2a06)
        } else {
            Rgba::hex(0xb9c4d6)
        };
        tiny_number(pm, n, px, py - 2, col);
    }

    // ── Cone and deflectors ── baked. Second composite.
    pm.over(&layers.mid);

    // ── Turret ── the four-armed brass handle riding the rotor. It is the
    // clearest read on which way the WHEEL is turning, as opposed to the ball.
    //
    // The arms are sorted by depth and drawn back to front, and each is a flat
    // 2px bar at a CONSTANT lift. The oracle's first version lifted each step of
    // each arm and drew 4px blocks, which merged the four arms into one jagged
    // gold X that read as a corrupted sprite rather than a spinner.
    let mut arms: [f64; 4] = [0, 1, 2, 3].map(|k| rotor + (k as f64 * PI) / 2.0);
    arms.sort_by(|p, q| p.sin().partial_cmp(&q.sin()).unwrap_or(core::cmp::Ordering::Equal));
    const ARM_LIFT: f64 = TURRET_LIFT + 5.0;
    for a in arms {
        let near = a.sin() > 0.0;
        let (tx, ty) = project(a, TURRET_R * 1.85, ARM_LIFT);
        let (rx, ry) = project(a, 0.0, ARM_LIFT);
        let steps = (tx - rx).abs().max((ty - ry).abs());
        for s in 0..=steps {
            let u = if steps == 0 { 0.0 } else { s as f64 / steps as f64 };
            let x = (rx as f64 + (tx - rx) as f64 * u).round() as i64;
            let y = (ry as f64 + (ty - ry) as f64 * u).round() as i64;
            pm.fill_rect(x - 1, y + 1, 3, 1, Rgba::hex(0x16110a));
            pm.fill_rect(x - 1, y - 1, 3, 2, if near { BRASS[4] } else { BRASS[2] });
        }
        pm.fill_rect(tx - 1, ty - 2, 3, 4, BRASS[if near { 3 } else { 1 }]);
    }
    let (hx, hy) = project(0.0, 0.0, ARM_LIFT + 2.0);
    pm.fill_rect(hx - 3, hy - 3, 7, 8, Rgba::hex(0x16110a));
    pm.fill_rect(hx - 2, hy - 2, 5, 5, BRASS[3]);
    pm.fill_rect(hx - 2, hy - 2, 2, 2, BRASS[4]);

    // ── Ball ──
    if v.show_ball {
        let art_r = art_radius(b.radius);
        let lift = ball_lift(b);

        // ── Smear ── a fast ball is a hard bar of dimmer pixels behind it, never
        // a blur and never a lowered alpha. Both of those fringe.
        let speed = b.omega.abs();
        if speed > 7.0 {
            let tail = ((speed - 7.0) / 3.2).round().min(4.0) as i64;
            for i in 1..=tail {
                let (px, py) = project(
                    b.theta - b.omega.signum() * i as f64 * 0.055,
                    art_r,
                    lift,
                );
                pm.fill_rect(px - 1, py - 1, 2, 2, C_BALL_TRAIL);
            }
        }

        // A drop shadow on the ring below, so the height reads while airborne.
        if b.height > 0.05 && !b.on_track {
            let (sx, sy) = project(b.theta, art_r, 0.0);
            pm.fill_rect(sx - 1, sy, 3, 1, Rgba::hex(0x0a0c12));
        }

        let (px, py) = project(b.theta, art_r, lift);
        draw_ball(pm, px, py, true);
    }

    // ── Far rim back on top ── the depth sort's payoff, baked. Third composite.
    pm.over(&layers.far);

    // ── Winner callout ── drawn dead last, so nothing can occlude it.
    //
    // The rotor keeps turning after the ball seats, so roughly half of all wins
    // come to rest on the FAR side of the wheel, where the pocket ring is three
    // pixels tall and its number is not drawn at all. Without this the player
    // watched a four-second spin and then could not see what they had won on the
    // object they had been staring at. A marker pinned to the ball fixes it
    // wherever the ball happens to stop.
    if v.show_ball && v.highlight >= 0 && v.flash > 0.0 {
        let (px, py) = project(b.theta, art_radius(b.radius), ball_lift(b));
        let bob = if v.flash > 0.5 { 0 } else { 1 };
        let ty = py - 17 + bob;
        let w = v.highlight.to_string().len() as i64 * 4 + 5;
        pm.fill_rect(px - w / 2 - 1, ty - 1, w + 2, 9, Rgba::hex(0x0a0c12));
        let face = if v.flash > 0.5 { C_WIN_HI } else { C_WIN };
        pm.fill_rect(px - w / 2, ty, w, 7, face);
        // The tail, so it points AT the ball rather than floating near it.
        pm.fill_rect(px - 1, ty + 7, 3, 2, face);
        pm.fill_rect(px, ty + 9, 1, 2, face);
        tiny_number(pm, v.highlight, px + 1, ty + 1, Rgba::hex(0x2a1f04));
    }
}

/// A fresh cabinet-sized surface with the table's background laid down.
pub fn clear_table(w: usize, h: usize) -> Pixmap {
    let mut pm = Pixmap::new(w, h);
    pm.fill(C_BG);
    pm
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view() -> WheelView {
        WheelView {
            ball: BallView::default(),
            pockets: pockets_for_test(),
            highlight: -1,
            flash: 0.0,
            show_ball: false,
        }
    }

    /// Odd red / even black / 0 green — the rule `pk_core` owns. Restated here
    /// ONLY for tests; production callers convert from `pk_core::PocketColor`.
    fn pockets_for_test() -> [PocketColor; POCKETS] {
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

    #[test]
    fn bake_box_matches_its_derivation() {
        assert_eq!(BAKE_W, (CX + R).ceil() as usize + 4);
        assert_eq!(
            BAKE_H,
            (CY - RIM_LIFT + R * FLAT).ceil() as usize + SKIRT as usize + 6
        );
    }

    /// The whole point of moving `CY`: the wheel has to FIT the 130px game area.
    /// This is the assertion the re-origin exists to satisfy.
    #[test]
    fn the_wheel_fits_the_game_area() {
        const GAME_H: f64 = 130.0; // screens::gambler::GAME_H
        let top = CY - RIM_LIFT - R * FLAT;
        let bottom = CY - RIM_LIFT + R * FLAT + SKIRT as f64 + 2.0;
        assert!(top >= 0.0, "rim clipped at the top: {top}");
        assert!(bottom <= GAME_H, "skirt runs past the game area: {bottom}");
        assert!(BAKE_H as f64 <= GAME_H, "bake box taller than the area");
    }

    /// `BALL_TRACK_R` must stay inside the groove or the ball rides the rim.
    #[test]
    fn the_ball_stays_in_its_groove() {
        assert!(BALL_TRACK_R >= APRON_R && BALL_TRACK_R <= TRACK_R);
        // And the remap's endpoints are the two radii it claims to join.
        assert!((art_radius(1.0) - BALL_TRACK_R).abs() < 1e-9);
        assert!((art_radius(R_POCKET) - R_POCKET).abs() < 1e-9);
    }

    /// The bake actually PAINTS. This is the check the deleted
    /// `RouletteWheelMetrics` roundtrip test could never make: it asserted that
    /// inverting a forward map returns its input, which is true of any invertible
    /// map and stayed green for a module whose draw functions had empty bodies.
    #[test]
    fn every_baked_layer_has_pixels_in_it() {
        let l = build_wheel_layers();
        assert!(l.base.painted() > 8000, "base: {}", l.base.painted());
        assert!(l.mid.painted() > 1000, "mid: {}", l.mid.painted());
        assert!(l.far.painted() > 500, "far: {}", l.far.painted());
    }

    /// `far` covers the far half and NOTHING of the near half.
    ///
    /// The cutoff is per-terrace, not global: `paint_disc` breaks when a
    /// scanline reaches ITS OWN `CY - lift`, so the rim (lift 11) stops at row
    /// 47 and the lip (lift 8) runs to 49. Asserting one shared boundary is how
    /// this test failed first time round — against correct art.
    #[test]
    fn the_far_layer_is_the_far_half_only() {
        let l = build_wheel_layers();
        let lowest = (CY - LIP_LIFT) as usize; // the deepest terrace in `far`
        let mut near = 0;
        for y in lowest..BAKE_H {
            for x in 0..BAKE_W {
                if l.far.pixel(x, y).a != 0 {
                    near += 1;
                }
            }
        }
        assert_eq!(near, 0, "{near} far-layer pixels below row {lowest}");
    }

    #[test]
    fn the_rotor_turns_the_pocket_ring() {
        let layers = build_wheel_layers();
        let mut a = Pixmap::new(BAKE_W, BAKE_H);
        let mut b = Pixmap::new(BAKE_W, BAKE_H);
        let mut va = view();
        draw_wheel(&mut a, &va, &layers);
        va.ball.rotor = POCKET_PITCH * 1.5;
        draw_wheel(&mut b, &va, &layers);
        assert_ne!(a.digest(), b.digest(), "the ring did not move with the rotor");
    }

    /// The ball is drawn only when asked, and moving it changes the frame.
    #[test]
    fn the_ball_is_drawn_and_moves() {
        let layers = build_wheel_layers();
        let mut idle = Pixmap::new(BAKE_W, BAKE_H);
        draw_wheel(&mut idle, &view(), &layers);

        let mut v = view();
        v.show_ball = true;
        v.ball.theta = PI / 2.0; // near half, so the rim cannot hide it
        let mut shown = Pixmap::new(BAKE_W, BAKE_H);
        draw_wheel(&mut shown, &v, &layers);
        assert_ne!(idle.digest(), shown.digest(), "show_ball drew nothing");

        v.ball.theta = PI / 2.0 + 0.6;
        let mut moved = Pixmap::new(BAKE_W, BAKE_H);
        draw_wheel(&mut moved, &v, &layers);
        assert_ne!(shown.digest(), moved.digest(), "the ball did not move");
    }

    /// THE PAYOFF OF THE THREE-LAYER SPLIT: `far` is composited last, so nothing
    /// drawn between the composites can overpaint it.
    ///
    /// This replaces an assertion that a ball on the far side is HIDDEN by the
    /// rim. It is not — see the measurement in the module header — and that test
    /// failed against correct art because it encoded a claim nobody had checked.
    /// The ordering is the property the split actually delivers, and it is the
    /// one that breaks if the composites are ever reordered.
    #[test]
    fn the_far_layer_is_never_overpainted() {
        let layers = build_wheel_layers();
        let mut v = view();
        v.show_ball = true;
        // NO highlight: the winner callout is drawn after the `far` composite ON
        // PURPOSE ("dead last, so nothing can occlude it"), so it is the one
        // thing allowed over the rim. Asserting against it is how this test
        // failed first time round — the exception is the design, not a bug.
        // `the_callout_outranks_the_far_rim` pins that direction separately.
        v.highlight = -1;
        v.flash = 0.0;
        // Sweep the ball right through the far rim's band.
        for i in 0..16 {
            v.ball.theta = -PI + i as f64 * PI / 15.0;
            v.ball.rotor = i as f64 * 0.4;
            v.ball.omega = 20.0; // long smear, which DOES reach the rim band
            let mut pm = Pixmap::new(BAKE_W, BAKE_H);
            draw_wheel(&mut pm, &v, &layers);
            for y in 0..BAKE_H {
                for x in 0..BAKE_W {
                    let f = layers.far.pixel(x, y);
                    if f.a != 0 {
                        assert_eq!(
                            pm.pixel(x, y),
                            f,
                            "far layer overpainted at ({x},{y}), theta step {i}"
                        );
                    }
                }
            }
        }
    }

    /// The callout is drawn when the ball seats on the FAR side — the case it
    /// exists for, where the pocket ring is three pixels tall and its number is
    /// not drawn at all.
    ///
    /// It does NOT assert the callout overpaints the far rim. It is composited
    /// after `far`, but the two do not overlap on screen: at theta = -PI/2 the
    /// rim band is rows 4..6 and the callout box is rows 11..23. Two drafts of
    /// this test asserted that overlap and failed against correct art — the
    /// same mistake as the "ball hidden behind the rim" claim in the header.
    /// Code order is not screen overlap, and only the second one is visible.
    #[test]
    fn the_callout_is_drawn_when_the_ball_seats_on_the_far_side() {
        let layers = build_wheel_layers();
        let mut v = view();
        v.show_ball = true;
        v.ball.theta = -PI / 2.0; // far side
        v.ball.radius = R_POCKET; // seated
        v.highlight = 12;

        v.flash = 0.0;
        let mut without = Pixmap::new(BAKE_W, BAKE_H);
        draw_wheel(&mut without, &v, &layers);
        v.flash = 0.9;
        let mut with = Pixmap::new(BAKE_W, BAKE_H);
        draw_wheel(&mut with, &v, &layers);

        assert_ne!(
            without.digest(),
            with.digest(),
            "the callout drew nothing on the far side — where it is needed most"
        );
        // And it is legible: the gold plate, not one stray pixel.
        let gold = (0..BAKE_H)
            .flat_map(|y| (0..BAKE_W).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let p = with.pixel(x, y);
                p == C_WIN || p == C_WIN_HI
            })
            .count();
        assert!(gold > 40, "callout is only {gold} gold pixels");
    }

    /// Every pocket index is reachable and lands on its own colour — the ring
    /// really is 19 pockets and not a smear.
    #[test]
    fn the_ring_shows_all_nineteen_pockets() {
        let layers = build_wheel_layers();
        let mut seen = std::collections::BTreeSet::new();
        for p in 0..POCKETS {
            let mut v = view();
            v.ball.rotor = p as f64 * POCKET_PITCH;
            let mut pm = Pixmap::new(BAKE_W, BAKE_H);
            draw_wheel(&mut pm, &v, &layers);
            seen.insert(pm.digest());
        }
        assert_eq!(seen.len(), POCKETS, "two rotor positions rendered identically");
    }

    /// The highlight actually paints gold somewhere, and pulses between its two
    /// faces rather than being a single static colour.
    #[test]
    fn the_winning_pocket_flashes() {
        let layers = build_wheel_layers();
        let mut v = view();
        v.show_ball = true;
        v.ball.theta = PI / 2.0;
        v.ball.radius = R_POCKET;
        v.highlight = 7;

        v.flash = 0.9;
        let mut hi = Pixmap::new(BAKE_W, BAKE_H);
        draw_wheel(&mut hi, &v, &layers);
        v.flash = 0.2;
        let mut lo = Pixmap::new(BAKE_W, BAKE_H);
        draw_wheel(&mut lo, &v, &layers);
        assert_ne!(hi.digest(), lo.digest(), "the flash does not pulse");

        let gold = (0..BAKE_H)
            .flat_map(|y| (0..BAKE_W).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let p = hi.pixel(x, y);
                p == C_WIN || p == C_WIN_HI
            })
            .count();
        assert!(gold > 20, "only {gold} gold pixels — the callout is missing");
    }

    #[test]
    fn tone_clamps_to_its_ramp_and_never_panics() {
        // WALL is the short ramp; a bias that overruns must clamp, not index out.
        assert_eq!(tone(&WALL, 0.0, 0.0, 1.0, 99.0), WALL[3]);
        assert_eq!(tone(&WALL, 0.0, 0.0, 0.0, -99.0), WALL[0]);
        assert_eq!(tone(&MAHOGANY, 0.0, 0.0, 1.0, 99.0), MAHOGANY[4]);
    }

    #[test]
    fn tiny_number_draws_multi_digit_values() {
        let mut pm = Pixmap::new(40, 12);
        tiny_number(&mut pm, 18, 20, 3, Rgba::hex(0xffffff));
        assert!(pm.painted() > 8, "18 drew {} pixels", pm.painted());
        let mut single = Pixmap::new(40, 12);
        tiny_number(&mut single, 8, 20, 3, Rgba::hex(0xffffff));
        assert_ne!(pm.digest(), single.digest());
    }

    /// Nothing may be drawn outside the bake box. A span that wrapped a row, or
    /// a lift that ran the skirt off the bottom, shows up here.
    #[test]
    fn the_wheel_stays_inside_the_bake_box() {
        let layers = build_wheel_layers();
        let mut v = view();
        v.show_ball = true;
        v.ball.radius = 1.0;
        for i in 0..24 {
            v.ball.theta = i as f64 * TAU / 24.0;
            v.ball.rotor = -(i as f64) * 0.3;
            let mut pm = Pixmap::new(BAKE_W, BAKE_H);
            draw_wheel(&mut pm, &v, &layers);
            // Column 0 and the last column are outside the rim's silhouette
            // (the rim spans x 30..218), so they must never be painted.
            for y in 0..BAKE_H {
                assert_eq!(pm.pixel(0, y).a, 0, "painted the left margin at y={y}");
                assert_eq!(
                    pm.pixel(BAKE_W - 1, y).a,
                    0,
                    "painted the right margin at y={y}"
                );
            }
        }
    }
}
