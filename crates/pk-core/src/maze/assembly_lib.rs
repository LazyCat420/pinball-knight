//! Canonical pinball machine library — authored modular mechanisms.
//!
//! PORTS: `maze/assembly-lib.ts`

use super::assembly::{Assembly, AssemblyPart, AssemblyPort, PortRole, Dir, E, N, S, W};

/// The classic Orbit: a curved wraparound lane that returns the ball with preserved speed.
pub fn orbit() -> Assembly {
    Assembly {
        name: "orbit".to_string(),
        w: 4,
        h: 3,
        floor: vec![
            (0, 0), (1, 0), (2, 0), (3, 0),
            (3, 1),
            (0, 2), (1, 2), (2, 2), (3, 2),
        ],
        parts: vec![
            AssemblyPart {
                ci: 1,
                cj: 0,
                kind: "booster".to_string(),
                dir: Some(E),
                role: Some("drive".to_string()),
                seq: Some(0),
            },
            AssemblyPart {
                ci: 3,
                cj: 0,
                kind: "deflector".to_string(),
                dir: Some(S),
                role: Some("corner".to_string()),
                seq: Some(1),
            },
            AssemblyPart {
                ci: 3,
                cj: 2,
                kind: "deflector".to_string(),
                dir: Some(W),
                role: Some("corner".to_string()),
                seq: Some(2),
            },
            AssemblyPart {
                ci: 1,
                cj: 2,
                kind: "booster".to_string(),
                dir: Some(W),
                role: Some("return".to_string()),
                seq: Some(3),
            },
        ],
        ports: vec![
            AssemblyPort {
                ci: 0,
                cj: 0,
                dir: E,
                role: PortRole::Entry,
            },
            AssemblyPort {
                ci: 0,
                cj: 2,
                dir: W,
                role: PortRole::Exit,
            },
        ],
    }
}

/// The Slingshot Pair: two diagonal rebounders positioned above the flippers.
pub fn slingshot_pair() -> Assembly {
    Assembly {
        name: "slingshot_pair".to_string(),
        w: 5,
        h: 3,
        floor: vec![
            (0, 0), (1, 0), (2, 0), (3, 0), (4, 0),
            (0, 1), (1, 1), (2, 1), (3, 1), (4, 1),
            (0, 2), (1, 2), (2, 2), (3, 2), (4, 2),
        ],
        parts: vec![
            AssemblyPart {
                ci: 1,
                cj: 1,
                kind: "slingshot_l".to_string(),
                dir: Some(Dir { di: 1, dj: -1 }),
                role: Some("slingshot".to_string()),
                seq: Some(0),
            },
            AssemblyPart {
                ci: 3,
                cj: 1,
                kind: "slingshot_r".to_string(),
                dir: Some(Dir { di: -1, dj: -1 }),
                role: Some("slingshot".to_string()),
                seq: Some(1),
            },
        ],
        ports: vec![
            AssemblyPort {
                ci: 2,
                cj: 2,
                dir: N,
                role: PortRole::Entry,
            },
            AssemblyPort {
                ci: 2,
                cj: 0,
                dir: N,
                role: PortRole::Exit,
            },
        ],
    }
}

/// Drop Target Bank: a row of targets guarding a reward vault.
pub fn drop_target_bank() -> Assembly {
    Assembly {
        name: "drop_target_bank".to_string(),
        w: 5,
        h: 2,
        floor: vec![
            (0, 0), (1, 0), (2, 0), (3, 0), (4, 0),
            (0, 1), (1, 1), (2, 1), (3, 1), (4, 1),
        ],
        parts: vec![
            AssemblyPart {
                ci: 1,
                cj: 0,
                kind: "target".to_string(),
                dir: Some(S),
                role: Some("bank".to_string()),
                seq: Some(0),
            },
            AssemblyPart {
                ci: 2,
                cj: 0,
                kind: "target".to_string(),
                dir: Some(S),
                role: Some("bank".to_string()),
                seq: Some(1),
            },
            AssemblyPart {
                ci: 3,
                cj: 0,
                kind: "target".to_string(),
                dir: Some(S),
                role: Some("bank".to_string()),
                seq: Some(2),
            },
        ],
        ports: vec![
            AssemblyPort {
                ci: 2,
                cj: 1,
                dir: N,
                role: PortRole::Entry,
            },
        ],
    }
}

/// Scoop Return: a saucer scoop that catches balls and ejects them along a track.
pub fn scoop_return() -> Assembly {
    Assembly {
        name: "scoop_return".to_string(),
        w: 3,
        h: 3,
        floor: vec![
            (0, 0), (1, 0), (2, 0),
            (0, 1), (1, 1), (2, 1),
            (0, 2), (1, 2), (2, 2),
        ],
        parts: vec![
            AssemblyPart {
                ci: 1,
                cj: 1,
                kind: "scoop".to_string(),
                dir: Some(S),
                role: Some("eject".to_string()),
                seq: Some(0),
            },
        ],
        ports: vec![
            AssemblyPort {
                ci: 1,
                cj: 0,
                dir: S,
                role: PortRole::Entry,
            },
            AssemblyPort {
                ci: 1,
                cj: 2,
                dir: S,
                role: PortRole::Exit,
            },
        ],
    }
}

/// Plunger Runway: a high-speed launch chute.
pub fn plunger_runway() -> Assembly {
    Assembly {
        name: "plunger_runway".to_string(),
        w: 2,
        h: 5,
        floor: vec![
            (0, 0), (1, 0),
            (0, 1), (1, 1),
            (0, 2), (1, 2),
            (0, 3), (1, 3),
            (0, 4), (1, 4),
        ],
        parts: vec![
            AssemblyPart {
                ci: 0,
                cj: 4,
                kind: "plunger".to_string(),
                dir: Some(N),
                role: Some("launch".to_string()),
                seq: Some(0),
            },
            AssemblyPart {
                ci: 0,
                cj: 2,
                kind: "magstrip".to_string(),
                dir: Some(N),
                role: Some("accel".to_string()),
                seq: Some(1),
            },
        ],
        ports: vec![
            AssemblyPort {
                ci: 0,
                cj: 0,
                dir: N,
                role: PortRole::Exit,
            },
        ],
    }
}

/// Returns the full collection of authored pinball machines.
pub fn all_machines() -> Vec<Assembly> {
    vec![
        orbit(),
        slingshot_pair(),
        drop_target_bank(),
        scoop_return(),
        plunger_runway(),
    ]
}
