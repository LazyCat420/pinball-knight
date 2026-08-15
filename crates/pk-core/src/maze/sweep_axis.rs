//! The Sweep Axis — Depth testing vectors covering all 5 archetypes across shallow and saturated budget regimes.
//!
//! PORTS: `maze/sweep-axis.ts`

/// The level at which every `levelConfig` procedural budget has saturated.
pub const SATURATION_LEVEL: u32 = 24;

/// Shallow sweep covering all 5 archetypes at the small/sparse budget end.
pub const SHALLOW: [u32; 5] = [1, 2, 3, 4, 5];

/// Deep sweep covering all 5 archetypes at the saturated budget cap.
pub const DEEP: [u32; 5] = [24, 25, 26, 27, 28];

/// Both ends: all five archetypes, at both budget regimes.
pub const SWEEP_LEVELS: [u32; 10] = [1, 2, 3, 4, 5, 24, 25, 26, 27, 28];

/// Canonical test seeds for a whole-floor sweep.
pub const SWEEP_SEEDS: [u64; 4] = [1, 12345, 987654321, 424242];

/// Number of seeds sampled at the saturated deep end by default.
pub const DEEP_SEED_SHARE: usize = 2;

/// Returns the archetype index [0..4] for a given dungeon level on a modulo-5 cycle.
pub fn archetype_index_for_level(level: u32) -> usize {
    let f = level.max(1);
    ((f - 1) % 5) as usize
}

/// Returns whether all generation budgets on this floor have reached their maximum saturation cap.
pub fn is_level_saturated(level: u32) -> bool {
    level >= SATURATION_LEVEL
}

/// Generates all (level, seed) test pairs for a whole-floor sweep.
pub fn sweep_pairs(seeds: Option<&[u64]>, deep_seeds: Option<&[u64]>) -> Vec<(u32, u64)> {
    let s = seeds.unwrap_or(&SWEEP_SEEDS);
    let d = deep_seeds.unwrap_or_else(|| {
        let count = DEEP_SEED_SHARE.min(s.len());
        &s[..count]
    });

    let mut pairs = Vec::with_capacity(SHALLOW.len() * s.len() + DEEP.len() * d.len());
    for &lvl in &SHALLOW {
        for &seed in s {
            pairs.push((lvl, seed));
        }
    }
    for &lvl in &DEEP {
        for &seed in d {
            pairs.push((lvl, seed));
        }
    }
    pairs
}
