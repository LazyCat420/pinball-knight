// Parity test suite for GPU Part Instancer.
// Replicates legacy/src/game/pinball-knight/render/part-instancer.ts

use pk_gui::render::part_instancer::PartInstancer;

#[test]
fn part_instancer_batching_and_emissive_updating() {
    let mut instancer = PartInstancer::new();

    let identity = [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];

    let idx0 = instancer.add_instance("booster", identity, 0.0);
    let idx1 = instancer.add_instance("booster", identity, 0.5);
    let idx2 = instancer.add_instance("kicker", identity, 1.0);

    assert_eq!(idx0, 0);
    assert_eq!(idx1, 1);
    assert_eq!(idx2, 0);

    assert_eq!(instancer.count("booster"), 2);
    assert_eq!(instancer.count("kicker"), 1);
    assert_eq!(instancer.total_instances(), 3);

    // Update emissive on booster instance 0
    instancer.set_emissive("booster", 0, 0.85);
    let booster_bucket = instancer
        .buckets
        .iter()
        .find(|b| b.kind == "booster")
        .unwrap();
    assert_eq!(booster_bucket.emissives[0], 0.85);
    assert_eq!(booster_bucket.emissives[1], 0.5);
}
