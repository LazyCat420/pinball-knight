//! THE THROW — the two-stage aim/release state machine, with no canvas in it.
//! Port of `legacy/src/scenes/tavern/gambler/darts-throw.ts`.
//!
//! The one invariant that matters: `score_at` is called EXACTLY ONCE per
//! dart, at the instant of release, on the same post-wobble coordinate the
//! renderer then draws the dart at. The round total is the sum of those
//! stored hits — there is no second calculation anywhere to drift apart.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/darts-throw.ts`

use super::darts::{
    apply_wobble, payout_for, score_at, throw_speed, wobble_radius, y_half_range, Hit,
    DARTS_PER_ROUND, X_SWEEP_AMPLITUDE,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThrowPhase {
    Idle,
    AimX,
    AimY,
    Flying,
    Done,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LandedDart {
    /// Where it ACTUALLY stuck, in units of board radius. Scoring used this.
    pub x: f64,
    pub y: f64,
    /// Scored once, at release, from exactly the (x, y) above.
    pub hit: Hit,
    /// Where the player locked, before the hand wobbled.
    pub aim_x: f64,
    pub aim_y: f64,
    /// A few degrees either way, so three darts don't read as a stamped grid.
    pub lean: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ThrowEvent {
    Tick,
    LockX,
    Release,
    Land(LandedDart),
    RoundDone {
        total: i32,
        mult: f64,
        label: &'static str,
    },
}

/// Seconds a dart spends in the air. Long enough to read as a throw.
pub const FLIGHT: f64 = 0.34;
/// Seconds the final total holds on screen before the controls unlock.
pub const SETTLE_HOLD: f64 = 1.5;
/// Graduations the reticle ticks past per full sweep — the audible metronome.
const TICKS_PER_SWEEP: f64 = 16.0;

pub struct ThrowMachine<R: FnMut() -> f64> {
    rng: R,
    phase: ThrowPhase,
    stake: f64,
    t: f64,
    aim_x: f64,
    last_tick: i64,
    flight_t: f64,
    settle_t: f64,
    pending: Option<LandedDart>,
    landed: Vec<LandedDart>,
}

impl<R: FnMut() -> f64> ThrowMachine<R> {
    pub fn new(rng: R) -> Self {
        Self {
            rng,
            phase: ThrowPhase::Idle,
            stake: 0.0,
            t: 0.0,
            aim_x: 0.0,
            last_tick: 0,
            flight_t: 0.0,
            settle_t: 0.0,
            pending: None,
            landed: Vec::new(),
        }
    }

    /// Speed of whichever bar is sweeping right now, in sweeps per second.
    fn speed(&self) -> f64 {
        throw_speed(self.stake, self.landed.len())
    }

    /// Triangle wave in -1..1. Starts at 0 and moves +ve, so the reticle
    /// enters from the middle rather than snapping to an edge.
    fn wave(&self) -> f64 {
        let u = (self.t * self.speed() + 0.5) % 2.0;
        if u < 1.0 {
            u * 2.0 - 1.0
        } else {
            3.0 - u * 2.0
        }
    }

    fn amplitude(&self) -> f64 {
        if self.phase == ThrowPhase::AimY {
            y_half_range(self.aim_x)
        } else {
            X_SWEEP_AMPLITUDE
        }
    }

    fn sweep_cursor(&self) -> f64 {
        self.wave() * self.amplitude()
    }

    fn release(&mut self) -> LandedDart {
        let aim_y = self.sweep_cursor();
        let r = wobble_radius(self.stake, self.landed.len());
        let p = apply_wobble(self.aim_x, aim_y, r, &mut self.rng);
        // The single scoring call for this dart. Everything downstream reads `hit`.
        LandedDart {
            x: p.0,
            y: p.1,
            hit: score_at(p.0, p.1),
            aim_x: self.aim_x,
            aim_y,
            lean: ((self.rng)() * 2.0 - 1.0) * 14.0,
        }
    }

    pub fn phase(&self) -> ThrowPhase {
        self.phase
    }

    /// Darts already stuck in the board, oldest first.
    pub fn darts(&self) -> &[LandedDart] {
        &self.landed
    }

    /// Sum of the stored hits. The ONLY place a round total is computed.
    pub fn total(&self) -> i32 {
        self.landed.iter().map(|d| d.hit.points).sum()
    }

    /// 0-based index of the dart currently being thrown.
    pub fn dart_index(&self) -> usize {
        self.landed.len()
    }

    /// Live reticle position on the axis currently sweeping, in board units.
    pub fn cursor(&self) -> f64 {
        match self.phase {
            ThrowPhase::AimX | ThrowPhase::AimY => self.sweep_cursor(),
            _ => 0.0,
        }
    }

    /// The locked X, once stage one is done.
    pub fn locked_x(&self) -> f64 {
        self.aim_x
    }

    /// Half-height of the Y sweep for the current X — the renderer draws this.
    pub fn y_range(&self) -> f64 {
        y_half_range(self.aim_x)
    }

    /// The dart in the air, and how far along it is (0..1), or None.
    pub fn flight(&self) -> Option<(&LandedDart, f64)> {
        if self.phase == ThrowPhase::Flying {
            self.pending
                .as_ref()
                .map(|d| (d, 1.0 - self.flight_t / FLIGHT))
        } else {
            None
        }
    }

    /// True while the shell must keep the stake controls locked.
    pub fn busy(&self) -> bool {
        self.phase != ThrowPhase::Idle && self.phase != ThrowPhase::Done
    }

    pub fn begin(&mut self, stake: f64) {
        self.stake = stake;
        self.landed.clear();
        self.pending = None;
        self.aim_x = 0.0;
        self.t = 0.0;
        self.last_tick = 0;
        self.flight_t = 0.0;
        self.settle_t = 0.0;
        self.phase = ThrowPhase::AimX;
    }

    pub fn press(&mut self) -> Vec<ThrowEvent> {
        if self.phase == ThrowPhase::AimX {
            self.aim_x = self.sweep_cursor();
            self.phase = ThrowPhase::AimY;
            self.t = 0.0;
            self.last_tick = 0;
            return vec![ThrowEvent::LockX];
        }
        if self.phase == ThrowPhase::AimY {
            let dart = self.release();
            self.pending = Some(dart);
            self.phase = ThrowPhase::Flying;
            self.flight_t = FLIGHT;
            return vec![ThrowEvent::Release];
        }
        // Presses during flight or the settle hold are deliberately swallowed:
        // a mashed button must never skip a dart or double-resolve a round.
        Vec::new()
    }

    pub fn tick(&mut self, dt: f64) -> Vec<ThrowEvent> {
        let mut out = Vec::new();

        if self.phase == ThrowPhase::AimX || self.phase == ThrowPhase::AimY {
            self.t += dt;
            // One event per graduation crossed, not one per frame.
            let g = libm::floor(self.t * self.speed() * TICKS_PER_SWEEP * 2.0) as i64;
            if g != self.last_tick {
                self.last_tick = g;
                out.push(ThrowEvent::Tick);
            }
            return out;
        }

        if self.phase == ThrowPhase::Flying {
            self.flight_t -= dt;
            if self.flight_t <= 0.0 {
                if let Some(dart) = self.pending.take() {
                    self.landed.push(dart.clone());
                    out.push(ThrowEvent::Land(dart));
                    if self.landed.len() >= DARTS_PER_ROUND {
                        self.phase = ThrowPhase::Done;
                        self.settle_t = SETTLE_HOLD;
                        let sum = self.total();
                        let (mult, label) = payout_for(sum);
                        out.push(ThrowEvent::RoundDone {
                            total: sum,
                            mult,
                            label,
                        });
                    } else {
                        self.phase = ThrowPhase::AimX;
                        self.t = 0.0;
                        self.last_tick = 0;
                    }
                }
            }
            return out;
        }

        if self.phase == ThrowPhase::Done && self.settle_t > 0.0 {
            self.settle_t -= dt;
            if self.settle_t <= 0.0 {
                self.phase = ThrowPhase::Idle;
            }
        }
        out
    }

    /// Payout for the round as thrown. Derived from `total()`, nothing else.
    pub fn result(&self) -> (i32, f64, &'static str) {
        let sum = self.total();
        let (mult, label) = payout_for(sum);
        (sum, mult, label)
    }
}

#[cfg(test)]
mod tests {
    //! Ported from the state-machine half of
    //! `legacy/src/scenes/tavern/gambler/darts.test.ts`.
    use super::*;
    use crate::gambler::darts::wobble_radius;
    use crate::gambler::table::{MAX_STAKE_ABS, MIN_STAKE};
    use crate::jsmath::js_hypot;

    fn half() -> impl FnMut() -> f64 {
        || 0.5
    }

    /// Advance `seconds` in 120Hz steps, collecting everything emitted.
    fn run<R: FnMut() -> f64>(m: &mut ThrowMachine<R>, seconds: f64) -> Vec<ThrowEvent> {
        let mut out = Vec::new();
        let step = 1.0 / 120.0;
        let mut t = 0.0;
        while t < seconds {
            out.extend(m.tick(step));
            t += step;
        }
        out
    }

    #[test]
    fn starts_idle_and_only_arms_when_a_round_begins() {
        let mut m = ThrowMachine::new(half());
        assert_eq!(m.phase(), ThrowPhase::Idle);
        assert!(!m.busy());
        m.begin(10.0);
        assert_eq!(m.phase(), ThrowPhase::AimX);
        assert!(m.busy());
    }

    #[test]
    fn walks_aim_x_aim_y_flying_aim_x_for_the_next_dart() {
        let mut m = ThrowMachine::new(half());
        m.begin(10.0);

        assert!(matches!(m.press()[..], [ThrowEvent::LockX]));
        assert_eq!(m.phase(), ThrowPhase::AimY);

        assert!(matches!(m.press()[..], [ThrowEvent::Release]));
        assert_eq!(m.phase(), ThrowPhase::Flying);

        let events = run(&mut m, FLIGHT + 0.05);
        assert!(events.iter().any(|e| matches!(e, ThrowEvent::Land(_))));
        assert_eq!(m.phase(), ThrowPhase::AimX);
        assert_eq!(m.darts().len(), 1);
    }

    #[test]
    fn holds_the_dart_in_the_air_for_the_whole_flight_rather_than_teleporting_it() {
        let mut m = ThrowMachine::new(half());
        m.begin(10.0);
        m.press();
        m.press();
        assert!(m.darts().is_empty());
        assert!(m.flight().is_some());

        run(&mut m, FLIGHT * 0.5);
        let (_, p) = m.flight().expect("mid-flight");
        assert!(p > 0.3 && p < 0.7, "flight progress {p}");
        assert!(m.darts().is_empty());

        run(&mut m, FLIGHT);
        assert!(m.flight().is_none());
        assert_eq!(m.darts().len(), 1);
    }

    #[test]
    fn ends_the_round_after_exactly_three_darts_and_then_unlocks() {
        let mut m = ThrowMachine::new(half());
        m.begin(10.0);
        let mut all = Vec::new();
        for _ in 0..DARTS_PER_ROUND {
            all.extend(m.press());
            all.extend(m.press());
            all.extend(run(&mut m, FLIGHT + 0.05));
        }
        assert_eq!(m.darts().len(), DARTS_PER_ROUND);
        assert_eq!(m.phase(), ThrowPhase::Done);
        assert_eq!(
            all.iter()
                .filter(|e| matches!(e, ThrowEvent::RoundDone { .. }))
                .count(),
            1
        );

        run(&mut m, SETTLE_HOLD + 0.05);
        assert_eq!(m.phase(), ThrowPhase::Idle);
    }

    #[test]
    fn swallows_presses_during_flight_so_mashing_cannot_skip_or_double_resolve() {
        let mut m = ThrowMachine::new(half());
        m.begin(10.0);
        m.press();
        m.press();
        assert_eq!(m.phase(), ThrowPhase::Flying);
        for _ in 0..20 {
            assert!(m.press().is_empty());
        }
        run(&mut m, FLIGHT + 0.05);
        assert_eq!(m.darts().len(), 1);
    }

    #[test]
    fn emits_exactly_one_round_done_however_hard_the_button_is_mashed() {
        let mut m = ThrowMachine::new(half());
        m.begin(10.0);
        let mut all = Vec::new();
        for _ in 0..400 {
            all.extend(m.press());
            all.extend(m.tick(1.0 / 120.0));
        }
        assert_eq!(
            all.iter()
                .filter(|e| matches!(e, ThrowEvent::RoundDone { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn ticks_the_reticle_faster_at_a_bigger_stake_the_metronome_is_the_tell() {
        let mut slow = ThrowMachine::new(half());
        let mut fast = ThrowMachine::new(half());
        slow.begin(MIN_STAKE as f64);
        fast.begin(MAX_STAKE_ABS as f64);
        let count = |m: &mut ThrowMachine<_>| {
            run(m, 1.0)
                .iter()
                .filter(|e| matches!(e, ThrowEvent::Tick))
                .count()
        };
        assert!(count(&mut fast) > count(&mut slow));
    }

    #[test]
    fn resets_completely_between_rounds() {
        let mut m = ThrowMachine::new(half());
        m.begin(10.0);
        for _ in 0..DARTS_PER_ROUND {
            m.press();
            m.press();
            run(&mut m, FLIGHT + 0.05);
        }
        assert!(m.total() >= 0);
        m.begin(10.0);
        assert!(m.darts().is_empty());
        assert_eq!(m.total(), 0);
        assert_eq!(m.phase(), ThrowPhase::AimX);
    }

    // ── The house invariant: the score is whatever the dart actually hit. ──

    /// Cheap deterministic LCG, so a failure is reproducible from its seed —
    /// the legacy tests' generator, verbatim.
    fn lcg(seed: u64) -> impl FnMut() -> f64 {
        let mut n = seed;
        move || {
            n = (n.wrapping_mul(1664525).wrapping_add(1013904223)) % 4294967296;
            n as f64 / 4294967296.0
        }
    }

    fn throw_round(seed: u64, stake: f64) -> ThrowMachine<impl FnMut() -> f64> {
        let mut m = ThrowMachine::new(lcg(seed));
        m.begin(stake);
        for d in 0..DARTS_PER_ROUND {
            for _ in 0..(7 + d * 5) {
                m.tick(1.0 / 120.0);
            }
            m.press();
            for _ in 0..(11 + d * 3) {
                m.tick(1.0 / 120.0);
            }
            m.press();
            for _ in 0..60 {
                m.tick(1.0 / 120.0);
            }
        }
        m
    }

    #[test]
    fn stores_the_hit_that_score_at_gives_for_the_landing_coordinate() {
        for seed in 1..=60u64 {
            let m = throw_round(seed, 50.0);
            for d in m.darts() {
                assert_eq!(d.hit, score_at(d.x, d.y), "seed {seed}");
            }
        }
    }

    #[test]
    fn totals_the_round_as_the_sum_of_the_darts_stuck_in_the_board() {
        for seed in 1..=60u64 {
            let m = throw_round(seed, 50.0);
            let sum: i32 = m.darts().iter().map(|d| d.hit.points).sum();
            assert_eq!(m.total(), sum, "seed {seed}");
            assert_eq!(m.result().0, sum, "seed {seed}");
        }
    }

    #[test]
    fn pays_the_band_belonging_to_that_same_total_no_second_calculation() {
        for seed in 1..=60u64 {
            let m = throw_round(seed, 50.0);
            let (total, mult, label) = m.result();
            assert_eq!(mult, payout_for(total).0, "seed {seed}");
            assert_eq!(label, payout_for(total).1, "seed {seed}");
        }
    }

    #[test]
    fn reports_the_same_total_in_round_done_as_it_leaves_on_the_board() {
        let mut m = ThrowMachine::new(lcg(7));
        m.begin(100.0);
        let mut done: Option<(i32, f64)> = None;
        for _ in 0..DARTS_PER_ROUND {
            for _ in 0..9 {
                m.tick(1.0 / 120.0);
            }
            m.press();
            for _ in 0..13 {
                m.tick(1.0 / 120.0);
            }
            m.press();
            for _ in 0..60 {
                for e in m.tick(1.0 / 120.0) {
                    if let ThrowEvent::RoundDone { total, mult, .. } = e {
                        done = Some((total, mult));
                    }
                }
            }
        }
        let (total, mult) = done.expect("round finished");
        let sum: i32 = m.darts().iter().map(|d| d.hit.points).sum();
        assert_eq!(total, sum);
        assert_eq!(mult, payout_for(total).0);
    }

    #[test]
    fn never_lands_a_dart_further_from_the_aim_than_the_hand_can_shake() {
        for seed in 1..=40u64 {
            let m = throw_round(seed, MAX_STAKE_ABS as f64);
            for (i, d) in m.darts().iter().enumerate() {
                let slack = wobble_radius(MAX_STAKE_ABS as f64, i) + 1e-9;
                assert!(
                    js_hypot(d.x - d.aim_x, d.y - d.aim_y) <= slack,
                    "seed {seed} dart {i}"
                );
            }
        }
    }
}
