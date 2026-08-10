//! The keepers — cast data and the idle-loop math of
//! `legacy/src/scenes/tavern/npcs.ts`, with the THREE meshes stripped out.
//!
//! Art is the dungeon's `NPC_PAINTS` (single static frames), so personality
//! comes from MOTION: each keeper gets a distinct idle curve, and two of them
//! (the smith's hammer, the tout's darts) are real work loops with a strike
//! beat the VFX and audio hang off. The shell reads the pose this sim
//! produces; the sim never touches a mesh.

use super::layout::KEEPER_SPOTS;

/// How a keeper idles (legacy `Idle`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Idle {
    /// Slow breathing bob — the default "standing about".
    Bob,
    /// Bob plus a side-to-side sway: wiping a glass down at the bar.
    Polish,
    /// A wind-up and a sharp drop. Emits a strike beat for sparks + sound.
    Hammer,
    /// A shuffling, fidgety rhythm — hands busy with cards.
    Deal,
    /// Aim, hold, release at the wall dartboard. Emits a throw beat.
    Dart,
}

/// What a keeper's idle loop just did, for the caller's VFX and audio.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeeperBeat {
    /// The smith's hammer landed.
    Anvil,
    /// The gambler's dart hit the board.
    Dart,
    /// A keeper noticed you walk up.
    Greet,
}

#[derive(Debug, Clone, Copy)]
pub struct KeeperSpec {
    pub id: &'static str,
    pub paint_key: &'static str,
    pub x: f64,
    pub z: f64,
    pub idle: Idle,
    /// Mirror while WORKING (+1 faces +x, -1 faces -x), chosen so each keeper
    /// faces the prop they're using — noticing you means breaking off.
    pub home: f64,
    /// Optional tint over the art when a paint has to be reused. Nothing sets
    /// it today — every keeper has their own painter.
    pub tint: Option<u32>,
}

/// The dungeon cel-painter's NPC roster (legacy `NPC_PAINTS` keys). The
/// painters themselves are P3 scope; the KEYS are pinned here so the cast
/// join below can assert its art exists, exactly as npcs.test.ts does.
pub const NPC_PAINT_KEYS: [&str; 5] = ["magician", "witch", "frog", "merchant", "tout"];

struct Role {
    paint_key: &'static str,
    idle: Idle,
    home: f64,
}

/// Art + idle style per station (legacy `KEEPER_ROLES`). Positions come from
/// the floor plan.
fn role_of(id: &str) -> Option<Role> {
    match id {
        "forge" => Some(Role {
            paint_key: "merchant",
            idle: Idle::Hammer,
            home: -1.0,
        }), // forge sits west of him
        "bar" => Some(Role {
            paint_key: "witch",
            idle: Idle::Polish,
            home: 1.0,
        }), // bar counter east
        "dealer" => Some(Role {
            paint_key: "magician",
            idle: Idle::Deal,
            home: 1.0,
        }), // card table east
        "armory" => Some(Role {
            paint_key: "frog",
            idle: Idle::Bob,
            home: -1.0,
        }), // bench west
        "gambler" => Some(Role {
            paint_key: "tout",
            idle: Idle::Dart,
            home: 1.0,
        }),
        _ => None,
    }
}

/// The cast actually built, joining placement (`layout`) to role. A spot with
/// no role, or a role naming art that doesn't exist, is DROPPED silently —
/// which is exactly why the tests count the join.
pub fn keepers() -> Vec<KeeperSpec> {
    KEEPER_SPOTS
        .iter()
        .filter_map(|spot| {
            let role = role_of(spot.id)?;
            Some(KeeperSpec {
                id: spot.id,
                paint_key: role.paint_key,
                x: spot.x,
                z: spot.z,
                idle: role.idle,
                home: role.home,
                tint: None,
            })
        })
        .collect()
}

/// Seconds per hammer cycle. Slow enough to read as work, not as a twitch.
pub const HAMMER_PERIOD: f64 = 2.1;
/// Seconds per dart cycle. Longer than the hammer — he aims before he throws.
pub const DART_PERIOD: f64 = 2.9;

/// Where the smith's anvil stands (props) — not where the smith stands.
pub const ANVIL: (f64, f64, f64) = (-6.2, 0.62, -1.3);
/// The wall dartboard (props), a hair off the wall so sparks read.
pub const DARTBOARD: (f64, f64, f64) = (5.9, 1.9, 6.6);

/// Ease `v` toward `target` at `rate` per second, without overshooting.
fn approach(v: f64, target: f64, rate: f64, dt: f64) -> f64 {
    let d = target - v;
    v + d.signum() * d.abs().min(rate * dt)
}

/// Position within a loop, 0..1. Safe for a negative clock.
pub fn phase01(t: f64, period: f64) -> f64 {
    (((t % period) + period) % period) / period
}

/// A keeper's live animation state (the fields legacy kept per mesh).
#[derive(Debug, Clone)]
pub struct KeeperState {
    pub spec: KeeperSpec,
    /// Phase offset so the keepers never move in lockstep (`i * 1.37`).
    pub phase: f64,
    /// Rising edge of a work beat, for one-shot spark/sfx per swing or throw.
    pub struck: bool,
    /// 0..1, eased. How much this keeper has broken off work to look at you.
    pub attention: f64,
    /// Signed mirror, eased through zero so a flip reads as turning round.
    pub face: f64,
    /// Counts 1→0 across the one-shot greeting beat.
    pub greet: f64,
    /// Latches the rising edge of focus so the greeting fires once per approach.
    pub noticed: bool,
}

/// What one keeper looks like this frame — the shell paints exactly this.
#[derive(Debug, Clone, Copy)]
pub struct KeeperPose {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Signed mirror scale for the billboard's x. Never exactly 0 (a
    /// zero-determinant matrix NaNs the normal maths).
    pub scale_x: f64,
    /// Lean, radians about z.
    pub rot_z: f64,
}

/// A spark burst a work beat wants emitted (position + velocity + count),
/// mirroring the legacy `vfx.sparks(...)` calls so the shell can honour them.
#[derive(Debug, Clone, Copy)]
pub struct SparkRequest {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub count: u32,
}

pub struct KeeperFrameOut {
    pub pose: KeeperPose,
    pub beats: Vec<(KeeperBeat, f64, f64, f64)>,
    pub sparks: Vec<SparkRequest>,
}

pub fn build_keeper_states() -> Vec<KeeperState> {
    keepers()
        .into_iter()
        .enumerate()
        .map(|(i, spec)| {
            let home = spec.home;
            KeeperState {
                spec,
                phase: i as f64 * 1.37,
                struck: false,
                attention: 0.0,
                face: home,
                greet: 0.0,
                noticed: false,
            }
        })
        .collect()
}

/// One keeper's frame — the exact update math from legacy `buildNpcs().update`.
/// `focus_id` is the station the player is standing at (from station focus,
/// never a second distance scan — the keeper, the spotlight and the prompt
/// must never disagree about whether you have arrived).
pub fn update_keeper(
    k: &mut KeeperState,
    time: f64,
    dt: f64,
    focus_id: Option<&str>,
    player_x: f64,
) -> KeeperFrameOut {
    let t = time + k.phase;
    let mut beats = Vec::new();
    let mut sparks = Vec::new();

    // ── Being approached ──
    let attentive = focus_id == Some(k.spec.id);
    if attentive && !k.noticed {
        k.noticed = true;
        k.greet = 1.0;
        beats.push((KeeperBeat::Greet, k.spec.x, 1.0, k.spec.z));
    } else if !attentive {
        k.noticed = false;
    }
    k.attention = approach(k.attention, if attentive { 1.0 } else { 0.0 }, 3.0, dt);
    k.greet = (k.greet - dt * 1.7).max(0.0);

    // Turn to face you, or back to the work — a mirror eased THROUGH zero.
    let want = if attentive {
        if player_x >= k.spec.x {
            1.0
        } else {
            -1.0
        }
    } else {
        k.spec.home
    };
    k.face = approach(k.face, want, 7.0, dt);
    let scale_x = if k.face.abs() < 0.06 {
        0.06 * if want >= 0.0 { 1.0 } else { -1.0 }
    } else {
        k.face
    };

    // A single dip of the head on the frame you walk up, and a small lean held
    // while you stand there — background characters, deliberately small.
    let greet_hop = libm::sin((1.0 - k.greet) * std::f64::consts::PI) * 0.075;
    let mut rz = k.attention * 0.05 * if player_x >= k.spec.x { -1.0 } else { 1.0 };
    let mut y = greet_hop; // baseY is 0
    let mut x = k.spec.x;

    // ── Idle loop ──
    match k.spec.idle {
        Idle::Bob => {
            y += libm::sin(t * 1.5) * 0.035;
        }
        Idle::Polish => {
            // Vertical breath plus a horizontal wipe, at different rates so the
            // two never sync into a single circular motion.
            y += libm::sin(t * 1.7) * 0.03;
            x += libm::sin(t * 2.9) * 0.055;
        }
        Idle::Deal => {
            // Quick, fidgety, with a pause: |sin| gives a shuffle-and-settle
            // rhythm rather than a smooth oscillation.
            y += libm::sin(t * 2.6).abs() * 0.05;
            rz += libm::sin(t * 1.9) * 0.03;
        }
        Idle::Hammer => {
            // Wind up slowly over most of the cycle, drop fast at the end. The
            // asymmetry is the whole read.
            let p = phase01(t, HAMMER_PERIOD);
            let lift = if p < 0.72 {
                libm::sin((p / 0.72) * std::f64::consts::PI * 0.5) * 0.14
            } else {
                (1.0 - (p - 0.72) / 0.1).max(0.0) * 0.14
            };
            y += lift;

            let striking = p >= 0.8;
            if striking && !k.struck {
                k.struck = true;
                // Spark at the anvil, not at the keeper.
                sparks.push(SparkRequest {
                    x: ANVIL.0,
                    y: ANVIL.1,
                    z: ANVIL.2,
                    vx: 0.4,
                    vy: 0.9,
                    count: 7,
                });
                beats.push((KeeperBeat::Anvil, ANVIL.0, ANVIL.1, ANVIL.2));
            } else if !striking {
                k.struck = false;
            }
        }
        Idle::Dart => {
            // The mirror of the hammer: a long LEAN BACK to sight the board,
            // then a snap forward — same rising-edge trick, opposite silhouette.
            let p = phase01(t, DART_PERIOD);
            let aim = if p < 0.62 {
                libm::sin((p / 0.62) * std::f64::consts::PI * 0.5)
            } else {
                (1.0 - (p - 0.62) / 0.07).max(0.0)
            };
            y += aim * 0.03;
            rz += -aim * 0.1 * k.spec.home; // rock away from the board, then whip back

            let throwing = (0.66..0.9).contains(&p);
            if throwing && !k.struck {
                k.struck = true;
                // Land it on the board on the wall, not on him.
                sparks.push(SparkRequest {
                    x: DARTBOARD.0,
                    y: DARTBOARD.1,
                    z: DARTBOARD.2,
                    vx: 0.15,
                    vy: -0.6,
                    count: 5,
                });
                beats.push((KeeperBeat::Dart, DARTBOARD.0, DARTBOARD.1, DARTBOARD.2));
            } else if !throwing {
                k.struck = false;
            }
        }
    }

    KeeperFrameOut {
        pose: KeeperPose {
            x,
            y,
            z: k.spec.z,
            scale_x,
            rot_z: rz,
        },
        beats,
        sparks,
    }
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/npcs.test.ts`, case for case,
    //! plus behavioural pins on the beat edges the shell hangs sound off.
    use super::*;
    use crate::jsmath::js_hypot;
    use crate::tavern::layout::{KEEPER_SPOTS, STATIONS};
    use std::collections::HashMap;

    #[test]
    fn builds_a_body_for_every_placed_keeper_nobody_is_silently_dropped() {
        let mut built: Vec<_> = keepers().iter().map(|k| k.id).collect();
        let mut placed: Vec<_> = KEEPER_SPOTS.iter().map(|k| k.id).collect();
        built.sort_unstable();
        placed.sort_unstable();
        assert_eq!(built, placed);
    }

    #[test]
    fn the_gamblers_cabinet_is_staffed() {
        assert!(
            keepers().iter().any(|k| k.id == "gambler"),
            "no keeper at the gambler station"
        );
        assert!(STATIONS.iter().any(|s| s.id == "gambler"));
    }

    #[test]
    fn every_keeper_names_art_that_actually_exists() {
        for k in keepers() {
            assert!(
                NPC_PAINT_KEYS.contains(&k.paint_key),
                "keeper {:?} has no art for {:?}",
                k.id,
                k.paint_key
            );
        }
    }

    #[test]
    fn takes_its_position_from_the_floor_plan_never_its_own_copy() {
        for k in keepers() {
            let spot = KEEPER_SPOTS.iter().find(|s| s.id == k.id).unwrap();
            assert_eq!(k.x, spot.x);
            assert_eq!(k.z, spot.z);
        }
    }

    #[test]
    fn gives_the_gambler_a_work_loop_with_a_beat_not_another_idle_bob() {
        let mut beats: Vec<_> = keepers()
            .iter()
            .filter(|k| k.idle == Idle::Hammer || k.idle == Idle::Dart)
            .map(|k| k.id)
            .collect();
        beats.sort_unstable();
        assert_eq!(beats, vec!["forge", "gambler"]);
    }

    #[test]
    fn reuses_art_only_across_the_room_never_side_by_side() {
        let mut by_paint: HashMap<&str, Vec<KeeperSpec>> = HashMap::new();
        for k in keepers() {
            by_paint.entry(k.paint_key).or_default().push(k);
        }
        for (paint, sharing) in by_paint {
            if sharing.len() < 2 {
                continue;
            }
            for i in 0..sharing.len() {
                for j in i + 1..sharing.len() {
                    let d = js_hypot(sharing[i].x - sharing[j].x, sharing[i].z - sharing[j].z);
                    assert!(
                        d > 8.0,
                        "{:?} and {:?} share {paint:?} and stand {d:.1} apart",
                        sharing[i].id,
                        sharing[j].id
                    );
                }
            }
            // ...and all but one of them is re-tinted, so they aren't clones.
            assert_eq!(
                sharing.iter().filter(|k| k.tint.is_none()).count(),
                1,
                "every {paint:?} is untinted"
            );
        }
    }

    #[test]
    fn faces_each_keeper_at_their_own_work_so_approaching_them_is_a_real_turn() {
        for k in keepers() {
            let s = STATIONS.iter().find(|x| x.id == k.id).unwrap();
            let toward_player = if s.x >= k.x { 1.0 } else { -1.0 };
            assert_eq!(
                k.home, -toward_player,
                "keeper {:?} already faces the player's spot; they will never turn",
                k.id
            );
        }
    }

    // ── Beat-edge pins (the sound/spark contract the shell relies on) ──

    #[test]
    fn the_hammer_lands_exactly_once_per_cycle() {
        let mut states = build_keeper_states();
        let smith = states.iter_mut().find(|k| k.spec.id == "forge").unwrap();
        let dt = 1.0 / 60.0;
        let mut anvils = 0;
        let mut t = 0.0;
        // Three full hammer periods.
        while t < HAMMER_PERIOD * 3.0 {
            let out = update_keeper(smith, t, dt, None, 0.0);
            anvils += out
                .beats
                .iter()
                .filter(|(b, ..)| *b == KeeperBeat::Anvil)
                .count();
            t += dt;
        }
        assert_eq!(anvils, 3, "one strike per cycle, rising-edge latched");
    }

    #[test]
    fn a_greet_fires_once_per_approach_and_rearms_on_leaving() {
        let mut states = build_keeper_states();
        let bar = states.iter_mut().find(|k| k.spec.id == "bar").unwrap();
        let dt = 1.0 / 60.0;
        let count_greets = |out: &KeeperFrameOut| {
            out.beats
                .iter()
                .filter(|(b, ..)| *b == KeeperBeat::Greet)
                .count()
        };
        let mut greets = 0;
        for i in 0..30 {
            greets += count_greets(&update_keeper(bar, i as f64 * dt, dt, Some("bar"), 5.0));
        }
        assert_eq!(greets, 1, "greeting fires once per approach");
        // Walk away, then back: it re-arms.
        for i in 30..40 {
            update_keeper(bar, i as f64 * dt, dt, None, 5.0);
        }
        let again = count_greets(&update_keeper(bar, 40.0 * dt, dt, Some("bar"), 5.0));
        assert_eq!(again, 1, "greeting re-arms after leaving");
    }

    #[test]
    fn the_billboard_mirror_never_reaches_zero() {
        let mut states = build_keeper_states();
        let smith = states.iter_mut().find(|k| k.spec.id == "forge").unwrap();
        let dt = 1.0 / 60.0;
        // Approach from the east so the turn eases from -1 toward +1 through 0.
        for i in 0..120 {
            let out = update_keeper(smith, i as f64 * dt, dt, Some("forge"), 0.0);
            assert!(
                out.pose.scale_x.abs() >= 0.06 - 1e-12,
                "scale reached {} at frame {i}",
                out.pose.scale_x
            );
        }
    }
}
