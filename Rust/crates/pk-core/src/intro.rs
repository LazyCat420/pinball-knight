//! Intro title sequence — the deterministic core of legacy `intro/`.
//!
//! Ports `intro/title-grid.ts` (the letterform maze + ricochet sim),
//! `intro/clock.ts` (the two-clock split), the phase choreography and camera
//! path constants from `intro/index.ts`, and the skip gate that
//! `intro/entry.test.ts` pins. The Bevy shell (`pk-game/src/intro.rs`) is a
//! view over this module and owns nothing that ticks.
//!
//! PORTS: `intro/title-grid.ts`, `intro/clock.ts`, `intro/index.ts`

use crate::collide::move_circle;
use crate::grid::{Grid, T_FLOOR, T_WALL};
use crate::jsmath::js_hypot;

// ── Title font (title-grid.ts) ──────────────────────────────────────

/// 5-row pixel glyphs for the ten letters the title needs. Strokes are 1 tile —
/// the same thickness as every real maze wall, so the letters render with the
/// standard wall boxes and read as dungeon architecture, not signage.
pub const GLYPH_H: i32 = 5;

pub fn title_glyph(ch: char) -> &'static [&'static str; 5] {
    match ch {
        'P' => &["###.", "#..#", "###.", "#...", "#..."],
        'I' => &["###", ".#.", ".#.", ".#.", "###"],
        'N' => &["#..#", "##.#", "#.##", "#..#", "#..#"],
        'B' => &["###.", "#..#", "###.", "#..#", "###."],
        'A' => &[".##.", "#..#", "####", "#..#", "#..#"],
        'L' => &["#...", "#...", "#...", "#...", "####"],
        'K' => &["#..#", "#.#.", "##..", "#.#.", "#..#"],
        'G' => &[".###", "#...", "#.##", "#..#", ".##."],
        'H' => &["#..#", "#..#", "####", "#..#", "#..#"],
        'T' => &["###", ".#.", ".#.", ".#.", ".#."],
        _ => panic!("title font has no glyph for {ch:?}"),
    }
}

pub const WORD_TOP: &str = "PINBALL";
pub const WORD_BOTTOM: &str = "KNIGHT";
const LETTER_GAP: i32 = 1; // tiles between letters
const WORD_GAP: i32 = 3; // floor rows between the two words — the bounce lane
const PAD: i32 = 3; // open floor between letters and the border wall

fn word_width(word: &str) -> i32 {
    let mut w = 0;
    for ch in word.chars() {
        w += title_glyph(ch)[0].len() as i32 + LETTER_GAP;
    }
    w - LETTER_GAP
}

pub struct TitleLayout {
    pub grid: Grid,
    /// Where the knight materialises after the 2D world shatters.
    pub spawn: (f64, f64),
    /// World-space centre of the title block — the camera's final target.
    pub center: (f64, f64),
    /// Tile origin (top-left) of each word, for tests and framing.
    pub top_word_origin: (i32, i32),
    pub bottom_word_origin: (i32, i32),
}

/// Stamp one glyph's wall tiles at tile origin (i0, j0).
fn stamp_glyph(g: &mut Grid, glyph: &[&str; 5], i0: i32, j0: i32) {
    for (r, row) in glyph.iter().enumerate() {
        for (c, ch) in row.bytes().enumerate() {
            if ch == b'#' {
                g.t[((j0 + r as i32) * g.w + (i0 + c as i32)) as usize] = T_WALL;
            }
        }
    }
}

fn stamp_word(g: &mut Grid, word: &str, i0: i32, j0: i32) {
    let mut i = i0;
    for ch in word.chars() {
        let glyph = title_glyph(ch);
        stamp_glyph(g, glyph, i, j0);
        i += glyph[0].len() as i32 + LETTER_GAP;
    }
}

/// Build the title maze: a sealed floor arena with the two words standing as
/// wall strokes. Everything outside the letters is open floor, so the ricochet
/// threads between and around the letterforms.
pub fn build_title_grid() -> TitleLayout {
    let top_w = word_width(WORD_TOP);
    let bottom_w = word_width(WORD_BOTTOM);
    let w = top_w + 2 * PAD + 2; // +2 = the border walls themselves
    let h = GLYPH_H * 2 + WORD_GAP + 2 * PAD + 2;

    let n = (w * h) as usize;
    let mut grid = Grid {
        w,
        h,
        t: vec![T_FLOOR; n],
        shapes: vec![0; n], // all SHAPE_FULL
        surfaces: None,
        arcs: Vec::new(),
        arc_idx: None,
    };

    // Sealed border ring.
    for i in 0..w {
        grid.t[i as usize] = T_WALL;
        grid.t[((h - 1) * w + i) as usize] = T_WALL;
    }
    for j in 0..h {
        grid.t[(j * w) as usize] = T_WALL;
        grid.t[(j * w + (w - 1)) as usize] = T_WALL;
    }

    let top_word_origin = (1 + PAD, 1 + PAD);
    // Bottom word centred under the top one.
    let bottom_word_origin = (
        1 + PAD + (top_w - bottom_w).div_euclid(2),
        1 + PAD + GLYPH_H + WORD_GAP,
    );
    stamp_word(&mut grid, WORD_TOP, top_word_origin.0, top_word_origin.1);
    stamp_word(
        &mut grid,
        WORD_BOTTOM,
        bottom_word_origin.0,
        bottom_word_origin.1,
    );

    // Spawn in the open lane between the words, left of centre — tile centres
    // (maze world space puts tile (i,j) centre at i+0.5-w/2).
    let spawn_i = 1 + PAD;
    let spawn_j = 1 + PAD + GLYPH_H + WORD_GAP.div_euclid(2);
    TitleLayout {
        spawn: (
            f64::from(spawn_i) + 0.5 - f64::from(w) / 2.0,
            f64::from(spawn_j) + 0.5 - f64::from(h) / 2.0,
        ),
        center: (0.0, 0.0),
        top_word_origin,
        bottom_word_origin,
        grid,
    }
}

// ── Ricochet sim (title-grid.ts) ────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct IntroBall {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
}

pub const INTRO_BALL_R: f64 = 0.3; // PLAYER_R — same footprint as the knight
pub const INTRO_BALL_SPEED: f64 = 15.0; // u/s — pinball-fast, still trackable

impl IntroBall {
    /// The launch `runPinballIntro` gives the ball: direction (0.84, 0.55)
    /// normalised to `INTRO_BALL_SPEED`.
    pub fn at_spawn(layout: &TitleLayout) -> Self {
        let (vx, vz) = (0.84, 0.55);
        let n = js_hypot(vx, vz);
        Self {
            x: layout.spawn.0,
            z: layout.spawn.1,
            vx: (vx / n) * INTRO_BALL_SPEED,
            vz: (vz / n) * INTRO_BALL_SPEED,
        }
    }
}

/// Advance the ball one step against the REAL collision sweep. Reflection
/// follows entities/player.ts precedence: a slant contact normal wins
/// (v − 2(v·n)n), else the blocked axis flips. Speed is re-normalised every
/// step — the intro ball never bleeds energy; it careens until told to stop.
///
/// Returns true when a wall was struck this step (for the bumper sting).
pub fn step_intro_ball(g: &Grid, b: &mut IntroBall, dt: f64) -> bool {
    let dx = b.vx * dt;
    let dz = b.vz * dt;
    let res = move_circle(g, b.x, b.z, INTRO_BALL_R, dx, dz);
    let mut bounced = false;

    if let Some((nx, nz)) = res.hit_n {
        let dot = b.vx * nx + b.vz * nz;
        if dot < 0.0 {
            b.vx -= 2.0 * dot * nx;
            b.vz -= 2.0 * dot * nz;
            bounced = true;
        }
    } else {
        // Axis clamp: the sweep resolved short of the requested move → that
        // axis hit a square wall face. Flip it.
        if (res.x - (b.x + dx)).abs() > 1e-6 {
            b.vx = -b.vx;
            bounced = true;
        }
        if (res.z - (b.z + dz)).abs() > 1e-6 {
            b.vz = -b.vz;
            bounced = true;
        }
    }

    b.x = res.x;
    b.z = res.z;

    // Constant energy, and a guard against ever settling into a pure-axis path
    // that could shuttle in a 1-tile slot forever: keep both components alive.
    let speed = {
        let s = js_hypot(b.vx, b.vz);
        if s == 0.0 {
            1.0
        } else {
            s
        }
    };
    b.vx = (b.vx / speed) * INTRO_BALL_SPEED;
    b.vz = (b.vz / speed) * INTRO_BALL_SPEED;
    // `Math.sign(v || 1)`: JS treats ±0 as falsy, so a dead axis restarts
    // positive.
    let sign = |v: f64| if v == 0.0 { 1.0 } else { v.signum() };
    if b.vx.abs() < INTRO_BALL_SPEED * 0.08 {
        b.vx = sign(b.vx) * INTRO_BALL_SPEED * 0.08;
    }
    if b.vz.abs() < INTRO_BALL_SPEED * 0.08 {
        b.vz = sign(b.vz) * INTRO_BALL_SPEED * 0.08;
    }
    bounced
}

// ── The two clocks (clock.ts) ───────────────────────────────────────
//
// THE INTRO HAS TWO CLOCKS, AND MERGING THEM MAKES IT FOUR TIMES TOO LONG.
// The choreography is authored in seconds and must advance by REAL time; the
// ball simulation needs its delta CLAMPED or one long frame tunnels it through
// a letterform. One number served both once, and the intro's LENGTH became a
// function of the frame rate (11.4s authored, 22s measured live). A starved
// frame CATCHES UP rather than stretching — the sequence may skip animation,
// but it ends when it says it does.

/// Longest step the ball simulation may take. Above this it tunnels walls.
pub const SIM_DT_CLAMP: f64 = 0.05;

/// The shatter's fixed integration step — the oracle's rAF interval.
///
/// `paintShatter` advances its pieces with semi-implicit Euler
/// (`vy += 1500·dt; y += vy·dt`), and that is STEP-SIZE DEPENDENT: the same
/// elapsed time split into a different number of steps lands the shards
/// somewhere else. The oracle is driven by a rAF timestamp and therefore always
/// steps in 1/60ths; a wasm build rendering at 22-32 ms was giving the same
/// 0.45 s to ~15 steps of ~0.030 rather than 27 of 0.0167, putting a
/// representative shard 6.7% further down the screen — an error that moved with
/// the frame rate, so the phase was not reproducible across machines either.
pub const SHATTER_STEP: f64 = 1.0 / 60.0;

#[derive(Debug, PartialEq)]
pub struct IntroDeltas {
    /// Real elapsed seconds. Drives the phase clock and its edge triggers.
    pub pdt: f64,
    /// Clamped seconds. Drives the ball, the shatter and the screen shake.
    pub dt: f64,
}

/// `now`/`last_now` in ms. A negative `last_now` yields a zero step — the
/// origin is stamped by the FIRST TICK, not at construction, so setup work
/// between construction and frame one is not spent from the sequence.
pub fn intro_deltas(now: f64, last_now: f64) -> IntroDeltas {
    if last_now < 0.0 {
        return IntroDeltas { pdt: 0.0, dt: 0.0 };
    }
    let pdt = ((now - last_now) / 1000.0).max(0.0);
    IntroDeltas {
        pdt,
        dt: pdt.min(SIM_DT_CLAMP),
    }
}

// ── Choreography (index.ts) ─────────────────────────────────────────

pub const RUN_DUR: f64 = 2.3; // sprint, jump at the end…
pub const JUMP_T: f64 = 1.55; // …launching here, smooth arc into question block
pub const BONK_DUR: f64 = 0.35; // hitstop freeze
pub const SHATTER_DUR: f64 = 0.95; // the 2D world falls apart
pub const SWEEP_DUR: f64 = 5.2; // camera tilts up + pulls out
pub const TITLE_DUR: f64 = 2.6; // hold on the full title

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntroPhase {
    Run,
    Bonk,
    Shatter,
    Sweep,
    Title,
}

impl IntroPhase {
    /// The `__dungeonIntroPhase` string the legacy probe published.
    pub fn name(self) -> &'static str {
        match self {
            IntroPhase::Run => "run",
            IntroPhase::Bonk => "bonk",
            IntroPhase::Shatter => "shatter",
            IntroPhase::Sweep => "sweep",
            IntroPhase::Title => "title",
        }
    }
}

/// Edge-triggered moments the shell reacts to (sfx stings, shake, snapshot,
/// title reveal, teardown) — the side effects of index.ts's tick switch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntroCue {
    /// `pt` crossed JUMP_T inside the run phase — the roll sting.
    Roll,
    /// run → bonk: shake = 1, break + coin stings.
    BonkStart,
    /// bonk → shatter: snapshot the 2D canvas and break it into pieces.
    ShatterStart,
    /// shatter → sweep: clear the 2D canvas.
    SweepStart,
    /// sweep → title: show the title + PRESS ANY KEY.
    TitleStart,
    /// title held its duration — fade and hand off.
    Finish,
}

/// The phase clock. `advance` mirrors index.ts's tick: `pt` accumulates REAL
/// seconds, each phase rolls into the next when its duration elapses (overflow
/// is dropped, as upstream), and at most one transition happens per tick.
pub struct IntroSeq {
    pub phase: IntroPhase,
    /// Time within the current phase, seconds.
    pub pt: f64,
}

impl Default for IntroSeq {
    fn default() -> Self {
        Self::new()
    }
}

impl IntroSeq {
    pub fn new() -> Self {
        Self {
            phase: IntroPhase::Run,
            pt: 0.0,
        }
    }

    pub fn advance(&mut self, pdt: f64, cues: &mut Vec<IntroCue>) {
        self.pt += pdt;
        match self.phase {
            IntroPhase::Run => {
                // Edge-detected against the delta `pt` actually moved by, or a
                // caught-up frame steps clean over the trigger and the sound
                // never plays.
                if self.pt >= JUMP_T && self.pt - pdt < JUMP_T {
                    cues.push(IntroCue::Roll);
                }
                if self.pt >= RUN_DUR {
                    self.phase = IntroPhase::Bonk;
                    self.pt = 0.0;
                    cues.push(IntroCue::BonkStart);
                }
            }
            IntroPhase::Bonk => {
                if self.pt >= BONK_DUR {
                    self.phase = IntroPhase::Shatter;
                    self.pt = 0.0;
                    cues.push(IntroCue::ShatterStart);
                }
            }
            IntroPhase::Shatter => {
                if self.pt >= SHATTER_DUR {
                    self.phase = IntroPhase::Sweep;
                    self.pt = 0.0;
                    cues.push(IntroCue::SweepStart);
                }
            }
            IntroPhase::Sweep => {
                if self.pt >= SWEEP_DUR {
                    self.phase = IntroPhase::Title;
                    self.pt = 0.0;
                    cues.push(IntroCue::TitleStart);
                }
            }
            IntroPhase::Title => {
                if self.pt >= TITLE_DUR {
                    cues.push(IntroCue::Finish);
                }
            }
        }
    }
}

// ── Camera path (index.ts) ──────────────────────────────────────────
//
// Side-on and tight (reads as the 2D plane) → isometric-ish and wide. Final
// yaw is a taste call: 0 keeps the words dead-horizontal, 18° restores the
// diamond feel while the text stays perfectly legible.

pub const TILT_FROM: f64 = 7.0 * std::f64::consts::PI / 180.0;
pub const TILT_TO: f64 = 38.0 * std::f64::consts::PI / 180.0;
pub const YAW_FROM: f64 = 0.0;
pub const YAW_TO: f64 = 18.0 * std::f64::consts::PI / 180.0;
pub const ZOOM_FROM: f64 = 2.3;

pub fn smoothstep01(u: f64) -> f64 {
    let t = u.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The zoom that frames the whole title grid at the FINAL tilt/yaw — legacy
/// `fitZoom`. `half_w`/`half_h` are the camera's unzoomed ortho half-extents;
/// `wall_h` is the wall box height (constants/world.ts WALL_H).
pub fn fit_zoom(grid_w: f64, grid_h: f64, wall_h: f64, half_w: f64, half_h: f64) -> f64 {
    // offsetFor(TILT_TO, YAW_TO), then dir = -offset normalised. The camera
    // distance cancels out of the dot products' maxima ordering, but keep the
    // exact construction anyway.
    const CAMERA_DIST: f64 = 24.0; // legacy constants/render.ts
    let horiz = TILT_TO.cos() * CAMERA_DIST;
    let off = (
        YAW_TO.sin() * horiz,
        TILT_TO.sin() * CAMERA_DIST,
        YAW_TO.cos() * horiz,
    );
    let len = (off.0 * off.0 + off.1 * off.1 + off.2 * off.2).sqrt();
    let dir = (-off.0 / len, -off.1 / len, -off.2 / len);
    let right = (YAW_TO.cos(), 0.0, -YAW_TO.sin());
    // up = right × dir, normalised.
    let up = (
        right.1 * dir.2 - right.2 * dir.1,
        right.2 * dir.0 - right.0 * dir.2,
        right.0 * dir.1 - right.1 * dir.0,
    );
    let ulen = (up.0 * up.0 + up.1 * up.1 + up.2 * up.2).sqrt();
    let up = (up.0 / ulen, up.1 / ulen, up.2 / ulen);

    let mut hw: f64 = 0.0;
    let mut hh: f64 = 0.0;
    for px in [-grid_w / 2.0, grid_w / 2.0] {
        for pz in [-grid_h / 2.0, grid_h / 2.0] {
            for py in [0.0, wall_h] {
                let v = (px, py, pz);
                hw = hw.max((v.0 * right.0 + v.1 * right.1 + v.2 * right.2).abs());
                hh = hh.max((v.0 * up.0 + v.1 * up.1 + v.2 * up.2).abs());
            }
        }
    }
    (half_w / (hw + 1.5)).min(half_h / (hh + 2.2))
}

pub struct IntroCamPose {
    pub tilt: f64,
    pub yaw: f64,
    pub zoom: f64,
    pub target: (f64, f64),
}

/// Legacy `aimIntroCamera`: smooth the sweep, interpolate tilt/yaw linearly,
/// zoom logarithmically, and slide the look-target from the ball to the title
/// block's centre.
pub fn aim_intro_camera(
    sweep_u: f64,
    ball: (f64, f64),
    center: (f64, f64),
    fit: f64,
) -> IntroCamPose {
    let u = smoothstep01(sweep_u);
    IntroCamPose {
        tilt: TILT_FROM + (TILT_TO - TILT_FROM) * u,
        yaw: YAW_FROM + (YAW_TO - YAW_FROM) * u,
        zoom: (ZOOM_FROM.ln() + (fit.ln() - ZOOM_FROM.ln()) * u).exp(),
        target: (
            ball.0 + (center.0 - ball.0) * u,
            ball.1 + (center.1 - ball.1) * u,
        ),
    }
}

// ── The skip gate (index.ts shouldSkipIntro / entry.test.ts) ────────

/// Who does NOT see the title intro. `?autostart=1` is the harness entry
/// (playtest bots and pk-check) — an 11-second sequence in front of it eats
/// the bot's input. `?no-intro=1` is the documented opt-out. `skip_flag` is
/// the `__skipDungeonIntro` escape hatch, `reduced_motion` honours
/// prefers-reduced-motion, and `played` makes it ONCE PER LAUNCH — a title
/// on the second entry of one visit is a sequence you sit through rather
/// than watch. Deliberately not persisted: a saved flag would mean nobody
/// ever sees it again, including whoever has to change it.
pub fn should_skip_intro(
    search: &str,
    skip_flag: bool,
    reduced_motion: bool,
    played: bool,
) -> bool {
    if played || skip_flag || reduced_motion {
        return true;
    }
    let q = search.strip_prefix('?').unwrap_or(search);
    q.split('&')
        .any(|kv| kv == "no-intro=1" || kv == "autostart=1")
}

// ── Tests: ported from intro/*.test.ts ──────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collide::circle_collides;
    use crate::grid::{at, is_walkable};

    /// WHY THE INTRO SHIPPED 1.714× TOO CLOSE AND ITS OWN A/B SAID IT WAS FINE.
    ///
    /// The shell used to hand `fit_zoom` the `VIEW_H` config default (20 × 11.25
    /// at 16:9) while legacy hands it the live lattice frustum
    /// (`renderW/PPU × renderH/PPU`, 34.29 × 19.29 at 1920×1080 and PPU 56).
    ///
    /// `fit_zoom`'s margins — `+1.5` and `+2.2` — are world-unit constants in
    /// the DENOMINATOR, so scaling both half-extents by k scales `fit` by
    /// exactly k. The visible world height is `frustum_h / zoom`, so at
    /// `sweep_u = 1`, where `zoom == fit`, the k cancels TO THE LAST BIT and
    /// both frustums render an identical title. At `sweep_u = 0` the zoom is the
    /// absolute constant [`ZOOM_FROM`], nothing cancels, and the error is the
    /// full k.
    ///
    /// That asymmetry is the whole story of the A/B table: `title` measured 13.3
    /// (correct), `sweep` 25.3 and `shatter` 60.7 — ranked by how little of the
    /// interpolation each phase had run. **A defect that vanishes at one end of
    /// an interpolation reads as a small defect and is not one.**
    ///
    /// This test would have failed against the shipped code the moment anyone
    /// asked it the `sweep_u = 0` question, and it is kept HERE — in pk-core,
    /// with no Bevy — so it survives whatever the shell does to its camera next.
    #[test]
    fn the_title_zoom_cancels_the_frustum_and_the_shatter_zoom_cannot() {
        let layout = build_title_grid();
        let (gw, gh) = (f64::from(layout.grid.w), f64::from(layout.grid.h));
        const WALL_H: f64 = 1.0; // constants/world.ts, as the shell passes it

        // The two frustums, at the one matched regime the A/B rigs photograph.
        const PPU: f64 = 56.0;
        let pinned = (11.25 * (16.0 / 9.0) / 2.0, 11.25 / 2.0); // the defect
        let lattice = (1920.0 / PPU / 2.0, 1080.0 / PPU / 2.0); // the oracle
        let k = lattice.1 / pinned.1;
        assert!((k - 1920.0 / PPU / 20.0).abs() < 1e-12, "k = {k}");
        assert!((k - 1.714_285_714_285_714_2).abs() < 1e-12, "k = {k}");
        // Both axes scale by the SAME k, which is what makes `min` scale by it.
        assert!((lattice.0 / pinned.0 - k).abs() < 1e-12);

        let fit_pinned = fit_zoom(gw, gh, WALL_H, pinned.0, pinned.1);
        let fit_lattice = fit_zoom(gw, gh, WALL_H, lattice.0, lattice.1);
        assert!(
            (fit_lattice - k * fit_pinned).abs() < 1e-12,
            "fit_zoom must scale linearly with the half-extents: \
             {fit_lattice} vs {}",
            k * fit_pinned
        );

        // Visible world height = frustum height / zoom.
        let vis = |half_h: f64, zoom: f64| 2.0 * half_h / zoom;

        // sweep_u = 1 — the title. The two frustums AGREE, exactly.
        let title_pinned = vis(
            pinned.1,
            aim_intro_camera(1.0, (0.0, 0.0), (0.0, 0.0), fit_pinned).zoom,
        );
        let title_lattice = vis(
            lattice.1,
            aim_intro_camera(1.0, (0.0, 0.0), (0.0, 0.0), fit_lattice).zoom,
        );
        assert!(
            (title_pinned - title_lattice).abs() < 1e-9,
            "the title phase cannot tell the two frustums apart: \
             {title_pinned} vs {title_lattice}"
        );

        // sweep_u = 0 — the shatter. The pinned frustum shows k times LESS
        // world, i.e. everything on screen is k times bigger.
        let shatter_pinned = vis(
            pinned.1,
            aim_intro_camera(0.0, (0.0, 0.0), (0.0, 0.0), fit_pinned).zoom,
        );
        let shatter_lattice = vis(
            lattice.1,
            aim_intro_camera(0.0, (0.0, 0.0), (0.0, 0.0), fit_lattice).zoom,
        );
        assert!(
            (shatter_lattice / shatter_pinned - k).abs() < 1e-9,
            "the shatter phase is off by the full frustum ratio: {} vs {k}",
            shatter_lattice / shatter_pinned
        );

        // And the error decays monotonically across the sweep, which is the
        // shape the A/B table reports. Checked, not asserted by narrative.
        let mut prev = f64::INFINITY;
        for step in 0..=10 {
            let u = f64::from(step) / 10.0;
            let ratio = vis(
                lattice.1,
                aim_intro_camera(u, (0.0, 0.0), (0.0, 0.0), fit_lattice).zoom,
            ) / vis(
                pinned.1,
                aim_intro_camera(u, (0.0, 0.0), (0.0, 0.0), fit_pinned).zoom,
            );
            assert!(ratio <= prev + 1e-12, "u={u}: {ratio} rose above {prev}");
            assert!(ratio >= 1.0 - 1e-9, "u={u}: {ratio} fell below 1");
            prev = ratio;
        }
        assert!((prev - 1.0).abs() < 1e-9, "it must land at 1.0, not {prev}");
    }

    fn ascii(g: &Grid) -> String {
        let mut out = String::new();
        for j in 0..g.h {
            for i in 0..g.w {
                out.push(if at(g, i, j) == T_WALL { '#' } else { '.' });
            }
            out.push('\n');
        }
        out
    }

    // title-grid.test.ts — "intro title grid"

    #[test]
    fn seals_the_border_completely() {
        let g = build_title_grid().grid;
        for i in 0..g.w {
            assert_eq!(at(&g, i, 0), T_WALL);
            assert_eq!(at(&g, i, g.h - 1), T_WALL);
        }
        for j in 0..g.h {
            assert_eq!(at(&g, 0, j), T_WALL);
            assert_eq!(at(&g, g.w - 1, j), T_WALL);
        }
    }

    #[test]
    fn stamps_the_p_of_pinball_exactly_where_the_layout_says() {
        let layout = build_title_grid();
        let g = &layout.grid;
        let glyph = title_glyph('P');
        let (i0, j0) = layout.top_word_origin;
        for r in 0..GLYPH_H {
            let row = glyph[r as usize].as_bytes();
            for (c, ch) in row.iter().enumerate() {
                let want = if *ch == b'#' { T_WALL } else { T_FLOOR };
                assert_eq!(
                    at(g, i0 + c as i32, j0 + r),
                    want,
                    "P glyph tile ({c},{r})\n{}",
                    ascii(g)
                );
            }
        }
    }

    #[test]
    fn stamps_the_t_of_knight_at_the_bottom_word_origin() {
        // T is the last letter — walk the origins forward across K,N,I,G,H.
        let layout = build_title_grid();
        let g = &layout.grid;
        let mut i0 = layout.bottom_word_origin.0;
        for ch in "KNIGH".chars() {
            i0 += title_glyph(ch)[0].len() as i32 + 1;
        }
        let glyph = title_glyph('T');
        let j0 = layout.bottom_word_origin.1;
        for r in 0..GLYPH_H {
            let row = glyph[r as usize].as_bytes();
            for (c, ch) in row.iter().enumerate() {
                let want = if *ch == b'#' { T_WALL } else { T_FLOOR };
                assert_eq!(at(g, i0 + c as i32, j0 + r), want, "T glyph tile ({c},{r})");
            }
        }
    }

    #[test]
    fn spawns_the_ball_on_clear_floor_with_room_to_move() {
        let layout = build_title_grid();
        let g = &layout.grid;
        assert!(!circle_collides(
            g,
            layout.spawn.0,
            layout.spawn.1,
            INTRO_BALL_R
        ));
        let ti = (layout.spawn.0 + f64::from(g.w) / 2.0).floor() as i32;
        let tj = (layout.spawn.1 + f64::from(g.h) / 2.0).floor() as i32;
        assert!(is_walkable(g, ti, tj));
    }

    #[test]
    fn keeps_letter_strokes_one_tile_thick_like_real_maze_walls() {
        // Sanity on the font itself: every glyph is 5 rows, uniform width,
        // only #/. characters.
        for ch in "PINBALKGHT".chars() {
            let rows = title_glyph(ch);
            assert_eq!(rows.len() as i32, GLYPH_H, "{ch}");
            let w = rows[0].len();
            for row in rows.iter() {
                assert_eq!(row.len(), w, "{ch} row width");
                assert!(row.bytes().all(|b| b == b'#' || b == b'.'), "{ch}");
            }
        }
    }

    // title-grid.test.ts — "intro ricochet soak"

    #[test]
    fn bounces_for_a_full_minute_without_escaping_sticking_or_losing_speed() {
        let layout = build_title_grid();
        let g = &layout.grid;
        let mut b = IntroBall::at_spawn(&layout);

        let mut bounces = 0;
        let mut last = (b.x, b.z);
        let mut still_frames = 0;
        for _ in 0..(120 * 60) {
            if step_intro_ball(g, &mut b, 1.0 / 120.0) {
                bounces += 1;
            }
            // Never inside a wall, never outside the arena.
            assert!(!circle_collides(g, b.x, b.z, INTRO_BALL_R * 0.95));
            assert!(b.x.abs() < f64::from(g.w) / 2.0);
            assert!(b.z.abs() < f64::from(g.h) / 2.0);
            // Constant energy.
            assert!((js_hypot(b.vx, b.vz) - INTRO_BALL_SPEED).abs() < 1e-5);
            // Not wedged in place.
            if js_hypot(b.x - last.0, b.z - last.1) < 1e-4 {
                still_frames += 1;
            } else {
                still_frames = 0;
            }
            assert!(still_frames < 10);
            last = (b.x, b.z);
        }
        assert!(bounces > 30, "bounces={bounces}");
    }

    // clock.test.ts — introDeltas

    #[test]
    fn advances_the_phase_clock_by_real_time_however_long_the_frame_was() {
        // THE REGRESSION. A one-second frame is a second of the sequence; the
        // old code moved it 50ms and put the other 950ms nowhere.
        assert!((intro_deltas(1000.0, 0.0).pdt - 1.0).abs() < 1e-6);
        assert!((intro_deltas(6000.0, 0.0).pdt - 6.0).abs() < 1e-6);
    }

    #[test]
    fn still_clamps_the_simulation_step_however_long_the_frame_was() {
        assert_eq!(intro_deltas(1000.0, 0.0).dt, SIM_DT_CLAMP);
        assert_eq!(intro_deltas(6000.0, 0.0).dt, SIM_DT_CLAMP);
    }

    #[test]
    fn keeps_the_two_equal_on_a_normal_frame() {
        let d = intro_deltas(16.7, 0.0);
        assert!((d.pdt - 0.0167).abs() < 1e-4);
        assert!((d.dt - d.pdt).abs() < 1e-6);
    }

    #[test]
    fn steps_nothing_on_the_first_frame() {
        assert_eq!(
            intro_deltas(9999.0, -1.0),
            IntroDeltas { pdt: 0.0, dt: 0.0 }
        );
    }

    #[test]
    fn never_steps_backwards() {
        assert_eq!(intro_deltas(100.0, 200.0).pdt, 0.0);
        assert_eq!(intro_deltas(100.0, 200.0).dt, 0.0);
    }

    // The phase machine — the tick switch's timing, extracted and pinned.

    #[test]
    fn runs_the_authored_sequence_end_to_end_at_60fps() {
        let mut seq = IntroSeq::new();
        let mut cues = Vec::new();
        let mut t = 0.0;
        let dt = 1.0 / 60.0;
        while !cues.contains(&IntroCue::Finish) && t < 20.0 {
            seq.advance(dt, &mut cues);
            t += dt;
        }
        // 11.4s authored; frame quantisation adds at most 5 frames.
        assert!((t - 11.4).abs() < 0.1, "sequence took {t}s");
        // Every cue fired exactly once, in order.
        let expect = [
            IntroCue::Roll,
            IntroCue::BonkStart,
            IntroCue::ShatterStart,
            IntroCue::SweepStart,
            IntroCue::TitleStart,
            IntroCue::Finish,
        ];
        assert_eq!(&cues[..expect.len()], &expect);
    }

    #[test]
    fn a_starved_frame_catches_up_rather_than_stretching() {
        // One 6-second frame lands mid-sweep (6s − 2.3 − 0.35 − 0.95 = 2.4s in,
        // via one transition per tick), not 50ms into the run.
        let mut seq = IntroSeq::new();
        let mut cues = Vec::new();
        seq.advance(6.0, &mut cues); // run → bonk (overflow dropped)
        assert_eq!(seq.phase, IntroPhase::Bonk);
        // The roll edge still fired even though the frame stepped over it.
        assert!(cues.contains(&IntroCue::Roll));
        seq.advance(1.0, &mut cues); // bonk → shatter
        assert_eq!(seq.phase, IntroPhase::Shatter);
        seq.advance(1.0, &mut cues); // shatter → sweep
        assert_eq!(seq.phase, IntroPhase::Sweep);
    }

    #[test]
    fn the_roll_edge_fires_exactly_once() {
        let mut seq = IntroSeq::new();
        let mut cues = Vec::new();
        let dt = 1.0 / 60.0;
        for _ in 0..(60 * 3) {
            seq.advance(dt, &mut cues);
        }
        assert_eq!(cues.iter().filter(|c| **c == IntroCue::Roll).count(), 1);
    }

    // entry.test.ts — "who does not see the title intro" (the gate, minus
    // the DOM: the shell asserts no scene is built when this returns true).

    #[test]
    fn skips_for_the_harness_entry_and_the_documented_opt_out() {
        assert!(should_skip_intro("?autostart=1", false, false, false));
        assert!(should_skip_intro("?no-intro=1", false, false, false));
        // Still skips with other params alongside.
        assert!(should_skip_intro(
            "?autostart=1&gpu=webgpu",
            false,
            false,
            false
        ));
    }

    #[test]
    fn skips_when_the_escape_hatch_or_reduced_motion_is_set() {
        assert!(should_skip_intro("", true, false, false));
        assert!(should_skip_intro("", false, true, false));
    }

    #[test]
    fn plays_once_per_launch_and_otherwise_plays() {
        assert!(!should_skip_intro("", false, false, false));
        assert!(should_skip_intro("", false, false, true));
        // The negative control for the query parser: unrelated params don't
        // trip the gate.
        assert!(!should_skip_intro(
            "?gpu=webgpu&foo=no-intro",
            false,
            false,
            false
        ));
    }
}
