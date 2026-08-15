// Parity test suite for Molten Lava Marble Scar Noise Shader.
// Replicates legacy/src/game/pinball-knight/fx/elements/molten.ts

use pk_core::marble::molten_fx::{
    sample_molten_scar, worley01, MELT_CHAR_RAMP, MELT_LIFETIME_SECONDS, MELT_SEAM_RAMP,
};

#[test]
fn worley_noise_is_bounded_and_continuous() {
    for i in 0..10 {
        for j in 0..10 {
            let u = i as f64 * 0.1;
            let v = j as f64 * 0.1;
            let d = worley01(u, v);
            assert!(d >= 0.0 && d <= 1.0);
        }
    }
}

#[test]
fn molten_scar_samples_hot_fissures_and_cools_to_char() {
    // Fresh scar at t=0.0
    let mut found_seam = false;
    let mut found_char = false;

    for i in 0..10 {
        for j in 0..10 {
            let u = (i as f64 - 5.0) * 0.1;
            let v = (j as f64 - 5.0) * 0.1;
            let (idx, alpha) = sample_molten_scar(u, v, 0.0);
            if alpha > 0.0 {
                if MELT_SEAM_RAMP.contains(&idx) {
                    found_seam = true;
                }
                if MELT_CHAR_RAMP.contains(&idx) {
                    found_char = true;
                }
            }
        }
    }
    assert!(found_seam, "Fresh scar should have hot magma fissures");
    assert!(found_char, "Fresh scar should have crust plates");

    // Cooled scar at t=3.6s (past 3.5s cooling threshold)
    let (cool_idx, cool_alpha) = sample_molten_scar(0.1, 0.1, 3.6);
    assert!(cool_alpha > 0.0);
    assert!(
        MELT_CHAR_RAMP.contains(&cool_idx),
        "Cooled scar should contain only dead char plates"
    );

    // Dead scar past lifetime
    let (_, dead_alpha) = sample_molten_scar(0.1, 0.1, MELT_LIFETIME_SECONDS + 0.1);
    assert_eq!(dead_alpha, 0.0);
}
