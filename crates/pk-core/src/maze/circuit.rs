//! CIRCUITS — the floor's highway loops.
//!
//! PORTS: `maze/circuit.ts`

use std::collections::{HashMap, HashSet};

use crate::grid::{at, idx, Grid, T_FLOOR, T_STAIRS};
use crate::maze::flow_orient::{
    is_downhill, open_runway, phi_at, TilePos, CARDS, UNREACHED,
};

pub const RAY: usize = 12;
pub const MIN_RUNWAY: usize = 3;
pub const MIN_RING: usize = 40;
pub const MIN_ARTERY_SEP: usize = 12;

fn open(g: &Grid, i: i32, j: i32) -> bool {
    let t = at(g, i, j);
    t == T_FLOOR || t == T_STAIRS
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinballPartSpot {
    pub i: i32,
    pub j: i32,
    pub kind: String,
    pub dir_i: i32,
    pub dir_j: i32,
    pub dir2_i: i32,
    pub dir2_j: i32,
    pub circuit: usize,
}

#[derive(Debug, Clone)]
pub struct Circuit {
    pub id: usize,
    pub ring: Vec<TilePos>,
    pub links: Vec<PinballPartSpot>,
    pub off_ramps: Vec<PinballPartSpot>,
    pub interchanges: Vec<TilePos>,
}

pub fn find_rings(
    g: &Grid,
    artery: &[TilePos],
    used: Option<&HashSet<usize>>,
) -> Vec<Vec<TilePos>> {
    if artery.len() < MIN_ARTERY_SEP {
        return Vec::new();
    }
    let mut on_artery: HashMap<usize, usize> = HashMap::new();
    for (k, t) in artery.iter().enumerate() {
        let key = idx(g, t.i, t.j);
        on_artery.entry(key).or_insert(k);
    }

    let mut tag: HashMap<usize, usize> = HashMap::new();
    let mut prev: HashMap<usize, usize> = HashMap::new();
    let mut queue: Vec<TilePos> = Vec::new();

    for (k, t) in artery.iter().enumerate() {
        for (di, dj) in CARDS {
            let ni = t.i + di;
            let nj = t.j + dj;
            if ni < 0 || nj < 0 || ni >= g.w || nj >= g.h {
                continue;
            }
            let key = idx(g, ni, nj);
            if !open(g, ni, nj) || on_artery.contains_key(&key) || used.map_or(false, |u| u.contains(&key)) {
                continue;
            }
            if tag.contains_key(&key) {
                continue;
            }
            tag.insert(key, k);
            prev.insert(key, idx(g, t.i, t.j));
            queue.push(TilePos { i: ni, j: nj });
        }
    }

    let mut pos: HashMap<usize, TilePos> = HashMap::new();
    for t in &queue {
        pos.insert(idx(g, t.i, t.j), *t);
    }

    let path_back = |key: usize, prev: &HashMap<usize, usize>, pos: &HashMap<usize, TilePos>, on_artery: &HashMap<usize, usize>| -> Vec<TilePos> {
        let mut out = Vec::new();
        let mut cur = Some(key);
        let mut seen = HashSet::new();
        while let Some(k) = cur {
            if on_artery.contains_key(&k) || !seen.insert(k) {
                break;
            }
            if let Some(t) = pos.get(&k) {
                out.push(*t);
            }
            cur = prev.get(&k).copied();
        }
        out.reverse();
        out
    };

    let mut rings: Vec<Vec<TilePos>> = Vec::new();
    let mut seen_pair: HashSet<String> = HashSet::new();

    let close = |low: usize,
                 high: usize,
                 from_low: Vec<TilePos>,
                 from_high: Vec<TilePos>,
                 rings: &mut Vec<Vec<TilePos>>,
                 seen_pair: &mut HashSet<String>| {
        let pair_key = format!("{}:{}", low, high);
        if !seen_pair.insert(pair_key) {
            return;
        }
        let mut ring = Vec::new();
        ring.extend_from_slice(&artery[low..=high]);
        ring.extend(from_high);
        let mut rev_low = from_low;
        rev_low.reverse();
        ring.extend(rev_low);
        if ring.len() >= MIN_RING {
            rings.push(ring);
        }
    };

    let mut head = 0;
    while head < queue.len() {
        let t = queue[head];
        head += 1;
        let key = idx(g, t.i, t.j);
        let my_tag = *tag.get(&key).unwrap();
        for (di, dj) in CARDS {
            let ni = t.i + di;
            let nj = t.j + dj;
            if ni < 0 || nj < 0 || ni >= g.w || nj >= g.h {
                continue;
            }
            let nk = idx(g, ni, nj);
            if !open(g, ni, nj) || used.map_or(false, |u| u.contains(&nk)) {
                continue;
            }

            if let Some(&artery_idx) = on_artery.get(&nk) {
                let diff = if artery_idx >= my_tag {
                    artery_idx - my_tag
                } else {
                    my_tag - artery_idx
                };
                if diff < MIN_ARTERY_SEP {
                    continue;
                }
                let detour = path_back(key, &prev, &pos, &on_artery);
                if my_tag < artery_idx {
                    close(my_tag, artery_idx, detour, Vec::new(), &mut rings, &mut seen_pair);
                } else {
                    close(artery_idx, my_tag, Vec::new(), detour, &mut rings, &mut seen_pair);
                }
                continue;
            }

            if let Some(&other_tag) = tag.get(&nk) {
                let diff = if other_tag >= my_tag {
                    other_tag - my_tag
                } else {
                    my_tag - other_tag
                };
                if diff < MIN_ARTERY_SEP {
                    continue;
                }
                let mine = path_back(key, &prev, &pos, &on_artery);
                let theirs = path_back(nk, &prev, &pos, &on_artery);
                if my_tag < other_tag {
                    close(my_tag, other_tag, mine, theirs, &mut rings, &mut seen_pair);
                } else {
                    close(other_tag, my_tag, theirs, mine, &mut rings, &mut seen_pair);
                }
                continue;
            }

            tag.insert(nk, my_tag);
            prev.insert(nk, key);
            pos.insert(nk, TilePos { i: ni, j: nj });
            queue.push(TilePos { i: ni, j: nj });
        }
    }

    rings.sort_by(|a, b| b.len().cmp(&a.len()));
    rings
}

fn step_dir(a: TilePos, b: TilePos) -> Option<(i32, i32)> {
    let di = (b.i - a.i).signum();
    let dj = (b.j - a.j).signum();
    if di.abs() + dj.abs() != 1 {
        return None;
    }
    Some((di, dj))
}

fn next_link_index(ring: &[TilePos], k: usize, dir: (i32, i32)) -> usize {
    let n = ring.len();
    let mut last = k;
    for s in 1..=RAY {
        let cur = ring[(k + s) % n];
        let p = ring[(k + s - 1) % n];
        let Some(d) = step_dir(p, cur) else {
            break;
        };
        if d.0 != dir.0 || d.1 != dir.1 {
            return (k + s - 1) % n;
        }
        last = (k + s) % n;
    }
    last
}

fn open_legs(g: &Grid, t: TilePos) -> usize {
    CARDS
        .iter()
        .filter(|&&(di, dj)| at(g, t.i + di, t.j + dj) == T_FLOOR)
        .count()
}

fn off_ramp_dir(
    g: &Grid,
    phi: &[i32],
    t: TilePos,
    on_ring: &HashSet<usize>,
) -> Option<(i32, i32)> {
    let mut best = None;
    let mut best_run = MIN_RUNWAY.saturating_sub(1);
    for (di, dj) in CARDS {
        let ni = t.i + di;
        let nj = t.j + dj;
        if !open(g, ni, nj) || on_ring.contains(&idx(g, ni, nj)) {
            continue;
        }
        if !is_downhill(g, phi, t.i, t.j, di, dj) {
            continue;
        }
        let run = open_runway(g, t.i, t.j, di, dj, RAY);
        if run > best_run {
            best_run = run;
            best = Some((di, dj));
        }
    }
    best
}

pub struct CircuitOpts<F: Fn(i32, i32) -> bool> {
    pub occupied: F,
    pub start: TilePos,
    pub stairs: TilePos,
    pub max_circuits: usize,
    pub budget: usize,
    pub stride: usize,
    pub existing: Vec<PinballPartSpot>,
}

pub fn author_circuits<F: Fn(i32, i32) -> bool>(
    g: &Grid,
    phi: &[i32],
    routes: &[Vec<TilePos>],
    opts: &CircuitOpts<F>,
) -> Vec<Circuit> {
    let mut circuits = Vec::new();
    if opts.max_circuits == 0 || opts.budget == 0 || routes.is_empty() {
        return circuits;
    }

    let mut used_detour: HashSet<usize> = HashSet::new();
    let mut ring_tiles: HashMap<usize, usize> = HashMap::new();
    let mut spent = 0;
    let mut next_id = 1;

    for route in routes {
        if circuits.len() >= opts.max_circuits || spent >= opts.budget {
            break;
        }
        let rings = find_rings(g, route, Some(&used_detour));

        for ring in rings {
            if circuits.len() >= opts.max_circuits || spent >= opts.budget {
                break;
            }
            let c = lay_circuit(
                g,
                phi,
                &ring,
                next_id,
                &ring_tiles,
                opts,
                opts.budget - spent,
            );
            let Some(c) = c else {
                continue;
            };
            spent += c.links.len();
            for t in &c.ring {
                let key = idx(g, t.i, t.j);
                ring_tiles.insert(key, c.id);
                if !route.iter().any(|r| r.i == t.i && r.j == t.j) {
                    used_detour.insert(key);
                }
            }
            circuits.push(c);
            next_id += 1;
        }
    }
    circuits
}

fn lay_circuit<F: Fn(i32, i32) -> bool>(
    g: &Grid,
    phi: &[i32],
    ring: &[TilePos],
    id: usize,
    ring_tiles: &HashMap<usize, usize>,
    opts: &CircuitOpts<F>,
    budget: usize,
) -> Option<Circuit> {
    let n = ring.len();
    let on_ring: HashSet<usize> = ring.iter().map(|t| idx(g, t.i, t.j)).collect();
    let mut interchanges = Vec::new();
    for t in ring {
        if ring_tiles.contains_key(&idx(g, t.i, t.j)) {
            interchanges.push(*t);
        }
    }

    let mut links = Vec::new();
    let mut off_ramps = Vec::new();
    let mut placed_at = HashSet::new();

    let placeable = |t: TilePos, placed_at: &HashSet<usize>| -> bool {
        !(t.i == opts.stairs.i && t.j == opts.stairs.j)
            && (t.i - opts.start.i).abs() + (t.j - opts.start.j).abs() >= 4
            && !(opts.occupied)(t.i, t.j)
            && !placed_at.contains(&idx(g, t.i, t.j))
            && phi_at(g, phi, t.i, t.j) < UNREACHED
    };

    let mut k = 0;
    let mut best_phi = i32::MAX;
    for (t_idx, t) in ring.iter().enumerate() {
        let p = phi_at(g, phi, t.i, t.j);
        if p < best_phi {
            best_phi = p;
            k = t_idx;
        }
    }

    let mut guard = 0;
    while links.len() < budget && guard < n {
        guard += 1;
        let cur = ring[k];
        let nxt = ring[(k + 1) % n];
        let Some(dir) = step_dir(cur, nxt) else {
            break;
        };

        if placeable(cur, &placed_at) {
            let legs = open_legs(g, cur);
            let shared = ring_tiles.contains_key(&idx(g, cur.i, cur.j));
            let ramp = off_ramp_dir(g, phi, cur, &on_ring);

            let must_yield = shared || (ramp.is_some() && off_ramps.len() < 2);
            if must_yield {
                let spot = if legs >= 3 {
                    PinballPartSpot {
                        i: cur.i,
                        j: cur.j,
                        kind: "bumper".to_string(),
                        dir_i: 0,
                        dir_j: 0,
                        dir2_i: 0,
                        dir2_j: 0,
                        circuit: id,
                    }
                } else {
                    PinballPartSpot {
                        i: cur.i,
                        j: cur.j,
                        kind: "deflector".to_string(),
                        dir_i: -dir.0,
                        dir_j: -dir.1,
                        dir2_i: dir.0,
                        dir2_j: dir.1,
                        circuit: id,
                    }
                };

                if spot.kind == "deflector" && dir.0 == -spot.dir_i && dir.1 == -spot.dir_j {
                    // opposing legs, skip
                } else if spot.kind == "bumper" || legs >= 3 {
                    placed_at.insert(idx(g, cur.i, cur.j));
                    if ramp.is_some() {
                        off_ramps.push(spot.clone());
                    }
                    links.push(spot);
                }
            } else if open_runway(g, cur.i, cur.j, dir.0, dir.1, MIN_RUNWAY) >= MIN_RUNWAY {
                let spot = PinballPartSpot {
                    i: cur.i,
                    j: cur.j,
                    kind: "booster".to_string(),
                    dir_i: dir.0,
                    dir_j: dir.1,
                    dir2_i: 0,
                    dir2_j: 0,
                    circuit: id,
                };
                placed_at.insert(idx(g, cur.i, cur.j));
                links.push(spot);
            }
        }

        let jump = next_link_index(ring, k, dir);
        let advanced = (jump + n - k) % n;
        let step = advanced.max(1).min(RAY);
        k = (k + step) % n;
        if k == 0 && guard > 1 {
            break;
        }
    }

    upgrade_bends(g, phi, ring, &mut links);
    prune_orphan_links(g, ring, &mut links, &opts.existing);

    if links.len() < 4 || off_ramps.len() < 2 {
        return None;
    }

    Some(Circuit {
        id,
        ring: ring.to_vec(),
        links,
        off_ramps,
        interchanges,
    })
}

fn is_launcher(kind: &str) -> bool {
    matches!(
        kind,
        "ramp" | "booster" | "boostcorner" | "spring" | "slingshot" | "flipper" | "jumppad"
    )
}

fn prune_orphan_links(
    g: &Grid,
    ring: &[TilePos],
    links: &mut Vec<PinballPartSpot>,
    existing: &[PinballPartSpot],
) {
    let n = ring.len();
    let mut index_of_tile: HashMap<i64, usize> = HashMap::new();
    for (k, t) in ring.iter().enumerate() {
        index_of_tile.insert((t.i as i64) * 100003 + (t.j as i64), k);
    }

    for _pass in 0..2 {
        let mut by_tile: HashSet<usize> = HashSet::new();
        for q in existing.iter().chain(links.iter()) {
            by_tile.insert(idx(g, q.i, q.j));
        }

        for p in links.iter_mut() {
            if !is_launcher(&p.kind) {
                continue;
            }
            let (di, dj) = if p.kind == "boostcorner" {
                (p.dir2_i, p.dir2_j)
            } else {
                (p.dir_i, p.dir_j)
            };
            if di.abs() + dj.abs() != 1 {
                continue;
            }

            let mut fed = false;
            for s in 1..=RAY {
                let ni = p.i + di * (s as i32);
                let nj = p.j + dj * (s as i32);
                if !open(g, ni, nj) {
                    break;
                }
                let key = idx(g, ni, nj);
                if by_tile.contains(&key) && !(ni == p.i && nj == p.j) {
                    fed = true;
                    break;
                }
            }
            if fed {
                continue;
            }

            let key_coord = (p.i as i64) * 100003 + (p.j as i64);
            let k_opt = index_of_tile.get(&key_coord).copied();
            let into = k_opt.and_then(|k| step_dir(ring[(k + n - 1) % n], ring[k]));
            let out_of = k_opt.and_then(|k| step_dir(ring[k], ring[(k + 1) % n]));

            if let (Some(into), Some(out_of)) = (into, out_of) {
                if into.0 * out_of.0 + into.1 * out_of.1 == 0 {
                    p.kind = "deflector".to_string();
                    p.dir_i = -into.0;
                    p.dir_j = -into.1;
                    p.dir2_i = out_of.0;
                    p.dir2_j = out_of.1;
                    continue;
                }
            }
            if open_legs(g, TilePos { i: p.i, j: p.j }) >= 3 {
                p.kind = "bumper".to_string();
                p.dir_i = 0;
                p.dir_j = 0;
                p.dir2_i = 0;
                p.dir2_j = 0;
            } else {
                p.kind = "REMOVE".to_string();
            }
        }

        links.retain(|l| l.kind != "REMOVE");
    }
}

fn upgrade_bends(g: &Grid, phi: &[i32], ring: &[TilePos], links: &mut [PinballPartSpot]) {
    let n = ring.len();
    let mut index_of_tile: HashMap<i64, usize> = HashMap::new();
    for (k, t) in ring.iter().enumerate() {
        index_of_tile.insert((t.i as i64) * 100003 + (t.j as i64), k);
    }

    for p in links.iter_mut() {
        if p.kind != "booster" {
            continue;
        }
        let key_coord = (p.i as i64) * 100003 + (p.j as i64);
        let Some(&k) = index_of_tile.get(&key_coord) else {
            continue;
        };
        let into = step_dir(ring[(k + n - 1) % n], ring[k]);
        let out_of = step_dir(ring[k], ring[(k + 1) % n]);
        let (Some(into), Some(out_of)) = (into, out_of) else {
            continue;
        };
        if into.0 * out_of.0 + into.1 * out_of.1 != 0 {
            continue;
        }
        if at(g, p.i - into.0, p.j - into.1) != T_FLOOR && at(g, p.i - into.0, p.j - into.1) != T_STAIRS {
            continue;
        }
        if at(g, p.i + out_of.0, p.j + out_of.1) != T_FLOOR && at(g, p.i + out_of.0, p.j + out_of.1) != T_STAIRS {
            continue;
        }

        let can_boost = open_runway(g, p.i, p.j, out_of.0, out_of.1, MIN_RUNWAY) >= MIN_RUNWAY
            && is_downhill(g, phi, p.i, p.j, out_of.0, out_of.1);
        p.kind = if can_boost {
            "boostcorner".to_string()
        } else {
            "deflector".to_string()
        };
        p.dir_i = -into.0;
        p.dir_j = -into.1;
        p.dir2_i = out_of.0;
        p.dir2_j = out_of.1;
    }
}
