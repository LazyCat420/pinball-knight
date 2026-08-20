//! THE PIECE REGISTRY — every renderable maze piece, labelled, with its rules.
//!
//! Port of `legacy/src/game/pinball-knight/maze/piece-rules.ts` (487 lines).
//!
//! PORTS: `maze/piece-rules.ts`

use std::collections::HashMap;

use super::arc_contract::{backed_fraction, find_arc_junctions, MIN_ARC_LEN, MIN_ARC_TILES};
use super::arc_sweeps::{rail_exit, RAIL_MIN_RUNWAY};
use super::flow_loops::{exit_ray, FlowPart};
use super::flow_orient::{is_downhill, open_runway};
use super::track_socket::near_sealed_coords;
use crate::grid::{at, idx, is_walkable, Grid, T_CRACKED, T_STAIRS, T_WALL};
use crate::maze::TrackMask;
use crate::tile_shape::{is_shaped, shape_backing, ArcFeature, SHAPE_ARC, SHAPE_FULL};

/// Open tiles a placed launcher must have ahead of it.
pub const MIN_PART_RUNWAY: usize = 3;

/// Parts that throw the player along a heading.
pub const THROWING: &[&str] = &[
    "ramp",
    "booster",
    "boostcorner",
    "spring",
    "slingshot",
    "flipper",
    "jumppad",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PieceLabel {
    WallBox,
    WallBevel,
    ArcFace,
    Rubber,
    Rail,
    FloorRoom,
    FloorRoad,
    FloorSealed,
    Crack,
    Stairs,
    Furniture,
}

impl PieceLabel {
    pub fn as_str(&self) -> &'static str {
        match self {
            PieceLabel::WallBox => "wall-box",
            PieceLabel::WallBevel => "wall-bevel",
            PieceLabel::ArcFace => "arc-face",
            PieceLabel::Rubber => "rubber",
            PieceLabel::Rail => "rail",
            PieceLabel::FloorRoom => "floor-room",
            PieceLabel::FloorRoad => "floor-road",
            PieceLabel::FloorSealed => "floor-sealed",
            PieceLabel::Crack => "crack",
            PieceLabel::Stairs => "stairs",
            PieceLabel::Furniture => "furniture",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PieceViolation {
    pub label: PieceLabel,
    pub rule: &'static str,
    pub i: i32,
    pub j: i32,
    pub detail: String,
}

const SIDES: &[(i32, i32)] = &[(1, 0), (-1, 0), (0, 1), (0, -1)];
const BAND_TILES: &[(i32, i32)] = &[(0, 0), (1, 0), (0, 1), (1, 1)];

/// What a caller must hand over for the rules that judge more than the grid.
pub struct PieceContent<'a> {
    pub phi: Option<&'a [i32]>,
    pub parts: Option<&'a [FlowPart]>,
}

fn is_throwing(kind: &str) -> bool {
    THROWING.iter().any(|&k| k == kind)
}

/// Check every piece on a finished floor against its rules.
pub fn check_pieces(
    g: &Grid,
    mask: Option<&TrackMask>,
    content: Option<&PieceContent>,
) -> Vec<PieceViolation> {
    let mut out = Vec::new();
    let phi = content.and_then(|c| c.phi);
    let arcs: &[ArcFeature] = &g.arcs;

    // 1. Tile pieces
    let mut stairs_count = 0;
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            let k = idx(g, i, j);
            let shape = if k < g.shapes.len() {
                g.shapes[k]
            } else {
                SHAPE_FULL
            };
            if at(g, i, j) == T_STAIRS {
                stairs_count += 1;
            }

            if is_walkable(g, i, j) {
                continue;
            }

            if at(g, i, j) == T_CRACKED {
                if (i & 1) == 0 && (j & 1) == 0 {
                    let mut open_around = 0;
                    for &(bi, bj) in BAND_TILES {
                        let x = i + bi;
                        let y = j + bj;
                        if at(g, x, y) != T_CRACKED {
                            continue;
                        }
                        for &(di, dj) in SIDES {
                            if is_walkable(g, x + di, y + dj) {
                                open_around += 1;
                            }
                        }
                    }
                    if open_around == 0 {
                        out.push(PieceViolation {
                            label: PieceLabel::Crack,
                            rule: "separates two open tiles (smashing it opens something)",
                            i,
                            j,
                            detail: "the whole 2x2 band is sealed in stone".into(),
                        });
                    }
                }
                continue;
            }

            if shape == SHAPE_ARC {
                continue; // judged as part of its feature below
            }

            if is_shaped(shape) {
                if let Some(back) = shape_backing(shape) {
                    for v in back {
                        let vx = v.x.round() as i32;
                        let vz = v.z.round() as i32;
                        if is_walkable(g, i + vx, j + vz) {
                            out.push(PieceViolation {
                                label: PieceLabel::WallBevel,
                                rule: "both legs backed by solid neighbours",
                                i,
                                j,
                                detail: format!("leg ({vx},{vz}) is open floor"),
                            });
                            break;
                        }
                    }
                }
                continue;
            }

            // Plain solid block.
            if let Some(m) = mask {
                if near_sealed_coords(g.w, g.h, &m.sealed, i, j) {
                    continue;
                }
            }
            let mut open = 0;
            for &(di, dj) in SIDES {
                if is_walkable(g, i + di, j + dj) {
                    open += 1;
                }
            }
            if open >= 4 {
                out.push(PieceViolation {
                    label: PieceLabel::WallBox,
                    rule: "not an isolated pillar",
                    i,
                    j,
                    detail: "open on all four sides".into(),
                });
            } else if open >= 3 {
                out.push(PieceViolation {
                    label: PieceLabel::WallBox,
                    rule: "not a stub: at most 2 open orthogonal neighbours",
                    i,
                    j,
                    detail: format!("{open} open neighbours"),
                });
            }
        }
    }

    if stairs_count != 1 {
        out.push(PieceViolation {
            label: PieceLabel::Stairs,
            rule: "exactly one per floor",
            i: 0,
            j: 0,
            detail: format!("{stairs_count} stairs tiles on the floor"),
        });
    }

    // 2. Arc features
    let mut tiles_per = vec![0_i32; arcs.len()];
    if let Some(arc_idx) = &g.arc_idx {
        for k in 0..g.shapes.len() {
            if g.shapes[k] != SHAPE_ARC {
                continue;
            }
            let i = (k % g.w as usize) as i32;
            let j = (k / g.w as usize) as i32;
            if at(g, i, j) != T_WALL {
                continue;
            }
            let fi = arc_idx[k];
            if fi >= 0 && (fi as usize) < arcs.len() {
                tiles_per[fi as usize] += 1;
            }
        }
    }

    for fi in 0..arcs.len() {
        let f = &arcs[fi];
        let ci = f.cx.round() as i32;
        let cj = f.cz.round() as i32;
        let backed = backed_fraction(g, f);
        if backed < 0.999 {
            out.push(PieceViolation {
                label: PieceLabel::ArcFace,
                rule: "fully backed: stone behind every sampled point of the drawn span",
                i: ci,
                j: cj,
                detail: format!("only {:.0}% of the span is backed", backed * 100.0),
            });
        }
        if f.r * f.span < MIN_ARC_LEN {
            out.push(PieceViolation {
                label: PieceLabel::ArcFace,
                rule: "at least MIN_ARC_LEN of arc",
                i: ci,
                j: cj,
                detail: format!("arc length {:.2} < {MIN_ARC_LEN}", f.r * f.span),
            });
        }
        if f.owner.as_deref() != Some("island") && (tiles_per[fi] as f64) < MIN_ARC_TILES as f64 {
            out.push(PieceViolation {
                label: PieceLabel::ArcFace,
                rule: "owns at least MIN_ARC_TILES wall tiles (islands exempt)",
                i: ci,
                j: cj,
                detail: format!("owns {} tiles", tiles_per[fi]),
            });
        }

        let closed = f.span >= std::f64::consts::PI * 2.0 - 1e-6;
        let in_span = |a0: f64, span: f64| -> bool {
            closed || (a0 >= f.a0 - 1e-6 && a0 + span <= f.a0 + f.span + 1e-6)
        };

        for b in &f.kicks {
            if !in_span(b.a0, b.span) {
                out.push(PieceViolation {
                    label: PieceLabel::Rubber,
                    rule: "angular range lies inside the owning arc-face's span",
                    i: ci,
                    j: cj,
                    detail: "kick band runs past the arc it rides".into(),
                });
            }
        }

        for b in &f.lanes {
            if !in_span(b.a0, b.span) {
                out.push(PieceViolation {
                    label: PieceLabel::Rail,
                    rule: "angular range lies inside the owning arc-face's span",
                    i: ci,
                    j: cj,
                    detail: "lane band runs past the arc it rides".into(),
                });
            }
            if let Some(p) = phi {
                if let Some(x) = rail_exit(g, f, b, b.cw) {
                    let run = open_runway(g, x.i, x.j, x.di, x.dj, RAIL_MIN_RUNWAY);
                    if run < RAIL_MIN_RUNWAY {
                        out.push(PieceViolation {
                            label: PieceLabel::Rail,
                            rule: "exit has RAIL_MIN_RUNWAY open tiles along the direction it throws",
                            i: ci,
                            j: cj,
                            detail: format!("{run} open tiles past the exit at ({},{}), wants {RAIL_MIN_RUNWAY}", x.i, x.j),
                        });
                    }
                    if !is_downhill(g, p, x.i, x.j, x.di, x.dj) {
                        out.push(PieceViolation {
                            label: PieceLabel::Rail,
                            rule: "throws DOWN-Φ: its exit is strictly closer to the stairs than its entry",
                            i: ci,
                            j: cj,
                            detail: format!("exit ({},{}) throws ({},{}), which is not down-Φ", x.i, x.j, x.di, x.dj),
                        });
                    }
                } else {
                    out.push(PieceViolation {
                        label: PieceLabel::Rail,
                        rule: "exit has RAIL_MIN_RUNWAY open tiles along the direction it throws",
                        i: ci,
                        j: cj,
                        detail: "its exit is off the grid or against stone".into(),
                    });
                }
            }
        }
    }

    for jn in find_arc_junctions(g, true) {
        out.push(PieceViolation {
            label: PieceLabel::ArcFace,
            rule: "coherent with any neighbouring feature: no kink, step or curvature flip",
            i: jn.i,
            j: jn.j,
            detail: format!(
                "{} against feature {} (kink {:.0}°, step {:.2})",
                jn.check.reason,
                jn.b,
                (jn.check.kink * 180.0) / std::f64::consts::PI,
                jn.check.step
            ),
        });
    }

    // 3. Sealed lane (the launch chute)
    if let Some(m) = mask {
        for j in 1..(g.h - 1) {
            for i in 1..(g.w - 1) {
                let k = idx(g, i, j);
                if m.sealed[k] != 1 {
                    continue;
                }
                for &(di, dj) in SIDES {
                    let x = i + di;
                    let y = j + dj;
                    if !is_walkable(g, x, y) {
                        continue;
                    }
                    let xk = idx(g, x, y);
                    if m.lane[xk] == 1 {
                        continue;
                    }
                    out.push(PieceViolation {
                        label: PieceLabel::FloorSealed,
                        rule: "side walls solid for its full length except the mouth",
                        i,
                        j,
                        detail: format!("opens onto off-lane floor at ({x},{y})"),
                    });
                }
            }
        }
    }

    // 4. Furniture
    if let Some(c) = content {
        if let Some(parts) = c.parts {
            for p in parts {
                if !is_walkable(g, p.i, p.j) {
                    out.push(PieceViolation {
                        label: PieceLabel::Furniture,
                        rule: "stands on walkable floor",
                        i: p.i,
                        j: p.j,
                        detail: format!("{} stands on a wall tile", p.kind),
                    });
                    continue;
                }
                if !is_throwing(&p.kind) {
                    continue;
                }
                let (di, dj) = exit_ray(p);
                if di.abs() + dj.abs() != 1 {
                    continue;
                }
                if p.vault || p.chute {
                    continue;
                }
                if open_runway(g, p.i, p.j, di, dj, MIN_PART_RUNWAY) < MIN_PART_RUNWAY
                    && at(g, p.i + di, p.j + dj) != T_CRACKED
                {
                    out.push(PieceViolation {
                        label: PieceLabel::Furniture,
                        rule: "throws along a heading with MIN_RUNWAY open tiles, or is a deliberate exception",
                        i: p.i,
                        j: p.j,
                        detail: format!("{} fires ({di},{dj}) into stone within {MIN_PART_RUNWAY} tiles", p.kind),
                    });
                }
                if let Some(p_phi) = phi {
                    if p.spine && !is_downhill(g, p_phi, p.i, p.j, di, dj) {
                        out.push(PieceViolation {
                            label: PieceLabel::Furniture,
                            rule: "a route part fires strictly down-Φ",
                            i: p.i,
                            j: p.j,
                            detail: format!("route {} fires ({di},{dj}), which is not down-Φ", p.kind),
                        });
                    }
                }
            }
        }
    }

    out
}

/// Group violations by label for a readable failure message.
pub fn summarise(v: &[PieceViolation]) -> String {
    let mut by: HashMap<String, Vec<&PieceViolation>> = HashMap::new();
    for x in v {
        let key = format!("{} — {}", x.label.as_str(), x.rule);
        by.entry(key).or_default().push(x);
    }
    let mut entries: Vec<_> = by.into_iter().collect();
    entries.sort_by(|a, b| b.1.len().cmp(&a.1.len()));

    entries
        .into_iter()
        .map(|(key, xs)| {
            format!(
                "  {}x {}\n      e.g. ({},{}) {}",
                xs.len(),
                key,
                xs[0].i,
                xs[0].j,
                xs[0].detail
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Every tile piece's label.
pub fn piece_at(g: &Grid, mask: Option<&TrackMask>, i: i32, j: i32) -> PieceLabel {
    let k = idx(g, i, j);
    if at(g, i, j) == T_STAIRS {
        return PieceLabel::Stairs;
    }
    if is_walkable(g, i, j) {
        if let Some(m) = mask {
            if m.sealed[k] == 1 {
                return PieceLabel::FloorSealed;
            }
            if m.lane[k] == 1 {
                return PieceLabel::FloorRoad;
            }
        }
        return PieceLabel::FloorRoom;
    }
    if at(g, i, j) == T_CRACKED {
        return PieceLabel::Crack;
    }
    let shape = if k < g.shapes.len() {
        g.shapes[k]
    } else {
        SHAPE_FULL
    };
    if shape == SHAPE_ARC {
        return PieceLabel::ArcFace;
    }
    if shape != SHAPE_FULL {
        return PieceLabel::WallBevel;
    }
    PieceLabel::WallBox
}

/// Convenience for tests/tools: how many of each piece a floor is made of.
pub fn piece_census(g: &Grid, mask: Option<&TrackMask>) -> HashMap<String, usize> {
    let mut out: HashMap<String, usize> = HashMap::new();
    for j in 0..g.h {
        for i in 0..g.w {
            let l = piece_at(g, mask, i, j);
            *out.entry(l.as_str().to_string()).or_insert(0) += 1;
        }
    }
    out.insert("arc-face(features)".to_string(), g.arcs.len());
    out
}

/// Validates all placed maze pieces and parts against design invariants (compatibility wrapper).
pub fn validate_piece_rules(g: &Grid, parts: &[FlowPart]) -> Vec<PieceViolation> {
    let content = PieceContent {
        phi: None,
        parts: Some(parts),
    };
    check_pieces(g, None, Some(&content))
}
