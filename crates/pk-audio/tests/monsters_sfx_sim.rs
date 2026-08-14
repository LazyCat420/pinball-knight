// Parity test for Synthesized Monsters, NPCs & World Pickups SFX.
// Replicates legacy/src/game/pinball-knight/sfx/monsters.ts, sfx/world.ts

use pk_audio::{OfflineSfx, Patch};

#[test]
fn monsters_npcs_and_world_patches_render_valid_waveforms() {
    let sfx = OfflineSfx::new(false, 1.0, 44100.0);

    let patches = [
        Patch::Groan,
        Patch::ZombieDie,
        Patch::Goblin,
        Patch::Cackle,
        Patch::Ribbit,
        Patch::CartBell { near: 0.8 },
        Patch::Pickup,
        Patch::Trapdoor,
    ];

    for patch in patches {
        sfx.play(patch);
        let samples = sfx.render_seconds(0.6);

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

#[test]
fn cart_bell_scales_amplitude_with_proximity() {
    let sfx_near = OfflineSfx::new(false, 1.0, 44100.0);
    sfx_near.play(Patch::CartBell { near: 1.0 });
    let samples_near = sfx_near.render_seconds(0.3);
    let peak_near = samples_near.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));

    let sfx_far = OfflineSfx::new(false, 1.0, 44100.0);
    sfx_far.play(Patch::CartBell { near: 0.0 });
    let samples_far = sfx_far.render_seconds(0.3);
    let peak_far = samples_far.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));

    assert!(
        peak_near > peak_far,
        "Near cart bell peak ({peak_near}) must be louder than distant cart bell peak ({peak_far})"
    );
}
