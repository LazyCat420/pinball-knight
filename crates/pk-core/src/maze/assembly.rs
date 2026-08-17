//! Pinball assemblies — authored multi-part machines with relative facings and boundary ports.
//!
//! PORTS-PARTIAL: `maze/assembly.ts` - NOT a finished port - 2 of 9 exported names carried over (22%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Dir {
    pub di: i32,
    pub dj: i32,
}

pub const N: Dir = Dir { di: 0, dj: -1 };
pub const S: Dir = Dir { di: 0, dj: 1 };
pub const E: Dir = Dir { di: 1, dj: 0 };
pub const W: Dir = Dir { di: -1, dj: 0 };
pub const O: Dir = Dir { di: 0, dj: 0 };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortRole {
    Entry,
    Exit,
    Bi,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssemblyPart {
    pub ci: i32,
    pub cj: i32,
    pub kind: String,
    pub dir: Option<Dir>,
    pub role: Option<String>,
    pub seq: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssemblyPort {
    pub ci: i32,
    pub cj: i32,
    pub dir: Dir,
    pub role: PortRole,
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

/// Rotates a cardinal direction vector clockwise by 90° steps (rot = 0..4).
pub fn rotate_dir(d: Dir, rot: u8) -> Dir {
    match rot % 4 {
        0 => d,
        1 => Dir { di: -d.dj, dj: d.di },
        2 => Dir { di: -d.di, dj: -d.dj },
        3 => Dir { di: d.dj, dj: -d.di },
        _ => d,
    }
}

/// Rotates a grid-relative coordinate (ci, cj) inside a bounding box of size (w, h).
pub fn rotate_coord(ci: i32, cj: i32, w: i32, h: i32, rot: u8) -> (i32, i32) {
    match rot % 4 {
        0 => (ci, cj),
        1 => (h - 1 - cj, ci),
        2 => (w - 1 - ci, h - 1 - cj),
        3 => (cj, w - 1 - ci),
        _ => (ci, cj),
    }
}

/// Produces a rotated copy of an authored assembly.
pub fn rotate_assembly(a: &Assembly, rot: u8) -> Assembly {
    let r = rot % 4;
    if r == 0 {
        return a.clone();
    }

    let (new_w, new_h) = if r % 2 == 1 { (a.h, a.w) } else { (a.w, a.h) };

    let mut new_floor = Vec::with_capacity(a.floor.len());
    for &(fi, fj) in &a.floor {
        new_floor.push(rotate_coord(fi, fj, a.w, a.h, r));
    }

    let mut new_parts = Vec::with_capacity(a.parts.len());
    for p in &a.parts {
        let (pi, pj) = rotate_coord(p.ci, p.cj, a.w, a.h, r);
        let new_dir = p.dir.map(|d| rotate_dir(d, r));
        new_parts.push(AssemblyPart {
            ci: pi,
            cj: pj,
            kind: p.kind.clone(),
            dir: new_dir,
            role: p.role.clone(),
            seq: p.seq,
        });
    }

    let mut new_ports = Vec::with_capacity(a.ports.len());
    for port in &a.ports {
        let (pi, pj) = rotate_coord(port.ci, port.cj, a.w, a.h, r);
        new_ports.push(AssemblyPort {
            ci: pi,
            cj: pj,
            dir: rotate_dir(port.dir, r),
            role: port.role,
        });
    }

    Assembly {
        name: format!("{}_r{}", a.name, r),
        w: new_w,
        h: new_h,
        floor: new_floor,
        parts: new_parts,
        ports: new_ports,
    }
}
