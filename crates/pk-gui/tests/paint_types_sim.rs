// Parity test suite for Actor Cel-Painting Vocabulary.
// Replicates legacy/src/game/pinball-knight/engine/render/paint-types.ts

use pk_gui::render::paint_types::{ActorBeats, ClipName, Dir};

#[test]
fn directional_facings_count_and_default() {
    assert_eq!(Dir::ALL.len(), 3);
    assert_eq!(Dir::default(), Dir::South);
}

#[test]
fn all_twenty_two_clips_are_cataloged() {
    assert_eq!(ClipName::ALL.len(), 22);

    // Marble bodies
    assert!(ClipName::Ball.is_marble_body());
    assert!(ClipName::Steelball.is_marble_body());
    assert!(ClipName::Diamondball.is_marble_body());
    assert!(ClipName::Waterball.is_marble_body());
    assert!(ClipName::Stoneball.is_marble_body());
    assert!(ClipName::Stormball.is_marble_body());
    assert!(ClipName::Shadowball.is_marble_body());
    assert!(ClipName::Lavaball.is_marble_body());
    assert!(!ClipName::Idle.is_marble_body());

    // Telegraph tells
    assert!(ClipName::Crouch.is_telegraph());
    assert!(ClipName::Wait.is_telegraph());
    assert!(ClipName::Wake.is_telegraph());
    assert!(ClipName::Stumble.is_telegraph());
    assert!(!ClipName::Attack.is_telegraph());
}

#[test]
fn actor_beats_rate_scaling() {
    let mut beats = ActorBeats::new();
    assert_eq!(beats.get_beat(ClipName::Walk, 8), 8);

    beats.set_beat(ClipName::Walk, 4);
    assert_eq!(beats.get_beat(ClipName::Walk, 8), 4);
}
