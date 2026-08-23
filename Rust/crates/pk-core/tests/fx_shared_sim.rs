// Parity test suite for Particle Pool Shared Constants.
// Replicates legacy/src/game/pinball-knight/fx/pools/shared.ts

use pk_core::fx::shared::{
    c_blood_g, c_blood_r, c_dust, c_ember, c_spark, c_spark2, DEFAULT_PPU, PARTICLE_SCALE,
};

#[test]
fn particle_scale_derives_from_ppu() {
    assert!((PARTICLE_SCALE - (1.0 / DEFAULT_PPU)).abs() < 1e-6);
}

#[test]
fn shared_linear_colors_are_within_unit_interval() {
    let colors = [c_spark(), c_spark2(), c_ember(), c_dust()];
    for c in colors {
        for ch in c {
            assert!(ch >= 0.0 && ch <= 1.0);
        }
    }

    for bg in c_blood_g() {
        for ch in bg {
            assert!(ch >= 0.0 && ch <= 1.0);
        }
    }

    for br in c_blood_r() {
        for ch in br {
            assert!(ch >= 0.0 && ch <= 1.0);
        }
    }
}
