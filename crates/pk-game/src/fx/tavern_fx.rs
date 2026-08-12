//! The tavern's ambient cadence, and the public spark-burst inbox.
//!
//! Oracle: `legacy/src/scenes/tavern/core.ts:467-476`. Three emitters on ONE
//! 0.14 s timer — embers off the hearth, embers off the forge coals, and a
//! dust mote somewhere in the room.
//!
//! WHY A TIMER AND NOT PER FRAME. The oracle's own comment: "Emitted on a
//! cadence rather than per-frame, so the density is the same whether the
//! machine runs at 15fps or 144." A per-frame emitter makes the room look
//! smokier on a fast machine, which is the wrong kind of hardware tell.
//!
//! The timer RESETS rather than accumulating (`moteT = 0.14`, not `+= 0.14`),
//! so a long frame emits one batch and never a burst of catch-up. Ported as
//! written.
//!
//! PORTS-PARTIAL: `legacy/src/scenes/tavern/core.ts` — only the ambient
//! emitter cadence at `:467-476`, ten lines of 906. The header above already
//! said so in prose; the declaration said `PORTS` and therefore scored the
//! whole file. See `crates/pk-core/src/tavern/camera.rs` for the other half of
//! the same mistake.

use bevy::prelude::*;

use pk_core::tavern::layout::{ROOM_MAX_X, ROOM_MAX_Z, ROOM_MIN_X, ROOM_MIN_Z};

use super::pool::{Particles, MAX_DT};

/// The oracle's `moteT` period.
pub const AMBIENT_PERIOD: f32 = 0.14;

/// A burst of impact sparks — the public way in for anything outside `fx/`.
///
/// The tavern's spark beats (the keeper's hammer at the anvil, the dart at the
/// board, a forge purchase) live in `tavern.rs`, so they raise this instead of
/// reaching into the pool. Bevy 0.17 renamed buffered events to MESSAGES
/// (`bevy_ecs::message::{Message, MessageReader, MessageWriter}`, registered
/// with `App::add_message`) — verified against the installed bevy 0.17.3
/// source: `EventReader` still exists, but only for the observer-shaped
/// `Event`, and a buffered inbox like this one is a `Message`.
///
/// ```ignore
/// // in a system that already takes `mut sparks: MessageWriter<fx::SparkBurst>`:
/// sparks.write(fx::SparkBurst::new(Vec3::new(-6.8, 1.05, -2.6), Vec2::new(1.0, 0.3)));
/// ```
///
/// `dir` is HORIZONTAL — `(x, z)`, not `(x, y)`. It is normalised inside, and
/// `Vec2::ZERO` degenerates to a straight-up fountain rather than a NaN.
#[derive(Message, Debug, Clone, Copy)]
pub struct SparkBurst {
    /// World-space emission point.
    pub pos: Vec3,
    /// Horizontal `(x, z)` direction the sparks mostly fly along.
    pub dir: Vec2,
    /// Particles in the burst. The oracle's default is 10.
    pub count: u32,
}

// Dead until `tavern.rs` raises its first hammer beat — this is the API that
// call site is waiting for, not an unused helper.
#[allow(dead_code)]
impl SparkBurst {
    /// The oracle's default count (`sparks(..., count = 10)`).
    pub const DEFAULT_COUNT: u32 = 10;

    /// A burst at `pos` heading along the horizontal `dir`, at the oracle's
    /// default of 10 particles.
    pub fn new(pos: Vec3, dir: Vec2) -> Self {
        Self {
            pos,
            dir,
            count: Self::DEFAULT_COUNT,
        }
    }
}

/// Countdown to the next ambient batch.
#[derive(Resource, Debug)]
pub struct AmbientTimer(pub f32);

impl Default for AmbientTimer {
    fn default() -> Self {
        // Zero, so the first tavern frame seeds the room immediately — the
        // oracle's `moteT` starts at 0 too. Walking in to a dead hearth and
        // waiting 140 ms for the first ember is a visible hitch on entry.
        Self(0.0)
    }
}

/// THE CADENCE, as a plain function so the tests drive the real thing rather
/// than a copy of it.
///
/// `dt` is clamped to [`MAX_DT`] here because the oracle clamps ONCE, at the
/// top of its scene tick, and every downstream consumer — `moteT` included —
/// sees the clamped value. That clamp is also what makes a stalled tab emit one
/// batch instead of nine.
pub fn emit_ambient(fx: &mut Particles, t: &mut AmbientTimer, dt: f32) {
    t.0 -= dt.min(MAX_DT);
    if t.0 > 0.0 {
        return;
    }
    t.0 = AMBIENT_PERIOD;

    // The hearth — a wide, low band of embers along the fire.
    let y = 0.55 + fx.rng.unit() * 0.4;
    let z = 0.2 + (fx.rng.unit() - 0.5) * 1.6;
    fx.ember(-8.0, y, z);

    // The forge coals — higher (they sit on the forge) and a tighter spread.
    let y = 1.5 + fx.rng.unit() * 0.3;
    let z = -2.6 + (fx.rng.unit() - 0.5) * 0.9;
    fx.ember(-6.8, y, z);

    // Room dust — anywhere in the interior, in the first two metres of air.
    let x = ROOM_MIN_X as f32 + fx.rng.unit() * (ROOM_MAX_X - ROOM_MIN_X) as f32;
    let y = 0.5 + fx.rng.unit() * 2.0;
    let z = ROOM_MIN_Z as f32 + fx.rng.unit() * (ROOM_MAX_Z - ROOM_MIN_Z) as f32;
    fx.mote(x, y, z);
}

/// The Bevy wrapper. Gated to `AppState::Tavern` by the plugin.
pub fn tavern_ambient(time: Res<Time>, mut fx: ResMut<Particles>, mut t: ResMut<AmbientTimer>) {
    emit_ambient(&mut fx, &mut t, time.delta_secs());
}

/// Drains [`SparkBurst`] into the pool. Runs in every state — a spark is an
/// event, and the scene that raised it is the one that decided when.
pub fn drain_spark_bursts(mut bursts: MessageReader<SparkBurst>, mut fx: ResMut<Particles>) {
    for b in bursts.read() {
        fx.sparks(b.pos, b.dir, b.count);
    }
}

/// Retire everything on the way out of the tavern, so a descend does not carry
/// a cloud of hearth embers into the dungeon.
pub fn clear_on_exit(mut fx: ResMut<Particles>, mut t: ResMut<AmbientTimer>) {
    fx.pool.clear();
    t.0 = 0.0;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(fx: &Particles) -> usize {
        (0..fx.pool.capacity())
            .filter(|&i| fx.pool.life[i] > 0.0)
            .count()
    }

    /// The cadence emits exactly THREE particles per period — two embers and
    /// one mote — and nothing on a frame inside the period.
    #[test]
    fn one_batch_per_period() {
        let mut fx = Particles::default();
        let mut t = AmbientTimer::default();

        // Frame 1: the timer starts at 0, so the batch lands immediately.
        emit_ambient(&mut fx, &mut t, 0.016);
        assert_eq!(live(&fx), 3, "hearth ember + forge ember + mote");

        // Eight more 16 ms frames — 0.128 s total, still inside the period.
        for _ in 0..8 {
            emit_ambient(&mut fx, &mut t, 0.016);
        }
        assert_eq!(live(&fx), 3, "no second batch inside 0.14s");

        // The frame that crosses 0.14 s emits the next batch.
        emit_ambient(&mut fx, &mut t, 0.016);
        assert_eq!(live(&fx), 6, "second batch at the period boundary");
    }

    /// A stalled frame emits ONE batch, not a backlog: the dt clamp caps how
    /// far the timer can move, and the reset (`= 0.14`, not `+= 0.14`) throws
    /// away the remainder.
    #[test]
    fn a_long_frame_does_not_burst() {
        let mut fx = Particles::default();
        let mut t = AmbientTimer::default();

        // A 2-second stall is worth fourteen periods of wall clock — and one
        // batch of output, because dt clamps to 0.05.
        emit_ambient(&mut fx, &mut t, 2.0);
        assert_eq!(live(&fx), 3, "one batch, not fourteen");
        assert!(
            (t.0 - AMBIENT_PERIOD).abs() < 1e-6,
            "timer reset, not summed"
        );

        // 0.05 per stalled frame, so it takes three more to come round again.
        emit_ambient(&mut fx, &mut t, 2.0);
        emit_ambient(&mut fx, &mut t, 2.0);
        assert_eq!(live(&fx), 3, "still inside the period");
        emit_ambient(&mut fx, &mut t, 2.0);
        assert_eq!(live(&fx), 6, "and one more batch, at the clamped rate");
    }

    /// The three emitters land where the oracle puts them.
    #[test]
    fn emitters_sit_at_the_hearth_the_coals_and_the_room() {
        let mut fx = Particles::default();
        let mut t = AmbientTimer::default();
        for _ in 0..40 {
            emit_ambient(&mut fx, &mut t, AMBIENT_PERIOD);
        }

        let (mut hearth, mut coals, mut motes) = (0, 0, 0);
        for i in 0..fx.pool.capacity() {
            if fx.pool.life[i] <= 0.0 {
                continue;
            }
            let p = fx.pool.pos[i];
            // The mote is the only long-lived one; embers live 0.6-1.2 s.
            if fx.pool.max_life[i] >= 1.6 {
                motes += 1;
                assert!(
                    (ROOM_MIN_X as f32..=ROOM_MAX_X as f32).contains(&p.x),
                    "mote inside the room in x: {}",
                    p.x
                );
                assert!(
                    (ROOM_MIN_Z as f32..=ROOM_MAX_Z as f32).contains(&p.z),
                    "mote inside the room in z: {}",
                    p.z
                );
                assert!((0.5..=2.5).contains(&p.y), "mote height: {}", p.y);
            } else if p.x < -7.4 {
                hearth += 1;
                // y is NOT jittered by `ember()` — only x and z are.
                assert!((0.55..=0.95).contains(&p.y), "hearth height: {}", p.y);
                assert!((-1.0..=1.4).contains(&p.z), "hearth spread: {}", p.z);
            } else {
                coals += 1;
                assert!((1.5..=1.8).contains(&p.y), "coal height: {}", p.y);
                // -2.6 ± 0.45 from the emitter, ± 0.08 from `ember()`'s jitter.
                assert!((-3.13..=-2.07).contains(&p.z), "coal z: {}", p.z);
            }
        }
        assert!(
            hearth > 0 && coals > 0 && motes > 0,
            "all three emitters ran"
        );
        assert_eq!(hearth, coals, "the two embers come in pairs");
        assert_eq!(motes, hearth, "one mote per batch");
    }

    /// `clear()` retires every slot, rather than just stopping the spawner.
    #[test]
    fn clearing_retires_every_slot() {
        let mut fx = Particles::default();
        let mut t = AmbientTimer::default();
        for _ in 0..10 {
            emit_ambient(&mut fx, &mut t, AMBIENT_PERIOD);
        }
        assert!(live(&fx) > 0);
        fx.pool.clear();
        assert_eq!(live(&fx), 0);
        assert_eq!(fx.pool.live, 0);
    }

    /// The convenience constructor carries the oracle's default count.
    #[test]
    fn spark_burst_defaults_to_ten() {
        let b = SparkBurst::new(Vec3::ZERO, Vec2::X);
        assert_eq!(b.count, 10);
    }
}
