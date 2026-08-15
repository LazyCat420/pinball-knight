//! Seed Query Parameter Resolver — Prioritizes explicit `?seed=` URL queries over standing developer ghost maze seeds.
//!
//! PORTS: `boot/seed-param.ts`

/// Resolves the run seed from an optional URL query string and developer ghost seed fallback.
pub fn parse_seed_param(raw: Option<&str>, ghost_seed: Option<u32>) -> Option<u32> {
    match raw {
        Some(s) => match s.trim().parse::<i64>() {
            Ok(n) => {
                let clamped = ((n.abs() as u64) % 0x7fffffff) as u32;
                Some(clamped)
            }
            Err(_) => ghost_seed,
        },
        None => ghost_seed,
    }
}
