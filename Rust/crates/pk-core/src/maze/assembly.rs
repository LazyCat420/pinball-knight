//! Pinball assemblies — authored multi-part machines with relative facings and boundary ports.
//!
//! Port of `legacy/src/game/pinball-knight/maze/assembly.ts` (380 lines).
//!
//! PORTS: `maze/assembly.ts`

use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Dir {
    pub di: i32,
    pub dj: i32,
}

pub const N: Dir = Dir { di: 0, dj: -1 };
pub const S: Dir = Dir { di: 0, dj: 1 };
pub const E: Dir = Dir { di: 1, dj: 0 };
pub const W: Dir = Dir { di: -1, dj: 0 };
pub const O: Dir = Dir { di: 0, dj: 0 };

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PartRole {
    Drive,
    Rebound,
    Target,
    Gate,
    Hazard,
}

pub const TWO_LEG_KINDS: &[&str] = &["boostcorner", "deflector"];

pub fn is_two_leg_kind(kind: &str) -> bool {
    TWO_LEG_KINDS.contains(&kind)
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssemblyPart {
    pub ci: i32,
    pub cj: i32,
    pub kind: String,
    pub dir: Dir,
    pub dir2: Option<Dir>,
    pub role: Option<String>,
    pub seq: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PortWay {
    In,
    Out,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PortFlow {
    Ballistic,
    Eject,
    Impact,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssemblyPort {
    pub ci: i32,
    pub cj: i32,
    pub dir: Dir,
    pub way: PortWay,
    pub flow: PortFlow,
    pub tag: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Assembly {
    pub name: String,
    pub w: i32,
    pub h: i32,
    pub floor: Vec<(i32, i32)>,
    pub parts: Vec<AssemblyPart>,
    pub ports: Vec<AssemblyPort>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssemblyRef {
    pub name: String,
    pub x: i32,
    pub z: i32,
    pub rot: u8,
    pub mirror: bool,
}

pub fn rotate_dir(d: Dir) -> Dir {
    Dir {
        di: -d.dj,
        dj: d.di,
    }
}

pub fn mirror_dir(d: Dir) -> Dir {
    Dir {
        di: -d.di,
        dj: d.dj,
    }
}

pub fn rotate_assembly(a: &Assembly) -> Assembly {
    let new_w = a.h;
    let new_h = a.w;

    let new_floor = a
        .floor
        .iter()
        .map(|&(ci, cj)| (new_w - 1 - cj, ci))
        .collect();

    let new_parts = a
        .parts
        .iter()
        .map(|p| AssemblyPart {
            ci: new_w - 1 - p.cj,
            cj: p.ci,
            kind: p.kind.clone(),
            dir: rotate_dir(p.dir),
            dir2: p.dir2.map(rotate_dir),
            role: p.role.clone(),
            seq: p.seq,
        })
        .collect();

    let new_ports = a
        .ports
        .iter()
        .map(|p| AssemblyPort {
            ci: new_w - 1 - p.cj,
            cj: p.ci,
            dir: rotate_dir(p.dir),
            way: p.way,
            flow: p.flow,
            tag: p.tag.clone(),
        })
        .collect();

    Assembly {
        name: format!("{}_rot", a.name),
        w: new_w,
        h: new_h,
        floor: new_floor,
        parts: new_parts,
        ports: new_ports,
    }
}

pub fn mirror_assembly(a: &Assembly) -> Assembly {
    let new_floor = a.floor.iter().map(|&(ci, cj)| (a.w - 1 - ci, cj)).collect();

    let new_parts = a
        .parts
        .iter()
        .map(|p| AssemblyPart {
            ci: a.w - 1 - p.ci,
            cj: p.cj,
            kind: p.kind.clone(),
            dir: mirror_dir(p.dir),
            dir2: p.dir2.map(mirror_dir),
            role: p.role.clone(),
            seq: p.seq,
        })
        .collect();

    let new_ports = a
        .ports
        .iter()
        .map(|p| AssemblyPort {
            ci: a.w - 1 - p.ci,
            cj: p.cj,
            dir: mirror_dir(p.dir),
            way: p.way,
            flow: p.flow,
            tag: p.tag.clone(),
        })
        .collect();

    Assembly {
        name: format!("{}_mir", a.name),
        w: a.w,
        h: a.h,
        floor: new_floor,
        parts: new_parts,
        ports: new_ports,
    }
}

pub fn signature_of(a: &Assembly) -> String {
    let mut floor_keys: Vec<String> = a.floor.iter().map(|&(ci, cj)| format!("{},{}", ci, cj)).collect();
    floor_keys.sort();
    let mut part_keys: Vec<String> = a
        .parts
        .iter()
        .map(|p| format!("{}:{},{}:{},{}", p.kind, p.ci, p.cj, p.dir.di, p.dir.dj))
        .collect();
    part_keys.sort();
    format!("{}:{};{}", a.w, a.h, floor_keys.join("|"))
}

pub fn orientations_of(a: &Assembly) -> Vec<Assembly> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    let mut cur = a.clone();
    for _ in 0..4 {
        let sig = signature_of(&cur);
        if seen.insert(sig) {
            out.push(cur.clone());
        }
        let mir = mirror_assembly(&cur);
        let mir_sig = signature_of(&mir);
        if seen.insert(mir_sig) {
            out.push(mir);
        }
        cur = rotate_assembly(&cur);
    }

    out
}

pub fn ports_chain(from: &AssemblyPort, to: &AssemblyPort) -> bool {
    from.way != PortWay::In
        && to.way != PortWay::Out
        && from.dir.di == -to.dir.di
        && from.dir.dj == -to.dir.dj
}

pub fn has_exit(a: &Assembly) -> bool {
    a.ports.iter().any(|p| p.way != PortWay::In)
}
