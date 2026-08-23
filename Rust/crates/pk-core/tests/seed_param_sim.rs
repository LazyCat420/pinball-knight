// Parity test suite for Seed Query Parameter Resolver.
// Replicates legacy/src/game/pinball-knight/boot/seed-param.ts

use pk_core::boot::seed_param::parse_seed_param;

#[test]
fn seed_param_explicit_query_takes_precedence() {
    let seed = parse_seed_param(Some("12345"), Some(999));
    assert_eq!(seed, Some(12345));

    let neg_seed = parse_seed_param(Some("-42"), Some(999));
    assert_eq!(neg_seed, Some(42));
}

#[test]
fn seed_param_falls_back_to_ghost_seed_when_absent_or_invalid() {
    let absent = parse_seed_param(None, Some(777));
    assert_eq!(absent, Some(777));

    let invalid = parse_seed_param(Some("not-a-number"), Some(777));
    assert_eq!(invalid, Some(777));

    let none = parse_seed_param(None, None);
    assert_eq!(none, None);
}
