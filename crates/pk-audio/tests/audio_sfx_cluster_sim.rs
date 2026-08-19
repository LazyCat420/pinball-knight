// Simulation test suite for Audio SFX Cluster (pinball, combat, weapons).
// Replicates legacy/src/game/pinball-knight/sfx/pinball.ts, sfx/combat.ts, sfx/weapons.ts

use pk_audio::patches::*;
use pk_audio::soft::SoftBackend;
use pk_audio::OfflineSfx;

const SR: f32 = 44_100.0;

#[test]
fn pinball_sfx_routines_synthesize_cleanly() {
    let offline = OfflineSfx::new(false, 1.0, SR);
    let be = SoftBackend::offline(SR);
    let engine = Engine::new(be, false, 1.0);

    // Call 1:1 exported routines from sfx/pinball.ts
    sfx_bumper(Some(&engine));
    sfx_spring(Some(&engine));
    sfx_spin(Some(&engine));
    sfx_target(Some(&engine));
    sfx_roll(Some(&engine));

    // Also assert offline playback
    offline.play(pk_audio::Patch::Bumper { p: 1.0 });
    let samples = offline.render_seconds(1.0);
    assert_eq!(samples.len(), SR as usize);
}

#[test]
fn combat_sfx_routines_synthesize_cleanly() {
    let offline = OfflineSfx::new(false, 1.0, SR);
    let be = SoftBackend::offline(SR);
    let engine = Engine::new(be, false, 1.0);

    // Call 1:1 exported routines from sfx/combat.ts
    sfx_swing(Some(&engine));
    sfx_heavy(Some(&engine));
    sfx_hit(Some(&engine));
    sfx_hurt(Some(&engine));
    sfx_break(Some(&engine));

    offline.play(pk_audio::Patch::Swing);
    offline.play(pk_audio::Patch::Hit);
    let samples = offline.render_seconds(1.0);
    assert_eq!(samples.len(), SR as usize);
}

#[test]
fn weapons_sfx_routines_synthesize_cleanly() {
    let offline = OfflineSfx::new(false, 1.0, SR);
    let be = SoftBackend::offline(SR);
    let engine = Engine::new(be, false, 1.0);

    // Call 1:1 exported routines from sfx/weapons.ts
    sfx_gun(Some(&engine));
    sfx_bow(Some(&engine));
    sfx_flame(Some(&engine));
    sfx_freeze(Some(&engine));

    offline.play(pk_audio::Patch::Gun);
    offline.play(pk_audio::Patch::Freeze);
    let samples = offline.render_seconds(1.0);
    assert_eq!(samples.len(), SR as usize);
}
