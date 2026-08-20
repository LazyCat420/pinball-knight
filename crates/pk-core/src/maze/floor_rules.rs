//! FLOOR RULES — placement weights and invariants for generated maze floors.
//!
//! Port of `legacy/src/game/pinball-knight/maze/floor-rules.ts` (430 lines).
//!
//! PORTS: `maze/floor-rules.ts`

use super::archetypes::ArchetypeId;
use super::doorways::{
    clearance_field, measure_doorway, width_from_clearance, Doorway, DOORWAY_WIDTHS,
    MIN_DOORWAY_WIDTH,
};
use super::track_launch::TilePos;
use crate::grid::{idx, is_walkable, Grid};

/// The archetype's grip on the placement rules.
#[derive(Clone, Debug, PartialEq)]
pub struct FloorRuleWeights {
    /// How strongly the spawn is pulled toward the map's edge, 0..1.
    pub perimeter_bias: f64,
    /// Minimum path distance, in tiles, from the spawn to the boss / exit.
    pub min_boss_tiles: i32,
    /// Minimum straight-line distance, in tiles, from the spawn to the boss.
    pub min_boss_euclid: f64,
}

/// The GLOBAL baseline. An archetype overrides only what it has a reason to.
pub const DEFAULT_RULE_WEIGHTS: FloorRuleWeights = FloorRuleWeights {
    perimeter_bias: 0.75,
    min_boss_tiles: 30,
    min_boss_euclid: 20.0,
};

impl Default for FloorRuleWeights {
    fn default() -> Self {
        DEFAULT_RULE_WEIGHTS
    }
}

/// The perimeter score a high-bias floor must reach.
pub const PERIMETER_RULE_MIN: f64 = 0.34;

/// THE KING'S HALL — radius in tiles needed for the Reaper King boss arena.
pub const BOSS_ARENA_R: f64 = 7.0;

/// Minimum passage width at the boss tile, derived from SLAM_RADIUS and body clearances.
pub const BOSS_ARENA_MIN_WIDTH: i32 = 9;

/// Scores a candidate tile (i, j) based on proximity to the map's perimeter:
/// 1.0 hard against the border, 0.0 dead centre, measured on the shorter axis.
pub fn perimeter_score(g: &Grid, i: i32, j: i32) -> f64 {
    let half = (g.w.min(g.h) as f64) / 2.0;
    if half <= 0.0 {
        return 0.0;
    }
    let d = i.min(j).min(g.w - 1 - i).min(g.h - 1 - j) as f64;
    (1.0 - d / half).clamp(0.0, 1.0)
}

/// Max finite BFS distance in a field — the floor's reach.
pub fn max_reach(g: &Grid, dist: &[i32]) -> i32 {
    let mut m = 0;
    for j in 0..g.h {
        for i in 0..g.w {
            if !is_walkable(g, i, j) {
                continue;
            }
            let d = dist[idx(g, i, j)];
            if d >= 0 && d < 0x3fff_ffff && d > m {
                m = d;
            }
        }
    }
    m
}

/// Verifies that spawn and exit are separated by minimum euclidean and topological distance.
pub fn check_endpoint_separation(
    start_i: i32,
    start_j: i32,
    exit_i: i32,
    exit_j: i32,
    path_len: usize,
    weights: &FloorRuleWeights,
) -> bool {
    let di = (exit_i - start_i) as f64;
    let dj = (exit_j - start_j) as f64;
    let euclid = (di * di + dj * dj).sqrt();

    euclid >= weights.min_boss_euclid && (path_len as i32) >= weights.min_boss_tiles
}

/// Everything a rule needs to judge a finished floor.
pub struct FloorRuleContext<'a> {
    pub grid: &'a Grid,
    pub start: TilePos,
    pub stairs: TilePos,
    /// Where the Reaper King will stand — `nearest_open_tile(stairs, 2)`.
    pub boss_spot: TilePos,
    /// BFS step distance from `start` to every tile.
    pub dist_from_start: &'a [i32],
    pub archetype: ArchetypeId,
    pub weights: FloorRuleWeights,
    /// Rule ids the generator declared it could not satisfy on this floor (`TrackFloor.relaxed`).
    pub relaxed: Option<&'a [String]>,
    /// The floor's authored openings between sections (`TrackFloor.doorways`).
    pub doorways: Option<&'a [Doorway]>,
    /// `clearance_field(grid)`, hoisted by caller if precomputed.
    pub clearance: Option<&'a [i32]>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuleVerdict {
    pub ok: bool,
    /// Human-readable measurement, shown on failure. Always populated.
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FloorRuleViolation {
    pub rule_id: &'static str,
    pub why: &'static str,
    pub verdict: RuleVerdict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FloorRuleDef {
    pub id: &'static str,
    pub why: &'static str,
}

pub const FLOOR_RULES: &[FloorRuleDef] = &[
    FloorRuleDef {
        id: "boss-not-near-spawn",
        why: "you would arrive on the floor already inside the king's reach, with no room to build speed",
    },
    FloorRuleDef {
        id: "boss-not-within-sight-of-spawn",
        why: "his skulls and his ground-pound both ignore walls, so a boss seven tiles away through stone can open fire on your spawn",
    },
    FloorRuleDef {
        id: "exit-not-near-spawn",
        why: "the floor would be over in seconds — the stairs are the run's pacing",
    },
    FloorRuleDef {
        id: "spawn-respects-perimeter-bias",
        why: "every floor type would open in the same place, which is what the archetypes exist to prevent",
    },
    FloorRuleDef {
        id: "doorways-are-uniform",
        why: "an opening the maze happened to leave one tile wide reads as sloppy and rattles the ball between both walls at speed; a doorway is supposed to be a recognisable object",
    },
    FloorRuleDef {
        id: "boss-has-room-to-fight",
        why: "his ground-pound commits to where you were standing 1.1s ago and kills everything within 2.6 tiles of it — in a four-wide gallery there is nowhere to dodge TO, so the fight degenerates into standing in the crater and trading blows",
    },
    FloorRuleDef {
        id: "spawn-is-walkable",
        why: "the player would start inside a wall",
    },
];

fn path_to(ctx: &FloorRuleContext, t: TilePos) -> i32 {
    let d = ctx.dist_from_start[idx(ctx.grid, t.i, t.j)];
    if d >= 0 && d < 0x3fff_ffff {
        d
    } else {
        -1
    }
}

fn is_relaxed(ctx: &FloorRuleContext, rule_id: &str) -> bool {
    ctx.relaxed
        .map(|r| r.iter().any(|s| s == rule_id))
        .unwrap_or(false)
}

/// Run every floor rule. Returns the failures; empty when the floor is clean.
pub fn check_floor_rules(ctx: &FloorRuleContext) -> Vec<FloorRuleViolation> {
    let mut violations = Vec::new();

    // 1. boss-not-near-spawn
    {
        let d = path_to(ctx, ctx.boss_spot);
        let verdict = if d < 0 {
            RuleVerdict {
                ok: false,
                detail: "boss tile is unreachable from the spawn".into(),
            }
        } else if is_relaxed(ctx, "boss-not-near-spawn") {
            RuleVerdict {
                ok: true,
                detail: format!("{d} path tiles — RELAXED (endpoint search settled short)"),
            }
        } else {
            RuleVerdict {
                ok: d >= ctx.weights.min_boss_tiles,
                detail: format!(
                    "{d} path tiles (floor wants >= {})",
                    ctx.weights.min_boss_tiles
                ),
            }
        };
        if !verdict.ok {
            violations.push(FloorRuleViolation {
                rule_id: FLOOR_RULES[0].id,
                why: FLOOR_RULES[0].why,
                verdict,
            });
        }
    }

    // 2. boss-not-within-sight-of-spawn
    {
        let di = (ctx.boss_spot.i - ctx.start.i) as f64;
        let dj = (ctx.boss_spot.j - ctx.start.j) as f64;
        let d = (di * di + dj * dj).sqrt();
        let verdict = if is_relaxed(ctx, "boss-not-within-sight-of-spawn") {
            RuleVerdict {
                ok: true,
                detail: format!(
                    "{d:.1} tiles straight-line — RELAXED (floor too small to separate them)"
                ),
            }
        } else {
            RuleVerdict {
                ok: d >= ctx.weights.min_boss_euclid,
                detail: format!(
                    "{d:.1} tiles straight-line (wants >= {})",
                    ctx.weights.min_boss_euclid
                ),
            }
        };
        if !verdict.ok {
            violations.push(FloorRuleViolation {
                rule_id: FLOOR_RULES[1].id,
                why: FLOOR_RULES[1].why,
                verdict,
            });
        }
    }

    // 3. exit-not-near-spawn
    {
        let d = path_to(ctx, ctx.stairs);
        let verdict = if d < 0 {
            RuleVerdict {
                ok: false,
                detail: "stairs unreachable from the spawn".into(),
            }
        } else if is_relaxed(ctx, "exit-not-near-spawn") {
            RuleVerdict {
                ok: true,
                detail: format!("{d} path tiles — RELAXED (endpoint search settled short)"),
            }
        } else {
            RuleVerdict {
                ok: d >= ctx.weights.min_boss_tiles,
                detail: format!(
                    "{d} path tiles (floor wants >= {})",
                    ctx.weights.min_boss_tiles
                ),
            }
        };
        if !verdict.ok {
            violations.push(FloorRuleViolation {
                rule_id: FLOOR_RULES[2].id,
                why: FLOOR_RULES[2].why,
                verdict,
            });
        }
    }

    // 4. spawn-respects-perimeter-bias
    {
        let s = perimeter_score(ctx.grid, ctx.start.i, ctx.start.j);
        let want = ctx.weights.perimeter_bias;
        let verdict = if want < 0.5 {
            RuleVerdict {
                ok: true,
                detail: format!("bias {want} — exempt (perimeterScore {s:.2})"),
            }
        } else if is_relaxed(ctx, "spawn-respects-perimeter-bias") {
            RuleVerdict {
                ok: true,
                detail: format!("perimeterScore {s:.2} — RELAXED (no peripheral site existed)"),
            }
        } else {
            RuleVerdict {
                ok: s >= PERIMETER_RULE_MIN,
                detail: format!(
                    "perimeterScore {s:.2} (bias {want} wants >= {PERIMETER_RULE_MIN})"
                ),
            }
        };
        if !verdict.ok {
            violations.push(FloorRuleViolation {
                rule_id: FLOOR_RULES[3].id,
                why: FLOOR_RULES[3].why,
                verdict,
            });
        }
    }

    // 5. doorways-are-uniform
    {
        let verdict = match ctx.doorways {
            None => RuleVerdict {
                ok: true,
                detail: "-1 — no doorway plan (legacy floor)".into(),
            },
            Some(ds) if ds.is_empty() => RuleVerdict {
                ok: true,
                detail: "0 authored — no two sections to join on this floor".into(),
            },
            Some(ds) => {
                let mut worst = usize::MAX;
                let mut off_size = Vec::new();
                for d in ds {
                    let w = measure_doorway(ctx.grid, d);
                    if w < worst {
                        worst = w;
                    }
                    if w < d.w as usize {
                        off_size.push((d, w));
                    }
                }
                if !off_size.is_empty() {
                    let (d, w) = off_size[0];
                    RuleVerdict {
                        ok: false,
                        detail: format!(
                            "{w} tiles at ({},{}) — authored {}, {}/{} came out under their own size",
                            d.site.i,
                            d.site.j,
                            d.w,
                            off_size.len(),
                            ds.len()
                        ),
                    }
                } else {
                    let vocab = DOORWAY_WIDTHS
                        .iter()
                        .rev()
                        .map(|x| x.to_string())
                        .collect::<Vec<_>>()
                        .join("/");
                    RuleVerdict {
                        ok: worst >= MIN_DOORWAY_WIDTH as usize,
                        detail: format!(
                            "{worst} tiles narrowest of {} authored (vocabulary {vocab}, wants >= {MIN_DOORWAY_WIDTH})",
                            ds.len()
                        ),
                    }
                }
            }
        };
        if !verdict.ok {
            violations.push(FloorRuleViolation {
                rule_id: FLOOR_RULES[4].id,
                why: FLOOR_RULES[4].why,
                verdict,
            });
        }
    }

    // 6. boss-has-room-to-fight
    {
        let verdict = match ctx.doorways {
            None => RuleVerdict {
                ok: true,
                detail: "-1 — legacy floor, no chamber pass".into(),
            },
            Some(_) => {
                let cl_owned;
                let cl = match ctx.clearance {
                    Some(c) => c,
                    None => {
                        cl_owned = clearance_field(ctx.grid);
                        &cl_owned
                    }
                };
                let w = width_from_clearance(cl[idx(ctx.grid, ctx.boss_spot.i, ctx.boss_spot.j)]);
                if is_relaxed(ctx, "boss-has-room-to-fight") {
                    RuleVerdict {
                        ok: true,
                        detail: format!(
                            "{w} tiles across — RELAXED (no site on this floor could take an r={BOSS_ARENA_R} hall)"
                        ),
                    }
                } else {
                    RuleVerdict {
                        ok: w >= BOSS_ARENA_MIN_WIDTH,
                        detail: format!(
                            "{w} tiles across at the king's tile (wants >= {BOSS_ARENA_MIN_WIDTH}; derived from SLAM_RADIUS 2.6 + PLAYER_R 0.3, twice, plus the king's own 1.08)"
                        ),
                    }
                }
            }
        };
        if !verdict.ok {
            violations.push(FloorRuleViolation {
                rule_id: FLOOR_RULES[5].id,
                why: FLOOR_RULES[5].why,
                verdict,
            });
        }
    }

    // 7. spawn-is-walkable
    {
        let verdict = RuleVerdict {
            ok: is_walkable(ctx.grid, ctx.start.i, ctx.start.j),
            detail: format!("start {},{}", ctx.start.i, ctx.start.j),
        };
        if !verdict.ok {
            violations.push(FloorRuleViolation {
                rule_id: FLOOR_RULES[6].id,
                why: FLOOR_RULES[6].why,
                verdict,
            });
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grid::T_FLOOR;

    #[test]
    fn perimeter_score_calculations() {
        let mut g = Grid::solid(20, 20);
        for k in 0..400 {
            g.t[k] = T_FLOOR;
        }

        // Corner tile (0, 0)
        let s_corner = perimeter_score(&g, 0, 0);
        assert!((s_corner - 1.0).abs() < 1e-6);

        // Center tile (10, 10)
        let s_center = perimeter_score(&g, 10, 10);
        assert!((s_center - 0.1).abs() < 1e-6);
    }
}
