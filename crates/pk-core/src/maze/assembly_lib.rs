//! Canonical pinball machine library — authored modular mechanisms.
//!
//! Port of `legacy/src/game/pinball-knight/maze/assembly-lib.ts` (305 lines).
//!
//! PORTS: `maze/assembly-lib.ts`

use std::sync::LazyLock;

use super::assembly::{
    Assembly, AssemblyPart, AssemblyPort, Dir, PortFlow, PortWay, E, N, O, S, W,
};

pub static ORBIT: LazyLock<Assembly> = LazyLock::new(|| Assembly {
    name: "orbit".to_string(),
    w: 4,
    h: 3,
    floor: vec![
        (0, 0),
        (1, 0),
        (2, 0),
        (3, 0),
        (3, 1),
        (3, 2),
        (2, 2),
        (1, 2),
        (0, 2),
    ],
    parts: vec![
        AssemblyPart {
            ci: 1,
            cj: 0,
            kind: "booster".to_string(),
            dir: E,
            dir2: None,
            role: Some("drive".to_string()),
            seq: Some(0),
        },
        AssemblyPart {
            ci: 3,
            cj: 0,
            kind: "deflector".to_string(),
            dir: E,
            dir2: Some(S),
            role: Some("turn".to_string()),
            seq: Some(1),
        },
        AssemblyPart {
            ci: 3,
            cj: 2,
            kind: "deflector".to_string(),
            dir: S,
            dir2: Some(W),
            role: Some("turn".to_string()),
            seq: Some(2),
        },
        AssemblyPart {
            ci: 1,
            cj: 2,
            kind: "booster".to_string(),
            dir: W,
            dir2: None,
            role: Some("drive".to_string()),
            seq: Some(3),
        },
    ],
    ports: vec![
        AssemblyPort {
            ci: 0,
            cj: 0,
            dir: E,
            way: PortWay::In,
            flow: PortFlow::Ballistic,
            tag: Some("upper".to_string()),
        },
        AssemblyPort {
            ci: 0,
            cj: 2,
            dir: W,
            way: PortWay::Out,
            flow: PortFlow::Ballistic,
            tag: Some("return".to_string()),
        },
    ],
});

pub static RAMP_RETURN: LazyLock<Assembly> = LazyLock::new(|| Assembly {
    name: "ramp-return".to_string(),
    w: 3,
    h: 3,
    floor: vec![
        (0, 0),
        (1, 0),
        (2, 0),
        (2, 1),
        (0, 2),
        (1, 2),
        (2, 2),
    ],
    parts: vec![
        AssemblyPart {
            ci: 0,
            cj: 0,
            kind: "ramp".to_string(),
            dir: E,
            dir2: None,
            role: Some("drive".to_string()),
            seq: Some(0),
        },
        AssemblyPart {
            ci: 2,
            cj: 0,
            kind: "deflector".to_string(),
            dir: E,
            dir2: Some(S),
            role: Some("turn".to_string()),
            seq: Some(1),
        },
        AssemblyPart {
            ci: 2,
            cj: 2,
            kind: "spring".to_string(),
            dir: W,
            dir2: None,
            role: Some("drive".to_string()),
            seq: Some(2),
        },
    ],
    ports: vec![
        AssemblyPort {
            ci: 0,
            cj: 0,
            dir: E,
            way: PortWay::In,
            flow: PortFlow::Ballistic,
            tag: Some("ramp".to_string()),
        },
        AssemblyPort {
            ci: 0,
            cj: 2,
            dir: W,
            way: PortWay::Out,
            flow: PortFlow::Eject,
            tag: Some("return".to_string()),
        },
    ],
});

pub static TARGET_BANK: LazyLock<Assembly> = LazyLock::new(|| Assembly {
    name: "target-bank".to_string(),
    w: 3,
    h: 2,
    floor: vec![
        (0, 0),
        (1, 0),
        (2, 0),
        (0, 1),
        (1, 1),
        (2, 1),
    ],
    parts: vec![
        AssemblyPart {
            ci: 0,
            cj: 1,
            kind: "target".to_string(),
            dir: N,
            dir2: None,
            role: Some("score".to_string()),
            seq: Some(0),
        },
        AssemblyPart {
            ci: 1,
            cj: 1,
            kind: "target".to_string(),
            dir: N,
            dir2: None,
            role: Some("score".to_string()),
            seq: Some(1),
        },
        AssemblyPart {
            ci: 2,
            cj: 1,
            kind: "target".to_string(),
            dir: N,
            dir2: None,
            role: Some("score".to_string()),
            seq: Some(2),
        },
    ],
    ports: vec![AssemblyPort {
        ci: 1,
        cj: 0,
        dir: S,
        way: PortWay::In,
        flow: PortFlow::Ballistic,
        tag: Some("face".to_string()),
    }],
});

pub static POP_NEST: LazyLock<Assembly> = LazyLock::new(|| Assembly {
    name: "pop-nest".to_string(),
    w: 3,
    h: 3,
    floor: vec![
        (0, 0),
        (1, 0),
        (2, 0),
        (0, 1),
        (1, 1),
        (2, 1),
        (0, 2),
        (1, 2),
        (2, 2),
    ],
    parts: vec![
        AssemblyPart {
            ci: 1,
            cj: 0,
            kind: "bumper".to_string(),
            dir: O,
            dir2: None,
            role: Some("rebound".to_string()),
            seq: None,
        },
        AssemblyPart {
            ci: 0,
            cj: 2,
            kind: "bumper".to_string(),
            dir: O,
            dir2: None,
            role: Some("rebound".to_string()),
            seq: None,
        },
        AssemblyPart {
            ci: 2,
            cj: 2,
            kind: "bumper".to_string(),
            dir: O,
            dir2: None,
            role: Some("rebound".to_string()),
            seq: None,
        },
    ],
    ports: vec![
        AssemblyPort {
            ci: 1,
            cj: 1,
            dir: S,
            way: PortWay::In,
            flow: PortFlow::Ballistic,
            tag: Some("mouth".to_string()),
        },
        AssemblyPort {
            ci: 1,
            cj: 2,
            dir: S,
            way: PortWay::Out,
            flow: PortFlow::Impact,
            tag: Some("spill".to_string()),
        },
    ],
});

pub static SLING_PAIR: LazyLock<Assembly> = LazyLock::new(|| Assembly {
    name: "sling-pair".to_string(),
    w: 3,
    h: 2,
    floor: vec![
        (0, 0),
        (1, 0),
        (2, 0),
        (0, 1),
        (1, 1),
        (2, 1),
    ],
    parts: vec![
        AssemblyPart {
            ci: 0,
            cj: 1,
            kind: "slingshot".to_string(),
            dir: E,
            dir2: None,
            role: Some("rebound".to_string()),
            seq: Some(0),
        },
        AssemblyPart {
            ci: 2,
            cj: 1,
            kind: "slingshot".to_string(),
            dir: W,
            dir2: None,
            role: Some("rebound".to_string()),
            seq: Some(1),
        },
    ],
    ports: vec![AssemblyPort {
        ci: 1,
        cj: 0,
        dir: S,
        way: PortWay::In,
        flow: PortFlow::Ballistic,
        tag: Some("lane".to_string()),
    }],
});

pub static KICKER_LANE: LazyLock<Assembly> = LazyLock::new(|| Assembly {
    name: "kicker-lane".to_string(),
    w: 2,
    h: 2,
    floor: vec![(0, 0), (1, 0), (0, 1), (1, 1)],
    parts: vec![
        AssemblyPart {
            ci: 0,
            cj: 1,
            kind: "spring".to_string(),
            dir: E,
            dir2: None,
            role: Some("drive".to_string()),
            seq: Some(0),
        },
        AssemblyPart {
            ci: 1,
            cj: 0,
            kind: "rollover".to_string(),
            dir: O,
            dir2: None,
            role: Some("score".to_string()),
            seq: None,
        },
    ],
    ports: vec![
        AssemblyPort {
            ci: 0,
            cj: 0,
            dir: S,
            way: PortWay::In,
            flow: PortFlow::Ballistic,
            tag: Some("mouth".to_string()),
        },
        AssemblyPort {
            ci: 1,
            cj: 1,
            dir: E,
            way: PortWay::Out,
            flow: PortFlow::Eject,
            tag: Some("kickout".to_string()),
        },
    ],
});

pub static SPINNER_GATE: LazyLock<Assembly> = LazyLock::new(|| Assembly {
    name: "spinner-gate".to_string(),
    w: 3,
    h: 1,
    floor: vec![(0, 0), (1, 0), (2, 0)],
    parts: vec![
        AssemblyPart {
            ci: 1,
            cj: 0,
            kind: "spinpad".to_string(),
            dir: E,
            dir2: None,
            role: Some("score".to_string()),
            seq: None,
        },
        AssemblyPart {
            ci: 2,
            cj: 0,
            kind: "booster".to_string(),
            dir: E,
            dir2: None,
            role: Some("drive".to_string()),
            seq: None,
        },
    ],
    ports: vec![
        AssemblyPort {
            ci: 0,
            cj: 0,
            dir: E,
            way: PortWay::In,
            flow: PortFlow::Ballistic,
            tag: Some("mouth".to_string()),
        },
        AssemblyPort {
            ci: 2,
            cj: 0,
            dir: E,
            way: PortWay::Out,
            flow: PortFlow::Ballistic,
            tag: Some("through".to_string()),
        },
    ],
});

pub static ROLLOVER_BANK: LazyLock<Assembly> = LazyLock::new(|| Assembly {
    name: "rollover-bank".to_string(),
    w: 3,
    h: 2,
    floor: vec![
        (0, 0),
        (1, 0),
        (2, 0),
        (0, 1),
        (1, 1),
        (2, 1),
    ],
    parts: vec![
        AssemblyPart {
            ci: 0,
            cj: 0,
            kind: "rollover".to_string(),
            dir: S,
            dir2: None,
            role: Some("score".to_string()),
            seq: Some(0),
        },
        AssemblyPart {
            ci: 1,
            cj: 0,
            kind: "rollover".to_string(),
            dir: S,
            dir2: None,
            role: Some("score".to_string()),
            seq: Some(1),
        },
        AssemblyPart {
            ci: 2,
            cj: 0,
            kind: "rollover".to_string(),
            dir: S,
            dir2: None,
            role: Some("score".to_string()),
            seq: Some(2),
        },
    ],
    ports: vec![
        AssemblyPort {
            ci: 1,
            cj: 0,
            dir: S,
            way: PortWay::In,
            flow: PortFlow::Ballistic,
            tag: Some("lanes".to_string()),
        },
        AssemblyPort {
            ci: 1,
            cj: 1,
            dir: S,
            way: PortWay::Out,
            flow: PortFlow::Ballistic,
            tag: Some("below".to_string()),
        },
    ],
});

pub static MACHINES: LazyLock<Vec<Assembly>> = LazyLock::new(|| {
    vec![
        ORBIT.clone(),
        RAMP_RETURN.clone(),
        TARGET_BANK.clone(),
        POP_NEST.clone(),
        SLING_PAIR.clone(),
        KICKER_LANE.clone(),
        SPINNER_GATE.clone(),
        ROLLOVER_BANK.clone(),
    ]
});

pub fn machine_named(name: &str) -> Option<Assembly> {
    MACHINES.iter().find(|m| m.name == name).cloned()
}
