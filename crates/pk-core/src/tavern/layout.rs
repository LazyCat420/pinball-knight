//! THE TAVERN FLOOR PLAN — pure data, no renderer, no DOM.
//! Port of `legacy/src/scenes/tavern/layout.ts` (hand-authored level data; the
//! geometry, the collision and the proximity checks all read from ONE
//! description, and the whole thing is testable without a canvas).
//!
//! Axes match the dungeon: +x east, +z south (toward the camera), 1 unit = 1
//! dungeon tile.
//!
//! PORTS: `legacy/src/scenes/tavern/layout.ts`

/// An axis-aligned box on the floor. Used for both props and collision.
/// Centre + FULL extents (not half), exactly the legacy `Rect`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub z: f64,
    pub w: f64,
    pub d: f64,
}

/// The vendor counters the economy defines (legacy union type).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vendor {
    Cards,
    Weapons,
    Armor,
    Potions,
}

/// What a station does when you interact with it (legacy `StationKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StationKind {
    /// Opens one of the existing vendor counters.
    Vendor(Vendor),
    /// The run summary on the central table.
    Summary,
    /// The casino corner — slots, roulette, blackjack, darts.
    Gambler,
    /// Commit the loadout and generate the next floor.
    Descend,
}

#[derive(Debug, Clone, Copy)]
pub struct Station {
    pub id: &'static str,
    /// Shown in the interaction prompt, e.g. "Forge / Repair".
    pub label: &'static str,
    /// One-line flavour under the label.
    pub blurb: &'static str,
    /// Where the player stands to use it (the FOOT position, not the prop's).
    pub x: f64,
    pub z: f64,
    /// Interaction radius in world units.
    pub radius: f64,
    /// Accent colour — the station's light and its prompt share it.
    pub accent: u32,
    pub action: StationKind,
}

/// Room interior, in world units. Walls sit just outside these bounds.
pub const ROOM_MIN_X: f64 = -9.0;
pub const ROOM_MAX_X: f64 = 9.0;
pub const ROOM_MIN_Z: f64 = -7.0;
pub const ROOM_MAX_Z: f64 = 7.0;

pub const ROOM_W: f64 = ROOM_MAX_X - ROOM_MIN_X;
pub const ROOM_D: f64 = ROOM_MAX_Z - ROOM_MIN_Z;

/// Wall height, matched to the dungeon so the two scenes feel continuous.
pub const WALL_HEIGHT: f64 = 3.2;

/// How far from a wall or prop the player's centre can get.
pub const PLAYER_RADIUS: f64 = 0.32;

/// Ejection overshoot, so a resolved collision never rests exactly on an edge.
const EJECT_EPS: f64 = 1e-3;

/// Warm hearth/forge orange — the "safe, occupied" half of the palette.
pub const WARM: u32 = 0xf0a63c;
/// Cold machine cyan — pinball hardware, card sockets, the way down.
pub const COLD: u32 = 0x6fd0e8;
/// Reserved for rewards and the jackpot sign. Never use it for navigation.
pub const GOLD: u32 = 0xf0c040;

/// The stations, laid out so every one is visible from the room's centre.
/// Coordinates and radii are the legacy values verbatim — see layout.ts for
/// the placement history (stand spots pulled ~0.7 off their counters, etc.).
pub const STATIONS: [Station; 7] = [
    Station {
        id: "board",
        label: "Descend",
        blurb: "commit your loadout and drop into the next floor",
        x: 0.0,
        z: -4.9,
        radius: 1.6,
        accent: COLD,
        action: StationKind::Descend,
    },
    Station {
        id: "forge",
        label: "Forge / Repair",
        blurb: "repair, add a socket, forge and reroll cards",
        x: -4.8,
        z: -2.6,
        radius: 1.7,
        accent: WARM,
        action: StationKind::Vendor(Vendor::Weapons),
    },
    Station {
        id: "bar",
        label: "Trade",
        blurb: "potions for the belt",
        x: 4.8,
        z: -2.6,
        radius: 1.7,
        accent: WARM,
        action: StationKind::Vendor(Vendor::Potions),
    },
    Station {
        id: "table",
        label: "Review Run",
        blurb: "the floor you just cleared",
        x: 0.0,
        z: 0.9,
        radius: 1.9,
        accent: COLD,
        action: StationKind::Summary,
    },
    Station {
        id: "dealer",
        label: "Cards",
        blurb: "buy power cards and socket them",
        x: 4.8,
        z: 2.8,
        radius: 1.7,
        accent: COLD,
        action: StationKind::Vendor(Vendor::Cards),
    },
    Station {
        id: "armory",
        label: "Manage Loadout",
        blurb: "plate, helms and repairs",
        x: -4.8,
        z: 2.8,
        radius: 1.7,
        accent: WARM,
        action: StationKind::Vendor(Vendor::Armor),
    },
    Station {
        id: "gambler",
        label: "Risk Gold",
        blurb: "slots · roulette · blackjack · darts",
        x: 2.2,
        z: 5.5,
        radius: 1.6,
        accent: GOLD,
        action: StationKind::Gambler,
    },
];

/// Solid furniture the player walks around (the PROPS, offset from the
/// station's stand-here position). Order matters: props.ts indexes into this.
pub const OBSTACLES: [Rect; 8] = [
    // The central pinball table — PORTRAIT on purpose (see layout.ts).
    Rect {
        x: 0.0,
        z: -1.6,
        w: 2.3,
        d: 3.2,
    },
    Rect {
        x: -7.2,
        z: -2.6,
        w: 2.6,
        d: 2.2,
    }, // forge + anvil
    Rect {
        x: 7.2,
        z: -2.6,
        w: 2.6,
        d: 2.2,
    }, // bar counter
    Rect {
        x: 7.2,
        z: 2.8,
        w: 2.6,
        d: 2.0,
    }, // card dealer's table
    Rect {
        x: -7.2,
        z: 3.05,
        w: 2.6,
        d: 2.5,
    }, // armory bench (extended south)
    Rect {
        x: 0.0,
        z: -6.4,
        w: 4.2,
        d: 1.0,
    }, // notice board
    Rect {
        x: 2.6,
        z: -6.4,
        w: 0.6,
        d: 0.6,
    }, // the descent plunger housing
    Rect {
        x: 3.9,
        z: 5.9,
        w: 1.6,
        d: 1.0,
    }, // the gambler's arcade cabinet (top lip)
];

/// Where each keeper stands. Lives with the floor plan because it is subject
/// to the same constraint as a stand-here spot: it must be OPEN FLOOR.
#[derive(Debug, Clone, Copy)]
pub struct KeeperSpot {
    /// Matches the Station id it belongs to.
    pub id: &'static str,
    pub x: f64,
    pub z: f64,
}

pub const KEEPER_SPOTS: [KeeperSpot; 5] = [
    KeeperSpot {
        id: "forge",
        x: -6.6,
        z: -0.7,
    },
    KeeperSpot {
        id: "bar",
        x: 6.6,
        z: -0.7,
    },
    KeeperSpot {
        id: "dealer",
        x: 6.6,
        z: 4.4,
    },
    KeeperSpot {
        id: "armory",
        x: -5.35,
        z: 4.3,
    },
    KeeperSpot {
        id: "gambler",
        x: 5.3,
        z: 6.0,
    },
];

/// The player's entry point — at the foot of the dungeon stair, facing in.
pub const SPAWN: (f64, f64) = (0.0, 5.4);

/// Staggered spawn points, one per color slot (multiplayer). Slot 0 keeps the
/// canonical SPAWN; the rest fan out along the south wall around it.
pub const SPAWN_SLOTS: [(f64, f64); 8] = [
    (0.0, 5.4),
    (1.2, 5.2),
    (-1.2, 5.2),
    (2.2, 5.0),
    (-2.2, 5.0),
    (1.0, 5.8),
    (-1.0, 5.8),
    (0.0, 6.0),
];

/// The stair back down, drawn at the south wall.
pub const STAIR: Rect = Rect {
    x: 0.0,
    z: 6.6,
    w: 3.0,
    d: 1.2,
};

/// Squared distance — avoids a sqrt in the per-frame proximity scan.
fn dist2(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = ax - bx;
    let dz = az - bz;
    dx * dx + dz * dz
}

/// The station the player is close enough to use, or None.
/// Returns the NEAREST when radii overlap, so standing between two counters
/// always resolves to one.
pub fn station_at(x: f64, z: f64) -> Option<&'static Station> {
    let mut best: Option<&'static Station> = None;
    let mut best_d = f64::INFINITY;
    for s in &STATIONS {
        let d = dist2(x, z, s.x, s.z);
        if d > s.radius * s.radius {
            continue;
        }
        if d < best_d {
            best_d = d;
            best = Some(s);
        }
    }
    best
}

/// legacy utils/math clamp — argument order (v, lo, hi).
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// Slide a circle to (to_x, to_z), pushed out of the walls and any furniture.
///
/// Ejection is decided by which axis the player was ALREADY clear on before
/// the move — that axis is the one the move crossed. Resolving one axis and
/// leaving the other free is what makes running into a counter at an angle
/// SLIDE along it rather than stick. Mirrors legacy `moveInRoom` exactly,
/// including operation order (walls clamp, per-obstacle eject, final clamp).
pub fn move_in_room(from_x: f64, from_z: f64, to_x: f64, to_z: f64, r: f64) -> (f64, f64) {
    let mut x = to_x;
    let mut z = to_z;

    // Walls first, so furniture resolution can't shove us back through them.
    x = clamp(x, ROOM_MIN_X + r, ROOM_MAX_X - r);
    z = clamp(z, ROOM_MIN_Z + r, ROOM_MAX_Z - r);

    for o in &OBSTACLES {
        let hx = o.w / 2.0 + r;
        let hz = o.d / 2.0 + r;
        if (x - o.x).abs() >= hx || (z - o.z).abs() >= hz {
            continue; // clear of this one
        }

        let was_clear_x = (from_x - o.x).abs() >= hx;
        let was_clear_z = (from_z - o.z).abs() >= hz;

        // Push back out of the face we came through, toward where we came from.
        let eject_x = |x: &mut f64| {
            *x = o.x
                + if from_x >= o.x {
                    hx + EJECT_EPS
                } else {
                    -hx - EJECT_EPS
                };
        };
        let eject_z = |z: &mut f64| {
            *z = o.z
                + if from_z >= o.z {
                    hz + EJECT_EPS
                } else {
                    -hz - EJECT_EPS
                };
        };

        if was_clear_x && !was_clear_z {
            eject_x(&mut x);
        } else if was_clear_z && !was_clear_x {
            eject_z(&mut z);
        } else if was_clear_x && was_clear_z {
            // Diagonal entry through a corner: undo the shallower penetration.
            if hx - (x - o.x).abs() < hz - (z - o.z).abs() {
                eject_x(&mut x);
            } else {
                eject_z(&mut z);
            }
        } else {
            // Already overlapping before the move — shove out the nearest face.
            if hx - (x - o.x).abs() < hz - (z - o.z).abs() {
                x = o.x
                    + if x >= o.x {
                        hx + EJECT_EPS
                    } else {
                        -hx - EJECT_EPS
                    };
            } else {
                z = o.z
                    + if z >= o.z {
                        hz + EJECT_EPS
                    } else {
                        -hz - EJECT_EPS
                    };
            }
        }
    }

    // A corner ejection can push us back into a wall; clamp once more.
    x = clamp(x, ROOM_MIN_X + r, ROOM_MAX_X - r);
    z = clamp(z, ROOM_MIN_Z + r, ROOM_MAX_Z - r);
    (x, z)
}

/// True if a point is inside the room and clear of furniture (tests/spawns).
pub fn is_open(x: f64, z: f64, r: f64) -> bool {
    if x < ROOM_MIN_X + r || x > ROOM_MAX_X - r || z < ROOM_MIN_Z + r || z > ROOM_MAX_Z - r {
        return false;
    }
    for o in &OBSTACLES {
        if (x - o.x).abs() < o.w / 2.0 + r && (z - o.z).abs() < o.d / 2.0 + r {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/layout.test.ts`, case for case.
    use super::*;
    use crate::jsmath::js_hypot;
    use std::collections::HashSet;

    /// Grid resolution for the reachability flood fill, in world units.
    const FILL_STEP: f64 = 0.25;

    /// Every floor cell you can actually WALK to from SPAWN.
    fn reachable_from_spawn() -> HashSet<(i64, i64)> {
        let gx = |x: f64| ((x - ROOM_MIN_X) / FILL_STEP).round() as i64;
        let gz = |z: f64| ((z - ROOM_MIN_Z) / FILL_STEP).round() as i64;
        let wx = |i: i64| ROOM_MIN_X + i as f64 * FILL_STEP;
        let wz = |j: i64| ROOM_MIN_Z + j as f64 * FILL_STEP;
        let cols = ((ROOM_MAX_X - ROOM_MIN_X) / FILL_STEP).ceil() as i64;
        let rows = ((ROOM_MAX_Z - ROOM_MIN_Z) / FILL_STEP).ceil() as i64;

        let mut seen = HashSet::new();
        let start = (gx(SPAWN.0), gz(SPAWN.1));
        let mut queue = vec![start];
        seen.insert(start);

        while let Some((i, j)) = queue.pop() {
            for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let (ni, nj) = (i + di, j + dj);
                if ni < 0 || nj < 0 || ni > cols || nj > rows {
                    continue;
                }
                if seen.contains(&(ni, nj)) {
                    continue;
                }
                if !is_open(wx(ni), wz(nj), PLAYER_RADIUS) {
                    continue;
                }
                seen.insert((ni, nj));
                queue.push((ni, nj));
            }
        }
        seen
    }

    /// True if the flood fill reached any cell within `tol` of (x, z).
    fn reached(fill: &HashSet<(i64, i64)>, x: f64, z: f64, tol: f64) -> bool {
        let span = (tol / FILL_STEP).ceil() as i64;
        let i0 = ((x - ROOM_MIN_X) / FILL_STEP).round() as i64;
        let j0 = ((z - ROOM_MIN_Z) / FILL_STEP).round() as i64;
        for i in i0 - span..=i0 + span {
            for j in j0 - span..=j0 + span {
                if !fill.contains(&(i, j)) {
                    continue;
                }
                let cx = ROOM_MIN_X + i as f64 * FILL_STEP;
                let cz = ROOM_MIN_Z + j as f64 * FILL_STEP;
                if js_hypot(cx - x, cz - z) <= tol {
                    return true;
                }
            }
        }
        false
    }

    #[test]
    fn every_stations_stand_here_spot_is_inside_the_room() {
        for s in &STATIONS {
            assert!(s.x > ROOM_MIN_X && s.x < ROOM_MAX_X, "{} x", s.id);
            assert!(s.z > ROOM_MIN_Z && s.z < ROOM_MAX_Z, "{} z", s.id);
        }
    }

    #[test]
    fn every_station_is_reachable_you_can_stand_where_it_wants_you() {
        for s in &STATIONS {
            assert!(
                is_open(s.x, s.z, PLAYER_RADIUS),
                "station {:?} is inside furniture",
                s.id
            );
        }
    }

    #[test]
    fn the_spawn_point_is_open_floor() {
        assert!(is_open(SPAWN.0, SPAWN.1, PLAYER_RADIUS));
    }

    #[test]
    fn you_can_walk_from_the_spawn_to_every_station_not_just_stand_there() {
        let fill = reachable_from_spawn();
        for s in &STATIONS {
            assert!(
                is_open(s.x, s.z, PLAYER_RADIUS),
                "station {:?} is inside furniture",
                s.id
            );
            assert!(
                reached(&fill, s.x, s.z, 0.4),
                "station {:?} is walled off from the spawn",
                s.id
            );
        }
    }

    #[test]
    fn every_keeper_stands_somewhere_the_player_could_also_walk() {
        let fill = reachable_from_spawn();
        for k in &KEEPER_SPOTS {
            assert!(
                reached(&fill, k.x, k.z, 0.4),
                "keeper {:?} is walled off from the spawn",
                k.id
            );
        }
    }

    #[test]
    fn no_stations_stand_here_spot_falls_inside_another_stations_radius() {
        for a in &STATIONS {
            for b in &STATIONS {
                if a.id == b.id {
                    continue;
                }
                let d = js_hypot(a.x - b.x, a.z - b.z);
                assert!(
                    d > b.radius,
                    "{:?}'s stand spot is inside {:?}'s radius",
                    a.id,
                    b.id
                );
            }
        }
    }

    #[test]
    fn every_stations_stand_spot_has_room_to_stand_in_not_just_on() {
        for s in &STATIONS {
            for (dx, dz) in [(0.35, 0.0), (-0.35, 0.0), (0.0, 0.35), (0.0, -0.35)] {
                assert!(
                    is_open(s.x + dx, s.z + dz, PLAYER_RADIUS),
                    "station {:?} is pinned against furniture toward ({dx},{dz})",
                    s.id
                );
            }
        }
    }

    #[test]
    fn every_keeper_stands_on_open_floor_not_inside_their_own_counter() {
        for k in &KEEPER_SPOTS {
            assert!(
                is_open(k.x, k.z, PLAYER_RADIUS),
                "keeper {:?} is inside furniture",
                k.id
            );
        }
    }

    #[test]
    fn every_keeper_belongs_to_a_real_station() {
        let ids: HashSet<_> = STATIONS.iter().map(|s| s.id).collect();
        for k in &KEEPER_SPOTS {
            assert!(ids.contains(k.id), "keeper {:?} has no station", k.id);
        }
    }

    #[test]
    fn each_keeper_stands_adjacent_to_the_station_they_keep() {
        for k in &KEEPER_SPOTS {
            let s = STATIONS.iter().find(|x| x.id == k.id).unwrap();
            let d = js_hypot(k.x - s.x, k.z - s.z);
            assert!(d < 4.0, "keeper {:?} is {:.1} from its station", k.id, d);
        }
    }

    #[test]
    fn no_keeper_blocks_a_stations_stand_here_spot() {
        for k in &KEEPER_SPOTS {
            let s = STATIONS.iter().find(|x| x.id == k.id).unwrap();
            assert!(
                js_hypot(k.x - s.x, k.z - s.z) > 0.8,
                "keeper {:?} is standing on its own prompt",
                k.id
            );
        }
    }

    #[test]
    fn no_keeper_stands_inside_someone_elses_interaction_radius() {
        for k in &KEEPER_SPOTS {
            for s in &STATIONS {
                if s.id == k.id {
                    continue;
                }
                let d = js_hypot(k.x - s.x, k.z - s.z);
                assert!(
                    d > s.radius,
                    "keeper {:?} is standing in {:?}'s radius",
                    k.id,
                    s.id
                );
            }
        }
    }

    #[test]
    fn every_station_a_keeper_could_staff_has_one() {
        let staffed: HashSet<_> = KEEPER_SPOTS.iter().map(|k| k.id).collect();
        let mut sorted: Vec<_> = staffed.iter().copied().collect();
        sorted.sort_unstable();
        assert_eq!(sorted, vec!["armory", "bar", "dealer", "forge", "gambler"]);
        // Only the two that are not a person's job are allowed to go unstaffed.
        for s in &STATIONS {
            if matches!(s.action, StationKind::Summary | StationKind::Descend) {
                continue;
            }
            assert!(staffed.contains(s.id), "station {:?} has no keeper", s.id);
        }
    }

    #[test]
    fn keeper_spots_are_unique_one_per_station() {
        let ids: Vec<_> = KEEPER_SPOTS.iter().map(|k| k.id).collect();
        let set: HashSet<_> = ids.iter().collect();
        assert_eq!(set.len(), ids.len());
    }

    #[test]
    fn station_ids_are_unique() {
        let ids: Vec<_> = STATIONS.iter().map(|s| s.id).collect();
        let set: HashSet<_> = ids.iter().collect();
        assert_eq!(set.len(), ids.len());
    }

    #[test]
    fn no_two_stations_interaction_radii_overlap() {
        for i in 0..STATIONS.len() {
            for j in i + 1..STATIONS.len() {
                let a = &STATIONS[i];
                let b = &STATIONS[j];
                let d = js_hypot(a.x - b.x, a.z - b.z);
                assert!(
                    d > a.radius + b.radius,
                    "{:?} and {:?} radii overlap",
                    a.id,
                    b.id
                );
            }
        }
    }

    #[test]
    fn covers_every_vendor_the_economy_defines_exactly_once() {
        let mut vendors: Vec<_> = STATIONS
            .iter()
            .filter_map(|s| match s.action {
                StationKind::Vendor(v) => Some(v),
                _ => None,
            })
            .map(|v| match v {
                Vendor::Armor => "armor",
                Vendor::Cards => "cards",
                Vendor::Potions => "potions",
                Vendor::Weapons => "weapons",
            })
            .collect();
        vendors.sort_unstable();
        assert_eq!(vendors, vec!["armor", "cards", "potions", "weapons"]);
    }

    #[test]
    fn has_exactly_one_way_down_one_run_summary_and_one_gambler() {
        let count = |k: fn(&StationKind) -> bool| STATIONS.iter().filter(|s| k(&s.action)).count();
        assert_eq!(count(|a| matches!(a, StationKind::Descend)), 1);
        assert_eq!(count(|a| matches!(a, StationKind::Summary)), 1);
        assert_eq!(count(|a| matches!(a, StationKind::Gambler)), 1);
    }

    #[test]
    fn station_at_finds_the_station_youre_standing_on() {
        let forge = STATIONS.iter().find(|s| s.id == "forge").unwrap();
        assert_eq!(station_at(forge.x, forge.z).map(|s| s.id), Some("forge"));
    }

    #[test]
    fn station_at_returns_none_out_in_the_open() {
        // Just south of the central table, clear of every radius.
        assert!(station_at(0.0, 4.2).is_none());
    }

    #[test]
    fn station_at_resolves_overlapping_radii_to_the_nearest_station() {
        let a = &STATIONS[0];
        assert_eq!(station_at(a.x, a.z).map(|s| s.id), Some(a.id));
    }

    #[test]
    fn station_at_is_exclusive_at_the_radius_boundary() {
        let s = STATIONS.iter().find(|x| x.id == "bar").unwrap();
        assert!(station_at(s.x + s.radius + 0.01, s.z).is_none());
    }

    #[test]
    fn move_in_room_keeps_the_player_inside_the_walls() {
        let (px, pz) = move_in_room(0.0, 0.0, 999.0, 999.0, PLAYER_RADIUS);
        assert!(px <= ROOM_MAX_X - PLAYER_RADIUS);
        assert!(pz <= ROOM_MAX_Z - PLAYER_RADIUS);

        let (qx, qz) = move_in_room(0.0, 0.0, -999.0, -999.0, PLAYER_RADIUS);
        assert!(qx >= ROOM_MIN_X + PLAYER_RADIUS);
        assert!(qz >= ROOM_MIN_Z + PLAYER_RADIUS);
    }

    #[test]
    fn never_lets_the_player_end_up_inside_furniture() {
        // Walk hard into the central table from every side.
        let table = &OBSTACLES[0];
        for (dx, dz) in [(0.0, -4.0), (0.0, 4.0), (-4.0, 0.0), (4.0, 0.0)] {
            let from = (table.x + dx, table.z + dz);
            let (px, pz) = move_in_room(from.0, from.1, table.x, table.z, PLAYER_RADIUS);
            assert!(
                is_open(px, pz, PLAYER_RADIUS),
                "entering from ({dx},{dz}) ended inside the table"
            );
        }
    }

    #[test]
    fn slides_along_a_counter_instead_of_sticking_to_it() {
        // Approach the central table at an angle: the blocked axis stops, the
        // free axis must still make progress.
        let table = &OBSTACLES[0];
        let start_z = table.z + table.d / 2.0 + PLAYER_RADIUS + 0.05;
        let from = (table.x - 1.0, start_z);
        let to = (from.0 + 0.5, start_z - 0.5); // into the table, and along it
        let (px, pz) = move_in_room(from.0, from.1, to.0, to.1, PLAYER_RADIUS);
        assert!(px > from.0, "slid sideways");
        assert!(is_open(px, pz, PLAYER_RADIUS));
    }

    #[test]
    fn a_walk_across_the_room_stays_open_the_whole_way() {
        // Sample the spawn -> notice board path; it crosses the room's spine
        // and must route around the central table rather than through it.
        let mut x = SPAWN.0;
        let mut z = SPAWN.1;
        for _ in 0..400 {
            let (px, pz) = move_in_room(x, z, x, z - 0.05, PLAYER_RADIUS);
            if pz == z {
                // Blocked head-on by the table: step aside, as a player would.
                let (sx, sz) = move_in_room(x, z, x + 0.05, z, PLAYER_RADIUS);
                x = sx;
                z = sz;
            } else {
                x = px;
                z = pz;
            }
            assert!(
                is_open(x, z, PLAYER_RADIUS),
                "left the floor at ({x:.2}, {z:.2})"
            );
        }
    }

    #[test]
    fn obstacles_do_not_overlap_each_other() {
        for i in 0..OBSTACLES.len() {
            for j in i + 1..OBSTACLES.len() {
                let a = &OBSTACLES[i];
                let b = &OBSTACLES[j];
                let overlap =
                    (a.x - b.x).abs() < (a.w + b.w) / 2.0 && (a.z - b.z).abs() < (a.d + b.d) / 2.0;
                assert!(!overlap, "obstacle {i} overlaps {j}");
            }
        }
    }
}
