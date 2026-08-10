//! The CPU particle substrate — a fixed-capacity ring buffer in
//! structure-of-arrays form, plus the three tavern spawners.
//!
//! Verbatim port of `legacy/src/game/pinball-knight/fx/pools/particle-pool.ts`
//! (the integrator) and the `ember` / `mote` / `sparks` closures in
//! `legacy/src/game/pinball-knight/fx/system.ts:272-315` (the spawners).
//!
//! THE INTEGRATOR IS THE PART A SCREENSHOT CANNOT CHECK, so it is written to
//! read like the oracle line for line, and the unit tests at the bottom pin it
//! to hand-computed values rather than to itself.
//!
//! ```text
//! k = max(0, 1 - drag*dt)
//! vy -= gravity*dt        // vy is NOT dragged — only vx and vz are
//! vx *= k ; vz *= k
//! pos += v*dt             // the NEW v, after gravity and drag
//! life -= dt ; t = life/maxLife
//! alpha = t
//! size  = size0 * (0.35 + 0.65*t)
//! ```
//!
//! RANDOMNESS. Every number this module jitters comes from the [`Lcg`] below —
//! never from `pk_core`'s Mulberry32. PRNG call order in the sim is a
//! determinism contract enforced by bit-exact trace fixtures; particles are
//! presentation and must not be able to perturb it. That is why the pool owns
//! its own generator instead of taking one.

use bevy::prelude::*;

/// Slots in the tavern's pool. The oracle's additive pool holds 500 for the
/// dungeon's blood-and-sparks load; the tavern's three ambient emitters at
/// 3 particles / 0.14s with a ≤3.2s life peak around 70 live slots, so 256 is
/// headroom, not a budget.
pub const CAP: usize = 256;

/// The oracle's per-frame `dt` clamp (`legacy/src/scenes/tavern/core.ts:336`,
/// `Math.min(0.05, …)`). A tab restored after a minute must not teleport every
/// ember through the ceiling in one step.
pub const MAX_DT: f32 = 0.05;

// ── Palette, LINEAR ──────────────────────────────────────────────────────────
// The scene target is a LINEAR buffer, and a literal written straight into a
// vertex attribute bypasses colour management entirely — so these convert by
// hand, exactly as `legacy/src/game/pinball-knight/fx/color.ts` does.
/// flame core — near white, blooms hard.
pub const C_SPARK: u32 = 0xfff3c8;
/// flame light.
pub const C_SPARK2: u32 = 0xffd98a;
/// flame — the ember.
pub const C_EMBER: u32 = 0xf0a63c;
/// stone light — floor dust, the drifting mote.
pub const C_DUST: u32 = 0x6b7688;

/// sRGB transfer function, inverted. The EXACT curve, not the 2.2
/// approximation — the pixel pass's own linear→sRGB step uses the real one and
/// a mismatched pair shows up as effects sitting a shade off the world.
pub fn to_linear(c: f32) -> f32 {
    if c <= 0.040_45 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// sRGB hex → linear rgb in 0..1, for the linear scene buffer.
pub fn lin_color(hex: u32) -> Vec3 {
    Vec3::new(
        to_linear(((hex >> 16) & 0xff) as f32 / 255.0),
        to_linear(((hex >> 8) & 0xff) as f32 / 255.0),
        to_linear((hex & 0xff) as f32 / 255.0),
    )
}

// ── RNG ──────────────────────────────────────────────────────────────────────

/// A small local LCG (Numerical Recipes constants), deliberately NOT the sim's
/// Mulberry32. See the module header: touching the sim's stream would break the
/// bit-exact trace fixtures in `pk-core`.
#[derive(Debug, Clone)]
pub struct Lcg {
    state: u32,
}

impl Default for Lcg {
    fn default() -> Self {
        // Any odd-ish constant; the stream is cosmetic, only its independence
        // from the sim matters.
        Self::new(0x9e37_79b9)
    }
}

impl Lcg {
    pub const fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    #[inline]
    fn next_u32(&mut self) -> u32 {
        self.state = self
            .state
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        self.state
    }

    /// Uniform in `[0, 1)` — the top 24 bits, so every value is exactly
    /// representable in `f32`.
    #[inline]
    pub fn unit(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / 16_777_216.0
    }

    /// Uniform in `[a, b)`. The oracle's `rnd(a, b)`.
    #[inline]
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + self.unit() * (b - a)
    }
}

// ── The pool ─────────────────────────────────────────────────────────────────

/// Structure-of-arrays, one entry per slot. Fields are public because the
/// upload walks them and the tests read them; nothing outside `fx/` sees this
/// type.
#[derive(Debug)]
pub struct ParticlePool {
    // Rendered state.
    pub pos: Vec<Vec3>,
    pub color: Vec<Vec3>,
    /// CURRENT size in RENDER PIXELS — world size is `size / PPU`.
    pub size: Vec<f32>,
    pub alpha: Vec<f32>,
    // Simulation state.
    pub vel: Vec<Vec3>,
    pub life: Vec<f32>,
    pub max_life: Vec<f32>,
    pub gravity: Vec<f32>,
    pub drag: Vec<f32>,
    /// Spawn size in render pixels — the envelope multiplies this, never `size`.
    pub size0: Vec<f32>,
    /// The ring cursor. A spawn into an occupied slot overwrites it, which is
    /// what makes the pool allocation-free and unbounded in emission rate.
    cursor: usize,
    /// Slots still alive after the last [`ParticlePool::update`]. Free — the
    /// loop visits every slot anyway — and it is the only cheap way to tell
    /// "the pool cost nothing" apart from "the pool cost nothing because it was
    /// empty".
    pub live: usize,
}

impl Default for ParticlePool {
    fn default() -> Self {
        Self::new(CAP)
    }
}

impl ParticlePool {
    pub fn new(n: usize) -> Self {
        Self {
            pos: vec![Vec3::ZERO; n],
            color: vec![Vec3::ZERO; n],
            size: vec![0.0; n],
            alpha: vec![0.0; n],
            vel: vec![Vec3::ZERO; n],
            life: vec![0.0; n],
            max_life: vec![1.0; n],
            gravity: vec![0.0; n],
            drag: vec![0.0; n],
            size0: vec![0.0; n],
            cursor: 0,
            live: 0,
        }
    }

    pub fn capacity(&self) -> usize {
        self.pos.len()
    }

    /// The oracle's `spawn()`. `size` is in RENDER PIXELS.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &mut self,
        pos: Vec3,
        vel: Vec3,
        color: Vec3,
        size: f32,
        life: f32,
        gravity: f32,
        drag: f32,
    ) -> usize {
        let i = self.cursor;
        self.cursor = (self.cursor + 1) % self.capacity();
        self.pos[i] = pos;
        self.color[i] = color;
        self.size[i] = size;
        self.alpha[i] = 1.0;
        self.vel[i] = vel;
        self.life[i] = life;
        self.max_life[i] = life;
        self.gravity[i] = gravity;
        self.drag[i] = drag;
        self.size0[i] = size;
        i
    }

    /// One integration step. `dt` is expected to be pre-clamped by the caller
    /// to [`MAX_DT`], exactly as the oracle's scene loop does.
    pub fn update(&mut self, dt: f32) {
        let mut live = 0;
        for i in 0..self.capacity() {
            if self.life[i] <= 0.0 {
                continue;
            }
            self.life[i] -= dt;
            if self.life[i] <= 0.0 {
                // A retired slot renders at size 0 / alpha 0 — no branch in the
                // shader, no compaction on the CPU.
                self.alpha[i] = 0.0;
                self.size[i] = 0.0;
                continue;
            }
            let k = (1.0 - self.drag[i] * dt).max(0.0);
            // vy is NOT dragged. That is the oracle's behaviour, not an
            // oversight: dragging it too turns the ember's rise into a crawl.
            self.vel[i].y -= self.gravity[i] * dt;
            self.vel[i].x *= k;
            self.vel[i].z *= k;
            let v = self.vel[i];
            self.pos[i] += v * dt;
            let t = self.life[i] / self.max_life[i]; // 1 → 0
            self.alpha[i] = t;
            self.size[i] = self.size0[i] * (0.35 + 0.65 * t); // shrink as it dies
            live += 1;
        }
        self.live = live;
    }

    /// Retire every slot — used when the scene that owns them is left.
    pub fn clear(&mut self) {
        for i in 0..self.capacity() {
            self.life[i] = 0.0;
            self.alpha[i] = 0.0;
            self.size[i] = 0.0;
        }
        self.live = 0;
    }
}

// ── The spawners ─────────────────────────────────────────────────────────────

/// The pool plus its private RNG — the resource the rest of `fx/` talks to.
#[derive(Resource, Debug, Default)]
pub struct Particles {
    pub pool: ParticlePool,
    pub rng: Lcg,
}

impl Particles {
    /// A single rising ember. NEGATIVE gravity — embers float UP.
    pub fn ember(&mut self, x: f32, y: f32, z: f32) {
        let px = x + self.rng.range(-0.08, 0.08);
        let pz = z + self.rng.range(-0.08, 0.08);
        let vx = self.rng.range(-0.25, 0.25);
        let vy = self.rng.range(0.6, 1.3);
        let vz = self.rng.range(-0.25, 0.25);
        let size = self.rng.range(2.0, 4.0);
        let life = self.rng.range(0.6, 1.2);
        self.pool.spawn(
            Vec3::new(px, y, pz),
            Vec3::new(vx, vy, vz),
            lin_color(C_EMBER),
            size,
            life,
            -0.6,
            0.6,
        );
    }

    /// A dim drifting dust mote — barely-there, near-weightless, long-lived.
    /// Atmosphere, not an event.
    pub fn mote(&mut self, x: f32, y: f32, z: f32) {
        let vx = self.rng.range(-0.12, 0.12);
        let vy = self.rng.range(-0.05, 0.08);
        let vz = self.rng.range(-0.12, 0.12);
        let size = self.rng.range(1.5, 2.5);
        let life = self.rng.range(1.6, 3.2);
        self.pool.spawn(
            Vec3::new(x, y, z),
            Vec3::new(vx, vy, vz),
            lin_color(C_DUST),
            size,
            life,
            -0.01,
            0.2,
        );
    }

    /// Bright sparks flying off an impact point — mostly along `dir`, with
    /// spread and an upward pop. Heavy gravity and heavy drag: they arc and
    /// die inside half a second.
    ///
    /// `dir` is a HORIZONTAL direction (x, z); it is normalised here, and a
    /// zero direction degenerates to a straight-up fountain exactly as the
    /// oracle's `Math.hypot(dirx, dirz) || 1` does.
    pub fn sparks(&mut self, pos: Vec3, dir: Vec2, count: u32) {
        let d = dir.length();
        let d = if d == 0.0 { 1.0 } else { d };
        let nx = dir.x / d;
        let nz = dir.y / d;
        for _ in 0..count {
            let spread = self.rng.range(-0.7, 0.7);
            let sp = self.rng.range(2.5, 6.5);
            let (s, c) = (spread.sin(), spread.cos());
            let vx = (nx * c - nz * s) * sp;
            let vz = (nx * s + nz * c) * sp;
            let vy = self.rng.range(1.5, 4.5);
            let hot = self.rng.unit() < 0.5;
            let size = self.rng.range(3.0, 6.0);
            let life = self.rng.range(0.18, 0.4);
            self.pool.spawn(
                pos,
                Vec3::new(vx, vy, vz),
                lin_color(if hot { C_SPARK } else { C_SPARK2 }),
                size,
                life,
                14.0,
                3.0,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tolerance for hand-computed f32 arithmetic.
    const EPS: f32 = 1e-6;

    fn assert_close(got: f32, want: f32, what: &str) {
        assert!(
            (got - want).abs() <= EPS,
            "{what}: got {got}, want {want} (delta {})",
            got - want
        );
    }

    /// ONE EMBER STEP, hand-computed.
    ///
    /// spawn: pos (0,0,0), v (0.2, 1.0, -0.1), gravity -0.6, drag 0.6,
    ///        size0 3, life 1.0. Step dt = 0.1.
    ///
    ///   k  = 1 - 0.6*0.1                      = 0.94
    ///   vy = 1.0 - (-0.6)*0.1                 = 1.06   ← rises FASTER
    ///   vx = 0.2 * 0.94                       = 0.188
    ///   vz = -0.1 * 0.94                      = -0.094
    ///   pos = (0.0188, 0.106, -0.0094)
    ///   life = 0.9, t = 0.9
    ///   alpha = 0.9
    ///   size  = 3 * (0.35 + 0.65*0.9) = 3 * 0.935 = 2.805
    #[test]
    fn ember_step_matches_hand_computation() {
        let mut p = ParticlePool::new(4);
        let i = p.spawn(
            Vec3::ZERO,
            Vec3::new(0.2, 1.0, -0.1),
            Vec3::ONE,
            3.0,
            1.0,
            -0.6,
            0.6,
        );
        p.update(0.1);

        assert_close(p.vel[i].x, 0.188, "vx");
        assert_close(p.vel[i].y, 1.06, "vy (gravity is negative → speeds UP)");
        assert_close(p.vel[i].z, -0.094, "vz");
        assert_close(p.pos[i].x, 0.0188, "pos.x");
        assert_close(p.pos[i].y, 0.106, "pos.y");
        assert_close(p.pos[i].z, -0.0094, "pos.z");
        assert_close(p.life[i], 0.9, "life");
        assert_close(p.alpha[i], 0.9, "alpha");
        assert_close(p.size[i], 2.805, "size");
        assert_eq!(p.live, 1);
    }

    /// ONE SPARK STEP, hand-computed. Heavy gravity (14) and heavy drag (3)
    /// are what make a spark an arc rather than a drift.
    ///
    /// spawn: pos (1,2,3), v (4, 3, -2), gravity 14, drag 3,
    ///        size0 5, life 0.3. Step dt = 0.05.
    ///
    ///   k  = 1 - 3*0.05                       = 0.85
    ///   vy = 3 - 14*0.05                      = 2.3
    ///   vx = 4 * 0.85                          = 3.4
    ///   vz = -2 * 0.85                         = -1.7
    ///   pos = (1 + 0.17, 2 + 0.115, 3 - 0.085) = (1.17, 2.115, 2.915)
    ///   life = 0.25, t = 0.25/0.3 = 0.833333…
    ///   size = 5 * (0.35 + 0.65*0.833333…)     = 5 * 0.891666… = 4.458333…
    #[test]
    fn spark_step_matches_hand_computation() {
        let mut p = ParticlePool::new(4);
        let i = p.spawn(
            Vec3::new(1.0, 2.0, 3.0),
            Vec3::new(4.0, 3.0, -2.0),
            Vec3::ONE,
            5.0,
            0.3,
            14.0,
            3.0,
        );
        p.update(0.05);

        assert_close(p.vel[i].x, 3.4, "vx");
        assert_close(p.vel[i].y, 2.3, "vy");
        assert_close(p.vel[i].z, -1.7, "vz");
        assert_close(p.pos[i].x, 1.17, "pos.x");
        assert_close(p.pos[i].y, 2.115, "pos.y");
        assert_close(p.pos[i].z, 2.915, "pos.z");
        assert_close(p.life[i], 0.25, "life");
        assert_close(p.alpha[i], 0.25 / 0.3, "alpha");
        assert_close(p.size[i], 5.0 * (0.35 + 0.65 * (0.25 / 0.3)), "size");
    }

    /// THE ENVELOPE at t = 1.0 / 0.5 / 0.0.
    ///
    ///   alpha(t) = t
    ///   size(t)  = size0 * (0.35 + 0.65*t)
    ///
    /// t = 1.0 → alpha 1.0, size = size0            (spawn)
    /// t = 0.5 → alpha 0.5, size = size0 * 0.675
    /// t = 0.0 → alpha 0.0, size = 0                (retired, NOT size0*0.35)
    ///
    /// The t=0 row is the one that matters: the oracle does not evaluate the
    /// envelope on the frame a particle dies, it forces size and alpha to 0.
    /// A shrink-to-35% pop would be visible on every ember.
    #[test]
    fn envelope_at_one_half_and_zero() {
        // t = 1.0 — the spawn state, before any step.
        let mut p = ParticlePool::new(4);
        let i = p.spawn(Vec3::ZERO, Vec3::ZERO, Vec3::ONE, 4.0, 1.0, 0.0, 0.0);
        assert_close(p.alpha[i], 1.0, "alpha @ t=1");
        assert_close(p.size[i], 4.0, "size @ t=1");

        // t = 0.5 — half the life spent.
        p.update(0.5);
        assert_close(p.alpha[i], 0.5, "alpha @ t=0.5");
        assert_close(p.size[i], 4.0 * (0.35 + 0.65 * 0.5), "size @ t=0.5");
        assert_close(p.size[i], 2.7, "size @ t=0.5 (= 4 * 0.675)");

        // t = 0.0 — the step that retires it.
        p.update(0.5);
        assert_close(p.alpha[i], 0.0, "alpha @ t=0");
        assert_close(p.size[i], 0.0, "size @ t=0 (forced, not 4*0.35)");
        assert_eq!(p.live, 0, "a retired slot is not live");

        // And it stays retired — a dead slot is skipped, not re-integrated.
        p.update(0.5);
        assert_close(p.life[i], 0.0, "life stays at 0");
    }

    /// `k = max(0, 1 - drag*dt)` — a drag high enough to overshoot must clamp
    /// to a dead stop, not reverse the horizontal velocity.
    #[test]
    fn drag_clamps_at_zero_rather_than_reversing() {
        let mut p = ParticlePool::new(2);
        // drag 30 * dt 0.05 = 1.5 → 1 - 1.5 = -0.5, clamped to 0.
        let i = p.spawn(
            Vec3::ZERO,
            Vec3::new(5.0, 5.0, -5.0),
            Vec3::ONE,
            1.0,
            1.0,
            0.0,
            30.0,
        );
        p.update(0.05);
        assert_close(p.vel[i].x, 0.0, "vx clamped");
        assert_close(p.vel[i].z, 0.0, "vz clamped");
        assert_close(p.vel[i].y, 5.0, "vy is NOT dragged");
    }

    /// The ring overwrites rather than dropping — spawning past capacity must
    /// keep every slot occupied and wrap the cursor.
    #[test]
    fn ring_wraps_and_overwrites() {
        let mut p = ParticlePool::new(3);
        for n in 0..5 {
            p.spawn(
                Vec3::splat(n as f32),
                Vec3::ZERO,
                Vec3::ONE,
                1.0,
                1.0,
                0.0,
                0.0,
            );
        }
        // 5 spawns into 3 slots: slot 0 ← #3, slot 1 ← #4, slot 2 ← #2.
        assert_close(p.pos[0].x, 3.0, "slot 0 overwritten");
        assert_close(p.pos[1].x, 4.0, "slot 1 overwritten");
        assert_close(p.pos[2].x, 2.0, "slot 2 untouched by the wrap");
        p.update(0.0);
        assert_eq!(p.live, 3, "every slot alive");
    }

    /// The ember spawner's constants, checked through the RNG's bounds rather
    /// than through a fixed stream — the point is the envelope of legal
    /// values, not this LCG's particular sequence.
    #[test]
    fn ember_spawner_stays_inside_the_oracles_ranges() {
        let mut fx = Particles::default();
        for _ in 0..200 {
            fx.ember(-8.0, 0.55, 0.2);
        }
        for i in 0..fx.pool.capacity() {
            if fx.pool.life[i] <= 0.0 {
                continue;
            }
            assert!((fx.pool.pos[i].x - -8.0).abs() <= 0.08 + EPS, "x jitter");
            assert_close(fx.pool.pos[i].y, 0.55, "y is not jittered");
            assert!((fx.pool.pos[i].z - 0.2).abs() <= 0.08 + EPS, "z jitter");
            assert!(fx.pool.vel[i].x.abs() <= 0.25, "vx range");
            assert!(
                (0.6..=1.3).contains(&fx.pool.vel[i].y),
                "vy range (always UP)"
            );
            assert!((2.0..=4.0).contains(&fx.pool.size0[i]), "size range");
            assert!((0.6..=1.2).contains(&fx.pool.max_life[i]), "life range");
            assert_close(fx.pool.gravity[i], -0.6, "gravity is NEGATIVE");
            assert_close(fx.pool.drag[i], 0.6, "drag");
        }
    }

    /// `sparks` fires roughly along the direction it is given, and a zero
    /// direction must not produce NaN.
    #[test]
    fn sparks_follow_their_direction_and_survive_a_zero_dir() {
        let mut fx = Particles::default();
        fx.sparks(Vec3::new(1.0, 0.5, 2.0), Vec2::new(1.0, 0.0), 32);
        let mut forward = 0;
        for i in 0..fx.pool.capacity() {
            if fx.pool.life[i] <= 0.0 {
                continue;
            }
            // spread is ±0.7 rad, so every spark has a positive +x component.
            assert!(fx.pool.vel[i].x > 0.0, "spread stays inside ±0.7 rad");
            assert!((1.5..=4.5).contains(&fx.pool.vel[i].y), "upward pop");
            assert_close(fx.pool.gravity[i], 14.0, "gravity");
            assert_close(fx.pool.drag[i], 3.0, "drag");
            forward += 1;
        }
        assert_eq!(forward, 32, "all 32 spawned");

        let mut fx = Particles::default();
        fx.sparks(Vec3::ZERO, Vec2::ZERO, 4);
        for i in 0..fx.pool.capacity() {
            if fx.pool.life[i] <= 0.0 {
                continue;
            }
            assert!(fx.pool.vel[i].is_finite(), "zero dir must not divide by 0");
        }
    }

    /// The linear palette conversion, against values computed from the exact
    /// sRGB curve (the oracle's `toLinear`).
    #[test]
    fn lin_color_uses_the_exact_srgb_curve() {
        // 0x00 → 0, 0xff → 1 at the ends.
        assert_close(to_linear(0.0), 0.0, "black");
        assert_close(to_linear(1.0), 1.0, "white");
        // The knee: 0.04045 is the last value on the linear segment.
        assert_close(to_linear(0.04045), 0.04045 / 12.92, "knee");
        // C_EMBER = 0xf0a63c → (240, 166, 60)/255 through the curve.
        let e = lin_color(C_EMBER);
        assert_close(e.x, to_linear(240.0 / 255.0), "ember r");
        assert_close(e.y, to_linear(166.0 / 255.0), "ember g");
        assert_close(e.z, to_linear(60.0 / 255.0), "ember b");
        // Sanity: the linear value is always DARKER than the sRGB one above
        // the knee — a port that forgets the conversion looks washed out.
        assert!(e.x < 240.0 / 255.0 && e.y < 166.0 / 255.0 && e.z < 60.0 / 255.0);
    }

    /// The LCG must stay in `[a, b)` and must not be constant.
    #[test]
    fn lcg_range_is_bounded_and_varied() {
        let mut r = Lcg::default();
        let mut lo = f32::MAX;
        let mut hi = f32::MIN;
        for _ in 0..10_000 {
            let v = r.range(-0.25, 0.25);
            assert!((-0.25..0.25).contains(&v), "out of range: {v}");
            lo = lo.min(v);
            hi = hi.max(v);
        }
        assert!(lo < -0.24 && hi > 0.24, "the stream must cover its range");
    }
}
