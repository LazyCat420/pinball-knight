// Parity test suite for Oil and Tar Viscous Fluid Shader Math.
// Replicates legacy/src/game/pinball-knight/fx/elements/goo.ts

use pk_core::fx::goo::{sample_goo, GooOpts, OIL_RAMP, TAR_RAMP};

#[test]
fn oil_sampling_uses_oil_ramp_and_iridescent_sheen() {
    let opts = GooOpts::oil();
    assert_eq!(opts.film, 1.0);
    assert_eq!(opts.rim, 0.9);
    assert_eq!(opts.flow, 1.0);

    for x in 0..10 {
        for y in 0..10 {
            let u = x as f64 / 10.0;
            let v = y as f64 / 10.0;
            let (idx, alpha) = sample_goo(u, v, 1.5, opts, false);
            assert!(OIL_RAMP.contains(&idx), "Oil index {} not in OIL_RAMP", idx);
            assert!(alpha >= 0.0 && alpha <= 1.0);
        }
    }
}

#[test]
fn tar_sampling_uses_tar_ramp_and_matte_finish() {
    let opts = GooOpts::tar();
    assert_eq!(opts.film, 0.0);
    assert_eq!(opts.rim, 0.0);
    assert_eq!(opts.flow, 0.12);

    for x in 0..10 {
        for y in 0..10 {
            let u = x as f64 / 10.0;
            let v = y as f64 / 10.0;
            let (idx, alpha) = sample_goo(u, v, 1.5, opts, true);
            assert!(TAR_RAMP.contains(&idx), "Tar index {} not in TAR_RAMP", idx);
            assert!(alpha >= 0.0 && alpha <= 1.0);
        }
    }
}
