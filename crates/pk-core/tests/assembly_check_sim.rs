// Simulation test suite for Pinball Assembly Library and Validation.
// Replicates legacy/src/game/pinball-knight/maze/assembly-check.ts and assembly-lib.ts

use pk_core::maze::assembly_check::{check_all, check_assembly};
use pk_core::maze::assembly_lib::{machine_named, MACHINES};

#[test]
fn all_canonical_machines_pass_validation() {
    let problems = check_all(&MACHINES);
    assert!(
        problems.is_empty(),
        "Canonical machines in assembly library must have 0 validation problems, found: {:?}",
        problems
    );
}

#[test]
fn machine_named_finds_all_defined_machines() {
    assert!(machine_named("orbit").is_some());
    assert!(machine_named("ramp-return").is_some());
    assert!(machine_named("target-bank").is_some());
    assert!(machine_named("pop-nest").is_some());
    assert!(machine_named("sling-pair").is_some());
    assert!(machine_named("kicker-lane").is_some());
    assert!(machine_named("spinner-gate").is_some());
    assert!(machine_named("rollover-bank").is_some());
    assert!(machine_named("non-existent-machine").is_none());
}
