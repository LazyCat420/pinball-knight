// Parity test for Synthesized Weapons & Combat SFX.
// Replicates legacy/src/game/pinball-knight/sfx/weapons.ts, sfx/combat.ts

use pk_audio::{OfflineSfx, Patch};

#[test]
fn weapons_and_combat_patches_render_valid_waveforms() {
    let sfx = OfflineSfx::new(false, 1.0, 44100.0);

    let patches = [
        Patch::Swing,
        Patch::HeavySwing,
        Patch::Hit,
        Patch::Hurt,
        Patch::Gun,
        Patch::Bow,
        Patch::Flame,
        Patch::Freeze,
    ];

    for patch in patches {
        sfx.play(patch);
        let samples = sfx.render_seconds(0.5);

        assert!(
            !samples.is_empty(),
            "Patch {patch:?} must produce rendered samples"
        );

        let mut has_sound = false;
        for s in &samples {
            assert!(!s.is_nan(), "Sample must not be NaN for {patch:?}");
            assert!(!s.is_infinite(), "Sample must not be Inf for {patch:?}");
            if s.abs() > 1e-4 {
                has_sound = true;
            }
        }

        assert!(
            has_sound,
            "Patch {patch:?} produced only silent zero samples"
        );
    }
}
