//! What the patches actually SOUND like, asserted on rendered samples.
//!
//! These run against `OfflineSfx` — the software renderer in `pk_audio::soft`
//! driven by a clock that only moves when we render. That is deliberate and it
//! is the only way this file can exist: it needs no audio device, no ALSA, no
//! browser and no wall-clock timing, so it is identical on the dev box, in CI
//! and on the Windows play target.
//!
//! The assertions are on LEVELS and SHAPE, not on node counts. A node count is
//! not a musical property and would pass by accident — the legacy suite made
//! the same call (`sfx-snapshot.test.ts` asserts note pitches and contours).

use pk_audio::{OfflineSfx, Patch};

const SR: f32 = 44_100.0;

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// The samples covering `[from, to)` seconds of a render that started at 0.
fn window(samples: &[f32], from: f64, to: f64) -> &[f32] {
    let a = ((from * SR as f64) as usize).min(samples.len());
    let b = ((to * SR as f64) as usize).min(samples.len());
    &samples[a..b]
}

#[test]
fn plunger_renders_audible_audio() {
    let sfx = OfflineSfx::new(false, 1.0, SR);
    sfx.play(Patch::Plunger);
    let out = sfx.render_seconds(1.0);

    assert_eq!(out.len(), SR as usize, "render length follows the clock");

    let p = peak(&out);
    // Above the noise floor, and nowhere near clipping: the sting's own gain
    // literal is 0.07 and the master is unity at volume 1.0. A peak at or
    // above 1.0 would mean the master curve or an envelope had inverted.
    assert!(p > 0.01, "plunger peaked at {p}, inaudible");
    assert!(p < 0.6, "plunger peaked at {p}, far too hot");

    let r = rms(&out);
    assert!(r > 0.0, "plunger rendered silence");

    // It is a 0.52 s sting inside a 1 s render, so the tail must be quiet —
    // this is what catches an envelope that never releases.
    let tail = rms(window(&out, 0.7, 1.0));
    assert!(tail < r * 0.05, "plunger tail {tail} against body {r}");
}

#[test]
fn muted_renders_pure_silence() {
    let sfx = OfflineSfx::new(true, 1.0, SR);
    // Everything the game can ask for, at once.
    for patch in [
        Patch::StationFocus,
        Patch::KeeperGreet,
        Patch::Plunger,
        Patch::Anvil,
        Patch::roll(),
        Patch::Break,
        Patch::Coin,
        Patch::bumper(),
        Patch::level_start(),
    ] {
        sfx.play(patch);
    }
    sfx.bed_start();
    let out = sfx.render_seconds(1.0);

    assert!(!out.is_empty());
    assert!(
        out.iter().all(|s| *s == 0.0),
        "muted render peaked at {}",
        peak(&out)
    );
}

#[test]
fn unmuting_restores_the_level_the_player_chose() {
    // Mute is a gate, not a volume: turning sound off and back on must come
    // back at the chosen level rather than jumping to full.
    let sfx = OfflineSfx::new(true, 0.5, SR);
    sfx.set_master(false, 0.5);
    sfx.play(Patch::Plunger);
    let quiet = peak(&sfx.render_seconds(1.0));

    let loud_sfx = OfflineSfx::new(false, 1.0, SR);
    loud_sfx.play(Patch::Plunger);
    let loud = peak(&loud_sfx.render_seconds(1.0));

    assert!(quiet > 0.0, "unmuted render is silent");
    // gain = volume², so 0.5 is a quarter of the amplitude.
    let ratio = quiet / loud;
    assert!(
        (ratio - 0.25).abs() < 0.02,
        "0.5 volume rendered at {ratio} of full"
    );
}

#[test]
fn tavern_bed_fades_in() {
    let sfx = OfflineSfx::new(false, 1.0, SR);
    sfx.bed_start();
    let out = sfx.render_seconds(2.0);

    // The fade is 1.2 s, so 0.1 s in is ~8% of the way up and 1.5 s in is
    // fully arrived. A bed that started at full level (the bug a fade exists
    // to prevent) would make these equal.
    let early = rms(window(&out, 0.05, 0.15));
    let settled = rms(window(&out, 1.45, 1.55));

    assert!(early > 0.0, "bed produced nothing at all");
    assert!(
        settled > early * 3.0,
        "bed did not fade in: {early} early vs {settled} settled"
    );
}

#[test]
fn bed_start_is_idempotent() {
    let once = {
        let sfx = OfflineSfx::new(false, 1.0, SR);
        sfx.bed_start();
        rms(window(&sfx.render_seconds(2.0), 1.45, 1.55))
    };
    let twice = {
        let sfx = OfflineSfx::new(false, 1.0, SR);
        sfx.bed_start();
        sfx.bed_start();
        sfx.bed_start();
        rms(window(&sfx.render_seconds(2.0), 1.45, 1.55))
    };
    // Three beds stacked would be audibly louder; the guard is what stops
    // re-entering the tavern from piling room tone on room tone.
    assert!(
        (once - twice).abs() < once * 0.001,
        "stacked beds: {once} vs {twice}"
    );
}

#[test]
fn bed_stop_fades_out_and_ends() {
    let sfx = OfflineSfx::new(false, 1.0, SR);
    sfx.bed_start();
    let up = sfx.render_seconds(1.5);
    assert!(rms(window(&up, 1.4, 1.5)) > 0.0);

    sfx.bed_stop();
    let down = sfx.render_seconds(1.5);
    // 0.6 s fade, sources stopped at 0.65 s.
    let after = window(&down, 0.8, 1.5);
    assert!(
        rms(after) == 0.0,
        "bed still sounding after the fade: {}",
        peak(after)
    );
}

#[test]
fn coin_cluster_arpeggiates_and_caps() {
    // Twelve coins in one frame: five chimes staggered by 0.055 s, the rest
    // banked. Rendering the whole cluster and a lone coin lets us assert the
    // cap on ENERGY rather than on node counts.
    let many = {
        let sfx = OfflineSfx::new(false, 1.0, SR);
        for _ in 0..12 {
            sfx.play(Patch::Coin);
        }
        sfx.render_seconds(1.0)
    };
    let one = {
        let sfx = OfflineSfx::new(false, 1.0, SR);
        sfx.play(Patch::Coin);
        sfx.render_seconds(1.0)
    };

    assert!(rms(&many) > rms(&one), "a sweep should out-ring one coin");
    // Five staggered chimes, not twelve stacked ones: without the cap the
    // energy would scale with the coin count.
    assert!(
        rms(&many) < rms(&one) * 6.0,
        "cluster cap not holding: {} vs {}",
        rms(&many),
        rms(&one)
    );
    // The ladder ends at 5 * 0.055 + 0.045 + 0.10 ≈ 0.42 s.
    assert!(rms(window(&many, 0.6, 1.0)) == 0.0, "coin ladder overran");
}

#[test]
fn bumper_rate_limit_swallows_a_machine_gun() {
    // Same audio instant, so every repeat is inside the 90 ms gap.
    let spammed = {
        let sfx = OfflineSfx::new(false, 1.0, SR);
        for _ in 0..16 {
            sfx.play(Patch::bumper());
        }
        sfx.render_seconds(0.5)
    };
    let single = {
        let sfx = OfflineSfx::new(false, 1.0, SR);
        sfx.play(Patch::bumper());
        sfx.render_seconds(0.5)
    };
    assert!(peak(&single) > 0.0, "one bumper is silent");
    assert!(
        (peak(&spammed) - peak(&single)).abs() < 1e-6,
        "rate limit let {} through against {}",
        peak(&spammed),
        peak(&single)
    );
}

#[test]
fn level_start_offset_moves_the_sting_on_the_audio_clock() {
    let sfx = OfflineSfx::new(false, 1.0, SR);
    sfx.play(Patch::LevelStart { at_offset: 0.4 });
    let out = sfx.render_seconds(1.5);

    // Nothing before the offset, everything after it. This is the assertion
    // that would fail if the offset were applied as a frame timer instead of
    // an audio-clock schedule.
    assert!(
        peak(window(&out, 0.0, 0.39)) == 0.0,
        "level start leaked before its offset"
    );
    assert!(
        peak(window(&out, 0.4, 1.0)) > 0.001,
        "level start never arrived"
    );
}

#[test]
fn every_patch_renders_something() {
    for patch in [
        Patch::StationFocus,
        Patch::KeeperGreet,
        Patch::Plunger,
        Patch::Anvil,
        Patch::roll(),
        Patch::Break,
        Patch::Coin,
        Patch::bumper(),
        Patch::level_start(),
    ] {
        let sfx = OfflineSfx::new(false, 1.0, SR);
        sfx.play(patch);
        let out = sfx.render_seconds(1.2);
        let p = peak(&out);
        assert!(p > 0.001, "{patch:?} rendered nothing (peak {p})");
        assert!(p < 1.0, "{patch:?} clipped (peak {p})");
        assert!(
            out.iter().all(|s| s.is_finite()),
            "{patch:?} produced a non-finite sample"
        );
    }
}
